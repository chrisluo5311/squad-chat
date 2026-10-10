// The registry's own behavior with a fake provider that counts its runs: it
// stops for good on close, a reload re-runs only what changed, and settings
// another session writes are picked up. Plus the lock every bridge shares.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { roomRegistry, PROVIDERS } from "../plugins/squad-chat/bridge/src/rooms/registry.mjs";
import { locked } from "../plugins/squad-chat/bridge/src/rooms/lock.mjs";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function setup(rooms) {
  const dir = mkdtempSync(join(tmpdir(), "sq-reg-"));
  const write = (id, extra = {}) => {
    mkdirSync(join(dir, "rooms", id), { recursive: true });
    writeFileSync(join(dir, "rooms", id, "room.json"), JSON.stringify({
      schema: 1, id, version: "1.0.0", name: id, icon: "·", color: "sky",
      settings: { word: { type: "string", default: "hello" } },
      providers: [{ id: "p", type: "counter", params: { word: "$settings.word" }, interval: { background: "1s" } }],
      layout: { cards: [{ title: "X", body: { type: "text", text: "{p.n}" } }] },
      ...extra,
    }));
  };
  for (const id of rooms) write(id);
  const runs = [];
  const counter = { type: "counter", hosts: [], async fetch(params, ctx) { runs.push({ room: ctx.dataDir.split("/").at(-1), word: params.word }); await sleep(30); return { n: runs.length }; } };
  const events = [];
  const reg = roomRegistry({ dirs: [join(dir, "rooms")], dataDir: join(dir, "data"), emit: (e) => events.push(e), providers: { ...PROVIDERS, counter } });
  return { dir, write, runs, events, reg, count: (id) => runs.filter((r) => r.room === id).length };
}

describe("the registry", () => {
  it("stops for good on close: a run still going doesn't come back", async () => {
    const t = setup(["aa"]);
    t.reg.setVisible({ enabled: ["aa"] });
    await sleep(5);   // the first run is under way
    t.reg.close();
    await sleep(1_300);   // past its 1s interval
    assert.equal(t.count("aa"), 1);
    await t.reg.refresh("aa");   // and nothing new starts
    assert.equal(t.count("aa"), 1);
  });

  it("re-runs on reload only the rooms that are new or changed", async () => {
    const t = setup(["aa", "bb"]);
    try {
      t.reg.setVisible({ enabled: ["aa", "bb", "cc"] });
      await sleep(80);
      assert.deepEqual([t.count("aa"), t.count("bb")], [1, 1]);
      t.write("bb", { version: "1.1.0" });   // an update
      t.write("cc");                          // an install, its tab already asked for
      t.reg.reload();
      t.reg.setVisible({ enabled: ["aa", "bb", "cc"] });   // what the mod sends once the new room is reported
      await sleep(80);
      assert.deepEqual([t.count("aa"), t.count("bb"), t.count("cc")], [1, 2, 1]);
    } finally { t.reg.close(); }
  });

  it("picks up settings another session's bridge wrote", async () => {
    const t = setup(["aa"]);
    await t.reg.refresh("aa");
    mkdirSync(join(t.dir, "data", "aa"), { recursive: true });
    writeFileSync(join(t.dir, "data", "aa", "settings.json"), JSON.stringify({ word: "bonjour" }));
    await t.reg.refresh("aa");
    await t.reg.setSetting({ room: "aa", key: "word", value: "hola" });   // and its own writes, at once
    await t.reg.refresh("aa");
    assert.deepEqual(t.runs.map((r) => r.word), ["hello", "bonjour", "hola"]);
    t.reg.close();
  });
});

describe("the shared lock", () => {
  it("breaks a lock whose holder is gone, at once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sq-lock-"));
    mkdirSync(join(dir, "x.lock"));
    writeFileSync(join(dir, "x.lock", "owner"), "999999:dead");
    const t0 = Date.now();
    assert.equal(await locked(dir, "x", () => "ran"), "ran");
    assert.ok(Date.now() - t0 < 1_000);
    assert.ok(!existsSync(join(dir, "x.lock")));
  });

  it("never breaks a live holder's lock, however slow, and releases only its own", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sq-lock-"));
    const order = [];
    const slow = locked(dir, "x", async () => { order.push("slow in"); await sleep(300); order.push("slow out"); });
    await sleep(20);
    const quick = locked(dir, "x", () => { order.push("quick"); });
    await Promise.all([slow, quick]);
    assert.deepEqual(order, ["slow in", "slow out", "quick"]);

    // A holder whose lock was taken from it leaves the new holder's alone.
    await locked(dir, "y", () => {
      writeFileSync(join(dir, "y.lock", "owner"), `${process.pid}:someone-else`);
    });
    assert.equal(readFileSync(join(dir, "y.lock", "owner"), "utf8"), `${process.pid}:someone-else`);
  });
});
