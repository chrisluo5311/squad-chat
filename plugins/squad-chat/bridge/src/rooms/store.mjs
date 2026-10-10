// The room store: rooms other people wrote, listed in the repository's
// rooms/index.json and installed into <config dir>/rooms/<id>/room.json.
//
// A room is data, never code: its manifest can only use the providers
// squad-chat ships, reach the hosts it names, and draw with the widgets the
// pane has. So installing one asks the person about the hosts, not about
// trusting someone's code. Each manifest is checked like a shipped one, its
// sha256 must match the index (a download cut short or mixed up with
// another isn't installed), and it must say it works with this version.
// What the person saw is what's written: install takes the copy the preview
// fetched and checked, by its hash.

import { createHash } from "node:crypto";
import { mkdirSync, chmodSync, writeFileSync, renameSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { checkManifest, compareVersions } from "./manifest.mjs";
import { limitedFetch, RoomError, clean } from "./net.mjs";

export const DEFAULT_STORE = "https://raw.githubusercontent.com/chrisluo5311/squad-chat/main/rooms";
const INDEX_TTL_MS = 10 * 60_000;
const PREVIEW_TTL_MS = 10 * 60_000;
const ID = /^[a-z][a-z0-9-]{1,23}$/;
const SHA = /^[0-9a-f]{64}$/;

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

export function roomStore({ url = DEFAULT_STORE, configDir, dataDir, registry, providers, version, fetch: get = limitedFetch }) {
  const base = String(url).replace(/\/+$/, "");
  const hosts = [new URL(base).hostname.toLowerCase()];
  let index = null;            // { at, rooms }
  const pending = new Map();   // id → { text, manifest, sha, at }: a checked copy, waiting for its install

  async function fetchText(path) {
    const r = await get(`${base}/${path}`, { hosts });
    if (r.status === 404) throw new RoomError(404, `the store has no ${path}`);
    if (!r.ok) throw new RoomError(502, `the store answered ${r.status} for ${path}`);
    return r.text;
  }

  async function loadIndex(force = false) {
    if (!force && index && Date.now() - index.at < INDEX_TTL_MS) return index.rooms;
    let data;
    try { data = JSON.parse(await fetchText("index.json")); } catch (err) { if (err instanceof RoomError) throw err; throw new RoomError(502, "the store's index isn't JSON"); }
    if (!Array.isArray(data?.rooms)) throw new RoomError(502, "the store's index has no rooms");
    const rooms = clean(data.rooms).filter((r) => r && ID.test(r.id ?? "") && SHA.test(r.sha256 ?? "") && typeof r.version === "string");
    index = { at: Date.now(), rooms };
    return rooms;
  }

  const installedManifest = (id) => {
    const src = registry.source(id);
    if (src && !src.shipped) return src.manifest;
    try { return JSON.parse(readFileSync(join(configDir, "rooms", id, "room.json"), "utf8")); } catch { return null; }
  };
  const hostsOf = (m) => [...(m?.permissions?.hosts ?? [])].map((h) => h.toLowerCase()).sort();

  // An index entry, with what this computer has of it.
  function describe(r) {
    const shipped = registry.source(r.id)?.shipped ?? false;
    const mine = shipped ? null : installedManifest(r.id);
    return {
      id: r.id,
      name: String(r.name ?? r.id).slice(0, 20),
      icon: String(r.icon ?? "·").slice(0, 2),
      version: r.version,
      description: String(r.description ?? "").slice(0, 200),
      author: String(r.author ?? "").slice(0, 60),
      hosts: Array.isArray(r.hosts) ? r.hosts.map(String) : [],
      shipped,
      installed: mine?.version ?? null,
      update: !!mine?.version && compareVersions(r.version, mine.version) > 0,
      compatible: !r.minSquadChat || !version || compareVersions(r.minSquadChat, version) <= 0,
      minSquadChat: r.minSquadChat ?? null,
    };
  }

  return {
    async list({ refresh = false } = {}) {
      return { rooms: (await loadIndex(refresh)).map(describe), version };
    },

    // Fetches and checks a room, and holds that copy for install. Says what
    // it would reach, and whether that changed from the installed version.
    async preview(id) {
      if (!ID.test(String(id ?? ""))) throw new RoomError(400, `not a room id: ${id}`);
      const entry = (await loadIndex()).find((r) => r.id === id) ?? (await loadIndex(true)).find((r) => r.id === id);
      if (!entry) throw new RoomError(404, `The store has no room called ${id}.`);
      const info = describe(entry);
      if (info.shipped) throw new RoomError(409, `${info.name} comes with squad-chat: /chat rooms +${id} shows it.`);
      if (!info.compatible) throw new RoomError(409, `${info.name} needs squad-chat ${entry.minSquadChat} or newer. Update squad-chat first.`);
      const text = await fetchText(`${id}/room.json`);
      const sha = sha256(text);
      if (sha !== entry.sha256) throw new RoomError(502, `${id}/room.json doesn't match the store's index. Try again later.`);
      let manifest;
      try { manifest = JSON.parse(text); } catch { throw new RoomError(502, `${id}/room.json isn't JSON`); }
      const errors = checkManifest(manifest, providers);
      if (manifest.id !== id) errors.push(`id: "${manifest.id}" but the store lists "${id}"`);
      if (manifest.version !== entry.version) errors.push(`version: ${manifest.version} but the store lists ${entry.version}`);
      if (manifest.minSquadChat && version && compareVersions(manifest.minSquadChat, version) > 0) errors.push(`needs squad-chat ${manifest.minSquadChat} or newer`);
      if (errors.length) throw new RoomError(422, `${id} doesn't check out: ${errors.slice(0, 3).join("; ")}`);
      pending.set(id, { text, manifest, sha, at: Date.now() });
      const was = installedManifest(id);
      return {
        ...info,
        sha256: sha,
        hosts: hostsOf(manifest),
        settings: Object.keys(manifest.settings ?? {}),
        providers: manifest.providers.map((p) => p.type),
        hostsChanged: !!was && JSON.stringify(hostsOf(was)) !== JSON.stringify(hostsOf(manifest)),
        newHosts: was ? hostsOf(manifest).filter((h) => !hostsOf(was).includes(h)) : hostsOf(manifest),
      };
    },

    // Writes the copy the preview checked (by its hash), then reloads.
    install(id, sha) {
      const p = pending.get(id);
      if (!p || p.sha !== sha || Date.now() - p.at > PREVIEW_TTL_MS) throw new RoomError(409, "Look at it again first: /chat install " + id);
      pending.delete(id);
      const dir = join(configDir, "rooms", id);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      chmodSync(dir, 0o700);
      const file = join(dir, "room.json");
      const tmp = `${file}.${process.pid}.tmp`;
      writeFileSync(tmp, p.text, { mode: 0o600 });
      renameSync(tmp, file);
      registry.reload();
      return { ok: true, id, name: p.manifest.name, version: p.manifest.version, hosts: hostsOf(p.manifest) };
    },

    // Removes an installed room, its settings and its data. Shipped rooms stay.
    uninstall(id) {
      const src = registry.source(id);
      if (src?.shipped) throw new RoomError(409, `${src.manifest.name} comes with squad-chat. /chat rooms -${id} hides it.`);
      if (!ID.test(String(id ?? "")) || !installedManifest(id)) throw new RoomError(404, `No room called ${id} is installed.`);
      const name = installedManifest(id)?.name ?? id;
      rmSync(join(configDir, "rooms", id), { recursive: true, force: true });
      rmSync(join(dataDir, id), { recursive: true, force: true });
      registry.reload();
      return { ok: true, id, name };
    },
  };
}
