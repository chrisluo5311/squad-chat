// Every Claude Code session on this computer, for the Agents room. Each
// session's mod sends a small heartbeat to its bridge, the bridge keeps it as
// a file next to the others', and every bridge reports the set back (a
// "sessions" event). Only what the room draws goes in: no prompts, no output.

import { agentTree, topTool } from "./metrics.mjs";

const FEED_SHARED = 12;

// This session's heartbeat, from its own figures.
export function heartbeat(u, { id, cwd, branch, now }) {
  const project = String(cwd ?? "").split("/").filter(Boolean).at(-1) ?? "session";
  return {
    v: 1,
    id,
    project,
    cwd,
    branch: branch ?? null,
    model: u.model,
    activity: u.activity,
    cost: u.cost?.usd ?? null,
    context: u.context?.percent ?? null,
    agents: agentTree(u).map(({ agent: a, depth, last }) => ({
      id: a.id, type: a.type, description: a.description, status: a.status,
      startedAt: a.startedAt, endedAt: a.endedAt, top: topTool(a), depth, last,
    })),
    feed: u.feed.slice(-FEED_SHARED).map((f) => ({
      key: f.key, tool: f.tool, agent: f.agentId ? (u.agents.get(f.agentId)?.type ?? "agent") : null,
      summary: f.summary, at: f.at, ms: f.ms, isError: f.isError, done: f.done,
    })),
    updatedAt: now,
  };
}

// What changed enough to send now (rather than at the next idle beat).
export function beatKey(hb) {
  return JSON.stringify([hb.activity, hb.agents.map((a) => a.status), hb.feed.at(-1)?.key, hb.feed.at(-1)?.done, Math.round((hb.cost ?? 0) * 100)]);
}

// Sessions in the order the room lists them: this one, then busy ones, then
// the rest by when they last did something.
export function orderSessions(own, others) {
  const list = [own, ...others.filter((s) => s && s.id !== own?.id)].filter(Boolean);
  const busy = (s) => (s.activity?.state && s.activity.state !== "idle" ? 1 : 0);
  return list.sort((a, b) => (a === own ? -1 : b === own ? 1 : 0) || busy(b) - busy(a) || (b.activity?.since ?? 0) - (a.activity?.since ?? 0));
}

// One feed across sessions, newest last, each row naming its session.
export function mergedFeed(sessions, { filter = "all", ownId, limit = 12 } = {}) {
  const rows = [];
  for (const s of sessions) {
    if (filter === "here" && s.id !== ownId) continue;
    for (const f of s.feed ?? []) rows.push({ ...f, session: s.project, sessionId: s.id });
  }
  const kept = (filter === "errors" ? rows.filter((r) => r.isError) : rows).sort((a, b) => a.at - b.at);
  // A run of the same finished call (a subagent reading file after file
  // with one name) reads as one row with a count.
  const out = [];
  for (const r of kept) {
    const prev = out.at(-1);
    if (prev && prev.done && r.done && !r.isError && !prev.isError && prev.sessionId === r.sessionId
      && prev.agent === r.agent && prev.tool === r.tool && prev.summary === r.summary) {
      prev.times = (prev.times ?? 1) + 1;
      prev.at = r.at;
      prev.ms = r.ms;
      continue;
    }
    out.push({ ...r });
  }
  return out.slice(-limit);
}
