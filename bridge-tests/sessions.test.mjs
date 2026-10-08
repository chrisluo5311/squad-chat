// The Agents room's heartbeats: each bridge keeps its session's heartbeat in
// a shared folder and reports every live session. Needs no server: the
// bridges here run without one.

import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Bridge } from "./helpers.mjs";

const latestSessions = (b) => b.events.filter((e) => e.type === "sessions").at(-1)?.sessions ?? [];
const ids = (b) => latestSessions(b).map((s) => s.id).sort();
const beat = (id, extra = {}) => ({ v: 1, id, project: id, activity: { state: "idle" }, agents: [], feed: [], updatedAt: Date.now(), ...extra });

describe("session heartbeats", () => {
  const dir = mkdtempSync("/tmp/sqh-");
  const one = new Bridge("one", { url: null, sessionsDir: dir });
  const two = new Bridge("two", { url: null, sessionsDir: dir });
  after(async () => {
    await one.stop();
    await two.stop();
    one.cleanup();
    two.cleanup();
    rmSync(dir, { recursive: true, force: true });
  });

  it("runs without a server: says so, and still answers", async () => {
    await one.start();
    assert.ok(one.events.some((e) => e.type === "error" && e.code === "unconfigured"));
    assert.equal(one.events.find((e) => e.type === "ready").chat, false);
    assert.equal((await one.call("POST", "/send", { text: "hi" })).status, 503);
    assert.equal((await one.call("GET", "/ping")).status, 200);
  });

  it("each bridge sees the other's session", async () => {
    await two.start();
    await one.ok("POST", "/sessions/beat", beat("sess-one", { project: "squad-chat" }));
    await two.ok("POST", "/sessions/beat", beat("sess-two", { project: "api-server" }));
    await one.waitFor(() => ids(one).join() === "sess-one,sess-two", 5_000, "both sessions");
    await two.waitFor(() => ids(two).join() === "sess-one,sess-two", 5_000, "both sessions");
    const seen = latestSessions(two).find((s) => s.id === "sess-one");
    assert.equal(seen.project, "squad-chat");
    assert.equal(seen.pid, one.child.pid);   // stamped by the bridge, for the liveness check
  });

  it("refuses a heartbeat without a proper id, or one too large", async () => {
    assert.equal((await one.call("POST", "/sessions/beat", { project: "x" })).status, 400);
    assert.equal((await one.call("POST", "/sessions/beat", beat("../escape"))).status, 400);
    const big = beat("sess-one", { feed: [{ summary: "x".repeat(40_000) }] });
    assert.equal((await one.call("POST", "/sessions/beat", big)).status, 413);
  });

  it("drops a session whose bridge is gone", async () => {
    writeFileSync(join(dir, "sess-ghost.json"), JSON.stringify({ ...beat("sess-ghost"), pid: 999_999 }));
    await one.ok("POST", "/sessions/beat", beat("sess-one", { project: "squad-chat", activity: { state: "thinking" } }));
    await one.waitFor(() => latestSessions(one).some((s) => s.activity?.state === "thinking"), 5_000, "the new beat");
    assert.deepEqual(ids(one), ["sess-one", "sess-two"]);
    assert.ok(!readdirSync(dir).includes("sess-ghost.json"));
  });

  it("removes its own file when it shuts down", async () => {
    await two.ok("POST", "/shutdown", {});
    await two.exited;
    assert.deepEqual(readdirSync(dir).filter((n) => n.endsWith(".json")), ["sess-one.json"]);
    await one.waitFor(() => ids(one).join() === "sess-one", 15_000, "two gone");
  });
});
