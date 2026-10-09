// Function rooms: the manifests this bridge found, and their providers run on
// a schedule. Rooms come from two folders, each holding <id>/room.json: the
// ones squad-chat ships (SQUAD_ROOMS_DIR, the plugin's rooms/), then the ones
// installed on this computer (<config dir>/rooms/), which can't replace a
// shipped one. A manifest that doesn't check out is reported and skipped.
//
// Events:
//   { type: "fnrooms", rooms: [manifest], invalid: [{ dir, errors }] }
//   { type: "fnroom", id, provider, data, at, error?, stale? }
//
// A provider runs when its room is enabled: once at the start, after each
// of its actions, and on its interval, the `visible` one while its room is
// on show and the `background` one otherwise (none: it waits for an action).

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkManifest, parseInterval } from "./manifest.mjs";
import { allowedHosts, limitedFetch, clean, RoomError } from "./net.mjs";
import localList from "./providers/local-list.mjs";

export const PROVIDERS = Object.fromEntries([localList].map((p) => [p.type, p]));

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
  const running = new Set();

  const key = (id, pid) => `${id}/${pid}`;

  function ctxFor(m, p) {
    const def = providers[p.type];
    const hosts = allowedHosts(def.hosts, m.permissions?.hosts ?? []);
    return {
      dataDir: join(dataDir, m.id),
      fetch: (url, init) => limitedFetch(url, { ...init, hosts }),
    };
  }

  async function run(id, pid) {
    const m = rooms.get(id);
    const p = m?.providers.find((x) => x.id === pid);
    if (!p) return;
    const k = key(id, pid);
    if (running.has(k)) return;
    running.add(k);
    clearTimeout(timers.get(k));
    try {
      const data = clean(await providers[p.type].fetch(p.params ?? {}, ctxFor(m, p)));
      const at = Date.now();
      last.set(k, { data, at });
      emit({ type: "fnroom", id, provider: pid, data, at });
    } catch (err) {
      if (!(err instanceof RoomError)) log(`room ${id}/${pid}: ${err?.stack ?? err}`);
      const prev = last.get(k);
      emit({ type: "fnroom", id, provider: pid, data: prev?.data ?? null, at: prev?.at ?? null, error: err?.message ?? String(err), stale: !!prev });
    } finally {
      running.delete(k);
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
      const fn = providers[p.type].actions?.[action];
      if (typeof fn !== "function") throw new RoomError(404, `${p.type} has no action ${action}`);
      const r = await fn(p.params ?? {}, args && typeof args === "object" ? args : {}, ctxFor(m, p));
      await run(id, p.id);
      return clean(r ?? { ok: true });
    },
    close() {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    },
  };
}
