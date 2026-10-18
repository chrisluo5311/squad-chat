// This computer's Docker: containers, images, volumes and networks, from
// the docker CLI. Read only. The commands are fixed here: a manifest can't
// name one, and a container's name goes to `docker` as one argument.
//
// One section shows at a time (lazydocker's way): the actions containers,
// images, volumes and networks pick it, and each room remembers its own
// while the bridge runs. A container picked in the list (the `container`
// setting) gets a card of its own, with CPU, memory and its last log lines.

import { RoomError } from "../net.mjs";

const SECTIONS = ["containers", "images", "volumes", "networks"];
const sectionOf = new Map();   // room data dir → section
// Where docker is when the bridge's PATH (from a GUI app) leaves it out.
const DOCKERS = ["docker", "/usr/local/bin/docker", "/opt/homebrew/bin/docker"];
const LOG_LINES = 5;

// ---------------------------------------------------------------- parsing

// `--format json` prints one object a line.
export function jsonLines(text) {
  return String(text ?? "").split("\n").map((l) => l.trim()).filter(Boolean).flatMap((l) => {
    try { return [JSON.parse(l)]; } catch { return []; }
  });
}

// "public.ecr.aws/supabase/postgres" → "supabase/postgres": the registry's
// host says little and takes the room the name needs.
export function shortImage(ref) {
  const s = String(ref ?? "");
  const parts = s.split("/");
  return parts.length > 1 && /[.:]|^localhost$/.test(parts[0]) ? parts.slice(1).join("/") : s;
}

// "0.0.0.0:54322->5432/tcp, [::]:54322->5432/tcp, 3000/tcp" → ":54322→5432".
// Ports only exposed inside Docker's network aren't reachable, so they're left out.
export function publishedPorts(text) {
  const seen = new Set();
  for (const p of String(text ?? "").split(",")) {
    const m = /:(\d+)->(\d+)\//.exec(p);
    if (m) seen.add(m[1] === m[2] ? `:${m[1]}` : `:${m[1]}→${m[2]}`);
  }
  return [...seen].join(" ");
}

// "Up 5 days (healthy)" → "up 5d"; "Exited (1) 20 minutes ago" → "exited (1) 20m".
export function shortStatus(text) {
  const units = { second: "s", minute: "m", hour: "h", day: "d", week: "w", month: "mo", year: "y" };
  return String(text ?? "")
    .replace(/\s*\((healthy|unhealthy|health: starting)\)/, "")
    .replace(/About an? (hour|minute)/, "1 $1")
    .replace(/Less than a second/, "0 seconds")
    .replace(/(\d+) (second|minute|hour|day|week|month|year)s?/g, (_, n, u) => `${n}${units[u]}`)
    .replace(/ ago$/, "")
    .replace(/^\w/, (c) => c.toLowerCase());
}

// A container's state as the list shows it: a dot, its color and a word.
export function stateOf(c) {
  const health = c.HealthStatus || (/\(unhealthy\)/.test(c.Status) ? "unhealthy" : "");
  if (c.State === "running" && health === "unhealthy") return { dot: "●", tone: "amber", word: "unhealthy", rank: 0 };
  if (c.State === "restarting") return { dot: "●", tone: "amber", word: "restarting", rank: 0 };
  if (c.State === "running") return { dot: "●", tone: "leaf", word: shortStatus(c.Status), rank: 1 };
  if (c.State === "paused") return { dot: "◐", tone: "amber", word: "paused", rank: 2 };
  if (c.State === "dead" || /^Exited \([1-9]\d*\)/.test(c.Status)) return { dot: "○", tone: "red", word: shortStatus(c.Status), rank: 3 };
  return { dot: "○", tone: null, word: shortStatus(c.Status), rank: 4 };
}

// "1.3GB" → bytes, for adding sizes up. Docker counts in 1000s.
export function sizeOf(text) {
  const m = /^([\d.]+)\s*([kMGT]?B)/i.exec(String(text ?? ""));
  if (!m) return 0;
  const mult = { B: 1, KB: 1e3, MB: 1e6, GB: 1e9, TB: 1e12 }[m[2].toUpperCase()] ?? 1;
  return Number(m[1]) * mult;
}

export function humanSize(n) {
  if (!(n > 0)) return "0 B";
  const units = ["B", "kB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1000 && i < units.length - 1) { n /= 1000; i++; }
  return `${i === 0 ? Math.round(n) : n.toFixed(n >= 100 ? 0 : 1)} ${units[i]}`;
}

const label = (labels, key) => new RegExp(`(?:^|,)${key.replace(/\./g, "\\.")}=([^,]*)`).exec(String(labels ?? ""))?.[1] ?? "";
const percent = (text) => { const n = Number.parseFloat(String(text ?? "")); return Number.isFinite(n) ? Math.round(n) : null; };
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// ---------------------------------------------------------------- reading

// The docker found last time is asked first and alone, so a tick every 5s
// spends one call on finding it, two with the daemon down. Only when that
// one is gone are the others tried again.
let lastDocker = null;

async function findDocker(ctx) {
  const ask = async (list) => {
    for (const d of list) {
      const v = await ctx.run([d, "version", "--format", "{{.Server.Version}}|{{.Server.Platform.Name}}"], { timeoutMs: 5_000 });
      if (v != null) return { docker: d, version: v.trim() };
    }
    // Installed but the daemon is down: `docker version` fails, `--version` doesn't.
    for (const d of list) if ((await ctx.run([d, "--version"])) != null) return { docker: d, version: null };
    return null;
  };
  const found = (lastDocker && await ask([lastDocker])) ?? await ask(DOCKERS);
  lastDocker = found?.docker ?? null;
  return found;
}

function containerRows(list) {
  return list.map((c) => {
    const st = stateOf(c);
    return {
      id: c.ID,
      name: c.Names,
      image: shortImage(c.Image),
      ref: c.Image,
      ports: publishedPorts(c.Ports),
      dot: st.dot,
      tone: st.tone,
      status: st.word,
      project: label(c.Labels, "com.docker.compose.project"),
      networks: String(c.Networks ?? "").split(",").filter(Boolean),
      running: c.State === "running",
      rank: st.rank,
    };
  }).sort((a, b) => a.rank - b.rank || a.name.localeCompare(b.name));
}

// `Containers` is often "N/A", so an image is in use too when a container
// names it.
function imageRows(list, containers = []) {
  const named = new Set(containers.map((c) => c.ref));
  return list.map((i) => {
    const dangling = i.Repository === "<none>";
    const used = Number(i.Containers) > 0 || named.has(`${i.Repository}:${i.Tag}`) || (i.Tag === "latest" && named.has(i.Repository));
    return {
      // One image can carry the same tag in two repositories.
      id: `${i.ID}:${i.Repository}:${i.Tag}`,
      name: dangling ? `<none> ${i.ID.slice(0, 12)}` : `${shortImage(i.Repository)}:${i.Tag}`,
      size: i.Size,
      bytes: sizeOf(i.Size),
      age: shortStatus(i.CreatedSince),
      use: dangling ? "dangling" : used ? "in use" : "",
      useTone: dangling ? "amber" : used ? "leaf" : null,
      dangling,
    };
  }).sort((a, b) => b.bytes - a.bytes);
}

// The share line for the room's card: what's up, then what isn't well.
function shareText(engine, rows) {
  const up = rows.filter((c) => c.running).length;
  const bad = rows.filter((c) => c.tone === "amber" || c.tone === "red");
  return [`Docker · ${engine}`, `${up} of ${rows.length} containers up`, ...bad.slice(0, 5).map((c) => `${c.dot} ${c.name} ${c.status}`)].join("\n");
}

// A log line as one row: its time (from --timestamps, in local time), and
// its words with no colors, no time of its own and no run of spaces, cut
// short. Errors are red and warnings amber.
export function logRow(line, i) {
  const m = /^(\d{4}-\d\d-\d\dT[\d:.]+Z)\s?(.*)$/.exec(line);
  const at = m ? new Date(m[1]) : null;
  const text = (m ? m[2] : line)
    .replace(/\x1b\[[0-9;]*m/g, "")
    .replace(/^\[?(\d{4}-\d\d-\d\d[T ])?\d\d:\d\d:\d\d([.,]\d+)?Z?\]?\s*/, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300);
  const tone = /\b(error|err|fatal|panic|exception|failed)\b/i.test(text) ? "red" : /\bwarn(ing)?\b/i.test(text) ? "amber" : null;
  const two = (n) => String(n).padStart(2, "0");
  return { id: String(i), time: at && !Number.isNaN(at.getTime()) ? `${two(at.getHours())}:${two(at.getMinutes())}:${two(at.getSeconds())}` : "", text, tone };
}

// "672.4MiB / 7.65GiB" → "672 MiB of 7.7 GiB".
export function memUse(text) {
  const round = (x) => x.replace(/([\d.]+)\s*([KMGT]i?B)/g, (_, n, u) => `${Number(n) >= 10 ? Math.round(Number(n)) : Number(Number(n).toFixed(1))} ${u}`);
  const [used, limit] = String(text ?? "").split("/").map((x) => round(x.trim()));
  return limit ? `${used} of ${limit}` : used ?? "";
}

async function detailOf(ctx, docker, c) {
  if (!c) return null;
  const [statsOut, logsOut] = await Promise.all([
    c.running ? ctx.run([docker, "stats", "--no-stream", "--format", "json", c.id], { timeoutMs: 6_000 }) : null,
    // docker logs writes the container's stderr to its own: 2>&1 keeps both.
    ctx.run(["/bin/sh", "-c", `"$0" logs --tail ${LOG_LINES} --timestamps "$1" 2>&1`, docker, c.id], { timeoutMs: 4_000 }),
  ]);
  const s = jsonLines(statsOut)[0];
  const cpu = s ? percent(s.CPUPerc) : null;
  return {
    name: c.name,
    image: c.image,
    status: c.status,
    tone: c.tone,
    cpu,
    cpuText: s ? s.CPUPerc : "–",
    cpuTone: cpu == null ? null : cpu >= 80 ? "amber" : "leaf",
    mem: s ? percent(s.MemPerc) : null,
    memText: s ? memUse(s.MemUsage) : "–",
    ports: c.ports || "–",
    logs: String(logsOut ?? "").split("\n").filter((l) => l.trim()).slice(-LOG_LINES).map(logRow).filter((r) => r.text),
  };
}

export default {
  type: "docker",
  hosts: [],
  async fetch(params, ctx) {
    const section = sectionOf.get(ctx.dataDir) ?? "containers";
    const on = Object.fromEntries(SECTIONS.map((s) => [s, s === section ? true : null]));
    const found = await findDocker(ctx);
    if (!found?.version) {
      const down = found ? "Docker isn't running. Start Docker Desktop, OrbStack or colima." : "No docker command found. Install Docker Desktop or OrbStack.";
      return { down, on, section, engine: found ? "not running" : "not installed", containers: [], images: [], volumes: [], networks: [], detail: null, band: down, share: `Docker · ${down}` };
    }
    const { docker } = found;
    const [ver, platform] = found.version.split("|");
    const engine = [`Docker ${ver}`, platform?.replace(/\s*\(\d+\)$/, "")].filter(Boolean).join(" · ");
    const run = (...args) => ctx.run([docker, ...args], { timeoutMs: 8_000 });
    const [psOut, imgOut, volOut, unusedOut, netOut] = await Promise.all([
      run("ps", "-a", "--format", "json"),
      run("images", "--format", "json"),
      run("volume", "ls", "--format", "json"),
      run("volume", "ls", "-q", "--filter", "dangling=true"),
      run("network", "ls", "--format", "json"),
    ]);
    if (psOut == null) throw new RoomError(502, "docker ps failed. Is the Docker daemon up?");

    const containers = containerRows(jsonLines(psOut));
    const images = imageRows(jsonLines(imgOut), containers);
    const unused = new Set(String(unusedOut ?? "").split("\n").map((s) => s.trim()).filter(Boolean));
    const volumes = jsonLines(volOut).map((v) => ({
      name: v.Name,
      driver: v.Driver,
      project: label(v.Labels, "com.docker.compose.project"),
      use: unused.has(v.Name) ? "unused" : "in use",
      useTone: unused.has(v.Name) ? "amber" : "leaf",
    })).sort((a, b) => (a.use === b.use ? a.name.localeCompare(b.name) : a.use === "in use" ? -1 : 1));
    const networks = jsonLines(netOut).map((n) => {
      const users = containers.filter((c) => c.networks.includes(n.Name)).length;
      return { name: n.Name, driver: n.Driver, scope: n.Scope, users, usersText: users ? plural(users, "container") : "" };
    }).sort((a, b) => b.users - a.users || a.name.localeCompare(b.name));

    // The container picked, or the first in the list (the one needing a look
    // comes first), so the card under the list is never empty.
    const want = String(params.container ?? "").toLowerCase();
    const picked = containers.find((c) => c.name.toLowerCase() === want) ?? containers[0] ?? null;
    const detail = section === "containers" ? await detailOf(ctx, docker, picked) : null;

    const up = containers.filter((c) => c.running).length;
    // What needs a look: crashed first, then unhealthy, restarting or paused.
    const bad = [...containers.filter((c) => c.tone === "red"), ...containers.filter((c) => c.tone === "amber")];
    const dangling = images.filter((i) => i.dangling).length;
    const imageBytes = images.reduce((n, i) => n + i.bytes, 0);
    return {
      down: "",
      on,
      section,
      engine,
      containers,
      containersMeta: [`${up} running`, containers.length - up ? `${containers.length - up} stopped` : null].filter(Boolean).join(" · "),
      picked,
      detail,
      images,
      imagesMeta: [plural(images.length, "image"), humanSize(imageBytes), dangling ? `${dangling} dangling` : null].filter(Boolean).join(" · "),
      volumes,
      volumesMeta: [plural(volumes.length, "volume"), unused.size ? `${unused.size} unused` : null].filter(Boolean).join(" · "),
      networks,
      networksMeta: plural(networks.length, "network"),
      counts: `${containers.length} containers · ${images.length} images · ${volumes.length} volumes · ${networks.length} networks`,
      band: [`${up}/${containers.length} up`, ...bad.slice(0, 2).map((c) => `${c.name} ${c.status}`)].join(" · "),
      upText: `${up}/${containers.length}`,
      tone: bad[0]?.tone ?? "leaf",
      worst: bad[0] ? { name: bad[0].name, status: bad[0].status, tone: bad[0].tone } : null,
      share: shareText(engine, containers),
    };
  },
  actions: Object.fromEntries(SECTIONS.map((s) => [s, async (params, args, ctx) => { sectionOf.set(ctx.dataDir, s); return { ok: true, section: s }; }])),
};

// For tests: every room back on its containers.
export function resetSections() {
  sectionOf.clear();
  lastDocker = null;
}
