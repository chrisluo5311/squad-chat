// Two people, two bridges, one local Supabase. Run: node --test bridge-tests/
//
// alice talks to Supabase through a proxy we can cut (network drop);
// bob connects directly. The steps share state and run in order.

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Bridge, CuttableProxy, localStackUp, runId, sleep } from "./helpers.mjs";

const up = await localStackUp();

describe("two users, two bridges", { skip: !up && "local Supabase is not running (supabase start)" }, () => {
  const id = runId();
  const slug = `lobby-${id}`;
  const proxy = new CuttableProxy();
  let alice, bob, room;

  before(async () => {
    await proxy.listen();
    alice = new Bridge("alice", { url: proxy.url });
    bob = new Bridge("bob");
    await Promise.all([alice.start(), bob.start()]);
  });

  after(async () => {
    await Promise.all([alice?.stop(), bob?.stop()]);
    await proxy.close();
    alice?.cleanup();
    bob?.cleanup();
  });

  it("starts signed out and rejects bad tokens", async () => {
    await alice.waitFor((e) => e.type === "auth" && e.state === "signed_out");
    assert.equal((await alice.ok("GET", "/state")).auth, "signed_out");
    const token = alice.token;
    alice.token = "wrong";
    try {
      assert.equal((await alice.call("GET", "/ping")).status, 401);
    } finally {
      alice.token = token;
    }
  });

  it("signs in with the emailed code", async () => {
    const [a, b] = await Promise.all([
      alice.login(`alice-${id}@example.com`),
      bob.login(`bob-${id}@example.com`),
    ]);
    assert.equal(a.user.name, `alice-${id}`);
    assert.equal(b.user.name, `bob-${id}`);
  });

  it("rejects a wrong code", async () => {
    const x = new Bridge("x");
    await x.start();
    try {
      await x.ok("POST", "/login/start", { email: `x-${id}@example.com` });
      const res = await x.call("POST", "/login/verify", { code: "00000000" });
      assert.equal(res.status, 401);
    } finally {
      await x.stop();
      x.cleanup();
    }
  });

  it("creates and joins a room with a passcode", async () => {
    room = await alice.ok("POST", "/room", { slug, passcode: "hunter22" });
    assert.equal(room.slug, slug);
    const wrong = await bob.call("POST", "/room", { slug, passcode: "nope" });
    assert.equal(wrong.status, 403);
    assert.deepEqual(await bob.ok("POST", "/room", { slug, passcode: "hunter22" }), room);
    await bob.waitFor((e) => e.type === "rooms" && e.current === room.id);
  });

  it("each sees the other online", async () => {
    const sees = (b, name) => (e) => e.type === "presence" && e.room === room.id && e.online.some((u) => u.name === name);
    await alice.waitFor(sees(alice, `bob-${id}`), 15_000, "bob online");
    await bob.waitFor(sees(bob, `alice-${id}`), 15_000, "alice online");
    await alice.waitFor((e) => e.type === "friends" && e.friends.some((f) => f.name === `bob-${id}` && f.online),
      10_000, "bob in alice's friends");
    const who = await alice.ok("GET", "/who");
    assert.deepEqual(who.friends.map((f) => [f.name, f.online, f.rooms]), [[`bob-${id}`, true, [slug]]]);
  });

  it("delivers messages both ways", async () => {
    const sent = await alice.ok("POST", "/send", { text: "hi bob" });
    const got = await bob.waitFor((e) => e.type === "message" && e.message.id === sent.id, 10_000, "alice's message");
    assert.equal(got.backfill, false);
    assert.equal(got.message.user, `alice-${id}`);
    assert.equal(got.message.body, "hi bob");

    const reply = await bob.ok("POST", "/send", { text: "hey alice" });
    await alice.waitFor((e) => e.type === "message" && e.message.id === reply.id, 10_000, "bob's reply");
    // The sender's own copy arrives once, not twice (insert result + realtime).
    await sleep(1000);
    assert.equal(alice.messages().filter((m) => m.id === sent.id).length, 1);
  });

  it("refuses empty and oversized messages", async () => {
    assert.equal((await alice.call("POST", "/send", { text: "   " })).status, 400);
    assert.equal((await alice.call("POST", "/send", { text: "x".repeat(501) })).status, 400);
  });

  it("catches up exactly once after a network drop", async () => {
    const before = alice.messages(room.id).length;
    const unreadBefore = alice.events.filter((e) => e.type === "message").at(-1).unread;
    const mark = alice.events.length;
    proxy.cut();
    await alice.waitFor((e) => alice.events.indexOf(e) >= mark && e.type === "status" && e.room === room.id
      && e.status !== "SUBSCRIBED", 15_000, "channel to drop");
    const ids = [];
    for (const text of ["while", "you", "were away"]) ids.push((await bob.ok("POST", "/send", { text })).id);
    await sleep(1000);
    assert.equal(alice.messages(room.id).length, before, "nothing arrives while cut off");

    proxy.restore();
    for (const mid of ids) {
      await alice.waitFor((e) => e.type === "message" && e.message.id === mid, 45_000, `missed message ${mid}`);
    }
    await sleep(2000);
    const after = alice.messages(room.id).slice(before);
    assert.deepEqual(after.map((m) => m.body), ["while", "you", "were away"]);
    assert.ok(after.every((m) => m.backfill), "missed messages come from backfill");
    const unreadAfter = alice.events.filter((e) => e.type === "message").at(-1).unread;
    assert.equal(unreadAfter, unreadBefore + 3, "each missed message counts as unread once");
  });

  it("keeps the session across restarts and replays recent history", async () => {
    await bob.stop();
    await bob.start();
    const auth = await bob.waitFor((e) => e.type === "auth", 15_000, "auth");
    assert.equal(auth.state, "signed_in");
    await bob.waitFor((e) => e.type === "rooms" && e.current === room.id);
    await bob.waitFor((e) => e.type === "message" && e.message.body === "were away", 15_000, "history");
    const history = bob.messages(room.id);
    assert.ok(history.every((m) => m.backfill));
    assert.deepEqual(history.map((m) => m.body), ["hi bob", "hey alice", "while", "you", "were away"]);
  });

  it("tracks unread counts and read markers", async () => {
    const state = await bob.ok("GET", "/state");
    assert.equal(state.rooms[0].unread, 1, "alice's 'hi bob' is unread for bob");
    const last = state.rooms[0].last_seen_id;
    await bob.ok("POST", "/read", { room: slug, last_id: last });
    await bob.stop();
    await bob.start();
    const rooms = await bob.waitFor((e) => e.type === "rooms" && e.rooms.length === 1);
    assert.equal(rooms.rooms[0].unread, 0);
    assert.equal(rooms.rooms[0].last_read_id, last);
  });

  // Events that arrive after this point, for waitFor.
  const since = (b) => { const mark = b.events.length; return (pred) => (e) => b.events.indexOf(e) >= mark && pred(e); };

  it("shows who's typing, until they send or go quiet", async () => {
    const typing = (e, name) => e.type === "typing" && e.room === room.id && e.users.some((u) => u.name === name);
    const quiet = (e) => e.type === "typing" && e.room === room.id && e.users.length === 0;

    let after = since(bob);
    await alice.ok("POST", "/typing", { room: room.id });
    await bob.waitFor(after((e) => typing(e, `alice-${id}`)), 10_000, "alice typing");
    after = since(bob);
    await alice.ok("POST", "/send", { text: "done typing", room: room.id });
    await bob.waitFor(after(quiet), 10_000, "typing to end with the message");

    await sleep(2100);   // past the bridge's send throttle
    after = since(bob);
    await alice.ok("POST", "/typing", { room: room.id });
    await bob.waitFor(after((e) => typing(e, `alice-${id}`)), 10_000, "alice typing again");
    const t0 = Date.now();
    await bob.waitFor(after(quiet), 10_000, "typing to time out");
    assert.ok(Date.now() - t0 >= 4000, "typing lasts about 5 seconds");
    assert.ok(!alice.events.some((e) => e.type === "typing" && e.users.length), "nobody sees themselves typing");
  });

  it("shows do not disturb as busy, and back again", async () => {
    const aliceId = (await alice.ok("GET", "/state")).user.id;
    const busyIn = (e) => e.type === "presence" && e.room === room.id && e.online.some((u) => u.user_id === aliceId && u.busy);
    const availableIn = (e) => e.type === "presence" && e.room === room.id && e.online.some((u) => u.user_id === aliceId && !u.busy);
    assert.equal((await alice.call("POST", "/status", { status: "away" })).status, 400);

    let after = since(bob);
    assert.deepEqual(await alice.ok("POST", "/status", { status: "busy" }), { status: "busy" });
    await bob.waitFor(after(busyIn), 10_000, "alice busy in presence");
    await bob.waitFor(after((e) => e.type === "friends" && e.friends.some((f) => f.user_id === aliceId && f.busy)), 10_000, "alice busy in friends");

    after = since(bob);
    await alice.ok("POST", "/status", { status: "available" });
    await bob.waitFor(after(availableIn), 10_000, "alice available again");
    assert.ok(!(await bob.ok("GET", "/who")).friends.find((f) => f.user_id === aliceId).busy);
  });

  it("renames: the room hears the new name, and names stay unique", async () => {
    assert.equal((await bob.call("POST", "/name", { name: `alice-${id}` })).status, 409);
    assert.equal((await bob.call("POST", "/name", { name: "has space" })).status, 400);
    const after = since(alice);
    assert.deepEqual(await bob.ok("POST", "/name", { name: `robert-${id}` }), { name: `robert-${id}` });
    await bob.waitFor((e) => e.type === "auth" && e.user?.name === `robert-${id}`, 10_000, "bob's new name");
    await alice.waitFor(after((e) => e.type === "name" && e.name === `robert-${id}`), 10_000, "alice to hear the new name");
    await alice.waitFor(after((e) => e.type === "presence" && e.room === room.id && e.online.some((u) => u.name === `robert-${id}`)),
      10_000, "the new name in presence");
    const sent = await bob.ok("POST", "/send", { text: "call me robert", room: room.id });
    const msg = await alice.waitFor((e) => e.type === "message" && e.message.id === sent.id, 10_000, "bob's message");
    assert.equal(msg.message.user, `robert-${id}`);
  });

  it("deletes a room: only its creator can, and members drop it", async () => {
    const temp = await alice.ok("POST", "/room", { slug: `temp-${id}`, passcode: "pass1234" });
    await bob.ok("POST", "/room", { slug: `temp-${id}`, passcode: "pass1234" });
    await bob.waitFor((e) => e.type === "rooms" && e.rooms.some((r) => r.id === temp.id));
    const refused = await bob.call("POST", "/room/delete", { room: temp.id });
    assert.equal(refused.status, 403);
    assert.deepEqual(await alice.ok("POST", "/room/delete", { room: temp.id }), { slug: `temp-${id}` });
    const mark = bob.events.length;
    await bob.waitFor((e) => bob.events.indexOf(e) >= mark && e.type === "rooms" && !e.rooms.some((r) => r.id === temp.id),
      15_000, "bob to drop the deleted room");
    await alice.ok("POST", "/room/select", { room: room.id });
    await bob.ok("POST", "/room/select", { room: room.id });
  });

  it("shows a killed bridge as offline within 60 seconds", async () => {
    await bob.waitFor((e) => e.type === "presence" && e.room === room.id && e.online.some((u) => u.name === `alice-${id}`));
    const t0 = Date.now();
    alice.child.kill("SIGKILL");
    const mark = bob.events.length;
    await bob.waitFor((e) => bob.events.indexOf(e) >= mark && e.type === "presence" && e.room === room.id
      && !e.online.some((u) => u.name === `alice-${id}`), 60_000, "alice to leave");
    const secs = (Date.now() - t0) / 1000;
    assert.ok(secs <= 60, `left after ${secs}s`);
    // The friends list agrees at once: alice's recent heartbeat doesn't keep
    // her "online" after presence saw her go.
    await bob.waitFor((e) => bob.events.indexOf(e) >= mark && e.type === "friends"
      && e.friends.some((f) => f.name === `alice-${id}` && !f.online), 5_000, "alice offline in friends");
    console.log(`# alice shown offline ${secs.toFixed(1)}s after kill -9`);
  });

  it("leaves rooms and signs out", async () => {
    await bob.ok("POST", "/room/leave", { room: slug });
    await bob.waitFor((e) => e.type === "rooms" && e.rooms.length === 0);
    await bob.ok("POST", "/logout");
    await bob.waitFor((e) => e.type === "auth" && e.state === "signed_out");
    assert.equal(existsSync(join(bob.configDir, "session.json")), false);
  });
});
