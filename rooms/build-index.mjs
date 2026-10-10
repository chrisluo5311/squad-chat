// The room store's index: every rooms/<id>/room.json, checked as the bridge
// checks it, with the sha256 the bridge holds each download to.
//
//   node rooms/build-index.mjs           write rooms/index.json
//   node rooms/build-index.mjs --check   fail if a room doesn't check out or
//                                        the index isn't up to date (CI)

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { checkManifest } from "../plugins/squad-chat/bridge/src/rooms/manifest.mjs";
import { PROVIDERS } from "../plugins/squad-chat/bridge/src/rooms/registry.mjs";

const here = new URL("./", import.meta.url);
const shipped = new Set(readdirSync(new URL("../plugins/squad-chat/rooms/", import.meta.url)));
const problems = [];
const rooms = [];

for (const id of readdirSync(here, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort()) {
  const file = new URL(`${id}/room.json`, here);
  if (!existsSync(file)) { problems.push(`${id}: no room.json`); continue; }
  const text = readFileSync(file, "utf8");
  let m;
  try { m = JSON.parse(text); } catch (err) { problems.push(`${id}: ${err.message}`); continue; }
  const errors = checkManifest(m, PROVIDERS);
  if (m.id !== id) errors.push(`id is "${m.id}" but the folder is "${id}"`);
  if (shipped.has(id)) errors.push("that id comes with squad-chat");
  if (!m.minSquadChat) errors.push("minSquadChat: say which squad-chat it needs (0.15.0 or newer, the first with the store)");
  if (!m.author) errors.push("author: who wrote it");
  if (errors.length) { problems.push(...errors.map((e) => `${id}: ${e}`)); continue; }
  rooms.push({
    id,
    name: m.name,
    icon: m.icon,
    version: m.version,
    minSquadChat: m.minSquadChat,
    description: m.description ?? "",
    author: m.author,
    hosts: m.permissions?.hosts ?? [],
    providers: [...new Set(m.providers.map((p) => p.type))],
    sha256: createHash("sha256").update(text).digest("hex"),
  });
}

const index = `${JSON.stringify({ schema: 1, rooms }, null, 2)}\n`;
const out = new URL("index.json", here);
if (problems.length) {
  console.error(problems.map((p) => `✗ ${p}`).join("\n"));
  process.exit(1);
}
if (process.argv.includes("--check")) {
  const now = existsSync(out) ? readFileSync(out, "utf8") : "";
  if (now !== index) {
    console.error("✗ rooms/index.json is out of date: run node rooms/build-index.mjs and commit it");
    process.exit(1);
  }
  console.log(`✓ ${rooms.length} rooms check out, and the index is up to date`);
} else {
  writeFileSync(out, index);
  console.log(`wrote rooms/index.json: ${rooms.map((r) => r.id).join(", ")}`);
}
