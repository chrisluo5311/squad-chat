// The Usage room's Trajectory card: what this session did, one row per
// thing, oldest first. FIXED is what every request starts with (the system
// prompt and the definitions of every tool), then each turn: your prompt
// (YOU), each request Claude was sent (CLAUDE), and the tool calls each
// request made (TOOL, AGENT with its own calls under it). A row's ▸ opens
// its details under it. Three lanes over the rows draw the same events in
// order, or in time with Duration. The desktop draws every row and lets
// the pane scroll; the terminal keeps the newest rows in a window the size
// of the pane, ▴ and ▾ (or the wheel) moving it back and forth.

import { state } from "./state.mjs";
import { MAX_SNIPPET, MAX_SNIPPET_LINES } from "./share.mjs";
import { theme, palette } from "./theme.mjs";
import { clip, fmtTokens, rowsFor, line, card } from "./widgets.mjs";
import { trajectory, trajectoryTotals, serverLabel } from "./metrics.mjs";

const TAG = {
  fixed: { text: "FIXED", color: "#8F8D87" },
  you: { text: "YOU", color: theme.you },
  claude: { text: "CLAUDE", color: theme.agents },
  tool: { text: "TOOL", color: theme.amber },
  agent: { text: "AGENT", color: palette.teal },
  compact: { text: "COMPACT", color: palette.rose },
};
const TAG_W = 8;
const LIST_ROWS = 8;           // rows an open FIXED category shows at once
const LANE_COLORS = { prompt: theme.you, result: theme.amber, wait: "#5F4F72", model: theme.agents, tool: theme.accent, agent: palette.teal, error: theme.error };

// "6.2k", "182": a row's tokens, a figure with no unit.
export const kTok = (n) => (n == null ? "" : n < 1000 ? String(Math.round(n)) : n < 10_000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : fmtTokens(n));
// "120ms", "1.8s", "41s", "1:12"
export function took(ms) {
  if (ms == null) return "";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
// "mcp__ccd_turn__update_plan" → "update_plan"; a built-in tool as it is.
export const shortTool = (name) => (String(name).startsWith("mcp__") ? String(name).slice(String(name).lastIndexOf("__") + 2) : String(name));
// "2026-11-07 23:41:04.504", in local time.
function stamp(ms) {
  const d = new Date(ms);
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}
const tokensOf = (call) => call.tokens ?? (call.chars != null ? Math.round(call.chars / 4) : null);
const stepMs = (s, now) => (s.endedAt ?? now) - s.at;
const isAgent = (c) => c.tool === "Agent" || c.tool === "Task";

// Moves the terminal's window `by` rows: up toward the earliest, down toward
// the newest (where it follows them again). False when it can't go that way.
export function scrollTraj(by) {
  const t = state.traj;
  if ((by < 0 && !t.above) || (by > 0 && !t.below)) return false;
  t.top = Math.max(0, (t.top ?? t.above) + by);
  return true;
}

// ---------------------------------------------------------------- rows

// Whether a turn shows its requests: as it was opened or folded by hand,
// else only the newest. A new turn clears the hand-set ones (see
// stepPrompt's caller), so the one before folds as it starts.
export function turnIsOpen(n, newest) {
  const set = state.traj.turnOpen;
  return set.has(n) ? set.get(n) : n === newest;
}

// ▸ on a turn's header, or the toolbar's Turns for all of them at once.
export function toggleTurn(u, n) {
  const list = trajectory(u);
  const newest = list.at(-1)?.n;
  if (n != null) { state.traj.turnOpen.set(n, !turnIsOpen(n, newest)); return; }
  const anyOpen = list.some((x) => turnIsOpen(x.n, newest));
  for (const x of list) state.traj.turnOpen.set(x.n, !anyOpen);
}

// The rows as data, folded as the toolbar and the turns say: { id, kind, depth, ... }.
// A folded turn is its header alone, with its prompt said at the end of it.
function rowList(u) {
  const t = state.traj;
  const out = [{ id: "fixed", kind: "fixed", depth: 0 }];
  const turns = trajectory(u);
  const newest = turns.at(-1)?.n;
  for (const turn of turns) {
    const open = turnIsOpen(turn.n, newest);
    out.push({ id: `t${turn.n}`, kind: "turn", depth: 0, turn, open });
    if (!open) continue;   // folded: the header alone, the prompt said on it
    if (!turn.earlier) out.push({ id: `y${turn.n}`, kind: "you", depth: 0, turn });
    for (const s of turn.steps) {
      if (s.isCompacted) out.push({ id: `k${s.n}`, kind: "compact", depth: 0, step: s });
      out.push({ id: `r${s.n}`, kind: "claude", depth: 0, step: s, turn });
      if (t.calls) continue;
      for (const c of s.calls) {
        out.push({ id: `c${c.key}`, kind: isAgent(c) ? "agent" : "tool", depth: 1, call: c, step: s });
        if (t.subcalls) continue;
        for (const sc of c.sub) out.push({ id: `c${sc.key}`, kind: "tool", depth: 2, call: sc, parent: c, step: s });
      }
    }
  }
  return out;
}

// One row's line: its ▸ (the press target), the tag, what it is, and its figures.
function rowLine(els, r, w, handlers, now) {
  const { Button } = els;
  const open = state.traj.sel === r.id;
  if (r.kind === "turn") {
    const steps = r.turn.steps;
    const span = steps.length ? took((steps.at(-1).endedAt ?? now) - (r.turn.earlier ? steps[0].at : r.turn.at)) : "";
    return line(els, r.id, [
      { node: Button({ key: `traj-${r.id}`, plain: true, label: r.open ? "▾" : "▸", onPress: () => handlers.onTraj?.("turn", r.turn.n) }) },
      { text: " " },
      { text: r.turn.earlier ? "Earlier" : `Turn ${r.turn.n}`, color: theme.usage, bold: true },
      { text: ` · ${steps.length} request${steps.length === 1 ? "" : "s"}${span ? ` · ${span}` : ""}${!r.open && r.turn.prompt ? ` · ${r.turn.prompt}` : ""}`, color: theme.muted, grow: true },
    ]);
  }
  const tag = { ...TAG[r.kind] };
  let text = "", tokens = "", time = "", live = false;
  if (r.kind === "fixed") {
    const o = state.usage.overhead;
    text = "Fixed overhead";
    tokens = o ? kTok(o.tokens) : "";
  } else if (r.kind === "you") {
    text = r.turn.prompt || "(empty prompt)";
    tokens = kTok(r.turn.tokens ?? Math.round(r.turn.chars / 4));
  } else if (r.kind === "compact") {
    text = "Context compacted";
  } else if (r.kind === "claude") {
    const s = r.step;
    live = s.status === "streaming";
    text = `#${s.n} ${s.status === "failed" ? "failed, sent again" : s.text || (live ? "…" : s.calls.length ? "" : "(no text)")}`.trimEnd();
    if (s.status === "failed") tag.color = theme.error;
    tokens = s.output != null ? kTok(s.output) : "";
    time = took(stepMs(s, now));
  } else {
    const c = r.call;
    live = !c.done;
    text = `${isAgent(c) ? c.agent?.type ?? "Agent" : c.tool}${c.summary ? ` ${c.summary}` : ""}${c.isError ? " ✗" : ""}${c.subN ? ` · ${c.subN} call${c.subN === 1 ? "" : "s"}` : ""}`;
    if (c.isError) tag.color = theme.error;
    tokens = r.depth < 2 ? kTok(tokensOf(c)) : "";
    time = live ? took(now - c.at) : took(c.ms);
  }
  const pad = "  ".repeat(r.depth);
  return line(els, r.id, [
    { node: Button({ key: `traj-${r.id}`, plain: true, dimColor: !open, label: open ? "▾" : "▸", onPress: () => handlers.onTraj?.("select", r.id) }) },
    { text: ` ${pad}` },
    { text: tag.text, width: TAG_W, color: tag.color, bold: true },
    live ? { text: "● ", color: theme.amber } : null,
    { text, grow: true },
    { text: tokens, width: 7, right: true, color: theme.muted },
    w >= 50 ? { text: time, width: 7, right: true, color: live ? theme.amber : theme.muted } : null,
  ]);
}

// ---------------------------------------------------------------- details

// A label and its value, the value cut at its end.
const kv = (els, key, k, v, color) => line(els, key, [{ text: k, width: 12, color: theme.muted }, { text: v, color, grow: true }]);

// A label and its value in full, the value wrapping under itself, and the rows it takes at `w`.
const kvWrap = (els, key, k, v, w, color) => ({
  node: els.Box({ key, flexDirection: "row", children: [
    els.Box({ key: "k", width: 12, flexShrink: 0, children: [els.Text({ key: "t", color: theme.muted, children: k })] }),
    els.Box({ key: "v", flexGrow: 1, flexShrink: 1, minWidth: 0, children: [els.Text({ key: "t", wrap: "wrap", color, children: v })] }),
  ] }),
  h: rowsFor(v, w - 12),
});

// A wrapped text and the rows it takes at `w`.
const para = (els, key, text, w, color) => ({ node: els.Text({ key, wrap: "wrap", color, children: text }), h: rowsFor(text, w) });

// The tabs of a row's details: the one shown bright, the rest dim.
function tabs(els, id, names, handlers) {
  const cur = state.traj.tabs[id] && names.includes(state.traj.tabs[id]) ? state.traj.tabs[id] : names[0];
  const node = els.Box({ key: "tabs", flexDirection: "row", columnGap: 2, children: names.map((n) => els.Button({
    key: `traj-tab-${id}-${n}`, plain: true, dimColor: n !== cur, label: n === cur ? `[${n}]` : n, onPress: () => handlers.onTraj?.("tab", { id, tab: n }),
  })) });
  return { cur, node };
}

// The details under an open row, as { node, h } pieces.
function details(els, r, w, handlers, now) {
  const u = state.usage;
  const out = [];
  const add = (node, h = 1) => out.push({ node, h });
  if (r.kind === "fixed") return fixedDetails(els, w, handlers);
  if (r.kind === "you") {
    add(kv(els, "tok", "Tokens", `${kTok(r.turn.tokens ?? Math.round(r.turn.chars / 4))} tokens`));
    out.push(para(els, "text", r.turn.prompt, w, theme.muted));
    return out;
  }
  if (r.kind === "claude") {
    const s = r.step;
    const { cur, node } = tabs(els, r.id, ["Summary", "Timing"], handlers);
    add(node);
    if (cur === "Summary") {
      add(kv(els, "st", "Status", s.status === "streaming" ? "Streaming" : s.status === "failed" ? "Failed · sent again in the next request" : `Completed${s.stopReason ? ` · ${s.stopReason}` : ""}`, s.status === "failed" ? theme.error : s.status === "streaming" ? theme.amber : undefined));
      if (s.input != null) {
        add(kv(els, "in", "Input", `${kTok(s.input)} tokens (${kTok(s.cacheRead)} from cache)`));
        add(kv(els, "out", "Output", `${kTok(s.output)} tokens`));
        add(kv(els, "hit", "Cache hit", `${s.input ? Math.round((s.cacheRead / s.input) * 100) : 0}%`));
      }
      if (s.text) out.push(para(els, "text", s.text, w, theme.muted));
    } else {
      const gen = s.firstAt != null && s.endedAt != null ? s.endedAt - s.firstAt : null;
      add(kv(els, "at", "Started", stamp(s.at)));
      add(kv(els, "dur", "Duration", took(stepMs(s, now))));
      if (s.firstAt != null) add(kv(els, "ttft", "TTFT", took(s.firstAt - s.at)));
      if (gen != null) add(kv(els, "gen", "Generation", took(gen)));
      if (gen && s.output) add(kv(els, "tps", "Throughput", `${Math.round(s.output / (gen / 1000))} tok/s`));
    }
    return out;
  }
  if (r.kind === "compact") return out;
  const c = r.call;
  const status = !c.done ? "Running" : c.isError ? "Failed" : "Completed";
  const statusColor = !c.done ? theme.amber : c.isError ? theme.error : undefined;
  if (r.depth === 2) {
    add(kv(els, "in", "Inside", `${r.parent.agent?.type ?? "Agent"} · ${r.parent.summary}`, palette.teal));
    add(kv(els, "st", "Status", status, statusColor));
    add(kv(els, "at", "Started", stamp(c.at)));
    add(kv(els, "dur", "Duration", c.done ? took(c.ms) : took(now - c.at)));
    return out;
  }
  const names = isAgent(c) ? ["Summary", "Calls", "Timing"] : ["Summary", "Input", "Result", "Timing"];
  const { cur, node } = tabs(els, r.id, names, handlers);
  add(node);
  if (cur === "Summary") {
    add(kv(els, "by", "Called by", `Request #${r.step.n}`, theme.agents));
    add(kv(els, "st", "Status", status, statusColor));
    const tok = tokensOf(c);
    add(kv(els, "res", "Result", tok == null ? "–" : `${kTok(tok)} tokens`));
    if (isAgent(c)) add(kv(els, "ag", "Agent", `${c.agent?.type ?? "Agent"} · ${c.subN} call${c.subN === 1 ? "" : "s"}`));
  } else if (cur === "Input") {
    if (!c.input.length) add(els.Text({ key: "none", color: theme.muted, children: "No input." }));
    c.input.forEach(([k, v], i) => out.push(kvWrap(els, `i${i}`, k, v, w)));
  } else if (cur === "Result") {
    if (!c.done) add(els.Text({ key: "wait", color: theme.muted, children: "Still running." }));
    else if (!c.lines.length) add(els.Text({ key: "none", color: theme.muted, children: "No output." }));
    else c.lines.forEach((l, i) => out.push(para(els, `l${i}`, l, w, theme.muted)));
  } else if (cur === "Calls") {
    if (!c.sub.length) add(els.Text({ key: "none", color: theme.muted, children: "No calls yet." }));
    if (c.subN > c.sub.length) add(els.Text({ key: "newest", color: theme.muted, children: `The newest ${c.sub.length} of ${c.subN}.` }));
    c.sub.forEach((sc, i) => add(line(els, `s${i}`, [
      { text: sc.tool, width: 10, color: theme.amber },
      { text: sc.summary, grow: true },
      { text: sc.done ? took(sc.ms) : "…", width: 7, right: true, color: theme.muted },
    ])));
  } else {
    add(kv(els, "at", "Started", stamp(c.at)));
    add(kv(els, "dur", "Duration", c.done ? took(c.ms) : took(now - c.at)));
  }
  return out;
}

const PART_ROW = { prompt: /system prompt/i, tools: /system tools/i, mcp: /^mcp tools/i, mcpInstructions: /mcp.*instruction/i, memory: /memory/i, skills: /skill/i, agents: /agent/i };

// FIXED's details: what it is, then each category, opened to its items
// (eight at a time, paged with ▴ ▾) when the full breakdown names them.
function fixedDetails(els, w, handlers) {
  const { Button, Text } = els;
  const u = state.usage;
  const o = u.overhead;
  const out = [];
  const last = u.steps.findLast((s) => s.status === "done");
  const share = o && last?.input ? ` ${Math.round((o.tokens / last.input) * 100)}% of the last request.` : "";
  out.push(para(els, "what", `Sent with every request: the system prompt and all tool definitions.${share}`, w, theme.muted));
  if (!o) { out.push({ node: Text({ key: "wait", color: theme.muted, children: "Counting…" }), h: 1 }); return out; }
  // Every category /context counts, with its own total; the full breakdown's
  // lists open under the one they belong to.
  const parts = o.parts ?? [];
  // A list joins the /context row it belongs to, by what the row is called.
  // One that matches no row isn't added as a row of its own: /context may
  // count those tokens under another, and FIXED would count them twice.
  const partOf = (name) => parts.find((p) => p.name.toLowerCase() === name.toLowerCase() || PART_ROW[p.key]?.test(name));
  const cats = o.rows.map((x) => ({ ...(partOf(x.name) ?? { key: x.name, items: null }), name: x.name, tokens: x.tokens }));
  for (const c of cats) {
    const items = c.groups ? c.groups.flatMap((g) => [{ name: serverLabel(u, g), tokens: g.tokens, group: true }, ...g.items.map((x) => ({ ...x, sub: true }))]) : c.items;
    const can = !!items?.length;
    const open = can && state.traj.open.has(c.key);
    out.push({ node: line(els, `fx-${c.key}`, [
      can ? { node: Button({ key: `traj-fx-${c.key}`, plain: true, dimColor: !open, label: open ? "▾" : "▸", onPress: () => handlers.onTraj?.("open", c.key) }) } : { text: " " },
      { text: ` ${c.name}`, grow: true },
      { text: `${kTok(c.tokens)} tokens`, color: theme.muted },
    ]), h: 1 });
    if (!open) continue;
    const max = Math.max(0, items.length - LIST_ROWS);
    const off = Math.min(state.traj.off[c.key] ?? 0, max);
    state.traj.off[c.key] = off;   // ▾ pressed at the end mustn't store a place past it
    const shown = items.slice(off, off + LIST_ROWS);
    out.push({ node: Text({ key: `fx-${c.key}-note`, color: theme.muted, wrap: "truncate-end", children: `   ${c.note}${max ? ` · ${off + 1}–${off + shown.length} of ${items.length}` : ""}` }), h: 1 });
    // The scrollbar's thumb: as long as the window is next to the list, where it is in it.
    const a = Math.floor((off / items.length) * shown.length);
    const b = Math.max(a + 1, Math.round(((off + shown.length) / items.length) * shown.length));
    // A long name (a memory file's path) wraps under itself; its figures stay on its first line.
    shown.forEach((x, i) => {
      const indent = 3 + (x.sub ? 2 : 0);
      const kind = x.kind && w >= 60 ? ` ${clip(x.kind, 14)}` : "";   // a narrow pane gives the name its room
      const name = x.name;
      const room = w - indent - kind.length - 7 - (max ? 2 : 0);
      out.push({ node: line(els, `fx-${c.key}-${off + i}`, [
        { text: " ".repeat(indent) },
        { node: Text({ key: "t", wrap: "wrap", bold: x.group, children: name }), grow: true },
        kind ? { text: kind, color: theme.muted } : null,
        { text: kTok(x.tokens), width: 7, right: true, color: theme.muted, bold: x.group },
        max ? { text: i >= a && i < b ? " ┃" : " │", color: i >= a && i < b ? theme.muted : theme.border } : null,
      ]), h: rowsFor(name, room) });
    });
    if (max) {
      out.push({ node: line(els, `fx-${c.key}-pager`, [
        { text: "   " },
        { node: Button({ key: `traj-up-${c.key}`, plain: true, dimColor: !off, label: "▴", onPress: () => handlers.onTraj?.("page", { key: c.key, by: -LIST_ROWS }) }) },
        { text: " " },
        { node: Button({ key: `traj-down-${c.key}`, plain: true, dimColor: off >= max, label: "▾", onPress: () => handlers.onTraj?.("page", { key: c.key, by: LIST_ROWS }) }) },
      ]), h: 1 });
    }
  }
  return out;
}

// ---------------------------------------------------------------- lanes

// Each thing on the lanes with where it sits: in order (equal slots, the
// default, easier to tell apart) or in time (Duration).
function laneItems(u, now) {
  const items = [];
  for (const turn of trajectory(u)) {
    if (!turn.earlier) items.push({ lane: "in", color: LANE_COLORS.prompt, t0: turn.at, t1: turn.at, slot: true });
    turn.steps.forEach((s, i) => {
      const prev = i ? turn.steps[i - 1] : null;
      if (prev?.calls.length) items.push({ lane: "in", color: LANE_COLORS.result, t0: s.at, t1: s.at, slot: true });
      items.push({ lane: "model", t0: s.at, t1: s.endedAt ?? now, first: s.firstAt, color: s.status === "failed" ? LANE_COLORS.error : LANE_COLORS.model, slot: true });
      for (const c of s.calls) {
        items.push({ lane: "tools", color: c.isError ? LANE_COLORS.error : isAgent(c) ? LANE_COLORS.agent : LANE_COLORS.tool, t0: c.at, t1: c.done ? c.at + c.ms : now, slot: true });
        for (const sc of c.sub) items.push({ lane: "sub", color: LANE_COLORS.agent, t0: sc.at, t1: sc.done ? sc.at + sc.ms : now, slot: false });
      }
    });
  }
  if (!items.length) return [];
  // In order every slotted item gets the same width; a subagent's calls share their Agent call's slot.
  const slots = items.filter((i) => i.slot).length;
  const start = Math.min(...items.map((i) => i.t0));
  const end = Math.max(...items.map((i) => i.t1), start + 1);
  let k = -1, owner = null;
  return items.map((it) => {
    if (state.traj.duration) return { ...it, x: (it.t0 - start) / (end - start), w: Math.max((it.t1 - it.t0) / (end - start), 0.004) };
    if (it.slot) { k++; owner = it; return { ...it, x: k / slots, w: (1 / slots) * 0.86 }; }
    const span = owner.t1 - owner.t0 || 1;
    return { ...it, x: (k + Math.min(0.9, Math.max(0, (it.t0 - owner.t0) / span))) / slots, w: 0.1 / slots };
  });
}

const LANES = [["in", "Input"], ["model", "Model"], ["tools", "Tools"]];

// The desktop: each lane a thin drawing across the card.
function lanesDesk(els, items) {
  const { Box, Text, Svg } = els;
  const W = 1000;
  const rows = [];
  for (const [lane, name] of [...LANES, ["sub", ""]]) {
    if (lane === "sub" && (state.traj.subcalls || !items.some((i) => i.lane === "sub"))) continue;
    const H = lane === "sub" ? 4 : 7;
    let body = "";
    for (const it of items.filter((i) => i.lane === lane)) {
      const x = it.x * W, w = Math.max(2, it.w * W);
      if (lane === "model" && it.first != null && it.t1 > it.t0) {
        const wait = Math.min(1, Math.max(0, (it.first - it.t0) / (it.t1 - it.t0)));
        const ww = state.traj.duration ? w * wait : w * Math.min(0.6, wait);
        body += `<rect x="${x.toFixed(1)}" width="${ww.toFixed(1)}" height="${H}" rx="1.5" fill="${LANE_COLORS.wait}"/>`;
        body += `<rect x="${(x + ww).toFixed(1)}" width="${Math.max(1, w - ww).toFixed(1)}" height="${H}" rx="1.5" fill="${it.color}"/>`;
      } else body += `<rect x="${x.toFixed(1)}" width="${w.toFixed(1)}" height="${H}" rx="1.5" fill="${it.color}"/>`;
    }
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${body}</svg>`;
    rows.push(Box({ key: `lane-${lane}`, flexDirection: "row", alignItems: "center", children: [
      Box({ key: "l", width: 7, flexShrink: 0, children: [Text({ key: "t", color: theme.muted, children: name })] }),
      Box({ key: "c", flexGrow: 1, minWidth: 1, overflow: "hidden", children: [Svg({ key: "svg", source, alt: `${name || "Subagent"} lane`, height: H })] }),
    ] }));
  }
  return rows;
}

// The terminal: each lane a line of ━ cells, colored by what is there.
function lanesTerm(els, items, w) {
  const W = Math.max(8, w - 7);
  return LANES.map(([lane, name]) => {
    const cellsOf = Array(W).fill(null);
    for (const it of items.filter((i) => i.lane === lane || (lane === "tools" && i.lane === "sub" && !state.traj.subcalls))) {
      const a = Math.min(W - 1, Math.floor(it.x * W));
      const b = Math.max(a + 1, Math.min(W, Math.floor((it.x + it.w) * W)));
      for (let x = a; x < b; x++) cellsOf[x] = lane === "model" && it.first != null && x === a && b - a > 1 ? LANE_COLORS.wait : it.color;
    }
    const runs = [];
    for (const c of cellsOf) {
      const last = runs.at(-1);
      if (last && last.color === c) last.text += c ? "━" : " ";
      else runs.push({ text: c ? "━" : " ", color: c ?? undefined });
    }
    return line(els, `lane-${lane}`, [{ text: name, width: 7, color: theme.muted }, ...runs]);
  });
}

// ---------------------------------------------------------------- the card

export function trajectoryCard(els, w, capacity, handlers = {}, now = Date.now()) {
  const { Box, Button, Text } = els;
  const u = state.usage;
  const t = state.traj;
  const windowed = capacity < 1000;   // the terminal: a window the pane's height
  const meta = `${u.stepN} request${u.stepN === 1 ? "" : "s"}`;
  const metaNode = Box({ key: "meta", flexDirection: "row", alignItems: "center", columnGap: 2, flexShrink: 1, minWidth: 0, children: [
    Text({ key: "m", color: theme.muted, wrap: "truncate-start", children: meta }),
    Button({ key: "traj-copy", plain: true, label: "⧉ Copy", onPress: (press) => handlers.onCopy?.(trajectoryText(now), press?.surface) }),
    Button({ key: "traj-share", plain: true, label: "⇪ Share", onPress: () => handlers.onShareItem?.({ title: "Trajectory", lang: null, body: trajectoryText(now, { maxChars: MAX_SNIPPET, maxLines: MAX_SNIPPET_LINES }) }) }),
  ] });
  if (!u.steps.length && !u.turns.length) {
    const rows = [Text({ key: "none", color: theme.muted, wrap: "truncate-end", children: "None yet. Each request to Claude shows up here." })];
    return { name: "Trajectory", node: card(els, { key: "trajectory", title: "TRAJECTORY", color: theme.usage, metaNode, rows }), height: 4 };
  }
  const fold = (k, label) => Button({ key: `traj-${k}`, plain: true, dimColor: !t[k], label, onPress: () => handlers.onTraj?.("fold", k) });
  const turnList = trajectory(u);
  const allFolded = turnList.length > 0 && !turnList.some((x) => turnIsOpen(x.n, turnList.at(-1).n));
  const turnsFold = Button({ key: "traj-turns", plain: true, dimColor: !allFolded, label: `${allFolded ? "⊞" : "⊟"} Turns`, onPress: () => handlers.onTraj?.("turn", null) });
  const head = [
    Box({ key: "toolbar", flexDirection: "row", columnGap: 2, flexWrap: "wrap", children: [
      fold("duration", "◷ Duration"), turnsFold, fold("calls", `${t.calls ? "⊞" : "⊟"} Calls`), fold("subcalls", `${t.subcalls ? "⊞" : "⊟"} Subcalls`),
    ] }),
  ];
  const items = laneItems(u, now);
  const lanes = els.Svg ? lanesDesk(els, items) : lanesTerm(els, items, w);
  head.push(...lanes);
  // Each row with its details when open, as blocks of { node, h }.
  const blocks = rowList(u).map((r) => {
    const parts = [{ node: rowLine(els, r, w, handlers, now), h: 1 }];
    if (t.sel === r.id) {
      // The details set apart from the rows: framed where the pane draws
      // pictures (desktop, VS Code), a │ down their left in the terminal.
      const d = details(els, r, w - 6, handlers, now);
      const h = d.reduce((n, x) => n + x.h, 0);
      if (d.length && els.Svg) {
        parts.push({ node: Box({ key: `${r.id}-detail`, flexDirection: "column", borderStyle: "round", borderColor: theme.border, paddingX: 1, marginLeft: 2, children: d.map((x) => x.node) }), h: h + 2 });
      } else if (d.length) {
        parts.push({ node: Box({ key: `${r.id}-detail`, flexDirection: "row", marginLeft: 2, children: [
          Box({ key: "guide", flexDirection: "column", width: 2, flexShrink: 0, children: Array.from({ length: h }, (_, i) => Text({ key: `g${i}`, color: theme.border, children: "│" })) }),
          Box({ key: "body", flexDirection: "column", flexGrow: 1, minWidth: 0, children: d.map((x) => x.node) }),
        ] }), h });
      }
    }
    return parts;
  });
  const tt = trajectoryTotals(u);
  const pct = u.context?.percent;
  const foot = [
    Text({ key: "sum", color: theme.muted, wrap: "truncate-end", children: [`${tt.turns} turn${tt.turns === 1 ? "" : "s"}`, `${tt.requests} request${tt.requests === 1 ? "" : "s"}`, `${tt.calls} call${tt.calls === 1 ? "" : "s"}`, tt.tps ? `${tt.tps} tok/s` : null].filter(Boolean).join(" · ") }),
    tt.next != null ? line(els, "next", [
      { text: "The next request sends ", color: theme.muted },
      { text: kTok(tt.next), bold: true },
      { text: Number.isFinite(pct) ? `, ${Math.round(pct)}% of the window.` : ".", color: theme.muted, grow: true },
    ]) : null,
  ].filter(Boolean);
  const headRows = 1 + lanes.length;
  const footRows = 1 + foot.length;   // a row above it
  let shown = blocks.flat();
  let pager = null;
  if (windowed) {
    // A window the pane's height over the rows, anchored at its top row: the
    // newest fill it until it is moved (▴ ▾, the wheel). A row taller than the
    // window (FIXED opened) shows cut to it, and the next move goes past it.
    const room = Math.max(3, capacity - 3 - headRows - footRows - 1);
    const hOf = (b) => b.reduce((k, x) => k + x.h, 0);
    const total = blocks.reduce((n, b) => n + hOf(b), 0);
    if (total > room) {
      let newest = blocks.length - 1, used = hOf(blocks[newest]);
      while (newest > 0 && used + hOf(blocks[newest - 1]) <= room) used += hOf(blocks[--newest]);
      let from = t.top == null ? newest : Math.min(Math.max(0, t.top), blocks.length - 1);
      if (from >= newest) { from = newest; t.top = null; }   // moved down to the newest: follow them again
      let end = from;
      used = 0;
      while (end < blocks.length && (end === from || used + hOf(blocks[end]) <= room)) used += hOf(blocks[end++]);
      t.above = from;
      t.below = blocks.length - end;
      shown = blocks.slice(from, end).flat();
      if (used > room) {
        // The one row is taller than the window: its first rows, cut at its height.
        shown = [{ node: Box({ key: "cut", flexDirection: "column", height: room, overflow: "hidden", flexShrink: 0, children: shown.map((x) => x.node) }), h: room }];
      }
      pager = line(els, "pager", [
        { node: Button({ key: "traj-older", plain: true, dimColor: !t.above, label: `▴ ${t.above} earlier`, onPress: () => handlers.onTraj?.("scroll", -3) }) },
        { text: "   " },
        { node: Button({ key: "traj-newer", plain: true, dimColor: !t.below, label: `▾ ${t.below} newer`, onPress: () => handlers.onTraj?.("scroll", 3) }) },
      ]);
    } else { t.top = null; t.above = 0; t.below = 0; }
  }
  const rows = [...head, ...(pager ? [pager] : []), ...shown.map((x) => x.node), Box({ key: "gap", height: 1 }), ...foot];
  const height = headRows + (pager ? 1 : 0) + shown.reduce((n, x) => n + x.h, 0) + footRows;
  return { name: "Trajectory", node: card(els, { key: "trajectory", title: "TRAJECTORY", color: theme.usage, metaNode, rows }), height: 3 + height };
}

// ---------------------------------------------------------------- as text

// The card as plain text, for Copy and Share: each turn and request with its
// figures, the calls by tool and what they were about (the brief description
// its row shows). No prompt, reply, input or result text: those stay in this
// pane. An agent's own calls are one line, counted by tool. Share passes a
// chat snippet's limits, and the oldest requests give way until it fits.
export function trajectoryText(now = Date.now(), { maxChars = Infinity, maxLines = Infinity } = {}) {
  const u = state.usage;
  const tt = trajectoryTotals(u);
  const head = [`Trajectory · ${tt.requests} request${tt.requests === 1 ? "" : "s"} to Claude · ${tt.calls} tool call${tt.calls === 1 ? "" : "s"}`];
  if (u.overhead) head.push(`Fixed overhead ${kTok(u.overhead.tokens)} tokens, sent with every request`);
  const foot = [tt.tps ? `${tt.tps} tok/s` : null, tt.next != null ? `the next request sends ${kTok(tt.next)}` : null].filter(Boolean).join(" · ");
  const turns = trajectory(u);
  const kept = turns.reduce((n, t) => n + t.steps.length, 0);
  // The text with the first `skip` of the kept requests left out.
  const write = (skip) => {
    const out = [...head];
    const before = u.stepN - kept + skip;   // sent before the first one written
    if (before > 0) out.push(`${before} earlier request${before === 1 ? "" : "s"} not listed`);
    let i = 0;
    for (const turn of turns) {
      const steps = turn.steps.filter(() => i++ >= skip);
      if (!steps.length) continue;
      out.push("", `${turn.earlier ? "Earlier" : `Turn ${turn.n}`} · ${turn.steps.length} request${turn.steps.length === 1 ? "" : "s"}`);
      for (const s of steps) {
        if (s.isCompacted) out.push("  Context compacted");
        out.push(`  #${s.n}  ${s.status === "failed" ? "failed, sent again" : s.status === "streaming" ? "streaming" : `${kTok(s.input)} in · ${kTok(s.output)} out`} · ${took(stepMs(s, now))}`);
        for (const c of s.calls) {
          out.push(`    ${c.tool}${c.summary ? ` ${c.summary}` : ""}${c.isError ? " ✗" : ""} · ${kTok(tokensOf(c)) || "–"} · ${c.done ? took(c.ms) : "running"}`);
          if (c.subN) out.push(`      ${c.subN} call${c.subN === 1 ? "" : "s"} of its own: ${subTools(c)}`);
        }
      }
    }
    if (foot) out.push("", foot);
    return out.join("\n").trimEnd();
  };
  let skip = 0;
  let text = write(skip);
  while (skip < kept && (text.length > maxChars || text.split("\n").length > maxLines)) text = write(++skip);
  return text;
}

// "Grep ×120, Read ×80, Bash ×12, …": an agent's calls by tool, the most used first.
function subTools(c) {
  const list = Object.entries(c.subTools ?? {}).sort((a, b) => b[1] - a[1]);
  return `${list.slice(0, 4).map(([tool, n]) => `${shortTool(tool)} ×${n}`).join(", ")}${list.length > 4 ? ", …" : ""}`;
}
