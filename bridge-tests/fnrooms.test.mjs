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
    assert.deepEqual(ev.rooms.map((r) => r.id), ["lofi", "monitor", "news", "snippet", "stock", "weather"]);
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

  it("reports each room's settings, changes them as typed, and refuses what doesn't fit", async () => {
    const values = (id) => b.events.filter((e) => e.type === "fnsettings" && e.id === id).at(-1)?.values;
    assert.deepEqual(values("weather"), { cities: ["Taipei"], units: "metric" });
    assert.equal(values("snippet"), undefined);   // no settings, no event

    // Weather has no tab here, so nothing goes online: only the setting changes.
    let r = await b.ok("POST", "/fnroom/settings", { room: "weather", key: "cities", value: "Taipei, Tokyo , New York" });
    assert.deepEqual(r.values.cities, ["Taipei", "Tokyo", "New York"]);
    r = await b.ok("POST", "/fnroom/settings", { room: "weather", key: "cities", value: "+Osaka, -tokyo" });
    assert.deepEqual(r.values.cities, ["Taipei", "New York", "Osaka"]);
    r = await b.ok("POST", "/fnroom/settings", { room: "weather", key: "units", value: "Imperial" });
    assert.equal(r.values.units, "imperial");
    assert.deepEqual(values("weather"), { cities: ["Taipei", "New York", "Osaka"], units: "imperial" });
    const file = join(b.configDir, "room-data", "weather", "settings.json");
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { cities: ["Taipei", "New York", "Osaka"], units: "imperial" });

    const bad = async (body, want) => {
      const res = await b.call("POST", "/fnroom/settings", body);
      assert.equal(res.status, want[0]);
      assert.match(res.body.error, want[1]);
    };
    await bad({ room: "weather", key: "units", value: "kelvin" }, [400, /Units: one of metric, imperial/]);
    await bad({ room: "weather", key: "cities", value: "a,b,c,d,e,f,g" }, [400, /at most 6/]);
    await bad({ room: "weather", key: "colour", value: "x" }, [404, /no setting colour\. It has cities, units/]);
    await bad({ room: "news", key: "feeds", value: "+https://evil.example/rss" }, [400, /evil\.example isn't one of this room's hosts/]);
    await bad({ room: "news", key: "feeds", value: "+http://techcrunch.com/feed/" }, [400, /not https/]);
    await bad({ room: "snippet", key: "x", value: "y" }, [404, /Snippets has no setting x/]);

    r = await b.ok("POST", "/fnroom/settings", { room: "weather", key: "cities", value: "default" });
    assert.deepEqual(r.values, { cities: ["Taipei"], units: "imperial" });
    // Setting a default by hand keeps nothing, so a later default still reaches you.
    await b.ok("POST", "/fnroom/settings", { room: "weather", key: "units", value: "metric" });
    assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), {});
  });

  it("loses no setting when two sessions change them at once", async () => {
    const other = new Bridge("rooms-3", { url: null, configDir: b.configDir });
    await other.start();
    try {
      await Promise.all([
        b.ok("POST", "/fnroom/settings", { room: "weather", key: "cities", value: "Kyoto" }),
        other.ok("POST", "/fnroom/settings", { room: "weather", key: "units", value: "imperial" }),
        b.ok("POST", "/fnroom/settings", { room: "news", key: "hn", value: "best" }),
        other.ok("POST", "/fnroom/settings", { room: "news", key: "feeds", value: "-https://techcrunch.com/feed/" }),
      ]);
      const read = (id) => JSON.parse(readFileSync(join(b.configDir, "room-data", id, "settings.json"), "utf8"));
      assert.deepEqual(read("weather"), { cities: ["Kyoto"], units: "imperial" });
      assert.equal(read("news").hn, "best");
      assert.equal(read("news").feeds.length, 3);
    } finally {
      await other.stop();
      rmSync(other.socketDir, { recursive: true, force: true });
    }
    for (const [room, key] of [["weather", "cities"], ["weather", "units"], ["news", "hn"], ["news", "feeds"]]) await b.ok("POST", "/fnroom/settings", { room, key, value: "default" });
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
    // A "__proto__" key, as is or once cleaned, never sets a copy's prototype.
    const polluted = clean(JSON.parse('{"row": {"__proto__": {"changeValue": 99}, "__pro\\u0000to__": {"alerts": [1]}, "usd": 1}}'));
    assert.equal(polluted.row.changeValue, undefined);
    assert.equal(polluted.row.alerts, undefined);
    assert.equal(Object.getPrototypeOf(polluted.row), Object.prototype);
    assert.deepEqual(polluted.row, { usd: 1 });

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
  it("every room squad-chat ships checks out", () => {
    for (const id of ["snippet", "weather", "news", "monitor", "stock", "lofi"]) {
      const m = JSON.parse(readFileSync(new URL(`../plugins/squad-chat/rooms/${id}/room.json`, import.meta.url), "utf8"));
      assert.deepEqual(checkManifest(m, PROVIDERS), [], id);
    }
  });

  it("checks settings: their kinds, their defaults, and params that name them", () => {
    const m = {
      ...SNIPPET,
      permissions: { hosts: ["example.com"] },
      settings: {
        feeds: { type: "list", item: "url", default: ["https://other.example/rss"] },
        mode: { type: "enum", values: ["a", "b"], default: "c" },
        "Bad Key": { type: "string", default: "x" },
        n: { type: "float" },
      },
      providers: [{ id: "list", type: "local-list", params: { x: "$settings.missing" } }],
    };
    const errors = checkManifest(m, PROVIDERS).join("\n");
    for (const want of [/settings.feeds.default: other.example isn't one of this room's hosts/, /settings.mode.default: one of a, b/, /settings.Bad Key: a key/, /settings.n.type/, /params.x: no setting called missing/]) {
      assert.match(errors, want);
    }
  });

  it("takes a column of widgets for a body, and a card shown only `when` its data is there", () => {
    const m = { ...SNIPPET, layout: { cards: [{ title: "X", when: "list.items", body: [{ type: "text", text: "a" }, { type: "meter", label: "M", value: "list.count" }] }], inline: [{ type: "text", text: "b" }] } };
    assert.deepEqual(checkManifest(m, PROVIDERS), []);
    const bad = { ...SNIPPET, layout: { cards: [{ title: "X", when: "a b", body: [] }], inline: [{ type: "nope" }] } };
    const errors = checkManifest(bad, PROVIDERS).join("\n");
    for (const want of [/cards\[0\].when: not a path/, /cards\[0\].body: 1-6 widgets/, /inline\[0\]: unknown widget "nope"/]) assert.match(errors, want);
  });

  it("holds buttons, a row's action and keys to actions the provider has", () => {
    const ok = { ...SNIPPET, layout: { cards: [{ title: "X", body: [{ type: "buttons", buttons: [{ label: "✕", action: "delete", args: { name: "x" } }] }, { type: "list", items: "list.items", title: "name", act: { label: "▶", action: "rename", field: "id" } }] }], keys: { d: "delete" } } };
    assert.deepEqual(checkManifest(ok, PROVIDERS), []);
    const bad = { ...SNIPPET, layout: { cards: [{ title: "X", body: [{ type: "buttons", buttons: [{ label: "go", action: "launch" }, { label: "way too long a label", action: "Bad Name" }] }, { type: "list", items: "list.items", title: "name", act: { label: "▶", action: "run", field: "id" } }] }], keys: { r: "delete", xx: "add", q: "fly" } } };
    const errors = checkManifest(bad, PROVIDERS).join("\n");
    for (const want of [/buttons\[0\]: local-list has no action launch/, /buttons\[1\].label: 1-8/, /buttons\[1\].action: an action's name/, /act: local-list has no action run/, /keys.r: one letter or digit, not r/, /keys.xx/, /keys.q: local-list has no action fly/]) assert.match(errors, want);
  });

  it("holds the player's stations to the room's hosts", () => {
    const lofi = JSON.parse(readFileSync(new URL("../plugins/squad-chat/rooms/lofi/room.json", import.meta.url), "utf8"));
    const bad = { ...lofi, permissions: { hosts: ["ice2.somafm.com"] }, providers: [{ ...lofi.providers[0], params: { ...lofi.providers[0].params, stations: [...lofi.providers[0].params.stations, { name: "Beacon", url: "https://tracker.example/b" }, { name: "Plain", url: "http://ice2.somafm.com/x" }, { name: "File", url: "/etc/passwd" }] } }] };
    const errors = checkManifest(bad, PROVIDERS).join("\n");
    for (const want of [/stations\[0\].url: www.youtube.com isn't one of this room's hosts/, /stations\[5\].url: tracker.example isn't one of this room's hosts/, /stations\[6\].url: an https URL/, /stations\[7\].url: an https URL/]) assert.match(errors, want);
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
