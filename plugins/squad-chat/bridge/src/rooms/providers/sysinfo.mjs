// This computer's CPU, memory, network, disk, battery, GPU and sensors,
// with no sudo. The commands are fixed here: a manifest can't name one.
//
//   macOS  os.cpus(), vm_stat, sysctl, netstat -ibn, df, pmset, ioreg; and
//          macmon (brew install macmon) when it's there, for temperatures,
//          power by part and fans, which macOS keeps from anyone without root.
//   Linux  os.cpus(), /proc/meminfo, /proc/net/dev, df, /sys/class/power_supply,
//          /sys/class/thermal, nvidia-smi.
//
// Rates and charts need the sample before, so each room keeps its last
// sample and 60 points of history while the bridge runs. Display strings are
// made here; the layout only places them. A provider that fails for one part
// (no battery, no macmon) leaves that part out.

const HISTORY = 60;
const SPARKS = "▁▂▃▄▅▆▇█";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const samples = new Map();   // room data dir → { cpu, net, hist }

// ---------------------------------------------------------------- formats

const GB = 1024 ** 3;
export function bytes(n, digits = 1) {
  if (!Number.isFinite(n)) return "–";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
  return `${i === 0 ? Math.round(n) : n.toFixed(n >= 100 ? 0 : digits)} ${units[i]}`;
}
const rate = (n) => `${bytes(n)}/s`;
const pctOf = (part, whole) => (whole > 0 ? Math.max(0, Math.min(100, Math.round((part / whole) * 100))) : null);
const watts = (w) => (Number.isFinite(w) ? `${w.toFixed(w >= 10 ? 0 : 1)} W` : "");
const celsius = (c) => (Number.isFinite(c) ? `${Math.round(c)}°C` : "");

function spark(values, max = Math.max(...values, 0)) {
  return values.map((v) => (max > 0 && v > 0 ? SPARKS[Math.min(7, Math.max(0, Math.round((v / max) * 7)))] : SPARKS[0])).join("");
}

function push(list, v) {
  list.push(Number.isFinite(v) ? v : 0);
  if (list.length > HISTORY) list.shift();
}

// ---------------------------------------------------------------- CPU (both)

function cpuTimes(list) {
  let idle = 0;
  let total = 0;
  for (const c of list ?? []) {
    const t = c.times ?? {};
    idle += t.idle ?? 0;
    total += (t.user ?? 0) + (t.nice ?? 0) + (t.sys ?? 0) + (t.idle ?? 0) + (t.irq ?? 0);
  }
  return { idle, total, cores: list?.length ?? 0 };
}

// ---------------------------------------------------------------- macOS parsers

export function parseVmStat(text) {
  if (!text) return null;
  const page = Number(/page size of (\d+) bytes/.exec(text)?.[1]) || 4096;
  const get = (name) => Number(new RegExp(`${name}:\\s+(\\d+)`).exec(text)?.[1]) || 0;
  return { used: (get("Pages active") + get("Pages wired down") + get("Pages occupied by compressor")) * page };
}

export function parseSysctl(text) {
  if (!text) return null;
  const [total, swap, level] = text.trim().split("\n");
  const mb = (k) => Number(new RegExp(`${k} = ([\\d.]+)M`).exec(swap ?? "")?.[1]) * 1024 * 1024;
  return { total: Number(total), swapTotal: mb("total"), swapUsed: mb("used"), free: Number(level) };
}

// Bytes in and out across the real interfaces (Ethernet, Wi-Fi, cellular),
// not loopback or tunnels, which would count the same traffic twice.
export function parseNetstat(text) {
  if (!text) return null;
  let rx = 0;
  let tx = 0;
  for (const line of text.split("\n")) {
    if (!/<Link#\d+>/.test(line)) continue;
    const f = line.trim().split(/\s+/);
    if (!/^(en|pdp_ip)\d+$/.test(f[0])) continue;
    rx += Number(f.at(-5)) || 0;
    tx += Number(f.at(-2)) || 0;
  }
  return { rx, tx };
}

export function parseDf(text) {
  const f = text?.trim().split("\n")[1]?.trim().split(/\s+/);
  if (!f || f.length < 4) return null;
  const total = Number(f[1]) * 1024;
  const free = Number(f[3]) * 1024;
  return Number.isFinite(total) && total > 0 ? { total, free, used: total - free } : null;
}

export function parsePmset(text) {
  const line = text?.split("\n").find((l) => /InternalBattery/.test(l));
  if (!line) return null;
  const pct = Number(/(\d+)%/.exec(line)?.[1]);
  const words = line.split(";").map((x) => x.trim().toLowerCase());
  const state = words.includes("charging") ? "charging" : words.includes("charged") ? "charged" : words.includes("discharging") ? "on battery" : "plugged in";
  const left = /(\d+:\d+) remaining/.exec(line)?.[1];
  return { pct, state, timeText: left && left !== "0:00" ? `${left} left` : "" };
}

const signed64 = (s) => { try { const n = BigInt(s); return Number(n >= 2n ** 63n ? n - 2n ** 64n : n); } catch { return NaN; } };

// Watts coming in from the charger, or going out of the battery.
export function parseBatteryPower(text) {
  if (!text) return null;
  const get = (name) => new RegExp(`"${name}" ?= ?(\\d+|Yes|No)`).exec(text)?.[1];
  if (get("ExternalConnected") === "Yes") {
    const mw = Number(get("SystemPowerIn"));
    return Number.isFinite(mw) && mw > 0 ? `${watts(mw / 1000)} in` : "";
  }
  const amps = signed64(get("InstantAmperage"));
  const volts = Number(get("Voltage"));
  return Number.isFinite(amps) && Number.isFinite(volts) && amps < 0 ? `${watts((-amps * volts) / 1e6)} out` : "";
}

export function parseGpuUse(text) {
  const n = Number(/"Device Utilization %"=(\d+)/.exec(text ?? "")?.[1]);
  return Number.isFinite(n) ? n : null;
}

export function parseMacmon(text) {
  const line = text?.trim().split("\n").at(-1);
  if (!line) return null;
  try {
    const m = JSON.parse(line);
    return {
      cpuTemp: m.temp?.cpu_temp_avg,
      gpuTemp: m.temp?.gpu_temp_avg,
      cpuPower: m.cpu_power,
      gpuPower: m.gpu_power,
      allPower: m.all_power,
      sysPower: m.sys_power,
      gpuUse: Number.isFinite(m.gpu_usage?.[1]) ? Math.round(m.gpu_usage[1] * 100) : null,
      ram: m.memory ? { used: m.memory.ram_usage, total: m.memory.ram_total, swapUsed: m.memory.swap_usage, swapTotal: m.memory.swap_total } : null,
      fans: (m.fans ?? []).map((f) => f.rpm),
    };
  } catch { return null; }
}

async function macos(ctx) {
  const macmon = (argv) => ctx.run(argv, { timeoutMs: 2_500 });
  const [vm, sysctl, net, df, batt, ioBatt, ioGpu, sensors] = await Promise.all([
    ctx.run(["vm_stat"]),
    ctx.run(["sysctl", "-n", "hw.memsize", "vm.swapusage", "kern.memorystatus_level"]),
    ctx.run(["netstat", "-ibn"]),
    ctx.run(["df", "-k", "/System/Volumes/Data"]).then((t) => t ?? ctx.run(["df", "-k", "/"])),
    ctx.run(["pmset", "-g", "batt"]),
    ctx.run(["ioreg", "-rn", "AppleSmartBattery"]),
    ctx.run(["ioreg", "-rc", "IOAccelerator", "-d", "1"]),
    macmon(["macmon", "pipe", "-s", "1", "-i", "250"]).then((t) => t ?? macmon(["/opt/homebrew/bin/macmon", "pipe", "-s", "1", "-i", "250"])),
  ]);
  const s = parseSysctl(sysctl);
  const mm = parseMacmon(sensors);
  const vmUsed = parseVmStat(vm)?.used;
  return {
    mem: mm?.ram ?? (s ? { used: vmUsed, total: s.total, swapUsed: s.swapUsed, swapTotal: s.swapTotal } : null),
    pressure: s && Number.isFinite(s.free) ? 100 - s.free : null,
    net: parseNetstat(net),
    disk: parseDf(df),
    battery: parsePmset(batt) ? { ...parsePmset(batt), power: parseBatteryPower(ioBatt) } : null,
    gpuUse: mm?.gpuUse ?? parseGpuUse(ioGpu),
    sensors: mm,
    sensorHint: mm ? "" : "brew install macmon for temperatures, power and fans",
  };
}

// ---------------------------------------------------------------- Linux

export function parseMeminfo(text) {
  if (!text) return null;
  const kb = (k) => (Number(new RegExp(`^${k}:\\s+(\\d+)`, "m").exec(text)?.[1]) || 0) * 1024;
  return { used: kb("MemTotal") - kb("MemAvailable"), total: kb("MemTotal"), swapUsed: kb("SwapTotal") - kb("SwapFree"), swapTotal: kb("SwapTotal") };
}

export function parseNetDev(text) {
  if (!text) return null;
  let rx = 0;
  let tx = 0;
  for (const line of text.split("\n").slice(2)) {
    const [name, rest] = line.split(":");
    if (!rest || /^\s*(lo|docker|veth|br-|virbr|tun|tap)/.test(name)) continue;
    const f = rest.trim().split(/\s+/).map(Number);
    rx += f[0] || 0;
    tx += f[8] || 0;
  }
  return { rx, tx };
}

async function linux(ctx) {
  const zones = await Promise.all(Array.from({ length: 10 }, (_, i) => Promise.all([
    ctx.read(`/sys/class/thermal/thermal_zone${i}/type`), ctx.read(`/sys/class/thermal/thermal_zone${i}/temp`),
  ])));
  const temps = zones.filter(([, t]) => t).map(([type, t]) => ({ type: String(type ?? "").trim(), c: Number(t) / 1000 }));
  const cpuZone = temps.find((z) => /x86_pkg|cpu|soc|k10temp|coretemp/i.test(z.type)) ?? temps[0];
  const [mem, net, df, cap, status, power, gpu] = await Promise.all([
    ctx.read("/proc/meminfo"), ctx.read("/proc/net/dev"), ctx.run(["df", "-k", "/"]),
    ctx.read("/sys/class/power_supply/BAT0/capacity"), ctx.read("/sys/class/power_supply/BAT0/status"), ctx.read("/sys/class/power_supply/BAT0/power_now"),
    ctx.run(["nvidia-smi", "--query-gpu=utilization.gpu,temperature.gpu,power.draw", "--format=csv,noheader,nounits"]),
  ]);
  const [gUse, gTemp, gPower] = (gpu?.trim().split("\n")[0] ?? "").split(",").map((x) => Number(x.trim()));
  const st = String(status ?? "").trim().toLowerCase();
  return {
    mem: parseMeminfo(mem),
    pressure: null,
    net: parseNetDev(net),
    disk: parseDf(df),
    battery: cap ? { pct: Number(cap), state: st === "charging" ? "charging" : st === "full" ? "charged" : st === "discharging" ? "on battery" : "plugged in", timeText: "", power: power ? `${watts(Number(power) / 1e6)} ${st === "discharging" ? "out" : "in"}` : "" } : null,
    gpuUse: Number.isFinite(gUse) ? gUse : null,
    sensors: cpuZone || Number.isFinite(gTemp) ? { cpuTemp: cpuZone?.c, gpuTemp: Number.isFinite(gTemp) ? gTemp : undefined, gpuPower: Number.isFinite(gPower) ? gPower : undefined, fans: [] } : null,
    sensorHint: "",
  };
}

// ---------------------------------------------------------------- the sample

export default {
  type: "sysinfo",
  hosts: [],
  async fetch(params, ctx) {
    const s = samples.get(ctx.dataDir) ?? { cpu: null, net: null, hist: { cpu: [], mem: [], rx: [], tx: [] } };
    samples.set(ctx.dataDir, s);

    // CPU use is the share of time not idle since the last sample: the very
    // first one waits a moment for a second reading.
    let t = cpuTimes(ctx.cpus());
    if (!s.cpu) { s.cpu = t; await sleep(250); t = cpuTimes(ctx.cpus()); }
    const dTotal = t.total - s.cpu.total;
    const cpuPct = dTotal > 0 ? Math.round((1 - (t.idle - s.cpu.idle) / dTotal) * 100) : 0;
    s.cpu = t;

    const os = ctx.platform === "darwin" ? await macos(ctx) : await linux(ctx);
    const now = ctx.now();
    let rx = null;
    let tx = null;
    if (os.net) {
      if (s.net && now > s.net.at) {
        const dt = (now - s.net.at) / 1000;
        rx = Math.max(0, (os.net.rx - s.net.rx) / dt);
        tx = Math.max(0, (os.net.tx - s.net.tx) / dt);
      }
      s.net = { ...os.net, at: now };
    }

    const m = os.mem;
    const memPct = m ? pctOf(m.used, m.total) : null;
    push(s.hist.cpu, cpuPct);
    push(s.hist.mem, memPct);
    push(s.hist.rx, rx);
    push(s.hist.tx, tx);
    const net = { rxText: rx == null ? "–" : rate(rx), txText: tx == null ? "–" : rate(tx) };
    const netMax = Math.max(...s.hist.rx, ...s.hist.tx, 1);

    const sen = os.sensors;
    const load = ctx.loadavg?.() ?? [];
    const gpu = os.gpuUse != null || Number.isFinite(sen?.gpuTemp)
      ? { pct: os.gpuUse, tempText: celsius(sen?.gpuTemp), power: watts(sen?.gpuPower) }
      : null;
    const d = os.disk;
    const b = os.battery;

    const alerts = [];
    if (params.alerts !== false) {
      if (Number.isFinite(sen?.cpuTemp) && sen.cpuTemp >= (params.cpu_temp ?? 90)) alerts.push({ id: "cpu-temp", text: `▦ CPU at ${celsius(sen.cpuTemp)}` });
      if (memPct != null && memPct >= (params.memory ?? 90)) alerts.push({ id: "memory", text: `▦ Memory ${memPct}% used` });
      if (d && pctOf(d.used, d.total) >= 95) alerts.push({ id: "disk", text: `▦ Disk ${pctOf(d.used, d.total)}% full` });
      if (b && b.state === "on battery" && b.pct <= 10) alerts.push({ id: "battery", text: `▦ Battery at ${b.pct}%` });
    }

    return {
      cpu: {
        pct: cpuPct,
        cores: t.cores,
        load: load.length ? `load ${load[0].toFixed(2)}` : "",
        spark: spark(s.hist.cpu, 100),
        tempText: celsius(sen?.cpuTemp),
        power: watts(sen?.cpuPower),
        meta: [`${t.cores} cores`, celsius(sen?.cpuTemp), watts(sen?.cpuPower)].filter(Boolean).join(" · "),
      },
      mem: m ? {
        pct: memPct,
        usedText: `${bytes(m.used)} / ${bytes(m.total, 0)}`,
        swapPct: m.swapTotal > 0 ? pctOf(m.swapUsed, m.swapTotal) : 0,
        swapText: m.swapTotal > 0 ? `${bytes(m.swapUsed)} / ${bytes(m.swapTotal, 0)}` : "no swap",
        pressure: os.pressure,
        spark: spark(s.hist.mem, 100),
      } : null,
      gpu,
      power: sen && Number.isFinite(sen.allPower) ? `CPU ${watts(sen.cpuPower)} · GPU ${watts(sen.gpuPower)} · all ${watts(sen.allPower)}` : "",
      fans: (sen?.fans ?? []).length ? sen.fans.map((r, i) => `fan ${i + 1} ${Math.round(r)} rpm`).join(" · ") : "",
      net: { ...net, rxSpark: spark(s.hist.rx, netMax), txSpark: spark(s.hist.tx, netMax) },
      disk: d ? { pct: pctOf(d.used, d.total), usedText: `${bytes(d.used, 0)} / ${bytes(d.total, 0)}`, freeText: `${bytes(d.free, 0)} free` } : null,
      battery: b ? { pct: b.pct, state: b.state, detail: [b.state, b.timeText, b.power].filter(Boolean).join(" · ") } : null,
      sensorHint: os.sensorHint,
      band: [`CPU ${cpuPct}%`, memPct != null ? `mem ${memPct}%` : null, rx != null ? `↓${net.rxText} ↑${net.txText}` : null, celsius(sen?.cpuTemp) || null, b ? `${b.state === "on battery" ? "▯" : "⚡"}${b.pct}%` : null].filter(Boolean).join(" · "),
      alerts,
    };
  },
};

// For tests: forget every room's last sample.
export function resetSamples() {
  samples.clear();
}

export { GB };
