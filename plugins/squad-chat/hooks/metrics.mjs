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
    steps: [],                 // the main loop's requests, oldest first (see stepStarted)
    overhead: null,            // { tokens, biggest: { name, tokens } }: what every request carries before the conversation
    overheadAt: 0,             // stepN when it was last read
    stepIn: [],                // what the next request carries that the last one didn't: [{ kind, label, chars }]
    stepN: 0,
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

// What the band needs back after a reload (the module starts over, the
// session does not): the tokens so far and the context after each turn.
export function usageSnapshot(u, at) {
  return { at, tokens: { ...u.tokens }, ctxHistory: [...u.ctxHistory] };
}

export function restoreUsage(u, saved) {
  if (!saved || typeof saved !== "object") return false;
  const t = saved.tokens ?? {};
  for (const k of ["input", "output", "cacheRead", "cacheWrite"]) if (Number.isFinite(t[k])) u.tokens[k] = Math.max(u.tokens[k], t[k]);
  if (Array.isArray(saved.ctxHistory) && !u.ctxHistory.length) u.ctxHistory = saved.ctxHistory.filter(Number.isFinite).slice(-CTX_HISTORY);
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
    // A leading "cd <dir> &&" says where, not what: the command after it is the news.
    case "Bash": s = String(input.command ?? "").replace(/^\s*cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*(?:&&|;)\s*/, ""); break;
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

// ---------------------------------------------------------------- requests

// Each request the main loop sends the model (one prompt takes several: a
// tool's answer goes back in a new one), with the API's own usage for it,
// what it carried that was new (the prompt, tool results) and what it
// answered with. The engine gives one total per request, so the growth since
// the request before is split across its new pieces by size: an estimate,
// which is what tells you that a Read took 6k and a Bash 200.
const STEPS = 30;

export function stepPrompt(u, text) {
  if (text) u.stepIn.push({ kind: "prompt", label: "prompt", chars: String(text).length });
}

// A tool's answer, named by what it was about ("Read metrics.mjs") so the
// card can say which one without numbering requests.
export function stepToolResult(u, tool, chars, summary = "") {
  const about = summary && !summary.startsWith("(hidden") ? ` ${summary.length > 24 ? `${summary.slice(0, 23)}…` : summary}` : "";
  u.stepIn.push({ kind: "tool", label: `${tool}${about}`, chars: Math.max(0, chars) });
}

export function stepStarted(u, { turnId, index = 0, at }) {
  const step = { n: ++u.stepN, turnId, index, at, status: "streaming", input: null, output: null, cacheRead: 0, added: u.stepIn, grown: null, tools: [], stopReason: null, isCompacted: false };
  u.stepIn = [];
  u.steps.push(step);
  if (u.steps.length > STEPS) u.steps.splice(0, u.steps.length - STEPS);
  return step;
}

export function stepToolUse(step, name) {
  if (step && name) step.tools.push(name);
}

// A request that failed (no usage: the stream broke or was dropped) hands
// what it carried to the next, which sends it again.
export function stepEnded(u, step, usage, stopReason) {
  if (!step) return false;
  step.stopReason = stopReason ?? null;
  if (!usage) {
    step.status = "failed";
    u.stepIn = [...step.added, ...u.stepIn];
    step.added = [];
    return true;
  }
  step.status = "done";
  step.input = (usage.input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  step.output = usage.output_tokens ?? 0;
  step.cacheRead = usage.cache_read_input_tokens ?? 0;
  // Grown since the last request that came back, a failed one between them aside.
  const prev = u.steps.slice(0, u.steps.indexOf(step)).findLast((s) => s.status === "done") ?? null;
  if (prev?.input != null && prev.output != null) {
    if (step.input < prev.input) step.isCompacted = true;
    else step.grown = Math.max(0, step.input - prev.input - prev.output);
  }
  if (step.grown != null) splitBySize(step.added, step.grown);
  return true;
}

// Spreads `total` over `pieces` by their characters; the parts sum to it.
function splitBySize(pieces, total) {
  const sum = pieces.reduce((n, p) => n + Math.max(1, p.chars), 0);
  let left = total;
  pieces.forEach((p, i) => {
    p.tokens = i === pieces.length - 1 ? left : Math.round((total * Math.max(1, p.chars)) / sum);
    left -= p.tokens;
  });
}

// What every request carries before the conversation, from the /context
// breakdown: its used rows (system prompt, tools, MCP tools, memory files,
// skills, agents) less the conversation itself.
const NOT_OVERHEAD = /messages|free space|autocompact|reserved/i;
export function applyOverhead(u, breakdown) {
  const rows = (breakdown?.categories ?? []).filter((c) => (c.kind ? c.kind === "used" : true) && !c.isDeferred && c.tokens > 0 && !NOT_OVERHEAD.test(c.name));
  if (!rows.length) return false;
  const biggest = rows.reduce((a, b) => (b.tokens > a.tokens ? b : a));
  u.overhead = { tokens: rows.reduce((n, c) => n + c.tokens, 0), biggest: { name: biggest.name, tokens: biggest.tokens } };
  u.overheadAt = u.stepN;
  return true;
}

// Whether to read the breakdown again: never read, or a few requests old.
export function wantsOverhead(u) {
  return u.steps.length > 0 && (!u.overhead || u.stepN - u.overheadAt >= 8);
}

// The context as strata, for the Requests card: one column per request (what
// it sent), then one for the next (the context now). Each thing that came
// into the conversation is a layer from the request that first carried it
// on, so a tool result read once is seen riding along in every column after.
// The few biggest get layers of their own; the rest is "conversation". Under
// them all is the bedrock: what was already there when the first column was
// sent, the overhead every request carries and any conversation from before
// we started watching, drawn apart since to scale it would flatten what
// comes after (a session hours long has hundreds of k of it). Column heights
// are the API's own figures.
const NAMED = 4;
export function strata(u, maxCols = 12) {
  let from = 0;
  const done = u.steps.filter((s) => s.status === "done" && s.input != null);
  done.forEach((s, i) => { if (s.isCompacted) from = i; });
  const since = done.slice(from);
  if (!since.length) return null;
  const first = since[0];
  const firstAdded = first.added.reduce((n, p) => n + (p.tokens ?? Math.round(p.chars / 4)), 0);
  const start = Math.max(0, first.input - firstAdded);
  const bed = Math.min(u.overhead?.tokens ?? start, start);
  const items = [];
  since.forEach((s, k) => {
    for (const p of s.added) {
      const tokens = p.tokens ?? Math.round(p.chars / 4);
      items.push({ name: p.kind === "prompt" ? "your prompt" : p.label, kind: p.kind, n: s.n, enter: k, tokens });
    }
    if (s.output) items.push({ name: s.tools.length ? "Claude's tool calls" : "Claude's reply", kind: "answer", n: s.n, enter: k + 1, tokens: s.output });
  });
  const named = [...items].filter((it) => it.tokens >= 300).sort((a, b) => b.tokens - a.tokens).slice(0, NAMED).sort((a, b) => a.enter - b.enter || a.n - b.n);
  const last = since.at(-1);
  const all = [...since.map((s, k) => ({ label: k ? "older" : "first", k, total: s.input })), { label: "next", k: since.length, total: last.input + (last.output ?? 0) }];
  const cols = all.slice(-maxCols);
  // Named by what they are; two alike ("Claude's reply") are told apart by count.
  const seen = new Map();
  const layers = named.map((it) => {
    const k = (seen.get(it.name) ?? 0) + 1;
    seen.set(it.name, k);
    return { name: k > 1 ? `${it.name} (${k})` : it.name, kind: it.kind, sizes: cols.map((c) => (c.k >= it.enter ? it.tokens : 0)) };
  });
  const talk = cols.map((c, i) => Math.max(0, c.total - start - layers.reduce((n, l) => n + l.sizes[i], 0)));
  return {
    bedrock: bed,
    bedrockKnown: !!u.overhead,
    earlier: start - bed,
    cols: cols.map((c) => ({ label: c.label, above: Math.max(0, c.total - start) })),
    layers: [{ name: "conversation", kind: "talk", sizes: talk }, ...layers],
    compacted: from > 0 || first.isCompacted,
    sent: since.length,
  };
}

// Two or three things worth knowing, in plain words: how much of a request
// is the overhead, the biggest thing riding along, and what the next one sends.
export function contextTips(u) {
  const st = strata(u);
  if (!st) return [];
  const tips = [];
  const last = u.steps.filter((s) => s.status === "done" && s.input != null).at(-1);
  if (st.bedrockKnown && last?.input) {
    const pct = Math.round((st.bedrock / last.input) * 100);
    const big = u.overhead.biggest;
    tips.push({ icon: "⚙", parts: [["Fixed overhead", true], [` (${fmtK(st.bedrock)}): sent with every request, ${pct}% of the last request.`, false], ...(big ? [[` Biggest: ${big.name} (${fmtK(big.tokens)}).`, false]] : [])] });
  }
  const top = st.layers.slice(1).reduce((a, l) => (!a || l.sizes.at(-1) > a.sizes.at(-1) ? l : a), null);
  const tok = top?.sizes.at(-1) ?? 0;
  if (top && tok >= 1000) {
    const rides = top.sizes.slice(0, -1).filter((n) => n > 0).length;
    const what = top.name.charAt(0).toUpperCase() + top.name.slice(1);
    // Said so it can't read as fetched again: it came in once, and is resent,
    // with what that has added up to.
    const once = top.kind === "answer" ? "written once" : top.kind === "prompt" ? "sent once" : /^Read\b/.test(top.name) ? "read once" : "came back once";
    const resent = rides ? `resent ${rides} time${rides === 1 ? "" : "s"} so far (${fmtK(rides * tok)} sent in all).` : "resent with every request from now on.";
    tips.push({ icon: "⇠", parts: [[what, true], [` (${fmtK(tok)}): ${once}, ${resent}`, false]] });
  }
  const next = st.bedrock + st.earlier + (st.cols.at(-1)?.above ?? 0);
  const pct = u.context?.percent;
  tips.push({ icon: "→", parts: [["The next request sends ", false], [fmtK(next), true], [Number.isFinite(pct) ? `, ${Math.round(pct)}% of the window.` : ".", false], ...(pct >= 80 ? [[" Compaction is near.", false]] : [])] });
  return tips;
}

function fmtK(n) {
  if (n < 1000) return String(Math.round(n));
  return n < 10_000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${Math.round(n / 1000)}k`;
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
