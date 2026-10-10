// Function rooms: the manifests this bridge found, and their providers run on
// a schedule. Rooms come from two folders, each holding <id>/room.json: the
// ones squad-chat ships (SQUAD_ROOMS_DIR, the plugin's rooms/), then the ones
// installed on this computer (<config dir>/rooms/), which can't replace a
// shipped one. A manifest that doesn't check out is reported and skipped.
//
// Events:
//   { type: "fnrooms", rooms: [manifest], invalid: [{ dir, errors }] }
//   { type: "fnroom", id, provider, data, at, error?, stale? }
//   { type: "fnsettings", id, values }   a room's settings, defaults filled in
//
// A room's settings live in <data dir>/<id>/settings.json (0600), only the
// ones changed from the manifest's defaults. A provider's params may name
// one as "$settings.<key>".
//
// A provider runs when its room is enabled: once at the start, after each
// of its actions, and on its interval, the `visible` one while its room is
// on show and the `background` one otherwise (none: it waits for an action).
// A run asked for while one is going waits for it and then runs once more,
// so an action's change is never overwritten by an older answer.

import { readdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { join } from "node:path";
import { execFile, spawn } from "node:child_process";
import { readFile, stat, readdir } from "node:fs/promises";
import { connect } from "node:net";
import { cpus, loadavg, homedir } from "node:os";
import { checkManifest, parseInterval, settingError, compareVersions } from "./manifest.mjs";
import { allowedHosts, limitedFetch, clean, RoomError } from "./net.mjs";
import { locked } from "./lock.mjs";
import localList from "./providers/local-list.mjs";
import openMeteo from "./providers/open-meteo.mjs";
import hn from "./providers/hn.mjs";
import rss from "./providers/rss.mjs";
import sysinfo from "./providers/sysinfo.mjs";
import quotes from "./providers/quotes.mjs";
import player from "./providers/player.mjs";
import httpJson from "./providers/http-json.mjs";

export const PROVIDERS = Object.fromEntries([localList, openMeteo, hn, rss, sysinfo, quotes, player, httpJson].map((p) => [p.type, p]));

// What a provider runs on this computer: a command its own code names (a
// manifest can't name one), with no shell, a time limit and an output limit.
// Resolves its stdout, or null when it's missing, fails or overruns.
function runCommand(argv, { timeoutMs = 3_000, maxBytes = 4 * 1024 * 1024 } = {}) {
  return new Promise((resolve) => {
    execFile(argv[0], argv.slice(1), { timeout: timeoutMs, maxBuffer: maxBytes, env: { ...process.env, LC_ALL: "C" } }, (err, stdout) => resolve(err ? null : String(stdout)));
  });
}

// "Taipei, Tokyo" for a list, "on" for a bool: what's typed, as the
// setting's kind. A list also takes "+Osaka" or "-Tokyo" to add or drop.
export function parseSetting(st, raw, current) {
  const text = String(raw ?? "").trim();
  switch (st.type) {
    case "list": {
      const parts = text.split(",").map((x) => x.trim()).filter(Boolean);
      if (parts.length && parts.every((x) => /^[+-]/.test(x))) {
        let list = [...(current ?? [])];
        for (const x of parts) {
          const v = x.slice(1).trim();
          list = list.filter((y) => y.toLowerCase() !== v.toLowerCase());
          if (x[0] === "+") list.push(v);
        }
        return list;
      }
      return parts;
    }
    case "bool":
      if (/^(on|true|yes|1)$/i.test(text)) return true;
      if (/^(off|false|no|0)$/i.test(text)) return false;
      return text;
    case "int": return /^-?\d+$/.test(text) ? Number(text) : text;
    case "enum": return st.values.find((v) => v.toLowerCase() === text.toLowerCase()) ?? text;
    default: return text;
  }
}

// A provider's actions by name. A Map, so a name from a request can only
// ever find an action the provider declared, never something inherited.
const actionsOf = new WeakMap();
function actionTable(def) {
  if (!actionsOf.has(def)) actionsOf.set(def, new Map(Object.entries(def.actions ?? {}).filter(([, fn]) => typeof fn === "function")));
  return actionsOf.get(def);
}

function readRooms(dir, providers) {
  const rooms = [];
  const invalid = [];
  let names = [];
  try { names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name); } catch { return { rooms, invalid }; }
  for (const name of names.sort()) {
    const file = join(dir, name, "room.json");
    let m;
    try { m = JSON.parse(readFileSync(file, "utf8")); }
    catch (err) { invalid.push({ dir: join(dir, name), errors: [err.code === "ENOENT" ? "no room.json" : `room.json: ${err.message}`] }); continue; }
    const errors = checkManifest(m, providers);
    if (!errors.length && m.id !== name) errors.push(`id: "${m.id}" but its folder is "${name}"`);
    if (errors.length) invalid.push({ dir: join(dir, name), errors });
    else rooms.push(m);
  }
  return { rooms, invalid };
}

// `runtimeDir` is the bridge's own short folder (socket paths are limited
// to about 100 bytes), for a provider that keeps a process going (Lo-fi's mpv).
// `version` is squad-chat's own: a room that needs a newer one is skipped.
export function roomRegistry({ dirs, dataDir, runtimeDir, emit, log = () => {}, providers = PROVIDERS, version = null }) {
  let rooms = new Map();   // id → manifest
  let invalid = [];
  let origin = new Map();  // id → the folder it came from (shipped or installed)

  function load() {
    const next = new Map();
    const bad = [];
    const from = new Map();
    for (const dir of dirs.filter(Boolean)) {
      const found = readRooms(dir, providers);
      bad.push(...found.invalid);
      for (const m of found.rooms) {
        if (next.has(m.id)) bad.push({ dir: join(dir, m.id), errors: [`id: "${m.id}" is already a room`] });
        else if (version && m.minSquadChat && compareVersions(m.minSquadChat, version) > 0) bad.push({ dir: join(dir, m.id), errors: [`needs squad-chat ${m.minSquadChat} or newer (this is ${version})`] });
        else { next.set(m.id, m); from.set(m.id, dir); }
      }
    }
    rooms = next;
    invalid = bad;
    origin = from;
  }
  load();

  let enabled = new Set();
  let shown = null;
  const last = new Map();      // "room/provider" → { data, at }
  const timers = new Map();    // "room/provider" → timeout
  const inflight = new Map();  // "room/provider" → the run going now
  const queued = new Map();    // "room/provider" → the run after it

  const key = (id, pid) => `${id}/${pid}`;
  const hostsOf = (m) => (m.permissions?.hosts ?? []).map((h) => h.toLowerCase());

  // ---- settings

  const settingsFile = (id) => join(dataDir, id, "settings.json");
  function savedSettings(id) {
    try {
      const data = JSON.parse(readFileSync(settingsFile(id), "utf8"));
      return data && typeof data === "object" && !Array.isArray(data) ? data : {};
    } catch { return {}; }
  }
  // The manifest's defaults, with what was changed on top. A saved value
  // that no longer checks out (the manifest changed) falls back.
  function settingsOf(id) {
    const m = rooms.get(id);
    const saved = savedSettings(id);
    const out = {};
    for (const [k, st] of Object.entries(m?.settings ?? {})) {
      out[k] = Object.hasOwn(saved, k) && !settingError(st, saved[k], hostsOf(m)) ? saved[k] : st.default;
    }
    return out;
  }
  function emitSettings(id) {
    if (rooms.get(id)?.settings) emit({ type: "fnsettings", id, values: settingsOf(id) });
  }
  // A provider's params, with "$settings.<key>" filled in at any depth.
  function paramsOf(m, p) {
    const values = settingsOf(m.id);
    const fill = (v) => {
      if (typeof v === "string") { const ref = /^\$settings\.(.+)$/.exec(v); return ref ? values[ref[1]] : v; }
      if (Array.isArray(v)) return v.map(fill);
      if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x)]));
      return v;
    };
    return fill(p.params ?? {});
  }

  // The manifest's own alerts on a provider's fresh data: each row (or the
  // one value) past its threshold, as { id, text }, joined to the provider's.
  function manifestAlerts(m, pid, data) {
    const out = [];
    const values = settingsOf(m.id);
    const limit = (v) => (typeof v === "string" ? Number(values[/^\$settings\.(.+)$/.exec(v)?.[1]]) : Number(v));
    const fillRow = (t, row) => String(t).replace(/\{([A-Za-z0-9_.]+)\}/g, (_, path) => String(path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), row) ?? ""));
    for (const a of m.alerts ?? []) {
      const path = a.rows ?? a.value;
      const [first, ...rest] = path.split(".");
      if (first !== pid) continue;
      const at = rest.reduce((o, k) => (o == null ? undefined : o[k]), data);
      const rows = a.rows ? (Array.isArray(at) ? at : []) : [{ value: at }];
      const field = a.rows ? a.field : "value";
      for (const row of rows) {
        const n = Number(field.split(".").reduce((o, k) => (o == null ? undefined : o[k]), row));
        if (!Number.isFinite(n)) continue;
        const hit = a.above != null ? n >= limit(a.above)
          : a.below != null ? n <= limit(a.below)
          : limit(a.beyond) > 0 && Math.abs(n) >= limit(a.beyond);
        if (hit) out.push({ id: `m:${fillRow(a.id, row)}`.slice(0, 80), text: fillRow(a.text, row).slice(0, 120) });
      }
    }
    return out;
  }

  function ctxFor(m, p) {
    const def = providers[p.type];
    const hosts = allowedHosts(def.hosts, m.permissions?.hosts ?? []);
    return {
      dataDir: join(dataDir, m.id),
      platform: process.platform,
      run: runCommand,
      read: (file) => readFile(file, "utf8").catch(() => null),
      cpus,
      loadavg,
      now: Date.now,
      home: homedir(),
      runtimeDir,
      spawn: (argv, opts) => spawn(argv[0], argv.slice(1), { stdio: "ignore", ...opts }),
      connect,
      fs: { stat: (f) => stat(f).catch(() => null), readdir: (d) => readdir(d).catch(() => []) },
      log,
      // Only headers come from the provider: the time and size limits stay ours.
      fetch: (url, { headers } = {}) => limitedFetch(url, { headers, hosts }),
    };
  }

  // Runs a provider now, or once more after the run going now. Resolves
  // when the run that sees the latest state has emitted.
  function run(id, pid) {
    const k = key(id, pid);
    if (inflight.has(k)) {
      if (!queued.has(k)) queued.set(k, inflight.get(k).then(() => { queued.delete(k); return run(id, pid); }));
      return queued.get(k);
    }
    const going = runOnce(id, pid).finally(() => inflight.delete(k));
    inflight.set(k, going);
    return going;
  }

  async function runOnce(id, pid) {
    const m = rooms.get(id);
    const p = m?.providers.find((x) => x.id === pid);
    if (!p) return;
    const k = key(id, pid);
    clearTimeout(timers.get(k));
    try {
      const data = clean(await providers[p.type].fetch(paramsOf(m, p), ctxFor(m, p)));
      const extra = m.alerts ? manifestAlerts(m, pid, data) : [];
      if (extra.length || (m.alerts && data && typeof data === "object")) data.alerts = [...(Array.isArray(data.alerts) ? data.alerts : []), ...extra];
      const at = Date.now();
      last.set(k, { data, at });
      emit({ type: "fnroom", id, provider: pid, data, at });
    } catch (err) {
      if (!(err instanceof RoomError)) log(`room ${id}/${pid}: ${err?.stack ?? err}`);
      const prev = last.get(k);
      emit({ type: "fnroom", id, provider: pid, data: prev?.data ?? null, at: prev?.at ?? null, error: err?.message ?? String(err), stale: !!prev });
    } finally {
      schedule(id, pid);
    }
  }

  function schedule(id, pid) {
    const k = key(id, pid);
    clearTimeout(timers.get(k));
    timers.delete(k);
    if (!enabled.has(id)) return;
    const p = rooms.get(id)?.providers.find((x) => x.id === pid);
    const ms = parseInterval(shown === id ? p?.interval?.visible : p?.interval?.background);
    if (ms) timers.set(k, setTimeout(() => void run(id, pid), ms));
  }

  return {
    report() {
      emit({ type: "fnrooms", rooms: [...rooms.values()], invalid });
      for (const id of rooms.keys()) emitSettings(id);
    },
    // Changes one setting from what was typed ("default" puts it back), then
    // runs the room's providers with it.
    async setSetting({ room: id, key: k, value } = {}) {
      const m = rooms.get(id);
      if (!m) throw new RoomError(404, `no room called ${id}`);
      const settings = new Map(Object.entries(m.settings ?? {}));
      if (!settings.has(String(k))) throw new RoomError(404, `${m.name} has no setting ${k}${settings.size ? `. It has ${[...settings.keys()].join(", ")}` : ""}.`);
      const st = settings.get(String(k));
      // Every session's bridge shares the file: read, change and write it
      // holding its lock, so two changes at once both land.
      await locked(join(dataDir, id), "settings", () => {
        const saved = savedSettings(id);
        if (/^default$/i.test(String(value ?? "").trim())) delete saved[k];
        else {
          const v = parseSetting(st, value, settingsOf(id)[k]);
          const bad = settingError(st, v, hostsOf(m));
          if (bad) throw new RoomError(400, `${st.label ?? k}: ${bad}.`);
          // Only what differs from the default is kept, so a room's new
          // default reaches people who never changed it.
          if (JSON.stringify(v) === JSON.stringify(st.default)) delete saved[k];
          else saved[k] = v;
        }
        const tmp = `${settingsFile(id)}.${process.pid}.tmp`;
        writeFileSync(tmp, JSON.stringify(saved, null, 1), { mode: 0o600 });
        renameSync(tmp, settingsFile(id));
      });
      emitSettings(id);
      if (enabled.has(id)) await Promise.all(m.providers.map((p) => run(id, p.id)));
      return { ok: true, values: settingsOf(id) };
    },
    // The rooms' folders read again (a room installed or removed): new rooms
    // with a tab start, gone ones stop.
    // Every room with a tab runs again, so an updated one shows its new self.
    reload() {
      const wasEnabled = [...enabled];
      const wasShown = shown;
      load();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      enabled = new Set();
      this.report();
      this.setVisible({ enabled: wasEnabled, shown: wasShown });
    },
    // Where a room came from: the first folder (shipped) or the second
    // (installed on this computer), and its manifest.
    source(id) {
      return rooms.has(id) ? { manifest: rooms.get(id), dir: origin.get(id), shipped: origin.get(id) === dirs.filter(Boolean)[0] } : null;
    },
    // Which rooms have tabs, and which is on show. A room just enabled, or
    // just shown with data older than its visible interval, runs now.
    setVisible({ enabled: list = [], shown: now = null } = {}) {
      const before = enabled;
      enabled = new Set(list.filter((id) => rooms.has(id)));
      const wasShown = shown;
      shown = enabled.has(now) ? now : null;
      for (const id of rooms.keys()) {
        for (const p of rooms.get(id).providers) {
          const k = key(id, p.id);
          if (!enabled.has(id)) { clearTimeout(timers.get(k)); timers.delete(k); continue; }
          const age = Date.now() - (last.get(k)?.at ?? 0);
          const fresh = parseInterval(p.interval?.visible);
          if (!before.has(id) || !last.has(k) || (shown === id && wasShown !== id && fresh && age > fresh)) void run(id, p.id);
          else schedule(id, p.id);
        }
      }
      return { ok: true };
    },
    async refresh(id) {
      const m = rooms.get(id);
      if (!m) throw new RoomError(404, `no room called ${id}`);
      await Promise.all(m.providers.map((p) => run(id, p.id)));
      return { ok: true, data: Object.fromEntries(m.providers.map((p) => [p.id, last.get(key(id, p.id))?.data ?? null])) };
    },
    // One of a provider's actions; the provider runs again after it.
    async action({ room: id, provider: pid, action, args = {} } = {}) {
      const m = rooms.get(id);
      if (!m) throw new RoomError(404, `no room called ${id}`);
      const p = m.providers.find((x) => x.id === pid) ?? (pid ? null : m.providers[0]);
      if (!p) throw new RoomError(404, `room ${id} has no provider ${pid}`);
      const table = actionTable(providers[p.type]);
      const name = String(action);
      if (!table.has(name)) throw new RoomError(404, `${p.type} has no action ${name}`);
      const r = await table.get(name)(paramsOf(m, p), args && typeof args === "object" ? args : {}, ctxFor(m, p));
      await run(id, p.id);
      return clean(r ?? { ok: true });
    },
    close() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
      // A provider that keeps something running (Lo-fi's player) stops it.
      for (const def of new Set(Object.values(providers))) { try { def.close?.(); } catch { /* exiting anyway */ } }
    },
  };
}
