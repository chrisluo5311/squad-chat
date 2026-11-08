// This session's numbers for the Usage and Agents rooms: what the engine
// measures (context, rate limits, cost), what each turn used (tokens, cache),
// how long each tool call took, and which subagents ran. Plain logic: the
// hooks module feeds it from session.measure, turn.complete, tool.call and
// agent.spawn.

import { findSecret } from "./share.mjs";

const COST_SAMPLES = 240;      // about two hours at one sample per 30 s
const SAMPLE_EVERY_MS = 30_000;
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
    calls: new Map(),          // call key → feed entry, while it runs
    feed: [],                  // [{ key, tool, agentId, summary, at, ms, isError, done }], oldest first
    agents: new Map(),         // agent id → { id, type, description, status, parentId, startedAt, endedAt, tools }
    turns: [],                 // the prompts, oldest first: { n, at, prompt, chars, tokens } (see stepPrompt)
    turnN: 0,
    steps: [],                 // the main loop's requests, oldest first (see stepStarted)
    traced: new Map(),         // call key → its trajectory entry, for its result and its end
    mcpNames: new Map(),       // MCP tool → its server's name, as tool.describe said it
    overhead: null,            // { tokens, rows, parts }: what every request carries before the conversation
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
// On Windows a path is split at \ as well as /.
export function toolSummary(tool, input = {}, platform = null) {
  const sep = platform === "win32" ? /[\\/]/ : "/";
  const base = (p) => String(p ?? "").split(sep).filter(Boolean).at(-1) ?? "";
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
    case "Skill": s = [input.skill, input.args].filter(Boolean).join(" "); break;
    default: s = input.description ?? input.command ?? input.query ?? "";
  }
  s = String(s ?? "").replace(/\s+/g, " ").trim();
  if (findSecret(s)) return "(hidden: looks secret)";
  return s.slice(0, 80);
}

let seq = 0;

export function toolStarted(u, { tool, agentId, input, at, platform }) {
  const key = `c${++seq}`;
  const entry = { key, tool, agentId: agentId ?? null, summary: toolSummary(tool, input, platform), at, ms: null, isError: false, done: false };
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
  if (!entry.agentId && u.activity.state === "tool") u.activity = { state: "thinking", tool: null, since: at };
  return true;
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

// ---------------------------------------------------------------- trajectory

// The session as what happened, in order, for the Usage room's Trajectory
// card: each prompt starts a turn, each request the main loop sends the
// model is a step of it, and each tool call hangs under the request that
// made it, a subagent's own calls under the call that started the agent.
// Short previews (the prompt, the reply, a call's input and the first lines
// of its result) are kept for this pane alone: Copy and Share leave them out,
// and the Agents room's feed never sees them.
const STEPS = 30;
const TURNS = 30;
const SUBCALLS = 40;
const PREVIEW = 200;
const TRACED = 200;            // calls the card can still find by key

// A text's first `n` characters on one line, masked when it looks secret.
export function preview(text, n = PREVIEW) {
  const raw = String(text ?? "");
  const s = raw.replace(/\s+/g, " ").trim();
  if (!s) return "";
  // On the text as written: an env file's line is only one at a line's start.
  if (findSecret(raw)) return "(hidden: looks secret)";
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

// A result's first lines, each cut short, or a mask when any looks secret.
function firstLines(text, lines = 3, width = 160) {
  const s = String(text ?? "");
  if (!s.trim()) return [];
  if (findSecret(s.slice(0, 4000))) return ["(hidden: looks secret)"];
  return s.split("\n").map((l) => l.replace(/\s+$/, "")).filter((l) => l.trim()).slice(0, lines)
    .map((l) => (l.length > width ? `${l.slice(0, width - 1)}…` : l));
}

// A call's input as [name, value] pairs, whole enough to read: a string as
// it was written, an object or a list as indented JSON, each cut only past
// INPUT_MAX characters.
const NOT_INPUT = new Set(["tool", "agentId", "toolUseId", "tool_use_id", "turnId", "origin"]);
const INPUT_MAX = 2000;
function inputPairs(input) {
  const out = [];
  for (const [k, v] of Object.entries(input ?? {})) {
    if (NOT_INPUT.has(k) || v === undefined || v === null) continue;
    const s = (typeof v === "string" ? v : JSON.stringify(v, null, 2) ?? "").replace(/\r\n?/g, "\n").replace(/\s+$/, "");
    out.push([k, findSecret(s) ? "(hidden: looks secret)" : s.length > INPUT_MAX ? `${s.slice(0, INPUT_MAX - 1)}…` : s]);
    if (out.length >= 12) break;
  }
  return out;
}

// A prompt starts a turn, with what was typed for its row. Its words go to
// the next request as something new it carries.
export function stepPrompt(u, text, at = Date.now()) {
  // A turn with no words (an image alone, one the engine started) is still a
  // turn: its requests mustn't land under the one before.
  u.turns.push({ n: ++u.turnN, at, prompt: preview(text), chars: String(text ?? "").length, piece: null });
  if (u.turns.length > TURNS) u.turns.splice(0, u.turns.length - TURNS);
  if (!text) return;
  const piece = { kind: "prompt", label: "prompt", chars: String(text).length, turn: u.turns.at(-1) };
  u.turns.at(-1).piece = piece;
  u.stepIn.push(piece);
}

// A tool's answer, which goes to the model with the next request. The call
// learns its size and its first lines.
// A main-loop call the card lost track of (a reload mid-turn) still adds to
// the next request, so the others' shares aren't inflated.
export function stepToolResult(u, key, text, { tool, agentId } = {}) {
  const call = u.traced.get(key);
  const chars = String(text ?? "").length;
  if (call) { call.chars = chars; call.lines = firstLines(text); }
  if (call ? !call.agentId : !agentId) u.stepIn.push({ kind: "tool", label: call?.tool ?? tool ?? "tool", chars: Math.max(0, chars), call: call ?? null });
}

export function stepStarted(u, { turnId, index = 0, at }) {
  const step = {
    n: ++u.stepN, turnId, turnN: u.turnN, index, at, firstAt: null, endedAt: null, status: "streaming",
    input: null, output: null, cacheRead: 0, added: u.stepIn, grown: null, calls: [], text: "", stopReason: null, isCompacted: false,
  };
  u.stepIn = [];
  u.steps.push(step);
  if (u.steps.length > STEPS) u.steps.splice(0, u.steps.length - STEPS);
  return step;
}

// The first piece of a reply's stream: how long the model took to start.
export function stepChunk(step, at) {
  if (step && step.firstAt == null) step.firstAt = at;
}

// A request that failed (no usage: the stream broke or was dropped) hands
// what it carried to the next, which sends it again.
export function stepEnded(u, step, result, at = Date.now()) {
  if (!step) return false;
  const usage = result?.usage;
  step.stopReason = result?.stopReason ?? null;
  step.endedAt = at;
  step.text = preview(result?.answer);
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
  // The growth, spread over what this request carried new by size: a prompt's
  // and a result's tokens, as their rows show them.
  if (step.grown != null) splitBySize(step.added, step.grown);
  for (const p of step.added) {
    if (p.tokens == null) continue;
    if (p.call) p.call.tokens = p.tokens;
    if (p.turn) p.turn.tokens = p.tokens;
  }
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

// A tool call joins the trajectory: the main loop's under the request that
// asked for it (the last one sent), a subagent's under the call that
// started that agent.
export function traceCall(u, key, { tool, agentId, input, at, platform }) {
  const call = { key, tool, agentId: agentId ?? null, summary: toolSummary(tool, input, platform), input: inputPairs(input), at, ms: null, isError: false, done: false, chars: null, lines: [], tokens: null, agent: null, sub: [] };
  if (agentId) {
    const owner = agentCall(u, agentId);
    if (!owner) return null;
    owner.sub.push(call);
    if (owner.sub.length > SUBCALLS) owner.sub.splice(0, owner.sub.length - SUBCALLS);
  } else {
    const step = u.steps.at(-1);
    if (!step) return null;
    step.calls.push(call);
  }
  u.traced.set(key, call);
  forgetTraced(u);
  return call;
}

// Past TRACED, the oldest finished calls go first: a running one (a long
// Agent call under hundreds of its subagent's) must still find its end.
// Running ones go only past twice that, when their ends were surely lost.
function forgetTraced(u) {
  let over = u.traced.size - TRACED;
  if (over <= 0) return;
  for (const [k, c] of u.traced) {
    if (over <= 0) break;
    if (c.done) { u.traced.delete(k); over--; }
  }
  while (u.traced.size > TRACED * 2) u.traced.delete(u.traced.keys().next().value);
}

export function traceEnded(u, key, { at, isError }) {
  const call = u.traced.get(key);
  if (!call) return false;
  call.ms = Math.max(0, at - call.at);
  call.isError = isError;
  call.done = true;
  return true;
}

// The call an agent's work hangs under: its own, or its parent's when it was
// started by another subagent.
function agentCall(u, id, depth = 0) {
  const a = u.agents.get(id);
  if (!a || depth > 4) return null;
  return a.call ?? (a.parentId ? agentCall(u, a.parentId, depth + 1) : null);
}

// A subagent the session spawned finds the Agent call that started it: the
// newest one still running with no agent yet, its description first.
function linkAgent(u, a) {
  if (a.call || a.parentId) return;
  const open = u.steps.flatMap((s) => s.calls).filter((c) => (c.tool === "Agent" || c.tool === "Task") && !c.agent && !c.done);
  const said = toolSummary("Agent", { description: a.description });
  // By its description, or the one running when there's no other to mistake it for.
  const call = open.findLast((c) => c.summary === said) ?? (open.length === 1 ? open[0] : null);
  if (!call) return;
  call.agent = { id: a.id, type: a.type };
  a.call = call;
}

// What every request carries before the conversation, from the /context
// breakdown: its used rows (system prompt, tools, MCP tools, memory files,
// skills, agents) less the conversation itself. A full breakdown also names
// what is in each row, for the card's FIXED row to open: MCP tools and
// their servers' instructions, memory files, skills and agents. Claude Code
// leaves the system prompt's sections and its own tools out of what it
// gives a plugin, so those two show their totals alone.
const NOT_OVERHEAD = /messages|free space|autocompact|reserved/i;
export function applyOverhead(u, breakdown) {
  const rows = (breakdown?.categories ?? []).filter((c) => (c.kind ? c.kind === "used" : true) && !c.isDeferred && c.tokens > 0 && !NOT_OVERHEAD.test(c.name));
  if (!rows.length) return false;
  u.overhead = { tokens: rows.reduce((n, c) => n + c.tokens, 0), rows: rows.map((c) => ({ name: c.name, tokens: c.tokens })), parts: overheadParts(breakdown) ?? u.overhead?.parts ?? null };
  u.overheadAt = u.stepN;
  return true;
}

// The full breakdown's lists, as the FIXED row opens them: each category with
// its items, MCP tools by server. Null from a summary breakdown.
function overheadParts(b) {
  if (!b || !(b.systemTools || b.mcpTools?.length || b.mcpInstructions?.length || b.memoryFiles?.length || b.systemPromptSections || b.skills || b.agents?.length)) return null;
  const by = (list) => [...list].sort((x, y) => y.tokens - x.tokens);
  const parts = [];
  const sum = (list) => list.reduce((n, x) => n + (x.tokens ?? 0), 0);
  if (b.systemPromptSections?.length) parts.push({ key: "prompt", name: "System prompt", note: "By section", items: by(b.systemPromptSections).map((x) => ({ name: x.name, tokens: x.tokens })) });
  if (b.systemTools?.length) {
    const deferred = (b.deferredBuiltinTools ?? []).filter((x) => !x.isLoaded).length;
    parts.push({ key: "tools", name: "System tools", note: `${b.systemTools.length} loaded${deferred ? ` · ${deferred} deferred` : ""}`, items: by(b.systemTools).map((x) => ({ name: x.name, tokens: x.tokens })) });
  }
  if (b.mcpTools?.length) {
    // Only the loaded tools go with every request: a deferred one is sent
    // once Claude searches for it, so it is counted apart and not listed.
    const loaded = b.mcpTools.filter((t) => t.isLoaded !== false);
    const deferred = b.mcpTools.length - loaded.length;
    const servers = new Map();
    for (const t of loaded) {
      const key = String(t.serverName ?? "") || "?";
      const g = servers.get(key) ?? { key, name: serverOf(t), tokens: 0, items: [], tools: [] };
      g.tokens += t.tokens;
      g.tools.push(t.name);
      // "mcp__claude-in-chrome__computer" is "computer" under its server.
      g.items.push({ name: t.name.startsWith("mcp__") ? t.name.slice(t.name.lastIndexOf("__") + 2) : t.name, tokens: t.tokens });
      servers.set(key, g);
    }
    const groups = by([...servers.values()]).map((s) => ({ ...s, items: by(s.items) }));
    const said = [`By server · ${groups.length} server${groups.length === 1 ? "" : "s"}`, deferred ? `${deferred.toLocaleString("en-US")} not loaded` : null].filter(Boolean).join(" · ");
    parts.push({ key: "mcp", name: "MCP tools", note: said, groups, tokens: sum(loaded) });
  }
  if (b.mcpInstructions?.length) parts.push({ key: "mcpInstructions", name: "MCP server instructions", note: "By server, each its share estimated from its text", items: by(b.mcpInstructions).map((x) => ({ name: x.serverName, tokens: x.tokens })) });
  if (b.memoryFiles?.length) parts.push({ key: "memory", name: "Memory files", note: "By file", items: b.memoryFiles.map((x) => ({ name: x.path, tokens: x.tokens, kind: x.type, path: x.path })) });
  if (b.skills?.skillFrontmatter?.length) parts.push({ key: "skills", name: "Skills", note: `${b.skills.includedSkills} of ${b.skills.totalSkills} listed`, items: by(b.skills.skillFrontmatter).map((x) => ({ name: x.name, tokens: x.tokens, kind: x.pluginName ? `plugin ${x.pluginName}` : x.source })) });
  if (b.agents?.length) parts.push({ key: "agents", name: "Agents", note: "By agent type", items: by(b.agents).map((x) => ({ name: x.agentType, tokens: x.tokens, kind: x.source })) });
  for (const p of parts) p.tokens ??= sum(p.items);
  return parts;
}

// MCP server names. A connector's or a plugin's server can come as an id,
// in its serverName and in its tools' names ("mcp__1a59c906-…__batch"), so
// the name tool.describe gave a tool is used first, then the name it was
// reported with, then the one its tools carry. Null when every one is an id.
const ID_LIKE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-/i;
export function noteProvider(u, tool, provider) {
  const name = provider?.name;
  if (!String(tool ?? "").startsWith("mcp__") || typeof name !== "string" || !name || ID_LIKE.test(name)) return false;
  u.mcpNames.set(tool, name);
  return true;
}
function serverOf(t) {
  const s = String(t.serverName ?? "");
  if (s && !ID_LIKE.test(s)) return s;
  const m = /^mcp__(.+?)__/.exec(t.name ?? "");   // up to the first "__": a tool's own name may hold more
  return m && !ID_LIKE.test(m[1]) ? m[1] : null;
}

// A group's name to draw: a known server name, else "Connector" with the
// first of its tools, never an id.
export function serverLabel(u, g) {
  const named = g.tools.map((t) => u.mcpNames.get(t)).find(Boolean);
  if (named) return named;
  if (g.name) return g.name;
  return `Connector · ${g.items.slice(0, 3).map((x) => x.name).join(", ")}${g.items.length > 3 ? ", …" : ""}`;
}

// Whether to read the breakdown again: never read, or a few requests old.
export function wantsOverhead(u) {
  return u.steps.length > 0 && (!u.overhead || u.stepN - u.overheadAt >= 8);
}

// The card's rows, oldest first, kept as plain data so every surface draws
// the same thing: the fixed overhead, then each turn (its prompt), each
// request in it, and the calls each request made. The view folds and windows them.
export function trajectory(u) {
  const turns = new Map(u.turns.map((t) => [t.n, { ...t, steps: [] }]));
  for (const s of u.steps) {
    if (!turns.has(s.turnN)) turns.set(s.turnN, { n: s.turnN, at: s.at, prompt: "", chars: 0, tokens: null, steps: [], earlier: true });
    turns.get(s.turnN).steps.push(s);
  }
  const list = [...turns.values()].filter((t) => t.steps.length || t.n === u.turnN).sort((a, b) => a.n - b.n);
  // Turns that fell out with their requests, or before we were watching, aren't shown.
  const first = u.steps[0]?.turnN ?? u.turnN;
  return list.filter((t) => t.n >= first);
}

// The figures under the rows: requests, calls, output speed, and what the
// next request sends (the last one's input and its reply).
export function trajectoryTotals(u) {
  const done = u.steps.filter((s) => s.status === "done");
  const calls = u.steps.reduce((n, s) => n + s.calls.length + s.calls.reduce((k, c) => k + c.sub.length, 0), 0);
  const gen = done.reduce((n, s) => n + (s.firstAt != null && s.endedAt != null ? Math.max(0, s.endedAt - s.firstAt) : 0), 0);
  const out = done.reduce((n, s) => n + (s.firstAt != null ? s.output : 0), 0);
  const last = done.at(-1);
  return {
    turns: new Set(u.steps.map((s) => s.turnN)).size,
    requests: u.steps.length,
    calls,
    tps: gen >= 200 ? Math.round(out / (gen / 1000)) : null,
    next: last ? last.input + (last.output ?? 0) : null,
  };
}

// What's under way, for the band: the whole of a turn, so it holds still
// between requests and calls. The call still running, else whether the
// request is streaming or Claude is between one and the next; and since when.
export function trajectoryLive(u) {
  const s = u.steps.at(-1);
  if (!s) return null;
  const call = s.calls.findLast((c) => !c.done) ?? null;
  const streaming = s.status === "streaming";
  if (u.activity.state === "idle" && !call && !streaming) return null;
  const doing = call ? "call" : streaming ? "writing" : "thinking";
  const since = call?.at ?? (streaming ? s.at : s.endedAt ?? s.at);
  return { step: s, call, doing, since };
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
  linkAgent(u, a);
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
