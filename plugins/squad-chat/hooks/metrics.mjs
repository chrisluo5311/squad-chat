// This session's numbers for the Usage and Agents rooms: what the engine
// measures (context, rate limits, cost), what each turn used (tokens, cache),
// how long each tool call took, and which subagents ran. Plain logic: the
// hooks module feeds it from session.measure, turn.complete, tool.call and
// agent.spawn.

import { findSecret } from "./share.mjs";

const COST_SAMPLES = 240;      // about two hours at one sample per 30 s
const SAMPLE_EVERY_MS = 30_000;
const DURATIONS = 200;         // per tool, for the percentiles
const FEED = 40;               // newest tool calls kept for the live feed
const BURN_WINDOW_MS = 15 * 60_000;

export function createUsage() {
  return {
    measured: false,
    context: null,             // { tokens, window, percent }
    breakdown: null,           // the /context breakdown, fetched when asked for
    showBreakdown: false,
    rateLimits: [],            // [{ kind, percentUsed, resetsAt }]
    hasLimits: false,          // ever reported a window (a subscription, not an API key)
    ctxHistory: [],            // context tokens after each main-loop turn, oldest first (the band's chart)
    cost: null,                // { usd }
    startedAt: null,
    model: null,
    costSamples: [],           // [{ at, usd }]
    tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    tools: new Map(),          // tool name → { count, errors, durations }
    calls: new Map(),          // call key → feed entry, while it runs
    feed: [],                  // [{ key, tool, agentId, summary, at, ms, isError, done }], oldest first
    agents: new Map(),         // agent id → { id, type, description, status, parentId, startedAt, endedAt, tools }
    activity: { state: "idle", tool: null, since: 0 },   // idle | thinking | tool
  };
}

// ---------------------------------------------------------------- engine figures

// A session.measure event or a $.session.usage() answer.
export function applyMeasure(u, m, now) {
  if (!m) return false;
  u.measured = true;
  if (m.context) u.context = { tokens: m.context.tokens, window: m.context.window, percent: m.context.percent };
  if (Array.isArray(m.rateLimits)) {
    u.rateLimits = m.rateLimits;
    if (m.rateLimits.length) u.hasLimits = true;   // a subscription: its windows always show
  }
  if (typeof m.startedAt === "number") u.startedAt = m.startedAt;
  if (m.cost && typeof m.cost.usd === "number") {
    u.cost = { usd: m.cost.usd };
    const last = u.costSamples.at(-1);
    if (!last || last.usd !== m.cost.usd || now - last.at >= SAMPLE_EVERY_MS) {
      u.costSamples.push({ at: now, usd: m.cost.usd });
      if (u.costSamples.length > COST_SAMPLES) u.costSamples.splice(0, u.costSamples.length - COST_SAMPLES);
    }
  }
  return true;
}

// The context's fill after a main-loop turn, for the band's chart.
const CTX_HISTORY = 12;
export function recordTurnContext(u) {
  const t = u.context?.tokens;
  if (t == null) return false;
  u.ctxHistory.push(t);
  if (u.ctxHistory.length > CTX_HISTORY) u.ctxHistory.splice(0, u.ctxHistory.length - CTX_HISTORY);
  return true;
}

// What one turn used (turn.complete's `usage`), the main loop's or a subagent's.
export function applyTurnUsage(u, usage) {
  if (!usage) return false;
  u.tokens.input += usage.input_tokens ?? 0;
  u.tokens.output += usage.output_tokens ?? 0;
  u.tokens.cacheRead += usage.cache_read_input_tokens ?? 0;
  u.tokens.cacheWrite += usage.cache_creation_input_tokens ?? 0;
  if (usage.model) u.model = usage.model;
  return true;
}

export function totalTokens(u) {
  const t = u.tokens;
  return t.input + t.output + t.cacheRead + t.cacheWrite;
}

// The windows to show, 5-hour and 7-day first and always (a window that just
// reset has no reading until the next reply: its percent is null), then any
// others the account has. None at all for an account without windows.
const MAIN_WINDOWS = ["five_hour", "seven_day"];
export function limitWindows(u) {
  if (!u.hasLimits && !u.rateLimits.length) return [];
  const main = MAIN_WINDOWS.map((kind) => u.rateLimits.find((l) => l.kind === kind) ?? { kind, percentUsed: null });
  return [...main, ...u.rateLimits.filter((l) => !MAIN_WINDOWS.includes(l.kind))];
}

// The share of input read from the prompt cache, 0-100, or null before any.
export function cacheRatio(u) {
  const t = u.tokens;
  const input = t.input + t.cacheRead + t.cacheWrite;
  return input ? (t.cacheRead / input) * 100 : null;
}

// Dollars per hour over the last quarter hour, or null with too little to go on.
export function burnRate(u, now) {
  const recent = u.costSamples.filter((s) => now - s.at <= BURN_WINDOW_MS);
  if (recent.length < 2) return null;
  const first = recent[0];
  const last = recent.at(-1);
  const hours = (last.at - first.at) / 3_600_000;
  if (hours < 5 / 60) return null;   // a few minutes say little about an hour
  return (last.usd - first.usd) / hours;
}

// Spend per bucket over the last `n` buckets, oldest first: the sparkline.
export function spendSeries(u, now, n = 12, bucketMs = 5 * 60_000) {
  const out = new Array(n).fill(0);
  const s = u.costSamples;
  for (let i = 1; i < s.length; i++) {
    const back = Math.floor((now - s[i].at) / bucketMs);
    if (back < 0 || back >= n) continue;
    out[n - 1 - back] += Math.max(0, s[i].usd - s[i - 1].usd);
  }
  return out;
}

// ---------------------------------------------------------------- tool calls

// A few words on what a call is about, with anything that looks like a
// secret masked: the command for Bash, a file's name, a search pattern.
export function toolSummary(tool, input = {}) {
  const base = (p) => String(p ?? "").split("/").filter(Boolean).at(-1) ?? "";
  let s;
  switch (tool) {
    case "Bash": s = input.command; break;
    case "Read": case "Write": case "Edit": case "NotebookEdit": s = base(input.file_path ?? input.notebook_path); break;
    case "Grep": s = input.pattern ? `"${input.pattern}"` : ""; break;
    case "Glob": s = input.pattern; break;
    case "WebFetch": s = input.url; break;
    case "WebSearch": s = input.query; break;
    case "Agent": case "Task": s = input.description; break;
    default: s = input.description ?? input.command ?? input.query ?? "";
  }
  s = String(s ?? "").replace(/\s+/g, " ").trim();
  if (findSecret(s)) return "(hidden: looks secret)";
  return s.slice(0, 80);
}

let seq = 0;

export function toolStarted(u, { tool, agentId, input, at }) {
  const key = `c${++seq}`;
  const entry = { key, tool, agentId: agentId ?? null, summary: toolSummary(tool, input), at, ms: null, isError: false, done: false };
  u.calls.set(key, entry);
  u.feed.push(entry);
  if (u.feed.length > FEED) u.feed.splice(0, u.feed.length - FEED);
  if (agentId) {
    // Only agents the session spawned or lists: the engine's own loops
    // (compaction, memory) carry ids nothing else names.
    const a = u.agents.get(agentId);
    if (a) a.tools.set(tool, (a.tools.get(tool) ?? 0) + 1);
  } else {
    u.activity = { state: "tool", tool, since: at };
  }
  return key;
}

export function toolEnded(u, key, { at, isError = false }) {
  const entry = u.calls.get(key);
  if (!entry) return false;
  u.calls.delete(key);
  entry.ms = Math.max(0, at - entry.at);
  entry.isError = isError;
  entry.done = true;
  const t = u.tools.get(entry.tool) ?? { count: 0, errors: 0, durations: [] };
  t.count++;
  if (isError) t.errors++;
  t.durations.push(entry.ms);
  if (t.durations.length > DURATIONS) t.durations.shift();
  u.tools.set(entry.tool, t);
  if (!entry.agentId && u.activity.state === "tool") u.activity = { state: "thinking", tool: null, since: at };
  return true;
}

export function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[i];
}

// One row per tool, the most time spent first.
export function toolRows(u) {
  return [...u.tools.entries()].map(([name, t]) => ({
    name,
    count: t.count,
    errors: t.errors,
    p50: percentile(t.durations, 50),
    p95: percentile(t.durations, 95),
    total: t.durations.reduce((a, b) => a + b, 0),
  })).sort((a, b) => b.total - a.total || b.count - a.count);
}

export function runningCalls(u) {
  return [...u.calls.values()];
}

// ---------------------------------------------------------------- turns

export function turnStarted(u, at) {
  u.activity = { state: "thinking", tool: null, since: at };
}

export function turnEnded(u, at) {
  u.activity = { state: "idle", tool: null, since: at };
}

// ---------------------------------------------------------------- subagents

function agentEntry(u, id, at) {
  let a = u.agents.get(id);
  if (!a) {
    a = { id, type: "agent", description: "", status: "running", parentId: null, startedAt: at, endedAt: null, tools: new Map() };
    u.agents.set(id, a);
  }
  return a;
}

export function agentSpawned(u, { id, type, description, parentId, at }) {
  if (!id) return false;
  const a = agentEntry(u, id, at);
  a.type = type || a.type;
  a.description = description || a.description;
  a.parentId = parentId ?? a.parentId;
  a.startedAt = Math.min(a.startedAt, at);
  return true;
}

const ENDED = new Set(["completed", "failed", "killed"]);

// $.agent.list(): the engine's word on each agent's status.
export function applyAgentList(u, list, now) {
  let changed = false;
  for (const info of list ?? []) {
    const a = agentEntry(u, info.id, now);
    const was = a.status;
    a.type = info.type || a.type;
    a.description = info.description || a.description;
    a.parentId = info.parentId ?? a.parentId;
    a.status = info.status;
    if (ENDED.has(info.status) && !a.endedAt) a.endedAt = now;
    if (was !== a.status) changed = true;
  }
  return changed;
}

// Agents in tree order: each one followed by those it spawned, newest first
// at each level. Each row carries its depth and whether it is the last child.
export function agentTree(u) {
  const all = [...u.agents.values()];
  // An agent whose parent isn't known is drawn at the top level.
  const parentOf = (a) => (a.parentId && u.agents.has(a.parentId) ? a.parentId : null);
  const out = [];
  const walk = (pid, depth) => {
    const list = all.filter((a) => parentOf(a) === pid).sort((a, b) => b.startedAt - a.startedAt);
    list.forEach((a, i) => {
      out.push({ agent: a, depth, last: i === list.length - 1 });
      walk(a.id, depth + 1);
    });
  };
  walk(null, 0);
  return out;
}

export function agentCounts(u) {
  let running = 0;
  let done = 0;
  for (const a of u.agents.values()) {
    if (ENDED.has(a.status)) done++;
    else running++;
  }
  return { running, done };
}

export function isEnded(status) {
  return ENDED.has(status);
}

// The tool an agent used most: "Read ×14".
export function topTool(agent) {
  let best = null;
  for (const [name, n] of agent.tools) if (!best || n > best[1]) best = [name, n];
  return best ? `${best[0]} ×${best[1]}` : "";
}
