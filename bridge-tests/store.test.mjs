// The room store: a real bridge against a store served from a folder here,
// so each case (a tampered file, a room for a newer squad-chat, an update
// that reaches a new host) can be set up. Needs no server.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, statSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Bridge } from "./helpers.mjs";

const repoRoom = (id) => JSON.parse(readFileSync(new URL(`../rooms/${id}/room.json`, import.meta.url), "utf8"));

// A store folder: rooms/<id>/room.json plus an index built from them, which
// `lie` can bend (a wrong hash, an entry for a room that isn't there).
function storeDir(rooms, lie = {}) {
  const dir = mkdtempSync(join(tmpdir(), "sq-store-"));
  const entries = rooms.map((m) => {
    const text = `${JSON.stringify(m, null, 2)}\n`;
    mkdirSync(join(dir, m.id), { recursive: true });
    writeFileSync(join(dir, m.id, "room.json"), text);
    return { id: m.id, name: m.name, icon: m.icon, version: m.version, minSquadChat: m.minSquadChat, description: m.description, author: m.author, hosts: m.permissions.hosts, sha256: createHash("sha256").update(text).digest("hex"), ...(lie[m.id] ?? {}) };
  });
  writeFileSync(join(dir, "index.json"), JSON.stringify({ schema: 1, rooms: [...entries, ...(lie.extra ?? [])] }));
  return dir;
}

describe("the room store", () => {
  let served = null;   // the store folder the server answers from
  let down = false;
  const server = createServer((req, res) => {
    if (down) { res.writeHead(503); return res.end(); }
    const file = join(served, decodeURIComponent(req.url.replace(/^\/rooms\//, "")));
    if (!existsSync(file)) { res.writeHead(404); return res.end(); }
    res.end(readFileSync(file));
  });
  let b;
  const ids = () => b.events.filter((e) => e.type === "fnrooms").at(-1).rooms.map((r) => r.id);

  before(async () => {
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const tampered = { ...repoRoom("security-news"), description: "changed after the index was built" };
    const future = { ...repoRoom("us-tech"), id: "future-room", minSquadChat: "9.0.0" };
    const broken = { ...repoRoom("dev-blogs"), id: "broken-room", providers: [{ id: "x", type: "shell" }] };
    served = storeDir([repoRoom("dev-blogs"), tampered, future, broken, repoRoom("us-tech")], {
      "security-news": { sha256: createHash("sha256").update("the original").digest("hex") },
      extra: [{ id: "weather", name: "Weather", version: "9.9.9", sha256: "0".repeat(64) }],
    });
    b = new Bridge("store", { url: null, env: { SQUAD_ROOM_STORE: `http://127.0.0.1:${server.address().port}/rooms`, SQUAD_VERSION: "0.15.0" } });
    await b.start();
  });
  after(async () => {
    await b.stop();
    b.cleanup();
    server.close();
  });

  it("lists the store's rooms, and what this computer has of them", async () => {
    const { rooms, version } = await b.ok("POST", "/store/list", {});
    assert.equal(version, "0.15.0");
    const byId = Object.fromEntries(rooms.map((r) => [r.id, r]));
    assert.deepEqual(Object.keys(byId).sort(), ["broken-room", "dev-blogs", "future-room", "security-news", "us-tech", "weather"]);
    assert.deepEqual([byId["dev-blogs"].installed, byId["dev-blogs"].compatible, byId["dev-blogs"].hosts], [null, true, ["blog.cloudflare.com", "deno.com", "nodejs.org"]]);
    assert.equal(byId["future-room"].compatible, false);
    assert.equal(byId.weather.shipped, true);
  });

  it("installs only the copy it checked, and gives the room to the registry", async () => {
    const p = await b.ok("POST", "/store/preview", { id: "dev-blogs" });
    assert.deepEqual([p.name, p.version, p.hosts, p.newHosts, p.settings, p.providers], ["Dev Blogs", "1.0.0", ["blog.cloudflare.com", "deno.com", "nodejs.org"], ["blog.cloudflare.com", "deno.com", "nodejs.org"], ["feeds"], ["rss"]]);
    assert.ok(!ids().includes("dev-blogs"));   // nothing written by a look
    assert.equal((await b.call("POST", "/store/install", { id: "dev-blogs", sha256: "0".repeat(64) })).status, 409);
    const r = await b.ok("POST", "/store/install", { id: "dev-blogs", sha256: p.sha256 });
    assert.deepEqual([r.name, r.version], ["Dev Blogs", "1.0.0"]);
    await b.waitFor(() => ids().includes("dev-blogs"), 5_000, "dev-blogs loaded");
    const file = join(b.configDir, "rooms", "dev-blogs", "room.json");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(join(b.configDir, "rooms", "dev-blogs")).mode & 0o777, 0o700);
    assert.equal((await b.call("POST", "/store/install", { id: "dev-blogs", sha256: p.sha256 })).status, 409);   // a look is good for one install
    const listed = (await b.ok("POST", "/store/list", {})).rooms.find((x) => x.id === "dev-blogs");
    assert.deepEqual([listed.installed, listed.update], ["1.0.0", false]);
  });

  it("refuses what doesn't check out: a changed file, a newer squad-chat's room, a broken manifest, a shipped room", async () => {
    const no = async (id, status, want) => {
      const res = await b.call("POST", "/store/preview", { id });
      assert.equal(res.status, status, id);
      assert.match(res.body.error, want);
    };
    await no("security-news", 502, /doesn't match the store's index/);
    await no("future-room", 409, /needs squad-chat 9\.0\.0 or newer/);
    await no("broken-room", 422, /no provider called "shell"/);
    await no("weather", 409, /comes with squad-chat/);
    await no("nope", 404, /no room called nope/);
    await no("../etc", 400, /not a room id/);
  });

  it("updates, asking first when the new version reaches new hosts", async () => {
    const v2 = { ...repoRoom("dev-blogs"), version: "1.1.0", permissions: { hosts: ["blog.cloudflare.com", "deno.com", "nodejs.org", "bun.sh"] } };
    served = storeDir([v2, repoRoom("us-tech")]);
    const listed = (await b.ok("POST", "/store/list", { refresh: true })).rooms.find((x) => x.id === "dev-blogs");
    assert.deepEqual([listed.installed, listed.version, listed.update], ["1.0.0", "1.1.0", true]);
    const p = await b.ok("POST", "/store/preview", { id: "dev-blogs" });
    assert.deepEqual([p.hostsChanged, p.newHosts], [true, ["bun.sh"]]);
    await b.ok("POST", "/store/install", { id: "dev-blogs", sha256: p.sha256 });
    await b.waitFor(() => b.events.filter((e) => e.type === "fnrooms").at(-1).rooms.find((r) => r.id === "dev-blogs")?.version === "1.1.0", 5_000, "1.1.0 loaded");
  });

  it("uninstalls a room with its settings and data, and leaves shipped rooms alone", async () => {
    await b.ok("POST", "/fnroom/settings", { room: "dev-blogs", key: "feeds", value: "https://deno.com/feed" });
    assert.ok(existsSync(join(b.configDir, "room-data", "dev-blogs", "settings.json")));
    const r = await b.ok("POST", "/store/uninstall", { id: "dev-blogs" });
    assert.equal(r.name, "Dev Blogs");
    await b.waitFor(() => !ids().includes("dev-blogs"), 5_000, "dev-blogs gone");
    assert.ok(!existsSync(join(b.configDir, "rooms", "dev-blogs")));
    assert.ok(!existsSync(join(b.configDir, "room-data", "dev-blogs")));
    assert.equal((await b.call("POST", "/store/uninstall", { id: "weather" })).status, 409);
    assert.equal((await b.call("POST", "/store/uninstall", { id: "dev-blogs" })).status, 404);
  });

  it("says when the store can't be reached", async () => {
    down = true;
    const res = await b.call("POST", "/store/list", { refresh: true });
    assert.equal(res.status, 502);
    assert.match(res.body.error, /answered 503/);
    down = false;
  });
});
