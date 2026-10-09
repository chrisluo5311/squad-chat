// The Monitor room's provider against what the real commands print
// (recorded on macOS 27 and a Linux box), through a fake ctx. Nothing runs.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import sysinfo, { parseVmStat, parseSysctl, parseNetstat, parseDf, parsePmset, parseBatteryPower, parseGpuUse, parseMacmon, parseMeminfo, parseNetDev, bytes, resetSamples } from "../plugins/squad-chat/bridge/src/rooms/providers/sysinfo.mjs";

const VM_STAT = `Mach Virtual Memory Statistics: (page size of 16384 bytes)
Pages free:                                     4211.
Pages active:                                 377981.
Pages inactive:                               376093.
Pages wired down:                             200000.
Pages occupied by compressor:                 150000.
`;
const SYSCTL = "34359738368\ntotal = 8192.00M  used = 6551.00M  free = 1641.00M  (encrypted)\n37\n";
const NETSTAT = (rx, tx) => `Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll
lo0        16384 <Link#1>                       7983089     0 12451081176  7983089     0 12451081176     0
en0        1500  <Link#14>   f2:09:56:7c:37:01  9000000     0 ${rx}  8000000     0 ${tx}     0
en0        1500  192.168.1     192.168.1.20     9000000     - ${rx}  8000000     - ${tx}     -
utun3      1380  <Link#20>                      1000        0 99999999  1000        0 99999999     0
`;
const DF = "Filesystem     1024-blocks      Used Available Capacity iused      ifree %iused  Mounted on\n/dev/disk3s5    971319460 772000000 197094164    80% 4840190 1970941640    0%   /System/Volumes/Data\n";
const PMSET_AC = "Now drawing from 'AC Power'\n -InternalBattery-0 (id=24903779)\t85%; charging; 0:42 remaining present: true\n";
const PMSET_BATT = "Now drawing from 'Battery Power'\n -InternalBattery-0 (id=24903779)\t8%; discharging; 0:31 remaining present: true\n";
const IOREG_AC = '  |   "ExternalConnected" = Yes\n  |   "Voltage" = 12149\n  |   "PowerTelemetryData" = {"SystemPowerIn"=32852,"SystemLoad"=32852}\n';
const IOREG_BATT = '  |   "ExternalConnected" = No\n  |   "Voltage" = 11500\n  |   "InstantAmperage" = 18446744073709550616\n';
const IOGPU = '    | "PerformanceStatistics" = {"Device Utilization %"=16,"Renderer Utilization %"=16}\n';
const MACMON = JSON.stringify({ all_power: 2.4, cpu_power: 1.9, gpu_power: 0.5, sys_power: 29.0, gpu_usage: [444, 0.09], temp: { cpu_temp_avg: 96.4, gpu_temp_avg: 51 }, fans: [{ rpm: 1362 }, { rpm: 1520 }], memory: { ram_total: 34359738368, ram_usage: 29205777203, swap_total: 5368709120, swap_usage: 3543348019 } });

const core = (idle, busy) => ({ times: { user: busy, nice: 0, sys: 0, idle, irq: 0 } });

// A Mac, driven sample by sample: `mac.cpu` and the counters move between fetches.
function fakeMac({ macmon = true, battery = "ac" } = {}) {
  const st = { now: 1_000_000, cpu: [core(1000, 0), core(1000, 0)], rx: 1_000_000, tx: 500_000, runs: [] };
  const out = {
    vm_stat: VM_STAT, sysctl: SYSCTL, df: DF,
    pmset: battery === "ac" ? PMSET_AC : battery === "low" ? PMSET_BATT : "Now drawing from 'AC Power'\n",
    "ioreg -rn": battery === "low" ? IOREG_BATT : battery === "none" ? "" : IOREG_AC,
    "ioreg -rc": IOGPU,
  };
  return {
    st,
    ctx: {
      dataDir: "/rooms/monitor",
      platform: "darwin",
      now: () => st.now,
      cpus: () => st.cpu,
      loadavg: () => [4.9, 7.4, 6.2],
      read: async () => null,
      run: async (argv) => {
        st.runs.push(argv.join(" "));
        if (argv[0].endsWith("macmon")) return macmon ? `${MACMON}\n` : null;
        if (argv[0] === "netstat") return NETSTAT(st.rx, st.tx);
        if (argv[0] === "ioreg") return out[`ioreg ${argv[1]}`];
        return out[argv[0]] ?? null;
      },
    },
  };
}

describe("sysinfo on macOS", () => {
  beforeEach(() => resetSamples());

  it("reads CPU, memory, network, disk, battery, GPU and sensors, with rates from the sample before", async () => {
    const { st, ctx } = fakeMac();
    // The first sample takes a second reading of the CPU a moment later.
    let calls = 0;
    ctx.cpus = () => (calls++ === 0 ? [core(1000, 0), core(1000, 0)] : [core(1100, 100), core(1100, 100)]);
    const a = await sysinfo.fetch({ alerts: true }, ctx);
    assert.equal(a.cpu.pct, 50);
    assert.equal(a.net.rxText, "–");   // a rate needs two samples

    ctx.cpus = () => [core(1150, 250), core(1150, 250)];   // 50 idle, 150 busy
    st.now += 2000;
    st.rx += 2 * 734_003;
    st.tx += 2 * 4300;
    const d = await sysinfo.fetch({ alerts: true, cpu_temp: 95, memory: 95 }, ctx);
    assert.equal(d.cpu.pct, 75);
    assert.deepEqual([d.cpu.cores, d.cpu.load, d.cpu.tempText, d.cpu.power, d.cpu.meta], [2, "load 4.90", "96°C", "1.9 W", "2 cores · 96°C · 1.9 W"]);
    assert.equal(d.cpu.spark, "▅▆");   // 50% then 75%, scaled to 100
    assert.deepEqual(d.mem, { pct: 85, usedText: "27.2 GB / 32 GB", swapPct: 66, swapText: "3.3 GB / 5 GB", pressure: 63, spark: "▇▇" });
    assert.deepEqual(d.gpu, { pct: 9, tempText: "51°C", power: "0.5 W" });
    assert.equal(d.power, "CPU 1.9 W · GPU 0.5 W · all 2.4 W");
    assert.equal(d.fans, "fan 1 1362 rpm · fan 2 1520 rpm");
    assert.deepEqual([d.net.rxText, d.net.txText], ["717 KB/s", "4.2 KB/s"]);   // en0 only: not loopback, not the VPN tunnel
    assert.deepEqual(d.disk, { pct: 80, usedText: "738 GB / 926 GB", freeText: "188 GB free" });
    assert.deepEqual(d.battery, { pct: 85, state: "charging", detail: "charging · 0:42 left · 33 W in" });
    assert.equal(d.sensorHint, "");
    assert.equal(d.band, "CPU 75% · mem 85% · ↓717 KB/s ↑4.2 KB/s · 96°C · ⚡85%");
    assert.deepEqual(d.alerts, [{ id: "cpu-temp", text: "▦ CPU at 96°C" }]);
    assert.ok(st.runs.every((r) => !/sudo|powermetrics/.test(r)));
  });

  it("without macmon: memory from vm_stat, GPU use from ioreg, and a hint", async () => {
    const { ctx } = fakeMac({ macmon: false });
    const d = await sysinfo.fetch({}, ctx);
    assert.equal(d.mem.usedText, "11.1 GB / 32 GB");   // (active + wired + compressed) × 16 KB pages
    assert.deepEqual(d.gpu, { pct: 16, tempText: "", power: "" });
    assert.equal(d.cpu.tempText, "");
    assert.equal(d.power, "");
    assert.equal(d.sensorHint, "brew install macmon for temperatures, power and fans");
  });

  it("on battery, low; and a desktop with no battery at all", async () => {
    let d = await sysinfo.fetch({ alerts: true }, fakeMac({ battery: "low" }).ctx);
    assert.deepEqual(d.battery, { pct: 8, state: "on battery", detail: "on battery · 0:31 left · 12 W out" });
    assert.ok(d.alerts.some((a) => a.id === "battery"));
    resetSamples();
    d = await sysinfo.fetch({ alerts: false }, fakeMac({ battery: "none" }).ctx);
    assert.equal(d.battery, null);
    assert.deepEqual(d.alerts, []);
  });
});

describe("sysinfo on Linux", () => {
  beforeEach(() => resetSamples());

  it("reads /proc, /sys and nvidia-smi", async () => {
    const files = {
      "/proc/meminfo": "MemTotal:       16384000 kB\nMemFree:         1000000 kB\nMemAvailable:    8192000 kB\nSwapTotal:       2048000 kB\nSwapFree:        2048000 kB\n",
      "/proc/net/dev": "Inter-|   Receive\n face |bytes    packets\n    lo: 999999 10 0 0 0 0 0 0 999999 10 0 0 0 0 0 0\n  eth0: 5000000 100 0 0 0 0 0 0 250000 90 0 0 0 0 0 0\n",
      "/sys/class/power_supply/BAT0/capacity": "64\n",
      "/sys/class/power_supply/BAT0/status": "Discharging\n",
      "/sys/class/power_supply/BAT0/power_now": "9500000\n",
      "/sys/class/thermal/thermal_zone0/type": "acpitz\n",
      "/sys/class/thermal/thermal_zone0/temp": "40000\n",
      "/sys/class/thermal/thermal_zone1/type": "x86_pkg_temp\n",
      "/sys/class/thermal/thermal_zone1/temp": "61000\n",
    };
    const ctx = {
      dataDir: "/rooms/monitor", platform: "linux", now: () => 1, loadavg: () => [0.5, 0.4, 0.3],
      cpus: () => [core(100, 100)],
      read: async (f) => files[f] ?? null,
      run: async (argv) => (argv[0] === "df" ? "Filesystem 1K-blocks Used Available Use% Mounted on\n/dev/nvme0n1p2 488281250 300000000 188281250 62% /\n" : argv[0] === "nvidia-smi" ? "37, 58, 21.5\n" : null),
    };
    const d = await sysinfo.fetch({}, ctx);
    assert.deepEqual([d.mem.pct, d.mem.usedText, d.mem.swapText, d.mem.pressure], [50, "7.8 GB / 16 GB", "0 B / 2 GB", null]);
    assert.equal(d.cpu.tempText, "61°C");   // the package sensor, not the first zone
    assert.deepEqual(d.gpu, { pct: 37, tempText: "58°C", power: "22 W" });
    assert.deepEqual(d.battery, { pct: 64, state: "on battery", detail: "on battery · 9.5 W out" });
    assert.equal(d.disk.pct, 61);   // used: total less what is available
  });
});

describe("sysinfo parsers", () => {
  it("survive missing or odd output", () => {
    for (const parse of [parseVmStat, parseSysctl, parseNetstat, parseDf, parsePmset, parseBatteryPower, parseMacmon, parseMeminfo, parseNetDev]) {
      assert.equal(parse(null), null, parse.name);
    }
    assert.equal(parseGpuUse("nothing"), null);
    assert.equal(parseMacmon("{ not json"), null);
    assert.equal(parseDf("Filesystem\n"), null);
    assert.equal(parsePmset("Now drawing from 'AC Power'\n"), null);
    assert.deepEqual([bytes(0), bytes(1536), bytes(34359738368, 0), bytes(NaN)], ["0 B", "1.5 KB", "32 GB", "–"]);
  });
});
