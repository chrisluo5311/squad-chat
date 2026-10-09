// Function rooms: the bridge loads the shipped rooms and any installed ones,
// refuses manifests that don't check out, and runs the Snippet room's list.
// Then the pieces every provider leans on: fetch held to a room's hosts,
// and strings cleaned of terminal escapes. Needs no server.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, statSync, existsSync, rmSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { Bridge } from "./helpers.mjs";
import { limitedFetch, clean, allowedHosts } from "../plugins/squad-chat/bridge/src/rooms/net.mjs";
import { checkManifest } from "../plugins/squad-chat/bridge/src/rooms/manifest.mjs";
import { PROVIDERS } from "../plugins/squad-chat/bridge/src/rooms/registry.mjs";

const SNIPPET = JSON.parse(readFileSync(new URL("../plugins/squad-chat/rooms/snippet/room.json", import.meta.url), "utf8"));
const latest = (b, id) => b.events.filter((e) => e.type === "fnroom" && e.id === id).at(-1);
const count = (b) => latest(b, "snippet")?.data?.count;

describe("function rooms in the bridge", () => {
  const b = new Bridge("rooms", { url: null });
  // Installed rooms: one broken, one that tries to take a shipped room's id.
  mkdirSync(join(b.configDir, "rooms", "broken"), { recursive: true });
  writeFileSync(join(b.configDir, "rooms", "broken", "room.json"), JSON.stringify({ ...SNIPPET, id: "broken", providers: [{ id: "x", type: "shell" }] }));
  mkdirSync(join(b.configDir, "rooms", "snippet"), { recursive: true });
  writeFileSync(join(b.configDir, "rooms", "snippet", "room.json"), JSON.stringify(SNIPPET));
  after(async () => { await b.stop(); b.cleanup(); });

  it("reports the shipped rooms, and refuses the ones that don't check out", async () => {
    await b.start();
    const ev = await b.waitFor((e) => e.type === "fnrooms");
    assert.deepEqual(ev.rooms.map((r) => r.id), ["snippet"]);
    const why = Object.fromEntries(ev.invalid.map((x) => [x.dir.split("/").at(-1), x.errors.join("; ")]));
    assert.match(why.broken, /no provider called "shell"/);
    assert.match(why.snippet, /already a room/);
  });

  it("runs a room's provider once it's enabled", async () => {
    await b.ok("POST", "/fnroom/visible", { enabled: ["snippet", "nope"], shown: "snippet" });
    await b.waitFor((e) => e.type === "fnroom" && e.id === "snippet", 5_000, "the list");
    assert.equal(count(b), 0);
  });

  it("adds, renames and deletes snippets, kept in a private file", async () => {
    const r = await b.ok("POST", "/fnroom/action", { room: "snippet", action: "add", args: { name: "jq pretty", lang: "sh", body: "\n\njq . file.json\n" } });
    assert.equal(r.item.body, "jq . file.json");
    assert.equal(count(b), 1);
    const file = join(b.configDir, "room-data", "snippet", "list.json");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(statSync(join(b.configDir, "room-data", "snippet")).mode & 0o777, 0o700);

    const dup = await b.call("POST", "/fnroom/action", { room: "snippet", action: "add", args: { name: "JQ Pretty", body: "x" } });
    assert.equal(dup.status, 409);
    assert.match(dup.body.error, /already a snippet called "JQ Pretty"/);
    assert.equal((await b.call("POST", "/fnroom/action", { room: "snippet", action: "add", args: { name: "", body: "x" } })).status, 400);
    assert.equal((await b.call("POST", "/fnroom/action", { room: "snippet", action: "add", args: { name: "empty", body: "  \n " } })).status, 400);
    assert.equal((await b.call("POST", "/fnroom/action", { room: "snippet", action: "run", args: {} })).status, 404);
    assert.equal((await b.call("POST", "/fnroom/action", { room: "nope", action: "add", args: {} })).status, 404);

    await b.ok("POST", "/fnroom/action", { room: "snippet", action: "add", args: { name: "curl json", body: "curl -sH 'accept: application/json' $URL" } });
    await b.ok("POST", "/fnroom/action", { room: "snippet", action: "rename", args: { name: "jq pretty", to: "jq tidy" } });
    assert.deepEqual(latest(b, "snippet").data.items.map((x) => x.name), ["curl json", "jq tidy"]);
    await b.ok("POST", "/fnroom/action", { room: "snippet", action: "delete", args: { name: "CURL JSON" } });
    assert.deepEqual(latest(b, "snippet").data.items.map((x) => x.name), ["jq tidy"]);
    assert.equal((await b.call("POST", "/fnroom/action", { room: "snippet", action: "delete", args: { name: "gone" } })).status, 404);
  });

  it("leaves a list it can't read alone, and says so", async () => {
    const file = join(b.configDir, "room-data", "snippet", "list.json");
    const good = readFileSync(file, "utf8");
    writeFileSync(file, "{ not json");
    const r = await b.call("POST", "/fnroom/action", { room: "snippet", action: "add", args: { name: "new", body: "x" } });
    assert.equal(r.status, 500);
    assert.match(r.body.error, /isn't valid JSON\. Fix or move it: nothing was changed\./);
    assert.equal(readFileSync(file, "utf8"), "{ not json");
    await b.ok("POST", "/fnroom/refresh", { room: "snippet" });
    const ev = latest(b, "snippet");
    assert.match(ev.error, /isn't valid JSON/);
    assert.equal(ev.stale, true);
    assert.deepEqual(ev.data.items.map((x) => x.name), ["jq tidy"]);   // the last good list, still shown
    writeFileSync(file, JSON.stringify({ items: "nope" }));
    assert.equal((await b.call("POST", "/fnroom/action", { room: "snippet", action: "delete", args: { name: "jq tidy" } })).status, 500);
    writeFileSync(file, good);
  });

  it("loses nothing when two sessions change the list at once", async () => {
    const other = new Bridge("rooms-2", { url: null, configDir: b.configDir });
    await other.start();
    try {
      const adds = [];
      for (let i = 0; i < 10; i++) {
        const who = i % 2 ? other : b;
        adds.push(who.ok("POST", "/fnroom/action", { room: "snippet", action: "add", args: { name: `n${i}`, body: `echo ${i}` } }));
      }
      await Promise.all(adds);
      await b.ok("POST", "/fnroom/refresh", { room: "snippet" });
      assert.equal(count(b), 11);
      assert.ok(!existsSync(join(b.configDir, "room-data", "snippet", "list.lock")));
    } finally {
      await other.stop();
      rmSync(other.socketDir, { recursive: true, force: true });
    }
    for (let i = 0; i < 10; i++) await b.ok("POST", "/fnroom/action", { room: "snippet", action: "delete", args: { name: `n${i}` } });
  });

  it("keeps the list across restarts", async () => {
    await b.stop();
    await b.start();
    await b.ok("POST", "/fnroom/visible", { enabled: ["snippet"] });
    await b.waitFor((e) => e.type === "fnroom" && e.id === "snippet", 5_000, "the list");
    assert.equal(count(b), 1);
  });
});

describe("what a provider may fetch", () => {
  let base;
  const server = createServer((req, res) => {
    if (req.url === "/slow") return setTimeout(() => res.end("late"), 2_000);
    if (req.url === "/big") return res.end("x".repeat(5_000));
    if (req.url === "/away") { res.writeHead(302, { location: "https://example.com/" }); return res.end(); }
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ title: "\x1b[31mred\x1b[0m \x1b]8;;https://evil.example\x07link\x1b]8;;\x07 \x07bell\nok" }));
  });
  after(() => server.close());

  it("reaches only the room's hosts, within time and size", async () => {
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${server.address().port}`;
    const hosts = ["127.0.0.1"];
    const r = await limitedFetch(`${base}/`, { hosts });
    assert.equal(r.status, 200);
    assert.equal(clean(r.json()).title, "red link bell\nok");

    await assert.rejects(limitedFetch(`${base}/`, { hosts: ["example.com"] }), { status: 403 });
    await assert.rejects(limitedFetch("file:///etc/passwd", { hosts }), { status: 400 });
    await assert.rejects(limitedFetch(`${base}/slow`, { hosts, timeoutMs: 200 }), { status: 504 });
    await assert.rejects(limitedFetch(`${base}/big`, { hosts, maxBytes: 1_000 }), { status: 502, message: /more than/ });
    await assert.rejects(limitedFetch(`${base}/away`, { hosts }), { status: 502, message: /redirected/ });
  });

  it("allows a host only when both the provider and the manifest name it", () => {
    assert.deepEqual(allowedHosts(["api.open-meteo.com", "geocoding-api.open-meteo.com"], ["API.open-meteo.com", "evil.example"]), ["api.open-meteo.com"]);
    assert.deepEqual(allowedHosts([], ["evil.example"]), []);
  });
});

describe("manifests", () => {
  it("the Snippet room's checks out", () => {
    assert.deepEqual(checkManifest(SNIPPET, PROVIDERS), []);
  });

  it("names what's wrong", () => {
    const bad = {
      ...SNIPPET,
      id: "usage",
      icon: "⌘⌘",
      color: "neon",
      permissions: { hosts: ["http://x.com"] },
      providers: [{ id: "list", type: "local-list", interval: { visible: "1ms" } }],
      layout: { cards: [{ title: "X", body: { type: "list", items: "list.items; rm -rf", title: "name", onPress: "x" } }], inline: { type: "html" } },
    };
    const errors = checkManifest(bad, PROVIDERS).join("\n");
    for (const want of [/id: "usage" is taken/, /icon: one character/, /color: one of/, /permissions.hosts/, /interval.visible/, /items: not a path/, /onPress: not a field of list/, /unknown widget "html"/]) {
      assert.match(errors, want);
    }
  });
});
