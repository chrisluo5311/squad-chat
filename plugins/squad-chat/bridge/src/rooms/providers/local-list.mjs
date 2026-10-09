// A list kept on this computer, one JSON file per room (written 0600 through
// a temporary file and a rename). The Snippet room's store. Never touches
// the network.

import { readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { RoomError } from "../net.mjs";

const MAX_ITEMS = 200;
const MAX_BODY = 20_000;
const NAME = /^[^\n\r\t]{1,40}$/;
const LANG = /^[a-z0-9+#._-]{1,20}$/;

function load(dir) {
  try {
    const data = JSON.parse(readFileSync(join(dir, "list.json"), "utf8"));
    return Array.isArray(data.items) ? data.items : [];
  } catch {
    return [];
  }
}

function save(dir, items) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = join(dir, "list.json");
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ v: 1, items }, null, 1), { mode: 0o600 });
  renameSync(tmp, file);
}

const byName = (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
const same = (a, b) => a.toLowerCase() === b.toLowerCase();

function cleanName(name) {
  const n = String(name ?? "").trim();
  if (!NAME.test(n)) throw new RoomError(400, "A name is 1-40 characters on one line.");
  return n;
}

function find(items, name) {
  const n = cleanName(name);
  const i = items.findIndex((x) => same(x.name, n));
  if (i < 0) throw new RoomError(404, `No snippet called "${n}".`);
  return i;
}

export default {
  type: "local-list",
  hosts: [],
  async fetch(params, ctx) {
    const items = load(ctx.dataDir).sort(byName);
    return { items, count: items.length };
  },
  actions: {
    add(params, args, ctx) {
      const items = load(ctx.dataDir);
      const name = cleanName(args.name);
      const body = String(args.body ?? "").replace(/^(\s*\n)+/, "").trimEnd();
      if (!body.trim()) throw new RoomError(400, "Nothing to save.");
      if (body.length > MAX_BODY) throw new RoomError(413, `Too long to save: ${body.length} characters, more than ${MAX_BODY}.`);
      if (items.some((x) => same(x.name, name))) throw new RoomError(409, `There's already a snippet called "${name}". Rename or delete it first.`);
      const max = Math.min(MAX_ITEMS, Number(params.max) || MAX_ITEMS);
      if (items.length >= max) throw new RoomError(409, `That's ${max} snippets already. Delete one first.`);
      const lang = args.lang && LANG.test(args.lang) ? args.lang : null;
      const item = { id: randomBytes(6).toString("hex"), name, lang, body, at: new Date().toISOString() };
      items.push(item);
      save(ctx.dataDir, items);
      return { ok: true, item };
    },
    delete(params, args, ctx) {
      const items = load(ctx.dataDir);
      const [item] = items.splice(find(items, args.name), 1);
      save(ctx.dataDir, items);
      return { ok: true, item };
    },
    rename(params, args, ctx) {
      const items = load(ctx.dataDir);
      const i = find(items, args.name);
      const to = cleanName(args.to);
      if (items.some((x, j) => j !== i && same(x.name, to))) throw new RoomError(409, `There's already a snippet called "${to}".`);
      items[i] = { ...items[i], name: to };
      save(ctx.dataDir, items);
      return { ok: true, item: items[i] };
    },
  },
};
