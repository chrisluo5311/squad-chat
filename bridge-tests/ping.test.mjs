// The Ping room's provider: what it takes as a target, what ping prints
// (recorded on macOS 27 and Linux), the history it keeps, and a run through
// a fake ctx. Nothing goes on the network.

import { describe, it, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import ping, { parseTarget, parsePing, recordCheck, pingView, dayBeats, fmtSpan, fmtMs, whyOf, resetPing, MIN_GAP } from "../plugins/squad-chat/bridge/src/rooms/providers/ping.mjs";
import { checkManifest } from "../plugins/squad-chat/bridge/src/rooms/manifest.mjs";
import { PROVIDERS } from "../plugins/squad-chat/bridge/src/rooms/registry.mjs";

const PING_MAC = `PING 1.1.1.1 (1.1.1.1): 56 data bytes
64 bytes from 1.1.1.1: icmp_seq=0 ttl=57 time=9.812 ms
64 bytes from 1.1.1.1: icmp_seq=1 ttl=57 time=11.204 ms
64 bytes from 1.1.1.1: icmp_seq=2 ttl=57 time=10.330 ms

--- 1.1.1.1 ping statistics ---
3 packets transmitted, 3 packets received, 0.0% packet loss
round-trip min/avg/max/stddev = 9.812/10.449/11.204/0.574 ms
`;
const PING_LINUX_LOSS = `PING nas.local (192.168.1.10) 56(84) bytes of data.
64 bytes from nas.local (192.168.1.10): icmp_seq=1 ttl=64 time=1.21 ms
64 bytes from nas.local (192.168.1.10): icmp_seq=3 ttl=64 time=0.98 ms

--- nas.local ping statistics ---
3 packets transmitted, 2 received, 33.3333% packet loss, time 402ms
rtt min/avg/max/mdev = 0.980/1.095/1.210/0.115 ms
`;

const ROOM = JSON.parse(readFileSync(new URL("../plugins/squad-chat/rooms/ping/room.json", import.meta.url), "utf8"));
const T0 = new Date(2026, 9, 17, 14, 0, 0).getTime();
const SETTINGS = { slowMs: 500, alertAfter: 3 };
const target = (raw) => ({ ...parseTarget(raw), raw });

describe("ping: targets", () => {
  it("reads a host as ICMP, host:port as TCP and a URL as HTTP(S)", () => {
    assert.deepEqual(parseTarget("1.1.1.1"), { key: "1.1.1.1", kind: "ICMP", host: "1.1.1.1", name: "1.1.1.1" });
    assert.equal(parseTarget("NAS.local").kind, "ICMP");
    assert.deepEqual(parseTarget("db.internal:5432"), { key: "db.internal:5432", kind: "TCP", host: "db.internal", port: 5432, name: "db.internal:5432" });
    assert.equal(parseTarget("tcp://[::1]:22").host, "::1");
    const h = parseTarget("https://api.example.com/health");
    assert.equal(h.kind, "HTTPS");
    assert.equal(h.name, "api.example.com/health");
    assert.equal(parseTarget("http://router.lan:8080").name, "router.lan:8080");
    assert.equal(parseTarget("fe80::1").kind, "ICMP");
  });

  it("refuses what would reach ping as a flag, a port out of range, a login in a URL, and spaces", () => {
    for (const bad of ["-f", "--help", "host:0", "host:70000", "https://me:pw@example.com", "two words", "ftp://example.com", "", "a_b.com"]) {
      assert.equal(parseTarget(bad), null, bad);
    }
  });

  it("checks what's added to the setting, and says how to write one", async () => {
    assert.deepEqual(await ping.check.targets([" example.com "]), ["example.com"]);
    await assert.rejects(ping.check.targets(["example.com", "-rf"]), { status: 400, message: /Can't watch -rf/ });
  });
});

describe("ping: what ping prints", () => {
  it("takes the times and the counts, on macOS and Linux", () => {
    assert.deepEqual(parsePing(PING_MAC), { times: [9.812, 11.204, 10.33], sent: 3, got: 3 });
    assert.deepEqual(parsePing(PING_LINUX_LOSS), { times: [1.21, 0.98], sent: 3, got: 2 });
    assert.deepEqual(parsePing(null), { times: [], sent: 0, got: 0 });
  });

  it("names an error in a few words", () => {
    assert.equal(whyOf({ code: "ECONNREFUSED" }), "refused");
    assert.equal(whyOf({ code: "CERT_HAS_EXPIRED" }), "certificate expired");
    assert.equal(whyOf(new Error("boom")), "boom");
  });

  it("writes times and spans short", () => {
    assert.equal(fmtMs(4.26), "4.3 ms");
    assert.equal(fmtMs(842.4), "842 ms");
    assert.equal(fmtMs(null), "–");
    assert.equal(fmtSpan(20_000), "<1m");
    assert.equal(fmtSpan(18 * 60_000), "18m");
    assert.equal(fmtSpan(125 * 60_000), "2h 5m");
    assert.equal(fmtSpan(3 * 86_400_000), "3d");
  });
});

describe("ping: history", () => {
  it("is down only after alert_after failed checks, from the first of them, and up at the next good one", () => {
    const h = { targets: {}, incidents: [], paused: [] };
    const t = target("db.internal:5432");
    recordCheck(h, t, { ok: true, ms: 3 }, { at: T0, ...SETTINGS });
    recordCheck(h, t, { ok: false, why: "refused" }, { at: T0 + 30_000, ...SETTINGS });
    recordCheck(h, t, { ok: false, why: "refused" }, { at: T0 + 60_000, ...SETTINGS });
    assert.equal(h.targets[t.key].downSince ?? null, null);
    let v = pingView(h, [t], { now: T0 + 60_000, slowMs: 500 });
    assert.equal(v.targets[0].state, "slow");
    assert.equal(v.targets[0].msText, "lost");
    assert.deepEqual(v.alerts, []);
    recordCheck(h, t, { ok: false, why: "refused" }, { at: T0 + 90_000, ...SETTINGS });
    assert.equal(h.targets[t.key].downSince, T0 + 30_000);
    v = pingView(h, [t], { now: T0 + 90_000 + 18 * 60_000, slowMs: 500 });
    assert.equal(v.targets[0].state, "down");
    assert.equal(v.targets[0].word, "down 19m");
    assert.equal(v.down, 1);
    assert.match(v.targets[0].why, /^Down since 14:00 \(19m\): refused/);
    assert.deepEqual(v.alerts, [{ id: `down:${t.key}:${T0 + 30_000}`, text: "Ping: db.internal:5432 is down · refused" }]);
    assert.equal(v.incidents[0].text, "db.internal:5432 down · refused");
    recordCheck(h, t, { ok: true, ms: 2 }, { at: T0 + 120_000, ...SETTINGS });
    v = pingView(h, [t], { now: T0 + 180_000, slowMs: 500 });
    assert.equal(v.targets[0].state, "up");
    assert.equal(v.incidents[0].text, "db.internal:5432 back up · was down 1m");
    assert.deepEqual(v.alerts, [{ id: `up:${t.key}:${T0 + 120_000}`, text: "Ping: db.internal:5432 is back up after 1m" }]);
    // The back-up toast has had its time.
    assert.deepEqual(pingView(h, [t], { now: T0 + 120_000 + 11 * 60_000, slowMs: 500 }).alerts, []);
    assert.deepEqual(pingView(h, [t], { now: T0 + 180_000, slowMs: 500, alerts: false }).alerts, []);
  });

  it("draws the last checks as beats, newest last, and counts the hour and the day", () => {
    const h = { targets: {}, incidents: [], paused: [] };
    const t = target("https://example.com");
    const rs = [{ ok: true, ms: 120 }, { ok: true, ms: 640, code: 200 }, { ok: false, why: "HTTP 502", code: 502 }, { ok: true, ms: 100, code: 200, split: [30, 20, 25, 25], certEnd: T0 + 12.5 * 86_400_000 }];
    rs.forEach((r, i) => recordCheck(h, t, r, { at: T0 + i * 30_000, ...SETTINGS }));
    const r = pingView(h, [t], { now: T0 + 90_000, slowMs: 500 }).targets[0];
    assert.equal(r.beats, `${"n".repeat(36)}usxu`);
    assert.equal(r.up24, "75%");
    assert.equal(r.upTone, "red");
    assert.equal(r.avgText, "287 ms");
    assert.equal(r.lossText, "25%");
    assert.equal(r.split, "dns 30 · connect 20 · tls 25 · first byte 25 ms");
    assert.equal(r.cert, "certificate ends in 12 days");
    assert.equal(r.certTone, "amber");
    assert.match(r.recent.split("\n")[0], /^14:01:30 {2}200 {2}100 ms$/);
    assert.match(r.recent.split("\n")[1], /^14:01:00 {2}lost · HTTP 502$/);
    assert.deepEqual(r.hist, [120, 640, 100]);
  });

  it("marks each of 90 days by its worst, oldest first, and folds them three to a mark for the share", () => {
    const e = { days: {} };
    const day = (n) => new Date(2026, 9, 17 - n).getTime();
    e.days[new Date(day(0)).toLocaleDateString("sv")] = [100, 100, 0];
    e.days[new Date(day(1)).toLocaleDateString("sv")] = [100, 99, 0];
    e.days[new Date(day(2)).toLocaleDateString("sv")] = [100, 90, 0];
    const all = dayBeats(e, T0);
    assert.equal(all.length, 90);
    assert.equal(all.slice(-3), "xsu");
    const folded = dayBeats(e, T0, 3);
    assert.equal(folded.length, 30);
    assert.equal(folded.at(-1), "x");
    assert.equal(folded.at(0), "n");
  });

  it("puts the trouble first, and shares a card of 90 days with or without names", () => {
    const h = { targets: {}, incidents: [], paused: [] };
    const ts = ["1.1.1.1", "db.internal:5432", "https://cdn.example.com"].map(target);
    recordCheck(h, ts[0], { ok: true, ms: 10 }, { at: T0, ...SETTINGS });
    for (let i = 0; i < 3; i++) recordCheck(h, ts[1], { ok: false, why: "refused" }, { at: T0 + i, ...SETTINGS });
    recordCheck(h, ts[2], { ok: true, ms: 840 }, { at: T0, ...SETTINGS });
    const v = pingView(h, ts, { now: T0 + 60_000, slowMs: 500 });
    assert.deepEqual(v.targets.map((r) => r.name), ["db.internal:5432", "cdn.example.com", "1.1.1.1"]);
    assert.deepEqual([v.up, v.slow, v.down], [1, 1, 1]);
    assert.equal(v.band, "db.internal:5432 down 1m · cdn.example.com 840 ms · 1 up · 1.1.1.1 10 ms");
    const lines = v.share.split("\n");
    assert.equal(lines[0], "Ping · last 90 days · 3 servers");
    assert.equal(lines[1], "db.internal:5432 is down");
    assert.match(lines[2], /^db\.internal:5432 {2}·{29}▯ {2}0%$/);
    assert.match(lines[4], /^1\.1\.1\.1 {11}·{29}▮ {2}100%$/);
    const anon = pingView(h, ts, { now: T0 + 60_000, slowMs: 500, shareNames: false }).share;
    assert.doesNotMatch(anon, /db\.internal|cdn|1\.1\.1\.1/);
    assert.match(anon, /server 1 is down/);
  });

  it("says what to do when nothing is watched", () => {
    const v = pingView({ targets: {}, incidents: [], paused: [] }, [], { now: T0, slowMs: 500 });
    assert.equal(v.count, 0);
    assert.match(v.band, /No servers yet/);
    assert.equal(v.meta, "none yet");
  });
});

// A socket that connects, or fails with `code`, on the next tick.
function fakeSocket(code) {
  const s = new EventEmitter();
  s.destroy = () => {};
  setImmediate(() => (code ? s.emit("error", Object.assign(new Error(code), { code })) : s.emit("connect")));
  return s;
}

describe("ping: a run", () => {
  let dir;
  let clock;
  const runs = [];
  const ctx = () => ({
    dataDir: dir,
    platform: "darwin",
    now: () => clock,
    run: async (argv) => { runs.push(argv); return argv.at(-1) === "1.1.1.1" ? PING_MAC : null; },
    connect: ({ port }) => fakeSocket(port === 5432 ? "ECONNREFUSED" : null),
    httpProbe: async (url) => ({ ok: true, ms: 120, code: 200, split: [10, 20, 30, 60] }),
  });
  const params = (extra = {}) => ({ targets: ["1.1.1.1", "db.internal:5432", "https://example.com", "nas.local"], slow_ms: 500, alert_after: 1, alerts: true, share_names: true, open: "none", ...extra });
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "ping-")); clock = T0; runs.length = 0; resetPing(); });
  after(() => rmSync(dir, { recursive: true, force: true }));

  it("checks each target its own way, and passes the host to ping after --", async () => {
    const d = await ping.fetch(params(), ctx());
    assert.deepEqual(runs.find((a) => a.at(-1) === "1.1.1.1"), ["/sbin/ping", "-c", "3", "-i", "0.2", "-W", "2000", "--", "1.1.1.1"]);
    const by = Object.fromEntries(d.targets.map((r) => [r.name, r]));
    assert.equal(by["1.1.1.1"].msText, "10 ms");
    assert.equal(by["db.internal:5432"].state, "down");
    assert.match(by["db.internal:5432"].why, /refused/);
    assert.equal(by["example.com"].msText, "120 ms");
    assert.equal(by["nas.local"].state, "down");
    assert.equal(d.open, null);
  });

  it("doesn't check a target again within MIN_GAP (another session just did), unless asked to", async () => {
    await ping.fetch(params(), ctx());
    const first = runs.length;
    clock += MIN_GAP - 1;
    await ping.fetch(params(), ctx());
    assert.equal(runs.length, first);
    ping.actions.check(params(), {}, ctx());
    await ping.fetch(params(), ctx());
    assert.equal(runs.length, first * 2);
    clock += MIN_GAP;
    const d = await ping.fetch(params(), ctx());
    assert.equal(d.targets.find((r) => r.name === "1.1.1.1").beats.slice(-3), "uuu");
  });

  it("pauses the open target, and forgets a target taken off the list", async () => {
    await ping.fetch(params(), ctx());
    const r = await ping.actions.pause(params({ open: "1.1.1.1" }), {}, ctx());
    assert.deepEqual(r, { ok: true, paused: true, name: "1.1.1.1" });
    clock += MIN_GAP;
    runs.length = 0;
    let d = await ping.fetch(params(), ctx());
    assert.equal(runs.some((a) => a.at(-1) === "1.1.1.1"), false);
    assert.equal(d.targets.at(-1).state, "paused");
    assert.equal(d.targets.at(-1).paused, true);
    await assert.rejects(Promise.resolve().then(() => ping.actions.pause(params(), {}, ctx())), { status: 404 });
    d = await ping.fetch(params({ targets: ["nas.local"] }), ctx());
    assert.deepEqual(Object.keys(JSON.parse(readFileSync(join(dir, "history.json"), "utf8")).targets), ["nas.local"]);
    assert.equal(d.count, 1);
  });

  it("says ping needs macOS or Linux elsewhere", async () => {
    const d = await ping.fetch(params({ targets: ["1.1.1.1"] }), { ...ctx(), platform: "win32" });
    assert.match(d.targets[0].why, /ping needs macOS or Linux/);
  });
});

describe("ping: the room's manifest", () => {
  it("checks out", () => {
    assert.deepEqual(checkManifest(ROOM, PROVIDERS), []);
  });

  it("can only watch what someone typed: targets from a list setting that starts empty", () => {
    const withDefault = { ...ROOM, settings: { ...ROOM.settings, targets: { ...ROOM.settings.targets, default: ["victim.example"] } } };
    const literal = { ...ROOM, providers: [{ ...ROOM.providers[0], params: { ...ROOM.providers[0].params, targets: ["victim.example"] } }] };
    for (const m of [withDefault, literal]) assert.match(checkManifest(m, PROVIDERS).join("\n"), /params.targets: "\$settings.<key>" of a list setting that starts empty/);
  });

  it("checks a beats column and a toggled pick", () => {
    const card = ROOM.layout.cards[1];
    const bad = { ...ROOM, layout: { ...ROOM.layout, cards: [ROOM.layout.cards[0], { ...card, body: { ...card.body, columns: [{ field: "beats", beats: "yes" }], pick: { ...card.body.pick, toggle: 1 } } }] } };
    const errors = checkManifest(bad, PROVIDERS).join("\n");
    assert.match(errors, /columns\[0\].beats: true or false/);
    assert.match(errors, /pick.toggle: true or false/);
  });
});
