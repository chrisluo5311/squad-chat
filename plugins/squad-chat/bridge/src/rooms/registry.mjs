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

import { readdirSync, readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { checkManifest, parseInterval, settingError } from "./manifest.mjs";
import { allowedHosts, limitedFetch, clean, RoomError } from "./net.mjs";
import localList from "./providers/local-list.mjs";
import openMeteo from "./providers/open-meteo.mjs";
import hn from "./providers/hn.mjs";
import rss from "./providers/rss.mjs";

export const PROVIDERS = Object.fromEntries([localList, openMeteo, hn, rss].map((p) => [p.type, p]));

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

export function roomRegistry({ dirs, dataDir, emit, log = () => {}, providers = PROVIDERS }) {
  const rooms = new Map();   // id → manifest
  const invalid = [];
  for (const dir of dirs.filter(Boolean)) {
    const found = readRooms(dir, providers);
    invalid.push(...found.invalid);
    for (const m of found.rooms) {
      if (rooms.has(m.id)) invalid.push({ dir: join(dir, m.id), errors: [`id: "${m.id}" is already a room`] });
      else rooms.set(m.id, m);
    }
  }

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
  // A provider's params, with "$settings.<key>" filled in.
  function paramsOf(m, p) {
    const values = settingsOf(m.id);
    const out = {};
    for (const [k, v] of Object.entries(p.params ?? {})) {
      const ref = typeof v === "string" && /^\$settings\.(.+)$/.exec(v);
      out[k] = ref ? values[ref[1]] : v;
    }
    return out;
  }

  function ctxFor(m, p) {
    const def = providers[p.type];
    const hosts = allowedHosts(def.hosts, m.permissions?.hosts ?? []);
    return {
      dataDir: join(dataDir, m.id),
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
      const saved = savedSettings(id);
      if (/^default$/i.test(String(value ?? "").trim())) delete saved[k];
      else {
        const v = parseSetting(st, value, settingsOf(id)[k]);
        const bad = settingError(st, v, hostsOf(m));
        if (bad) throw new RoomError(400, `${st.label ?? k}: ${bad}.`);
        saved[k] = v;
      }
      const dir = join(dataDir, id);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
      const tmp = `${settingsFile(id)}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(saved, null, 1), { mode: 0o600 });
      renameSync(tmp, settingsFile(id));
      emitSettings(id);
      if (enabled.has(id)) await Promise.all(m.providers.map((p) => run(id, p.id)));
      return { ok: true, values: settingsOf(id) };
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
    },
  };
}
