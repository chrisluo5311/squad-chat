// The built-in rooms, drawn from state alone: Usage (this session's context,
// limits, spend, tools and subagents), Git (the branch, pull requests,
// Actions, issues) and Agents (every session on this computer, and a live
// feed of tool calls). Each has a docked layout of cards, a compact one for
// the inline pane, a one-line summary for the band, and a plain-text
// snapshot for sharing to a chat room.

import { state } from "./state.mjs";
import { theme, level, nameColor } from "./theme.mjs";
import {
  cells, clip, fit, fmtTokens, fmtUsd, fmtDur, fmtSpan, relTime, age, resetLabel,
  bar, barNode, stretchBar, sparkline, meter, tiles, line, col, stackCards, card, CARD_GAP, LABEL_W,
  bigNumber, lineChart, xml,
} from "./widgets.mjs";
import {
  totalTokens, cacheRatio, burnRate, limitWindows, spendSeries, toolRows, agentTree, agentCounts, isEnded, topTool,
  strata, contextTips,
} from "./metrics.mjs";
import { gitAttention, ghStatusText } from "./github.mjs";
import * as K from "./bandkit.mjs";
import { capsule, draw, label as pLabel, value as pValue, sub as pSub, msg as pMsg } from "./bands.mjs";
import { orderSessions, mergedFeed } from "./sessions.mjs";
import { fnMeta, fnDock, fnInline, fnBandPieces, fnSnapshot, fnSnapshotLine } from "./fnviews.mjs";
import { SNAPSHOT_ICONS } from "./share.mjs";
import { FOCUS_META, focusDock, focusInline, focusBandPieces, focusBandDesk, focusBadge, focusSnapshot } from "./focus.mjs";
import { HABITS_META, habitsDock, habitsInline, habitsBandPieces, habitsBandDesk, habitsBadge, habitsSnapshot } from "./habits.mjs";
import { TOOLBOX_META, toolboxDock, toolboxInline, toolboxBandPieces, toolboxBandDesk, toolboxBadge } from "./toolbox.mjs";
import { CLIP_META, clipboardDock, clipboardInline, clipboardBandPieces, clipboardBandDesk } from "./clipboard.mjs";
import { PET_META, petDock, petInline, petBandPieces, petBandDesk } from "./pet.mjs";

export const SYS = {
  usage: { icon: "◔", label: "Usage", color: theme.usage },
  git: { icon: "⎇", label: "Git", color: theme.git },
  agents: { icon: "⟡", label: "Agents", color: theme.agents },
  focus: FOCUS_META,
  habits: HABITS_META,
  toolbox: TOOLBOX_META,
  clipboard: CLIP_META,
  pet: PET_META,
};

// The built-in rooms that live in modules of their own: each draws its
// docked cards, its inline lines, its band (a line of text, and the
// desktop's capsule as { color, sections }), and may badge its tab or share
// a snapshot (Toolbox, Clipboard and Pet have nothing to share).
const OWN = {
  focus: { dock: focusDock, inline: focusInline, band: focusBandPieces, desk: focusBandDesk, badge: focusBadge, snapshot: focusSnapshot },
  habits: { dock: habitsDock, inline: habitsInline, band: habitsBandPieces, desk: habitsBandDesk, badge: habitsBadge, snapshot: habitsSnapshot },
  toolbox: { dock: toolboxDock, inline: toolboxInline, band: toolboxBandPieces, desk: toolboxBandDesk, badge: toolboxBadge },
  clipboard: { dock: clipboardDock, inline: clipboardInline, band: clipboardBandPieces, desk: clipboardBandDesk },
  pet: { dock: petDock, inline: petInline, band: petBandPieces, desk: petBandDesk },
};

// Whether a room's Share posts a snapshot of it.
export function hasSnapshot(view) {
  return !OWN[view] || !!OWN[view].snapshot;
}

// How a room's Share posts: "card" (a snippet the chat draws as the room's
// card), "text" (a line of chat) or "code" (a room's cards, listed).
export function snapshotKind(view) {
  if (SNAPSHOT_ICONS[view]) return "card";
  if (OWN[view] || fnSnapshotLine(view)) return "text";
  return "code";
}

// A room's icon, label and color: built-in or function room.
export function roomMeta(id) {
  return SYS[id] ?? fnMeta(id);
}

const SPIN = ["◐", "◓", "◑", "◒"];
const spin = (now) => SPIN[Math.floor(now / 1000) % SPIN.length];

// "claude-opus-5-5" → "opus-5.5"
export function shortModel(id) {
  if (!id) return "";
  return String(id).replace(/^claude-/, "").replace(/-\d{8}$/, "").replace(/-(\d+)-(\d+)$/, "-$1.$2");
}

// One rate-limit window's meter. Without a reading (it just reset) it says so.
function limitMeter(els, l, w) {
  const right = l.percentUsed == null ? "no data yet" : l.resetsAt ? `↻ ${resetLabel(l.resetsAt)}` : "";
  return meter(els, { key: `rl-${l.kind}`, label: limitName(l.kind), pct: l.percentUsed ?? undefined, width: w, right });
}

const LIMIT_NAMES = { five_hour: "5-hour", seven_day: "7-day", seven_day_opus: "7d opus", seven_day_sonnet: "7d sonnet", spend_limit: "Spend" };
function limitName(kind) {
  return LIMIT_NAMES[kind] ?? String(kind).replace(/_/g, " ");
}

const sized = (name, node, rowCount) => ({ name, node, height: 3 + rowCount });
const muted = (els, key, text) => els.Text({ key, color: theme.muted, wrap: "truncate-end", children: text });
// A row's link: the desktop opens it (↗), the terminal copies it (⧉).
const openLink = (els, url) => els.Link({ href: String(url), label: "↗" });
const copyButton = (els, key, url, handlers) => (url
  ? { node: els.Svg ? openLink(els, url) : els.Button({ key, plain: true, dimColor: true, label: "⧉", onPress: () => handlers.onCopy?.(url) }) }
  : null);

// ---------------------------------------------------------------- Usage

function usageCard(els, w, handlers, now) {
  const u = state.usage;
  const rows = [];
  if (!u.measured) {
    rows.push(muted(els, "wait", "Waiting for the first reply from Claude…"));
  } else {
    const c = u.context ?? {};
    const right = c.tokens != null ? `${fmtTokens(c.tokens)}/${fmtTokens(c.window)}` : `${fmtTokens(c.window)} window`;
    rows.push(meter(els, { key: "ctx", label: u.showBreakdown ? "Context ▾" : "Context ▸", pct: c.percent, width: w, right, onPress: handlers.onToggleBreakdown }));
    if (u.showBreakdown) {
      const cats = (u.breakdown?.categories ?? []).filter((x) => !x.isDeferred && x.tokens > 0 && !/free space/i.test(x.name));
      if (!u.breakdown) rows.push(muted(els, "bd-wait", "  counting…"));
      for (const [i, x] of cats.slice(0, 6).entries()) {
        const pct = u.breakdown.maxTokens ? (x.tokens / u.breakdown.maxTokens) * 100 : 0;
        rows.push(meter(els, { key: `bd${i}`, label: `  ${x.name}`, pct, width: w, right: fmtTokens(x.tokens), color: theme.usage }));
      }
    }
    const windows = limitWindows(u);
    if (windows.length) {
      for (const l of windows) rows.push(limitMeter(els, l, w));
    } else {
      rows.push(muted(els, "nolimits", "No rate-limit windows on this account."));
    }
  }
  const meta = [shortModel(u.model), u.startedAt ? fmtSpan(now - u.startedAt) : null].filter(Boolean).join(" · ");
  return sized("Usage", card(els, { key: "usage", title: "USAGE", color: theme.usage, meta, rows }), rows.length);
}

// The desktop's Spend: three tiles, each a figure set large over its
// caption with a small drawing under it: the cost with its last hour, the
// tokens with a bar of what went in and what came out, the cache hits with a
// ring.
function spendCardDesk(els, now) {
  const { Box, Text, Svg } = els;
  const u = state.usage;
  const series = spendSeries(u, now);
  const rate = burnRate(u, now);
  const cache = cacheRatio(u);
  const t = u.tokens;
  const cacheC = cache == null ? "#8F8D87" : cache >= 60 ? theme.online : cache >= 30 ? theme.amber : theme.error;
  const label = (text) => Text({ key: "l", color: theme.muted, children: text });
  const cap = (text, wrap = "truncate-end") => Text({ key: "c", color: theme.muted, wrap, children: text });
  const tile = (key, kids) => Box({ key, flexDirection: "column", width: 1, flexGrow: 1, minWidth: 0, borderStyle: "round", borderColor: theme.border, paddingX: 1, children: kids.filter(Boolean) });
  // What went in (fresh, and read from or written to the cache) and what came out, as one bar.
  const inTok = t.input + t.cacheRead + t.cacheWrite;
  const all = inTok + t.output;
  const split = all ? Box({ key: "split", flexDirection: "row", children: [Box({ key: "c", flexGrow: 1, minWidth: 1, overflow: "hidden", children: [
    Svg({ key: "svg", alt: `${Math.round((t.output / all) * 100)}% out`, height: 6, source: `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="6" viewBox="0 0 1000 6" preserveAspectRatio="none">`
      + `<rect width="1000" height="6" rx="3" fill="#33322F"/><rect width="${Math.max(2, (inTok / all) * 1000).toFixed(1)}" height="6" fill="${theme.agents}"/>`
      + `<rect x="${((inTok / all) * 1000).toFixed(1)}" width="${Math.max(6, (t.output / all) * 1000).toFixed(1)}" height="6" fill="${theme.amber}"/></svg>` }),
  ] })] }) : null;
  const C = 2 * Math.PI * 9;
  const ring = cache == null ? null : Svg({ key: "ring", alt: "cache ring", width: 22, height: 22, source: `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24">`
    + `<circle cx="12" cy="12" r="9" fill="none" stroke="#33322F" stroke-width="4"/>`
    + `<circle cx="12" cy="12" r="9" fill="none" stroke="${cacheC}" stroke-width="4" stroke-dasharray="${((cache / 100) * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 12 12)"/></svg>` });
  const row = Box({ key: "tiles", flexDirection: "row", columnGap: 1, children: [
    tile("cost", [
      label("COST"),
      bigNumber(els, "v", u.cost ? fmtUsd(u.cost.usd) : "–", theme.usage),
      cap(rate != null ? `+${fmtUsd(rate)}/h` : "this session"),
      series.some((v) => v > 0) ? lineChart(els, "hour", [series], [theme.usage], { height: 16 }) : null,
    ]),
    tile("tokens", [
      label("TOKENS"),
      bigNumber(els, "v", fmtTokens(totalTokens(u)), "#E8E6E1"),
      cap(`${fmtTokens(t.output)} out`),
      split,
    ]),
    tile("cache", [
      label("CACHE HITS"),
      Box({ key: "vr", flexDirection: "row", alignItems: "center", columnGap: 1, children: [bigNumber(els, "v", cache == null ? "–" : `${Math.round(cache)}%`, cacheC), ring].filter(Boolean) }),
      cap("of input read from cache", "wrap"),   // a narrow tile takes it on two lines
    ]),
  ] });
  return sized("Spend", card(els, { key: "spend", title: "SPEND", color: theme.usage, meta: "this session", rows: [row] }), 7);
}

function spendCard(els, w, now) {
  if (els.Svg) return spendCardDesk(els, now);
  const u = state.usage;
  const series = spendSeries(u, now);
  const rate = burnRate(u, now);
  const cache = cacheRatio(u);
  const spark = series.some((v) => v > 0) ? `${sparkline(series)} last 1h` : "";
  const list = [
    { value: u.cost ? fmtUsd(u.cost.usd) : "–", sub: rate != null ? `+${fmtUsd(rate)}/h` : "this session", color: theme.usage },
    { value: fmtTokens(totalTokens(u)), sub: `${fmtTokens(u.tokens.output)} out`, color: undefined },
    { value: cache == null ? "–" : `${Math.round(cache)}%`, sub: "cache hits", color: cache == null ? theme.muted : cache >= 60 ? theme.online : cache >= 30 ? theme.amber : theme.error },
  ];
  return sized("Spend", card(els, { key: "spend", title: "SPEND", color: theme.usage, meta: spark, metaColor: theme.usage, rows: [tiles(els, list, w)] }), 2);
}

// The number columns, shared by the header and every row so they line up.
const TOOL_COLS = [["p50", 6], ["p95", 6], ["calls", 7], ["fail", 6]];
const TOOL_NUMS = TOOL_COLS.reduce((n, [, w]) => n + w, 0);
const toolHeader = () => TOOL_COLS.map(([h, w]) => fit(h, w, { right: true })).join("");

// The desktop's Tools card: a count in the title row, the column labels in a
// row of their own over a rule, and each tool's bar taking the room between
// its name and its numbers, so every number sits under its label.
function toolsCardDesk(els, list) {
  const { Box, Text } = els;
  const NAME = 14;
  const [[, w50], [, w95], [, wCalls], [, wFail]] = TOOL_COLS;
  const top = Math.max(...list.map((t) => t.total), 1);
  const calls = list.reduce((n, t) => n + t.count, 0);
  const nums = (key, cells) => Box({ key, flexDirection: "row", flexShrink: 0, children: cells });
  const rows = [
    Box({ key: "cols", flexDirection: "row", children: [
      col(els, "n", "tool", NAME, { color: theme.muted }),
      Box({ key: "b", flexGrow: 1 }),
      nums("h", TOOL_COLS.map(([h, cw]) => col(els, h, h, cw, { right: true, color: theme.muted }))),
    ] }),
    Box({ key: "rule", flexDirection: "row", children: [stretchBar(els, "line", 100, "#7F7F7F", { track: false })] }),
  ];
  for (const t of list) {
    rows.push(Box({ key: `t-${t.name}`, flexDirection: "row", alignItems: "center", children: [
      col(els, "n", clip(t.name, NAME - 1), NAME),
      stretchBar(els, "b", (t.total / top) * 100, theme.usage, { track: false, min: true, box: { marginRight: 1 } }),
      nums("v", [
        col(els, "p50", fmtDur(t.p50), w50, { right: true }),
        col(els, "p95", fmtDur(t.p95), w95, { right: true, color: theme.muted }),
        col(els, "c", String(t.count), wCalls, { right: true }),
        col(els, "e", String(t.errors), wFail, { right: true, bold: t.errors > 0, color: t.errors ? theme.error : theme.muted }),
      ]),
    ] }));
  }
  const meta = `${list.length} tool${list.length === 1 ? "" : "s"} · ${calls} call${calls === 1 ? "" : "s"}`;
  return sized("Tools", card(els, { key: "tools", title: "TOOLS", color: theme.usage, meta, rows }), rows.length);
}

function toolsCard(els, w, max) {
  const { Box } = els;
  const list = toolRows(state.usage).slice(0, max);
  const rows = [];
  if (!list.length) rows.push(muted(els, "none", "No tool calls yet."));
  const NAME = Math.min(14, Math.max(8, ...list.map((t) => cells(t.name) + 1)));
  const barW = Math.max(3, w - NAME - TOOL_NUMS);
  const top = Math.max(...list.map((t) => t.total), 1);
  const [[, w50], [, w95], [, wCalls], [, wFail]] = TOOL_COLS;
  if (els.Svg && list.length) return toolsCardDesk(els, list);
  for (const t of list) {
    rows.push(Box({ key: `t-${t.name}`, flexDirection: "row", alignItems: "center", children: [
      col(els, "n", clip(t.name, NAME - 1), NAME),
      barNode(els, "b", (t.total / top) * 100, barW, theme.usage, { track: false, min: true }),   // even a quick tool gets a mark
      col(els, "p50", fmtDur(t.p50), w50, { right: true }),
      col(els, "p95", fmtDur(t.p95), w95, { right: true, color: theme.muted }),
      col(els, "c", String(t.count), wCalls, { right: true }),
      col(els, "e", String(t.errors), wFail, { right: true, bold: t.errors > 0, color: t.errors ? theme.error : theme.muted }),
    ] }));
  }
  // The header ends at the card's right edge, as the rows do: each label sits over its column.
  const header = list.length
    ? Box({ key: "meta", flexDirection: "row", flexShrink: 0, children: TOOL_COLS.map(([h, cw]) => col(els, h, h, cw, { right: true, color: theme.muted })) })
    : null;
  return sized("Tools", card(els, { key: "tools", title: "TOOLS", color: theme.usage, metaNode: header, rows }), rows.length);
}

// The Requests card: the context as strata, one column per request to the
// model and one for the next, each thing that came into the conversation a
// layer from the request that first carried it on (see strata). Under them,
// as bedrock, what was there before: the overhead every request carries and
// any earlier conversation, drawn apart, since to scale they would flatten
// the rest. Then a few plain-word tips. The terminal draws the strata in
// block cells, the desktop as a drawing.
const LAYER_COLORS = ["#8F8D87", "#D97757", "#E2B86B", "#6FC2B5", "#C8A2E0"];
const BEDROCK = "#8A5A44";
const EARLIER = "#5E5C57";

// A layer's size as the tips say it: "3.6k", "740".
const kTok = (n) => (n < 1000 ? String(Math.round(n)) : n < 10_000 ? `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k` : `${Math.round(n / 1000)}k`);

// "79k fixed + 310k earlier": what the bedrock holds.
function bedrockText(st) {
  const fixed = `${kTok(st.bedrock)} ${st.bedrockKnown ? "fixed" : "at start"}`;
  return st.earlier >= 1000 ? `${fixed} + ${kTok(st.earlier)} earlier` : fixed;
}

// The context now, as a sum that comes to the Usage meter's figure:
// "79k fixed + 499k earlier + 5.5k new = 586k".
function contextSum(st) {
  const added = st.cols.at(-1)?.above ?? 0;
  return `${bedrockText(st)} + ${kTok(added)} new = ${kTok(st.bedrock + st.earlier + added)}`;
}
const STRATA_ROWS = 5;

function requestsCard(els, w, handlers = {}) {
  const u = state.usage;
  const st = strata(u, els.Svg ? 16 : Math.min(12, Math.max(3, Math.floor((w - 18) / 2))));
  const rows = [];
  if (!st) {
    rows.push(muted(els, "none", "None yet. Each request to the model shows up here."));
    return sized("Requests", card(els, { key: "requests", title: "REQUESTS", color: theme.usage, rows }), 1);
  }
  const height = els.Svg ? strataDesk(els, st, w, rows) : strataTerm(els, st, w, rows);
  const tips = contextTips(u);
  let tipRows = 0;
  for (const [i, t] of tips.entries()) {
    const text = t.parts.map(([p]) => p).join("");
    rows.push(els.Box({ key: `tip${i}`, flexDirection: "row", marginTop: i ? 0 : 1, children: [
      els.Box({ key: "i", width: 2, flexShrink: 0, children: [els.Text({ key: "t", color: theme.usage, children: t.icon })] }),
      els.Box({ key: "x", flexGrow: 1, flexShrink: 1, minWidth: 0, children: [els.Text({ key: "t", wrap: "wrap", children: t.parts.map(([p, bold], j) => (bold ? els.Text({ key: `b${j}`, bold: true, children: p }) : p)) })] }),
    ] }));
    tipRows += Math.max(1, Math.ceil(cells(text) / Math.max(10, w - 2)));
  }
  const meta = `${st.sent} request${st.sent === 1 ? "" : "s"}${st.compacted ? " since compaction" : ""}`;
  // Copy and Share take the card as text (requestsText); Share asks first, as a snippet's does.
  const metaNode = els.Box({ key: "meta", flexDirection: "row", alignItems: "center", columnGap: 2, flexShrink: 1, minWidth: 0, children: [
    els.Text({ key: "m", color: theme.muted, wrap: "truncate-start", children: meta }),
    els.Button({ key: "requests-copy", plain: true, label: "⧉ Copy", onPress: (press) => handlers.onCopy?.(requestsText(), press?.surface) }),
    els.Button({ key: "requests-share", plain: true, label: "⇪ Share", onPress: () => handlers.onShareItem?.({ title: "Requests", lang: null, body: requestsText() }) }),
  ] });
  return sized("Requests", card(els, { key: "requests", title: "REQUESTS", color: theme.usage, metaNode, rows }), height + tipRows + (tips.length ? 1 : 0));
}

// The Requests card as plain text, for Copy and Share: what was there before
// the first request, what each named layer and the rest of the conversation
// hold now (the biggest first), and the tips.
export function requestsText() {
  const u = state.usage;
  const st = strata(u);
  if (!st) return "";
  const k = kTok;
  const held = st.layers.map((l) => ({ name: l.name, tokens: l.sizes.at(-1) })).filter((l) => l.tokens > 0).sort((a, b) => b.tokens - a.tokens);
  const widest = Math.max(...held.map((l) => cells(l.name)));
  return [
    `Requests · ${st.sent} request${st.sent === 1 ? "" : "s"} to Claude`,
    `Context now: ${contextSum(st)}.`,
    "",
    ...held.map((l) => `  ${l.name}${" ".repeat(widest - cells(l.name) + 2)}${k(l.tokens)}`),
    "",
    ...contextTips(u).map((t) => `${t.icon} ${t.parts.map(([p]) => p).join("")}`),
  ].join("\n");
}

// The layer at a height in a column, and the top one, for a cell's color.
function layerAt(st, c, h) {
  let acc = 0;
  for (const [i, l] of st.layers.entries()) { acc += l.sizes[c]; if (h < acc) return i; }
  return -1;
}
function topLayer(st, c) {
  for (let i = st.layers.length - 1; i >= 0; i--) if (st.layers[i].sizes[c] > 0) return i;
  return 0;
}

// Block cells: a full one where the column passes the cell, a half where it
// ends in its lower part. Each named layer is labeled at its height beside
// the last column, where there's room.
function strataTerm(els, st, w, rows) {
  const AX = 5;
  const LBL = w >= 44 ? 15 : 0;
  const n = st.cols.length;
  const cw = Math.min(5, Math.max(2, Math.floor((w - AX - LBL) / n)));
  const block = cw - 1;
  const max = Math.max(1, ...st.cols.map((c) => c.above));
  const step = max / STRATA_ROWS;
  const labels = new Map();
  if (LBL) {
    const last = n - 1;
    let acc = 0;
    for (const [i, l] of st.layers.entries()) {
      const size = l.sizes[last];
      if (i && size > 0) {
        let r = Math.min(STRATA_ROWS - 1, Math.floor((acc + size / 2) / step));
        while (labels.has(r) && r < STRATA_ROWS - 1) r++;
        if (!labels.has(r)) labels.set(r, i);
      }
      acc += size;
    }
  }
  for (let r = STRATA_ROWS - 1; r >= 0; r--) {
    const lo = r * step, hi = (r + 1) * step;
    const runs = [];
    const push = (text, color) => { const prev = runs.at(-1); if (prev && prev.color === color) prev.text += text; else runs.push({ text, color }); };
    st.cols.forEach((c, i) => {
      if (c.above >= hi - step * 0.05) push("█".repeat(block), LAYER_COLORS[layerAt(st, i, (lo + hi) / 2)] ?? LAYER_COLORS[0]);
      else if (c.above > lo + step * 0.25) push("▄".repeat(block), LAYER_COLORS[topLayer(st, i)] ?? LAYER_COLORS[0]);
      else push(" ".repeat(block), undefined);
      push(" ", undefined);
    });
    const li = labels.get(r);
    rows.push(line(els, `s${r}`, [
      { text: r === STRATA_ROWS - 1 ? fmtTokens(max) : "", width: AX - 1, right: true, color: theme.muted },
      { text: " " },
      ...runs.map((x) => ({ text: x.text, color: x.color })),
      // The size first: a long name is cut at its end, never the number.
      li != null ? { text: ` ${kTok(st.layers[li].sizes[n - 1])} ${st.layers[li].name}`, color: LAYER_COLORS[li], grow: true } : null,
    ]));
  }
  const span = n * cw - 1;
  const old = st.earlier >= 1000 ? Math.min(span - 1, Math.max(1, Math.round((st.earlier / (st.bedrock + st.earlier)) * span))) : 0;
  rows.push(line(els, "bed", [
    { text: "", width: AX },
    { text: "▀".repeat(span - old), color: BEDROCK },
    old ? { text: "▀".repeat(old), color: EARLIER } : null,
    { text: ` ${contextSum(st)}`, color: theme.muted, grow: true },
  ]));
  const first = st.cols[0].label;
  rows.push(line(els, "x", [
    { text: "", width: AX },
    { text: first, color: theme.muted },
    { text: " ".repeat(Math.max(1, span - cells(first) - 4)) },
    { text: "next", color: theme.usage },
  ]));
  return STRATA_ROWS + 2;
}

// The desktop: the columns as one drawing that stretches to the card, each
// stratum carried on between columns so it reads as one band; the bedrock a
// thick bar under it; a key of the named layers.
function strataDesk(els, st, w, rows) {
  const { Box, Svg } = els;
  const W = 1000, H = 64;
  const n = st.cols.length;
  const max = Math.max(1, ...st.cols.map((c) => c.above));
  const cw = W / n, gap = Math.min(12, cw * 0.18);
  const y = (v) => H - (v / max) * (H - 2);
  let body = "";
  const base = st.cols.map(() => 0);
  st.layers.forEach((l, li) => {
    const fill = LAYER_COLORS[li] ?? LAYER_COLORS[0];
    let d = "";
    st.cols.forEach((_, c) => {
      const s = l.sizes[c];
      if (s > 0) {
        const x0 = c * cw + gap / 2, x1 = (c + 1) * cw - gap / 2;
        d += `M${x0.toFixed(1)} ${y(base[c]).toFixed(1)}V${y(base[c] + s).toFixed(1)}H${x1.toFixed(1)}V${y(base[c]).toFixed(1)}Z`;
        if (c && l.sizes[c - 1] > 0) {   // the band between this column and the one before
          const xa = c * cw - gap / 2, xb = c * cw + gap / 2;
          d += `M${xa.toFixed(1)} ${y(base[c - 1]).toFixed(1)}V${y(base[c - 1] + l.sizes[c - 1]).toFixed(1)}L${xb.toFixed(1)} ${y(base[c] + s).toFixed(1)}V${y(base[c]).toFixed(1)}Z`;
        }
      }
    });
    if (d) body += `<path d="${d}" fill="${fill}" fill-opacity="${li ? 0.95 : 0.7}"/>`;
    st.cols.forEach((_, c) => { base[c] += l.sizes[c]; });
  });
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">${body}</svg>`;
  const alt = `Context by request: ${st.layers.slice(1).map((l) => l.name).join(", ") || "conversation"} over ${fmtTokens(st.bedrock)} fixed`;
  rows.push(Box({ key: "strata", flexDirection: "row", children: [Box({ key: "c", flexGrow: 1, minWidth: 1, overflow: "hidden", children: [Svg({ key: "svg", source, alt, height: H })] })] }));
  // The bedrock in two parts, each its share of what was there before, as one
  // drawing (as Spend draws in against out) so the split is exact.
  const fixedW = st.earlier >= 1000 ? (st.bedrock / (st.bedrock + st.earlier)) * W : W;
  const bedSrc = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="8" viewBox="0 0 ${W} 8" preserveAspectRatio="none">`
    + `<rect width="${fixedW.toFixed(1)}" height="8" fill="${BEDROCK}"/>`
    + (fixedW < W ? `<rect x="${fixedW.toFixed(1)}" width="${(W - fixedW).toFixed(1)}" height="8" fill="${EARLIER}"/>` : "") + `</svg>`;
  rows.push(Box({ key: "bed", flexDirection: "row", children: [Box({ key: "c", flexGrow: 1, minWidth: 1, overflow: "hidden", children: [
    Svg({ key: "svg", source: bedSrc, alt: `Before the first request: ${bedrockText(st)}`, height: 8 }),
  ] })] }));
  rows.push(line(els, "x", [
    { text: `${st.cols[0].label}`, color: theme.muted },
    { text: contextSum(st), color: theme.muted, grow: true, right: true },
    { text: "  next", color: theme.usage },
  ]));
  // The key wraps, a whole entry to a line, rather than running past the card.
  // Each entry with what it holds now, so every color has a size, not only the tip's.
  const keys = st.layers.map((l, i) => ({ name: `${l.name} ${kTok(l.sizes.at(-1))}`, color: LAYER_COLORS[i], shown: i ? l.sizes.at(-1) > 0 : true }))
    .filter((k) => k.shown).sort((a, b) => a.name.startsWith("conversation ") - b.name.startsWith("conversation "));
  rows.push(Box({ key: "key", flexDirection: "row", flexWrap: "wrap", columnGap: 2, children: keys.map((k, i) => Box({ key: `k${i}`, flexShrink: 0, children: [
    els.Text({ key: "t", color: k.color, children: `■ ${k.name}` }),
  ] })) }));
  const keyCells = keys.reduce((n, k) => n + cells(k.name) + 4, 0);
  return 5 + Math.max(1, Math.ceil(keyCells / Math.max(20, w)));
}

function agentGlyph(status, now) {
  if (status === "completed") return { g: "✓", color: theme.online };
  if (status === "failed") return { g: "✗", color: theme.error };
  if (status === "killed") return { g: "⊘", color: theme.muted };
  if (status === "idle" || status === "waiting" || status === "pending") return { g: "○", color: theme.agents };
  return { g: spin(now), color: theme.agents };
}

function agentRow(els, key, a, { indent = "", now }) {
  const st = agentGlyph(a.status, now);
  const took = (a.endedAt ?? now) - a.startedAt;
  return line(els, key, [
    indent ? { text: indent, color: theme.muted } : null,
    { text: `${st.g} `, color: st.color },
    { text: clip(a.type, 9), width: 10, bold: true },
    { text: a.description, grow: true },
    { text: ` ${isEnded(a.status) ? "done" : fmtDur(took)}`, color: theme.muted },
    a.top ? { text: `  ${a.top}`, color: theme.muted } : null,
  ]);
}

// The desktop's Subagents: how many are running and done, and the time
// they've spent between them, set large; the agents as rows under them.
function subagentsCardDesk(els, max, now) {
  const { Box, Text } = els;
  const tree = agentTree(state.usage);
  const { running, done } = agentCounts(state.usage);
  const spent = [...state.usage.agents.values()].reduce((n, a) => n + Math.max(0, (a.endedAt ?? now) - a.startedAt), 0);
  const stat = (key, value, label, color) => Box({ key, flexDirection: "column", children: [
    bigNumber(els, "v", value, color),
    Text({ key: "l", color: theme.muted, children: label }),
  ] });
  const rows = [];
  if (tree.length) {
    rows.push(Box({ key: "stats", flexDirection: "row", columnGap: 4, marginBottom: 1, children: [
      stat("run", String(running), "RUNNING", running ? theme.agents : "#8F8D87"),
      stat("done", String(done), "DONE", done ? theme.online : "#8F8D87"),
      stat("time", fmtDur(spent), "AGENT TIME", "#E8E6E1"),
    ] }));
  }
  rows.push(...tree.slice(0, max).map(({ agent: a, depth, last }) => agentRow(els, `a-${a.id}`, { ...a, top: topTool(a) }, {
    indent: depth ? `${"   ".repeat(depth - 1)}${last ? "└─ " : "├─ "}` : "", now,
  })));
  if (tree.length > max) rows.push(muted(els, "more", `+${tree.length - max} more`));
  if (!tree.length) rows.push(muted(els, "none", "None yet. They show up here as Claude starts them."));
  return sized("Subagents", card(els, { key: "subagents", title: "SUBAGENTS", color: theme.usage, meta: "this session", rows }), rows.length + (tree.length ? 3 : 0));
}

function subagentsCard(els, max, now) {
  if (els.Svg) return subagentsCardDesk(els, max, now);
  const tree = agentTree(state.usage);
  const { running, done } = agentCounts(state.usage);
  const rows = tree.slice(0, max).map(({ agent: a, depth, last }) => agentRow(els, `a-${a.id}`, { ...a, top: topTool(a) }, {
    indent: depth ? `${"   ".repeat(depth - 1)}${last ? "└─ " : "├─ "}` : "", now,
  }));
  if (tree.length > max) rows.push(muted(els, "more", `+${tree.length - max} more`));
  if (!rows.length) rows.push(muted(els, "none", "None yet. They show up here as Claude starts them."));
  const meta = running || done ? `${running} running · ${done} done` : "";
  return sized("Subagents", card(els, { key: "subagents", title: "SUBAGENTS", color: theme.usage, meta, metaColor: running ? theme.agents : theme.muted, rows }), rows.length);
}

function usageDock(els, w, capacity, handlers, now) {
  return stackCards(els, [
    usageCard(els, w, handlers, now),
    spendCard(els, w, now),
    requestsCard(els, w, handlers),
    toolsCard(els, w, 5),
    subagentsCard(els, 4, now),
  ], capacity, handlers.scroll);
}

// ---------------------------------------------------------------- Git

function ago(g, now) {
  if (g.status === "loading" && !g.fetchedAt) return { text: "loading…", color: theme.muted };
  if (!g.fetchedAt) return { text: "", color: theme.muted };
  return { text: `${g.stale ? "⚠ " : ""}updated ${relTime(g.fetchedAt, now)}`, color: g.stale ? theme.amber : theme.muted };
}

// Where the branch stands against its remote: "↑2 ↓1", or "local" (with its
// commits past main, "↑3 local") when it has no remote branch yet. Then the
// working tree: "● 23 changed" or "clean".
function syncPieces(l) {
  if (!l) return [];
  const sync = l.upstream
    ? [
      { text: `↑${l.ahead}`, color: l.ahead ? theme.sky : theme.muted, bold: l.ahead > 0 },
      { text: " " },
      { text: `↓${l.behind}`, color: l.behind ? theme.amber : theme.muted, bold: l.behind > 0 },
    ]
    : [{ text: l.unpushed ? `↑${l.unpushed} local` : "local", color: l.unpushed ? theme.amber : theme.muted }];
  const tree = l.changed
    ? { text: `● ${l.changed} changed`, color: theme.amber }
    : { text: "clean", color: theme.muted };
  return { sync, tree };
}

function checksPieces(c) {
  if (!c.total) return [{ text: "no checks", color: theme.muted }];
  return [
    { text: `✓ ${c.pass}`, color: c.pass ? theme.online : theme.muted },
    { text: `  ● ${c.pending}${c.pending ? " running" : ""}`, color: c.pending ? theme.amber : theme.muted },
    { text: `  ✗ ${c.fail}`, color: c.fail ? theme.error : theme.muted },
  ];
}

function mergePiece(pr) {
  if (pr.state === "MERGED") return { text: "merged ✓", color: theme.agents };
  if (pr.state === "CLOSED") return { text: "closed", color: theme.muted };
  if (pr.mergeable === "CONFLICTING" || pr.mergeState === "DIRTY") return { text: "conflict ✗", color: theme.error };
  if (pr.mergeState === "BEHIND") return { text: "behind base", color: theme.amber };
  if (pr.mergeState === "BLOCKED") return { text: "blocked", color: theme.amber };
  if (pr.mergeState === "CLEAN" || pr.mergeable === "MERGEABLE") return { text: "mergeable ✓", color: theme.online };
  return { text: "merge ?", color: theme.muted };
}

function prState(pr) {
  if (pr.state === "MERGED") return { text: "merged", color: theme.agents };
  if (pr.state === "CLOSED") return { text: "closed", color: theme.muted };
  if (pr.draft) return { text: "draft", color: theme.muted };
  return { text: "open", color: theme.git };
}

// The short status a PR row ends in, most urgent first.
function prPill(pr, g) {
  if (g.reviewMe.includes(pr.number)) return { text: "● you", color: theme.amber };
  if (pr.checks.fail) return { text: "✗ CI", color: theme.error };
  if (pr.decision === "CHANGES_REQUESTED") return { text: "● changes", color: theme.amber };
  if (pr.checks.pending) return { text: "● CI", color: theme.amber };
  if (pr.draft) return { text: "draft", color: theme.muted };
  if (pr.decision === "APPROVED") return { text: "✓ approved", color: theme.online };
  if (pr.checks.total) return { text: "✓ CI", color: theme.online };
  return { text: "", color: theme.muted };
}

function repoCard(els, handlers, now) {
  const g = state.git;
  const l = g.local;
  const rows = [];
  if (l) {
    const { sync, tree } = syncPieces(l);
    rows.push(line(els, "branch", [
      { text: `⎇ ${l.branch ?? "?"}`, bold: true, color: theme.git },
      { text: "  " },
      ...sync,
      { text: "  " },
      { ...tree, grow: true },
      { node: els.Button({ key: "refresh", plain: true, dimColor: true, label: "↻", onPress: () => handlers.onRefresh?.() }) },
    ]));
  }
  const help = ghStatusText(g);
  if (help) rows.push(els.Text({ key: "help", color: theme.warn, wrap: "wrap", children: help }));
  else if (g.error && (g.stale || !g.fetchedAt || g.error === "no GitHub remote")) rows.push(muted(els, "err", g.error === "no GitHub remote" ? "No GitHub remote: only the local branch shows here." : `⚠ ${g.error}`));
  if (!rows.length) rows.push(muted(els, "wait", "Reading the repository…"));
  const when = ago(g, now);
  const helpRows = help ? Math.ceil(cells(help) / 44) : 0;
  return sized("Repo", card(els, { key: "repo", title: g.repo?.name || "REPOSITORY", color: theme.git, meta: when.text, metaColor: when.color, rows }), rows.length + Math.max(0, helpRows - 1));
}

function branchCard(els, handlers) {
  const g = state.git;
  if (g.status !== "ok" || !g.repo) return null;
  const pr = g.pr;
  if (!pr) {
    return sized("This branch", card(els, { key: "branch", title: "THIS BRANCH", color: theme.git, meta: "no pull request", rows: [
      muted(els, "none", g.local?.ahead ? "Pushed commits, no PR yet. Open one with gh pr create." : "No pull request for this branch."),
    ] }), 1);
  }
  const st = prState(pr);
  const reviewers = [
    ...pr.reviews.map((r) => ({ text: `${r.state === "APPROVED" ? "✓" : r.state === "CHANGES_REQUESTED" ? "✗" : "●"} ${r.login}`, color: r.state === "APPROVED" ? theme.online : r.state === "CHANGES_REQUESTED" ? theme.error : theme.muted })),
    ...pr.requested.filter((x) => !pr.reviews.some((r) => r.login === x)).map((x) => ({ text: `● ${x}`, color: theme.amber })),
  ];
  const rows = [
    line(els, "title", [{ text: pr.title, grow: true, bold: true }]),
    line(els, "checks", [...checksPieces(pr.checks), { text: "", grow: true }, mergePiece(pr)]),
    line(els, "reviews", [
      { text: "reviews ", color: theme.muted },
      ...(reviewers.length ? reviewers.flatMap((r, i) => [i ? { text: "  " } : null, r]) : [{ text: pr.decision === "REVIEW_REQUIRED" ? "needed, none asked yet" : "none", color: theme.muted }]),
    ]),
    els.Box({ key: "actions", flexDirection: "row", gap: 2, children: [
      els.Button({ key: "copy-pr", label: "Copy link", onPress: () => handlers.onCopy?.(pr.url) }),
    ] }),
  ];
  return sized("This branch", card(els, { key: "branch", title: "THIS BRANCH", color: theme.git, meta: `PR #${pr.number} · ${st.text}`, metaColor: st.color, rows }), rows.length);
}

function prsCard(els, handlers, max, now) {
  const g = state.git;
  if (g.status !== "ok" || !g.repo) return null;
  const list = g.prs.filter((p) => p.number !== g.pr?.number)
    .sort((a, b) => Number(g.reviewMe.includes(b.number)) - Number(g.reviewMe.includes(a.number)) || b.updatedAt - a.updatedAt);
  const rows = list.slice(0, max).map((p) => {
    const pill = prPill(p, g);
    return line(els, `pr-${p.number}`, [
      { text: `#${p.number}`, width: 6, color: theme.muted },
      { text: p.title, grow: true },
      { text: clip(pill.text, 10), width: 11, right: true, color: pill.color },
      { text: clip(age(p.updatedAt, now), 4), width: 5, right: true, color: theme.muted },
      { text: " " },
      copyButton(els, "copy", p.url, handlers),
    ]);
  });
  if (list.length > max) rows.push(muted(els, "more", `+${list.length - max} more`));
  if (!rows.length) rows.push(muted(els, "none", "No other open pull requests."));
  const meta = `${g.prs.length} open${g.reviewMe.length ? ` · ${g.reviewMe.length} for you` : ""}`;
  return sized("Pull requests", card(els, { key: "prs", title: "PULL REQUESTS", color: theme.git, meta, metaColor: g.reviewMe.length ? theme.amber : theme.muted, rows }), rows.length);
}

function runGlyph(r, now) {
  if (r.status !== "completed") return { g: spin(now), color: theme.amber };
  if (r.conclusion === "success") return { g: "✓", color: theme.online };
  if (r.conclusion === "failure" || r.conclusion === "timed_out" || r.conclusion === "startup_failure") return { g: "✗", color: theme.error };
  return { g: "⊘", color: theme.muted };
}

function runsCard(els, handlers, max, now) {
  const g = state.git;
  if (g.status !== "ok" || !g.repo) return null;
  const rows = g.runs.slice(0, max).map((r) => {
    const st = runGlyph(r, now);
    const when = r.status === "completed" ? age(r.updatedAt, now) : `${r.status === "queued" ? "queued" : "running"} ${fmtDur(now - r.startedAt)}`;
    return line(els, `run-${r.id}`, [
      { text: `${st.g} `, color: st.color },
      { text: clip(r.name, 12), width: 13, bold: true },
      { text: r.branch, color: theme.muted, grow: true },
      { text: ` ${when} `, color: r.status === "completed" ? theme.muted : theme.amber },
      copyButton(els, "copy", r.url, handlers),
    ]);
  });
  if (!rows.length) rows.push(muted(els, "none", "No workflow runs."));
  const failing = g.runs.filter((r) => r.status === "completed" && runGlyph(r, now).g === "✗").length;
  const running = g.runs.filter((r) => r.status !== "completed").length;
  const meta = [running ? `${running} running` : null, failing ? `${failing} failed` : null].filter(Boolean).join(" · ");
  return sized("Actions", card(els, { key: "runs", title: "ACTIONS", color: theme.git, meta, metaColor: failing ? theme.error : running ? theme.amber : theme.muted, rows }), rows.length);
}

const SEVERITY = { critical: theme.error, high: theme.error, medium: theme.amber, moderate: theme.amber, low: theme.muted };

function issuesCard(els, handlers, max, now) {
  const g = state.git;
  if (g.status !== "ok" || !g.repo) return null;
  const rows = [];
  for (const i of g.issues.slice(0, max)) {
    rows.push(line(els, `is-${i.number}`, [
      { text: `#${i.number}`, width: 6, color: theme.muted },
      { text: i.title, grow: true },
      i.labels[0] ? { text: ` ${clip(i.labels[0], 12)}`, color: theme.agents } : null,
      { text: clip(age(i.updatedAt, now), 4), width: 5, right: true, color: theme.muted },
      { text: " " },
      copyButton(els, "copy", i.url, handlers),
    ]));
  }
  for (const a of (g.alerts ?? []).slice(0, Math.max(1, max - rows.length))) {
    rows.push(line(els, `al-${a.number}`, [
      { text: "⚠ ", color: SEVERITY[a.severity] ?? theme.amber },
      { text: a.pkg, bold: true, grow: true },
      { text: ` ${a.severity} `, color: SEVERITY[a.severity] ?? theme.amber },
      copyButton(els, "copy", a.url, handlers),
    ]));
  }
  if (!rows.length) rows.push(muted(els, "none", "No issues assigned to you."));
  const nAlerts = g.alerts?.length ?? 0;
  const meta = `${g.issues.length} assigned${nAlerts ? ` · ${nAlerts} ⚠` : ""}`;
  return sized("Issues", card(els, { key: "issues", title: "ISSUES & ALERTS", color: theme.git, meta, metaColor: nAlerts ? theme.amber : theme.muted, rows }), rows.length);
}

function gitDock(els, w, capacity, handlers, now) {
  // The desktop: one header with the state as chips, the PR's numbers as
  // tiles, Actions with branch chips, and a graph of the newest commits.
  if (els.Svg) {
    return stackCards(els, [
      repoCardDesk(els, handlers, now),
      branchCardDesk(els, w, handlers),
      graphCard(els, now),
      prsCard(els, handlers, 4, now),
      runsCardDesk(els, handlers, 3, now),
      issuesCard(els, handlers, 3, now),
    ], capacity, handlers.scroll);
  }
  return stackCards(els, [
    repoCard(els, handlers, now),
    branchCard(els, handlers),
    prsCard(els, handlers, 4, now),
    runsCard(els, handlers, 3, now),
    issuesCard(els, handlers, 3, now),
  ], capacity, handlers.scroll);
}

// ---------------------------------------------------------------- Git on the desktop

// A word on a tinted ground, in its color: "18 changed", "PR #28 merged".
const chip = (els, key, text, color) => els.Text({ key, color, backgroundColor: K.tint(/^#/.test(color) ? color : "#8F8D87", 0.18), children: ` ${text} ` });

function repoCardDesk(els, handlers, now) {
  const g = state.git;
  const l = g.local;
  const when = ago(g, now);
  const rows = [];
  if (l) {
    const chips = [];
    if (l.upstream) chips.push(chip(els, "sync", `↑${l.ahead} ↓${l.behind}`, l.behind ? theme.amber : l.ahead ? theme.sky : theme.muted));
    else chips.push(chip(els, "sync", l.unpushed ? `↑${l.unpushed} local` : "local", l.unpushed ? theme.amber : theme.muted));
    chips.push(l.changed ? chip(els, "tree", `${l.changed} changed`, theme.amber) : chip(els, "tree", "clean", theme.muted));
    if (g.pr) { const st = prState(g.pr); chips.push(chip(els, "pr", `PR #${g.pr.number} ${st.text}`, st.color)); }
    rows.push(els.Box({ key: "chips", flexDirection: "row", flexWrap: "wrap", columnGap: 1, children: chips }));
  }
  const help = ghStatusText(g);
  if (help) rows.push(els.Text({ key: "help", color: theme.warn, wrap: "wrap", children: help }));
  else if (g.error && (g.stale || !g.fetchedAt || g.error === "no GitHub remote")) rows.push(muted(els, "err", g.error === "no GitHub remote" ? "No GitHub remote: only the local branch shows here." : `⚠ ${g.error}`));
  if (!rows.length) rows.push(muted(els, "wait", "Reading the repository…"));
  const metaNode = els.Box({ key: "meta", flexDirection: "row", columnGap: 1, flexShrink: 1, minWidth: 0, children: [
    els.Text({ key: "repo", color: g.stale ? theme.amber : theme.muted, wrap: "truncate-end", children: g.repo?.name || when.text }),
    els.Button({ key: "refresh", plain: true, dimColor: true, label: "↻", onPress: () => handlers.onRefresh?.() }),
  ] });
  return sized("Repo", card(els, { key: "repo", title: `⎇ ${l?.branch ?? "?"}`, color: theme.git, metaNode, rows }), rows.length);
}

function branchCardDesk(els, w, handlers) {
  const g = state.git;
  if (g.status !== "ok" || !g.repo) return null;
  const pr = g.pr;
  if (!pr) {
    return sized("This branch", card(els, { key: "branch", title: "PULL REQUEST", color: theme.git, meta: "none", rows: [
      muted(els, "none", g.local?.ahead ? "Pushed commits, no PR yet. Open one with gh pr create." : "No pull request for this branch."),
    ] }), 1);
  }
  const st = prState(pr);
  const c = pr.checks;
  const checkTile = !c.total ? { value: "–", sub: "checks", color: theme.muted }
    : c.fail ? { value: `${c.fail} ✗`, sub: "checks failed", color: theme.error }
      : c.pending ? { value: `${c.pending} ●`, sub: "checks running", color: theme.amber }
        : { value: `${c.pass} ✓`, sub: "checks", color: theme.online };
  const approved = pr.reviews.filter((r) => r.state === "APPROVED").length;
  const changes = pr.reviews.filter((r) => r.state === "CHANGES_REQUESTED").length;
  const reviewTile = changes ? { value: `${changes} ✗`, sub: "changes asked", color: theme.error }
    : approved ? { value: `${approved} ✓`, sub: "approved", color: theme.online }
      : pr.requested.length ? { value: String(pr.requested.length), sub: "reviews asked", color: theme.amber }
        : { value: "0", sub: "reviews", color: undefined };
  const merge = mergePiece(pr);
  const rows = [
    line(els, "title", [{ text: `#${pr.number} `, color: theme.muted }, { text: pr.title, grow: true, bold: true }]),
    tiles(els, [checkTile, reviewTile, { value: pr.state === "OPEN" ? merge.text : st.text, sub: "state", color: pr.state === "OPEN" ? merge.color : st.color }], w),
  ];
  const metaNode = pr.url ? openLink(els, pr.url) : undefined;
  return sized("This branch", card(els, { key: "branch", title: "PULL REQUEST", color: theme.git, metaNode, rows }), 3);
}

function runsCardDesk(els, handlers, max, now) {
  const g = state.git;
  if (g.status !== "ok" || !g.repo) return null;
  const rows = g.runs.slice(0, max).map((r) => {
    const st = runGlyph(r, now);
    const when = r.status === "completed" ? age(r.updatedAt, now) : `${r.status === "queued" ? "queued" : "running"} ${fmtDur(now - r.startedAt)}`;
    return els.Box({ key: `run-${r.id}`, flexDirection: "row", alignItems: "center", columnGap: 1, children: [
      els.Text({ key: "dot", color: st.color, children: st.g === "✓" ? "●" : st.g }),
      els.Text({ key: "n", bold: true, wrap: "truncate-end", children: r.name }),
      els.Box({ key: "push", flexGrow: 1, minWidth: 1 }),
      r.branch ? chip(els, "br", r.branch, theme.muted) : null,
      els.Text({ key: "t", color: r.status === "completed" ? theme.muted : theme.amber, children: when }),
      r.url ? openLink(els, r.url) : null,
    ].filter(Boolean) });
  });
  if (!rows.length) rows.push(muted(els, "none", "No workflow runs."));
  const failing = g.runs.filter((r) => r.status === "completed" && runGlyph(r, now).g === "✗").length;
  const running = g.runs.filter((r) => r.status !== "completed").length;
  const meta = [running ? `${running} running` : null, failing ? `${failing} failed` : null].filter(Boolean).join(" · ") || (g.runs.length ? "all green" : "");
  return sized("Actions", card(els, { key: "runs", title: "ACTIONS", color: theme.git, meta, metaColor: failing ? theme.error : running ? theme.amber : theme.muted, rows }), rows.length);
}

// The newest commits of every branch as Fork draws them: a colored lane per
// line of history, a dot per commit, its branches and remotes as tags, the
// subject and the time. One drawing, scaled to the card.
const LANE_COLORS = ["#E2B86B", "#E06C75", "#7FB6E2", "#6CC070", "#C8A2E0", "#6FC2B5"];
// About how wide a text is in the graph's 11.5 px system font: the drawing
// can't measure, and one width for every letter leaves tags too long.
export function textW(str) {
  let w = 0;
  for (const ch of String(str)) {
    if (/[ilj.,:;'|!/ ]/.test(ch)) w += 3.1;
    else if (/[ftr\-()]/.test(ch)) w += 4.1;
    else if (/[mwMW]/.test(ch)) w += 9.2;
    else if (/[A-Z]/.test(ch)) w += 7.4;
    else if (/[0-9]/.test(ch)) w += 6.6;
    else if (cells(ch) === 2) w += 11.5;
    else w += 6.3;
  }
  return w;
}
// Cut to `px` wide, with "…" when anything was cut.
function clipW(str, px) {
  if (textW(str) <= px) return str;
  let out = "";
  for (const ch of String(str)) {
    if (textW(out + ch) > px - 8) break;
    out += ch;
  }
  return `${out}…`;
}
function commitTime(ms, now) {
  const d = new Date(ms);
  const n = new Date(now);
  if (d.toDateString() === n.toDateString()) {
    const h = d.getHours();
    return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
  }
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
function graphCard(els, now) {
  const log = state.git.log ?? [];
  if (!log.length) return null;
  const W = 440;
  const ROW = 22;
  const LANE = 14;
  const lanes = Math.max(1, ...log.map((r) => Math.max(r.before.length, r.after.length, r.col + 1)));
  const x0 = 8;
  const textX = x0 + lanes * LANE + 6;
  const cx = (i) => x0 + i * LANE;
  const color = (i) => LANE_COLORS[i % LANE_COLORS.length];
  const edges = [];
  const dots = [];
  const texts = [];
  log.forEach((r, i) => {
    const top = i * ROW;
    const mid = top + ROW / 2;
    const bottom = top + ROW;
    const curve = (xa, ya, xb, yb, c) => edges.push(`<path d="M${xa} ${ya} C${xa} ${(ya + yb) / 2} ${xb} ${(ya + yb) / 2} ${xb} ${yb}" stroke="${c}"/>`);
    r.before.forEach((h, j) => {
      if (h == null) return;
      if (h === r.hash) curve(cx(j), top, cx(r.col), mid, color(j));
      else { const k = r.after.indexOf(h); if (k >= 0) curve(cx(j), top, cx(k), bottom, color(k)); }
    });
    if (i < log.length - 1 || r.parents.length) {
      r.parents.forEach((p) => { const k = r.after.indexOf(p); if (k >= 0) curve(cx(r.col), mid, cx(k), bottom, color(k)); });
    }
    dots.push(`<circle cx="${cx(r.col)}" cy="${mid}" r="4.5" fill="${color(r.col)}" stroke="#1f1f1e" stroke-width="1.5"/>`);
    let x = textX;
    for (const ref of r.refs.slice(0, 2)) {
      const label = `${ref === r.head ? "✓ " : ""}${clip(ref, 18)}`;
      // The text is held to the width the tag was given (textLength), so the
      // border fits it in whatever font the surface draws with.
      const tw = textW(label) * 1.04;
      const w = tw + 12;
      const c = ref === r.head ? theme.git : ref.includes("/") ? theme.amber : color(r.col);
      texts.push(`<rect x="${x}" y="${top + 3.5}" width="${w.toFixed(1)}" height="15" rx="3" fill="none" stroke="${c}"/><text x="${x + 6}" y="${top + 15}" fill="${c}" textLength="${tw.toFixed(1)}" lengthAdjust="spacingAndGlyphs">${xml(label)}</text>`);
      x += w + 5;
    }
    const time = commitTime(r.at, now);
    const room = W - 4 - textW(time) - 12 - x;
    texts.push(`<text x="${x}" y="${top + 15}" fill="${r.refs.includes(r.head) ? "#E8E6E1" : "#B9B6AE"}"${r.head ? ' font-weight="600"' : ""}>${xml(clipW(r.subject, Math.max(30, r.head ? room * 0.92 : room)))}</text>`);
    texts.push(`<text x="${W - 4}" y="${top + 15}" text-anchor="end" fill="#8F8D87">${xml(time)}</text>`);
  });
  const H = log.length * ROW;
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system, system-ui, sans-serif" font-size="11.5">`
    + `<defs><clipPath id="c"><rect width="${W}" height="${H}"/></clipPath></defs>`
    + `<g fill="none" stroke-width="2" clip-path="url(#c)">${edges.join("")}</g>${dots.join("")}${texts.join("")}</svg>`;
  const rows = [els.Svg({ key: "graph", source, alt: `the newest ${log.length} commits, as a graph` })];
  return sized("Graph", card(els, { key: "graph", title: "GRAPH", color: theme.git, meta: `last ${log.length} commits`, rows }), Math.ceil(H / 19));
}

// ---------------------------------------------------------------- Agents

function allSessions() {
  return orderSessions(state.self, state.sessions);
}

// Subagents of a session still at work.
const liveAgents = (s) => (s.agents ?? []).filter((a) => !isEnded(a.status)).length;
// A session is busy while its turn runs or any of its agents does: a turn
// can end with a background agent still at work.
const sessionBusy = (s) => (s.activity?.state && s.activity.state !== "idle") || liveAgents(s) > 0;

function activityPieces(s, now) {
  const a = s.activity ?? { state: "idle" };
  const live = liveAgents(s);
  const since = a.since ? now - a.since : 0;
  const tail = [s.cost != null ? fmtUsd(s.cost) : null, s.context != null ? `ctx ${Math.round(s.context)}%` : null].filter(Boolean).join(" · ");
  const head = a.state === "tool" ? { text: `running ${a.tool} · ${fmtDur(since)}`, color: theme.agents }
    : a.state === "thinking" ? { text: `thinking · ${fmtDur(since)}`, color: theme.agents }
      : live ? { text: `waiting on ${live} agent${live === 1 ? "" : "s"}`, color: theme.agents }
        : { text: `idle${a.since ? ` ${age(a.since, now)}` : ""}`, color: theme.muted };
  return [{ text: "  " }, head, tail ? { text: ` · ${tail}`, color: theme.muted, grow: true } : { text: "", grow: true }];
}

function sessionRows(els, s, handlers, now, maxAgents) {
  const here = s.id === state.sessionId;
  const busy = sessionBusy(s);
  const color = nameColor(s.id);
  const folded = state.collapsed.has(s.id);
  const agents = s.agents ?? [];
  const live = agents.filter((a) => !isEnded(a.status)).length;
  const rows = [line(els, `s-${s.id}`, [
    { text: `${busy ? "●" : "○"} `, color: busy ? color : theme.muted },
    { text: s.project, bold: true, color },
    here ? { text: " (here)", color: theme.muted } : null,
    { text: s.branch ? `  ${s.branch}` : "", color: theme.muted, grow: true },
    { text: ` ${shortModel(s.model)} `, color: theme.muted },
    agents.length
      ? { node: els.Button({ key: "fold", plain: true, dimColor: true, label: folded ? `▸${live || agents.length}` : "▾", onPress: () => handlers.onToggleSession?.(s.id) }) }
      : { text: " " },   // keeps the model column in line with rows that have the fold mark
  ]), line(els, `sa-${s.id}`, activityPieces(s, now))];
  if (!folded) {
    const shown = agents.slice(0, maxAgents);
    for (const a of shown) {
      const indent = `  ${"   ".repeat(a.depth ?? 0)}${a.last || a === shown.at(-1) ? "└─ " : "├─ "}`;
      rows.push(agentRow(els, `ag-${s.id}-${a.id}`, a, { indent, now }));
    }
    if (agents.length > maxAgents) rows.push(muted(els, `agm-${s.id}`, `     +${agents.length - maxAgents} more`));
  }
  return rows;
}

function sessionsCard(els, handlers, maxRows, now) {
  const list = allSessions();
  const rows = [];
  for (const s of list) {
    const next = sessionRows(els, s, handlers, now, s.id === state.sessionId ? 4 : 2);
    if (rows.length && rows.length + next.length > maxRows) {
      rows.push(muted(els, "more", `+${list.length - list.indexOf(s)} more sessions`));
      break;
    }
    rows.push(...next);
  }
  if (!rows.length) rows.push(muted(els, "none", "Starting…"));
  const meta = `${list.length} on this computer`;
  return sized("Sessions", card(els, { key: "sessions", title: "SESSIONS", color: theme.agents, meta, rows }), rows.length);
}

// What a session is doing, as a chip's words and color.
// One branch of a subagent tree, as tall as its row so the lines meet: the
// trunk down (all the way, or to the elbow on the last), and the elbow.
const TREE_ROW = 22;
function treeLimb(els, key, depth, last) {
  const w = 10 + depth * 14 + 12;
  const x = 5 + depth * 14;
  const trunks = Array.from({ length: depth }, (_, d) => `M${5 + d * 14} 0 V${TREE_ROW}`).join(" ");
  const d = `${trunks} M${x} 0 V${last ? TREE_ROW / 2 : TREE_ROW} M${x} ${TREE_ROW / 2} H${w}`;
  return els.Svg({ key, source: K.svg(w, TREE_ROW, `<path d="${d}" stroke="#5A5955" stroke-width="1.5" fill="none"/>`), alt: "", width: w, height: TREE_ROW });
}

// A running subagent's ring: a quarter arc that turns a step each second.
function agentRing(els, key, now) {
  const turn = (Math.floor(now / 1000) % 4) * 90;
  const body = `<circle cx="7" cy="7" r="5.5" stroke="rgba(127,127,127,0.3)" stroke-width="2" fill="none"/>`
    + `<path d="M7 1.5 A5.5 5.5 0 0 1 12.5 7" stroke="${theme.agents}" stroke-width="2" fill="none" stroke-linecap="round" transform="rotate(${turn} 7 7)"/>`;
  return els.Svg({ key, source: K.svg(14, 14, body), alt: "running", width: 14, height: 14 });
}

// A session at work on the desktop: a ring that spins by itself (CSS in the
// drawing, so the row isn't redrawn for it), in place of the dot.
function sessionSpinner(els, key, color) {
  const body = `<style>g{transform-origin:7px 7px;animation:s 1s linear infinite}@keyframes s{to{transform:rotate(360deg)}}</style>`
    + `<circle cx="7" cy="7" r="5" stroke="rgba(127,127,127,0.3)" stroke-width="2" fill="none"/>`
    + `<g><path d="M7 2 A5 5 0 0 1 12 7" stroke="${color}" stroke-width="2" fill="none" stroke-linecap="round"/></g>`;
  return els.Svg({ key, source: K.svg(14, 14, body), alt: "working", width: 14, height: 14 });
}

// What a session is doing, for its row on the desktop: the tool or the
// state in color, then how long, dim. Idle reads "idle 16m", dim.
function sessionDoing(s, now) {
  const a = s.activity ?? { state: "idle" };
  const live = liveAgents(s);
  const since = a.since ? fmtDur(now - a.since) : null;
  if (a.state === "tool") return { what: a.tool, color: theme.amber, time: since };
  if (a.state === "thinking") return { what: "thinking", color: theme.amber, time: since };
  if (live) return { what: `${live} agent${live === 1 ? "" : "s"}`, color: theme.agents, time: null };
  return { what: `idle${a.since ? ` ${age(a.since, now)}` : ""}`, color: theme.muted, time: null, idle: true };
}

function sessionBlockDesk(els, s, handlers, now, maxAgents) {
  const { Box, Text, Button } = els;
  const here = s.id === state.sessionId;
  const folded = state.collapsed.has(s.id);
  const agents = s.agents ?? [];
  const live = liveAgents(s);
  // One line, whatever the width: what it's doing keeps its size, and the
  // folder's name and then the branch give way (cut with "…").
  const doing = sessionDoing(s, now);
  const keep = (key, node) => Box({ key, flexShrink: 0, children: [node] });
  const give = (key, node, shrink = 1) => Box({ key, flexShrink: shrink, minWidth: 0, overflow: "hidden", children: [node] });
  const nodes = [Box({ key: `s-${s.id}`, flexDirection: "row", alignItems: "center", columnGap: 1, children: [
    keep("dot", sessionBusy(s) ? sessionSpinner(els, "spin", doing.color) : Text({ key: "t", color: theme.muted, children: "●" })),
    give("p", Text({ key: "t", bold: true, wrap: "truncate-end", children: s.project })),
    here ? keep("here", Text({ key: "t", color: theme.muted, children: "here" })) : null,
    keep("doing", Text({ key: "t", bold: !doing.idle, color: doing.color, children: doing.what })),
    doing.time ? keep("time", Text({ key: "t", color: theme.muted, children: doing.time })) : null,
    Box({ key: "push", flexGrow: 1, minWidth: 1 }),
    s.branch ? give("br", Text({ key: "t", color: theme.muted, wrap: "truncate-end", children: s.branch }), 2) : null,
    keep("m", Text({ key: "t", color: theme.muted, children: shortModel(s.model) })),
    agents.length ? Button({ key: "fold", plain: true, dimColor: true, label: folded ? `▸ ${live || agents.length}` : "▾", onPress: () => handlers.onToggleSession?.(s.id) }) : null,
  ].filter(Boolean) })];
  if (!folded) {
    const shown = agents.slice(0, maxAgents);
    shown.forEach((a, i) => {
      const last = i === shown.length - 1 && agents.length <= maxAgents;
      const ended = isEnded(a.status);
      const g = agentGlyph(a.status, now);
      const took = (a.endedAt ?? now) - a.startedAt;
      nodes.push(Box({ key: `ag-${s.id}-${a.id}`, flexDirection: "row", alignItems: "center", columnGap: 1, children: [
        treeLimb(els, "limb", a.depth ?? 0, last || a.last),
        ended ? Text({ key: "g", color: g.color, children: g.g }) : agentRing(els, "ring", now),
        Text({ key: "t", bold: !ended, children: a.type }),
        Text({ key: "d", color: theme.muted, wrap: "truncate-end", children: a.description ?? "" }),
        Box({ key: "push", flexGrow: 1, minWidth: 1 }),
        Text({ key: "took", color: ended ? theme.muted : theme.agents, children: fmtDur(took) }),
      ] }));
    });
    if (agents.length > maxAgents) nodes.push(muted(els, `agm-${s.id}`, `     +${agents.length - maxAgents} more`));
  }
  return nodes;
}

function sessionsCardDesk(els, handlers, now) {
  const list = allSessions();
  const rows = [];
  list.forEach((s, i) => {
    if (i) rows.push(sessionRule(els, `sep-${s.id}`));
    rows.push(...sessionBlockDesk(els, s, handlers, now, s.id === state.sessionId ? 6 : 3));
  });
  if (!rows.length) rows.push(muted(els, "none", "Starting…"));
  const busy = list.filter(sessionBusy).length;
  const meta = busy ? `${busy} working · ${list.length - busy} idle` : `${list.length} on this computer`;
  return sized("Sessions", card(els, { key: "sessions", title: "SESSIONS", color: theme.agents, meta, rows }), rows.length);
}

// A thin rule across the row, between sessions.
const sessionRule = (els, key) => els.Box({ key, flexDirection: "row", marginY: 0, children: [stretchBar(els, "l", 100, "#3A3936", { track: false })] });

const FILTERS = { all: "all", here: "here", errors: "errors" };

function feedRow(els, f, w, now) {
  const t = new Date(f.at);
  const clock = `${String(t.getHours()).padStart(2, "0")}:${String(t.getMinutes()).padStart(2, "0")}:${String(t.getSeconds()).padStart(2, "0")}`;
  const who = f.agent ? ` ↳ ${f.agent}` : f.session;
  const end = f.done ? (f.isError ? { text: " ✗", color: theme.error } : { text: " ✓", color: theme.online }) : { text: ` ${spin(now)}`, color: theme.agents };
  return line(els, `f-${f.sessionId}-${f.key}`, [
    w >= 46 ? { text: `${clock} `, color: theme.muted } : null,
    { text: clip(who, w >= 46 ? 11 : 9), width: w >= 46 ? 12 : 10, color: f.agent ? theme.muted : nameColor(f.sessionId) },
    { text: clip(f.tool, 6), width: 7, bold: true },
    { text: f.summary || "", color: theme.muted, grow: true },
    f.times > 1 ? { text: ` ×${f.times}`, color: theme.agents } : null,
    { text: ` ${f.done ? fmtDur(f.ms) : fmtDur(now - f.at)}`, color: f.done ? theme.muted : theme.agents },
    end,
  ]);
}

function feedCard(els, w, rowsLeft, handlers, now) {
  const rows = mergedFeed(allSessions(), { filter: state.feedFilter, ownId: state.sessionId, limit: Math.max(1, rowsLeft) })
    .map((f) => feedRow(els, f, w, now));
  if (!rows.length) rows.push(muted(els, "none", state.feedFilter === "errors" ? "No failed tool calls." : "Tool calls show up here as they run."));
  const metaNode = els.Button({ key: "filter", plain: true, dimColor: true, label: `${FILTERS[state.feedFilter]} ▾`, onPress: () => handlers.onCycleFilter?.() });
  // The terminal's feed fills the pane's spare rows; the desktop's pane
  // scrolls, so there the card ends with its last call.
  return { name: "Live", node: card(els, { key: "feed", title: "LIVE", color: theme.agents, metaNode, rows, grow: !els.Svg }), height: 3 + Math.min(rows.length, 1) };
}

function agentsDock(els, w, capacity, handlers, now) {
  // The desktop: sessions with their subagent trees drawn in lines, and the
  // live feed held to its newest 30 calls (the pane scrolls, nothing windows it).
  if (els.Svg) return stackCards(els, [sessionsCardDesk(els, handlers, now), feedCard(els, w, 30, handlers, now)], capacity, handlers.scroll);
  const sessions = sessionsCard(els, handlers, Math.max(3, Math.floor((capacity - 4) * 0.55)), now);
  const left = capacity - sessions.height - CARD_GAP - 3;
  return stackCards(els, [sessions, feedCard(els, w, left, handlers, now)], capacity, handlers.scroll);
}

// ---------------------------------------------------------------- entry points

// The docked pane's body for a built-in room: cards within `capacity` rows.
export function sysDock(els, view, width, capacity, handlers, now = Date.now()) {
  const w = Math.max(20, width - 4);   // inside a card's border and padding
  if (!SYS[view]) return fnDock(els, view, w, capacity, handlers);
  if (OWN[view]) return OWN[view].dock(els, w, capacity, handlers, now);
  if (view === "usage") return usageDock(els, w, capacity, handlers, now);
  if (view === "git") return gitDock(els, w, capacity, handlers, now);
  return agentsDock(els, w, capacity, handlers, now);
}

// The inline pane: a few lines, no cards.
export function sysInline(els, view, width, handlers, now = Date.now()) {
  const { Text } = els;
  const w = Math.max(20, width);
  if (!SYS[view]) return fnInline(els, view, w, handlers);
  if (OWN[view]) return OWN[view].inline(els, w, handlers, now);
  const meta = SYS[view];
  const head = (text, right) => line(els, "head", [
    { text: `${meta.icon} ${meta.label}`, bold: true, color: meta.color },
    { text: text ? `  ${text}` : "", color: theme.muted, grow: true },
    right ? { text: right, color: theme.muted } : null,
  ]);
  if (view === "usage") {
    const u = state.usage;
    const parts = [head([shortModel(u.model), u.startedAt ? fmtSpan(now - u.startedAt) : null].filter(Boolean).join(" · "))];
    if (!u.measured) return [...parts, muted(els, "wait", "Waiting for the first reply from Claude…")];
    const c = u.context ?? {};
    parts.push(meter(els, { key: "ctx", label: "Context", pct: c.percent, width: w, right: c.tokens != null ? `${fmtTokens(c.tokens)}/${fmtTokens(c.window)}` : c.window ? `${fmtTokens(c.window)} window` : "" }));
    for (const l of limitWindows(u).slice(0, 2)) parts.push(limitMeter(els, l, w));
    const cache = cacheRatio(u);
    const running = agentCounts(u).running;
    parts.push(line(els, "spend", [
      { text: "Spend", width: LABEL_W, color: theme.muted },
      { text: u.cost ? fmtUsd(u.cost.usd) : "–", bold: true, color: theme.usage },
      { text: "  ·  ", color: theme.muted },
      { text: fmtTokens(totalTokens(u)), bold: true },
      { text: " tokens  ·  ", color: theme.muted },
      { text: cache == null ? "–" : `${Math.round(cache)}%`, bold: true, color: cache == null ? theme.muted : cache >= 60 ? theme.online : cache >= 30 ? theme.amber : theme.error },
      { text: " cache hits", color: theme.muted },
      running ? { text: `  ·  ⟡ ${running} running`, color: theme.agents } : null,
    ]));
    return parts;
  }
  if (view === "git") {
    const g = state.git;
    const l = g.local;
    const parts = [head("", ago(g, now).text)];
    if (l) {
      const { sync, tree } = syncPieces(l);
      parts.push(line(els, "branch", [{ text: `⎇ ${l.branch ?? "?"}`, bold: true, color: theme.git }, { text: "  " }, ...sync, { text: "  " }, { ...tree, grow: true }]));
    }
    const help = ghStatusText(g);
    if (help) return [...parts, Text({ key: "help", color: theme.warn, wrap: "wrap", children: help })];
    if (g.pr) {
      const c = g.pr.checks;
      parts.push(line(els, "pr", [{ text: `#${g.pr.number} `, color: theme.git, bold: true }, { text: g.pr.title, grow: true }, { text: ` ✓${c.pass} ●${c.pending} ✗${c.fail}`, color: c.fail ? theme.error : c.pending ? theme.amber : theme.online }]));
    }
    for (const p of g.prs.filter((p) => p.number !== g.pr?.number).slice(0, 3)) {
      const pill = prPill(p, g);
      parts.push(line(els, `pr-${p.number}`, [{ text: `#${p.number}`, width: 6, color: theme.muted }, { text: p.title, grow: true }, { text: ` ${pill.text}`, color: pill.color }]));
    }
    return parts;
  }
  const list = allSessions();
  const parts = [head(`${list.length} session${list.length === 1 ? "" : "s"}`)];
  for (const s of list.slice(0, 4)) {
    const live = (s.agents ?? []).filter((a) => !isEnded(a.status)).length;
    parts.push(line(els, `s-${s.id}`, [
      { text: `${sessionBusy(s) ? "●" : "○"} `, color: sessionBusy(s) ? nameColor(s.id) : theme.muted },
      { text: clip(s.project, 14), width: 15, bold: true, color: nameColor(s.id) },
      ...activityPieces(s, now).slice(1),
      live ? { text: ` ⟡${live}`, color: theme.agents } : null,
    ]));
  }
  return parts;
}

// How full the context is, as weather (from token-weather, the
// claude-code-playground mod): single-width symbols that line up in any font.
const FORECAST = [
  { upTo: 25, icon: "☀", word: "Clear", color: theme.amber },
  { upTo: 50, icon: "☁", word: "Cloudy", color: theme.usage },
  { upTo: 75, icon: "☂", word: "Showers", color: "#6FC2B5" },
  { upTo: 90, icon: "☇", word: "Storm", color: theme.agents },
  { upTo: Infinity, icon: "↯", word: "Compact soon", color: theme.error },
];
export function forecast(pct) {
  return FORECAST.find((f) => pct < f.upTo) ?? FORECAST.at(-1);
}

// The band's line for a built-in room, as colored pieces, fitted to `width`
// cells. For Usage: "☂ Showers 67% 134k/200k ▁▂▅█ ▲+98k · 5-hour 12% ·
// spent $1.21": the context as a forecast once measured, the 5-hour window,
// and the spend once there is some.
export function sysBandPieces(view, width = 0) {
  if (!SYS[view]) return fnBandPieces(view, width);
  if (OWN[view]) return OWN[view].band(width);
  const sep = { text: " · ", color: theme.muted };
  const join = (list) => list.filter(Boolean).flatMap((p, i) => (i ? [sep, ...p] : p));
  const figure = (label, pct) => [{ text: `${label} `, color: theme.muted }, { text: `${Math.round(pct)}%`, color: level(pct), bold: true }];
  if (view === "usage") {
    const u = state.usage;
    const c = u.context;
    // The forecast, then the 5-hour window and the spend. On a narrow band
    // the turn's delta goes first, then the chart, then the token count.
    const weather = (detail) => {
      if (c?.percent == null) return null;
      const f = forecast(c.percent);
      const hist = u.ctxHistory;
      const delta = hist.length >= 2 ? hist.at(-1) - hist.at(-2) : 0;
      return [
        { text: `${f.icon} ${f.word} `, color: f.color, bold: true },
        { text: `${Math.round(c.percent)}%`, color: f.color, bold: true },
        detail >= 1 && c.tokens != null ? { text: ` ${fmtTokens(c.tokens)}/${fmtTokens(c.window)}`, color: theme.muted } : null,
        detail >= 2 && hist.length >= 2 ? { text: ` ${sparkline(hist, 12)}`, color: f.color } : null,
        detail >= 3 && delta ? { text: delta > 0 ? ` ▲+${fmtTokens(delta)}` : ` ▼${fmtTokens(-delta)}`, color: theme.muted } : null,
      ].filter(Boolean);
    };
    const five = limitWindows(u).find((l) => l.kind === "five_hour");
    const tail = [
      five ? (five.percentUsed == null
        ? [{ text: "5-hour ", color: theme.muted }, { text: "–", color: theme.muted }]
        : figure("5-hour", five.percentUsed)) : null,
      u.cost?.usd > 0 ? [{ text: "spent ", color: theme.muted }, { text: fmtUsd(u.cost.usd), color: theme.usage, bold: true }] : null,
    ];
    let pieces = [];
    for (let detail = 3; detail >= 0; detail--) {
      pieces = join([weather(detail), ...tail]);
      if (!width || cells(pieces.map((p) => p.text).join("")) <= width) break;
    }
    return pieces.length ? pieces : [{ text: "waiting for the first reply", color: theme.muted }];
  }
  if (view === "git") {
    const g = state.git;
    if (g.status === "no-repo") return [{ text: "not a git repository", color: theme.warn }];
    const pr = g.pr;
    // git works without gh: the branch shows either way.
    return join([
      g.local?.branch ? [{ text: g.local.branch, color: theme.git, bold: true }] : null,
      g.local ? syncPieces(g.local).sync : null,
      g.local ? [syncPieces(g.local).tree] : null,
      ghStatusText(g) ? [{ text: "gh isn't set up", color: theme.warn }] : null,
      pr ? [{ text: `#${pr.number} `, color: theme.muted }, ...checksPieces(pr.checks).map((p) => ({ ...p, text: p.text.replace(" running", "") }))] : null,
      g.reviewMe.length ? [{ text: `${g.reviewMe.length} review${g.reviewMe.length === 1 ? "" : "s"} for you`, color: theme.amber }] : null,
    ]);
  }
  const list = allSessions();
  const running = list.reduce((n, s) => n + (s.agents ?? []).filter((a) => !isEnded(a.status)).length, 0);
  return join([
    [{ text: `${list.length} session${list.length === 1 ? "" : "s"}`, color: theme.muted }],
    [{ text: `${running} agent${running === 1 ? "" : "s"} running`, color: running ? theme.agents : theme.muted }],
  ]);
}

// ---------------------------------------------------------------- the desktop band

function gitSections() {
  const g = state.git;
  if (g.status === "no-repo") return [{ key: "none", color: theme.warn, parts: [pSub("not a git repository")] }];
  const l = g.local;
  const out = [];
  if (l?.branch) {
    out.push({ key: "branch", color: theme.git, parts: [draw(K.icon("branch", theme.git), "Branch"), pValue(l.branch)],
      tip: [`⎇ ${l.branch}`, g.repo?.name ? `in ${g.repo.name}` : null, l.upstream ? `tracks ${l.upstream}` : "not pushed yet"] });
    const ahead = l.upstream ? l.ahead : l.unpushed ?? 0;
    out.push({ key: "sync", color: ahead ? theme.sky : theme.git, parts: l.upstream
      ? (l.ahead || l.behind
        ? [pValue(`↑${l.ahead}`, l.ahead ? theme.sky : theme.muted), pValue(`↓${l.behind}`, l.behind ? theme.amber : theme.muted)]
        : [pSub("in sync")])
      : [pSub(l.unpushed ? `↑${l.unpushed} local` : "local")],
      tip: l.upstream ? [`${l.ahead} to push · ${l.behind} to pull`] : ["No upstream: push to share this branch"] });
    const dot = (c) => draw({ source: K.svg(10, 10, `<circle cx="5" cy="5" r="4" fill="${c}"/>`), width: 10, height: 10 }, "Working tree");
    out.push(l.changed
      ? { key: "tree", color: theme.amber, parts: [dot(theme.amber), pValue(String(l.changed)), pSub("changed")], tip: [`${l.changed} file${l.changed === 1 ? "" : "s"} changed, not committed`] }
      : { key: "tree", color: theme.online, parts: [dot(theme.online), pSub("clean")] });
  }
  if (ghStatusText(g)) out.push({ key: "gh", color: theme.warn, parts: [pSub("gh isn't set up")], tip: [ghStatusText(g)] });
  const pr = g.pr;
  if (pr) {
    const c = pr.checks;
    const color = c.fail ? theme.error : c.pending ? theme.amber : c.total ? theme.online : theme.git;
    const word = !c.total ? [pSub("no checks")]
      : c.fail ? [pValue(`${c.fail} failing`, theme.error)]
        : c.pending ? [pValue(`${c.pending} running`, theme.amber)]
          : [pValue(`${c.pass}/${c.total}`, theme.online), pSub("checks")];
    out.push({ key: "pr", color, parts: [
      draw(K.icon("pr", theme.git), "Pull request"),
      pLabel(`#${pr.number}`),
      c.total ? draw(K.segments([{ n: c.pass, color: theme.online }, { n: c.pending, color: theme.amber }, { n: c.fail, color: theme.error }]), `checks: ${c.pass} passed, ${c.pending} running, ${c.fail} failed`) : null,
      ...word,
    ], tip: [`#${pr.number} ${pr.title}`, `${prState(pr).text} · ${mergePiece(pr).text}`, `checks ✓${c.pass} ●${c.pending} ✗${c.fail}`] });
  }
  if (g.reviewMe.length) out.push({ key: "review", color: theme.amber, parts: [pValue(String(g.reviewMe.length), theme.amber), pSub(`review${g.reviewMe.length === 1 ? "" : "s"} for you`)],
    tip: g.reviewMe.slice(0, 5).map((n) => `#${n}`) });
  return out;
}

function agentSections(now) {
  const list = allSessions();
  const agents = list.flatMap((s) => s.agents ?? []);
  const running = agents.filter((a) => !isEnded(a.status)).length;
  const out = [{
    key: "sessions",
    color: theme.agents,
    parts: [draw(K.dots(list.map((s) => (sessionBusy(s) ? "live" : "idle")), theme.agents), "Sessions, busy ones breathing"), pValue(String(list.length)), pSub(`session${list.length === 1 ? "" : "s"}`)],
    tip: [`${list.length} Claude session${list.length === 1 ? "" : "s"} here`, ...list.slice(0, 5).map((s) => `${sessionBusy(s) ? "●" : "○"} ${s.project}${s.branch ? ` (${s.branch})` : ""} · ${s.activity?.state ?? "idle"}`)],
  }];
  if (agents.length) {
    const marks = agents.map((a) => (!isEnded(a.status) ? "live" : a.status === "completed" ? "done" : "failed"));
    out.push({ key: "agents", color: theme.agents, parts: [draw(K.dots(marks, theme.agents), `${running} running`), pValue(String(running)), pSub("running")],
      tip: [`${running} running · ${agents.length - running} done`, ...agents.slice(-5).map((a) => `${isEnded(a.status) ? (a.status === "completed" ? "✓" : "✗") : "◐"} ${a.type}: ${clip(a.description ?? "", 40)}`)] });
  } else out.push({ key: "agents", color: theme.muted, parts: [pSub("no agents running")] });
  const busy = list.find(sessionBusy);
  if (busy) {
    const a = busy.activity ?? {};
    const what = a.state === "tool" ? `${a.tool} · ${fmtDur(a.since ? now - a.since : 0)}` : a.state === "thinking" ? "thinking" : "waiting on agents";
    out.push({ key: "busy", color: nameColor(busy.id), parts: [pValue(busy.project, nameColor(busy.id)), pSub(what)],
      tip: [busy.project, busy.branch ? `⎇ ${busy.branch}` : null, shortModel(busy.model)] });
  }
  return out;
}

// Git and Agents on the desktop, as a capsule.
export function sysBandDesktop(view, els, { onOpen, onCycle, columns = 0 }, now = Date.now()) {
  const meta = SYS[view];
  if (OWN[view]) {
    const { color, sections } = OWN[view].desk(now);
    return capsule(els, { room: `${meta.icon} ${meta.label}`, color, sections, onOpen, onCycle, columns });
  }
  if (!meta || view === "usage") return null;
  const sections = view === "git" ? gitSections() : agentSections(now);
  return capsule(els, { room: `${meta.icon} ${meta.label}`, color: meta.color, sections, onOpen, onCycle, columns });
}

// The same as plain text.
export function sysBandText(view) {
  return sysBandPieces(view).map((p) => p.text).join("");
}

// A tab's badge: what's worth a glance from another room.
export function sysBadge(view) {
  if (OWN[view]) return OWN[view].badge?.() ?? null;
  if (view === "git" && gitAttention(state.git)) return { text: "●", color: theme.error };
  if (view === "agents") {
    const n = allSessions().reduce((k, s) => k + (s.agents ?? []).filter((a) => !isEnded(a.status)).length, 0);
    if (n) return { text: String(n), color: theme.agents };
  }
  if (view === "usage" && (state.usage.context?.percent ?? 0) >= 80) return { text: `${Math.round(state.usage.context.percent)}%`, color: level(state.usage.context.percent) };
  return null;
}

// ---------------------------------------------------------------- snapshots

// The fill heavy and the track thin, so a card colors one and dims the other.
const textBar = (pct, width) => {
  const { fill, track } = bar(pct, width);
  return fill + "─".repeat(track.length);
};

// A built-in room as plain text, for a snippet card in a chat room.
export function snapshotText(view, now = Date.now()) {
  if (!SYS[view]) return fnSnapshot(view);
  if (OWN[view]) return OWN[view].snapshot?.(now) ?? "";
  // A card: its title, then a label and its figures on each line.
  const W = 20;
  const row = (label, text) => `${fit(clip(label, LABEL_W - 2), LABEL_W)}${text}`;
  const out = [];
  if (view === "usage") {
    const u = state.usage;
    out.push(`Usage · ${[shortModel(u.model), u.startedAt ? fmtSpan(now - u.startedAt) : null].filter(Boolean).join(" · ")}`);
    if (u.context) out.push(row("Context", `${textBar(u.context.percent ?? 0, W)} ${fit(`${Math.round(u.context.percent ?? 0)}%`, 4, { right: true })}  ${fmtTokens(u.context.tokens)}/${fmtTokens(u.context.window)}`));
    for (const l of limitWindows(u)) {
      out.push(row(limitName(l.kind), `${textBar(l.percentUsed ?? 0, W)} ${fit(l.percentUsed == null ? "–" : `${Math.round(l.percentUsed)}%`, 4, { right: true })}${l.resetsAt ? `  ↻ ${resetLabel(l.resetsAt)}` : ""}`));
    }
    const cache = cacheRatio(u);
    const rate = burnRate(u, now);
    out.push(row("Spend", `${u.cost ? fmtUsd(u.cost.usd) : "–"}${rate != null ? ` (+${fmtUsd(rate)}/h)` : ""}`));
    out.push(row("Tokens", `${fmtTokens(totalTokens(u))}${cache == null ? "" : ` · ${Math.round(cache)}% cache hits`}`));
    const { running, done } = agentCounts(u);
    if (running || done) out.push(row("Agents", `${running} running · ${done} done`));
  } else if (view === "git") {
    const g = state.git;
    const l = g.local;
    const st = l ? syncPieces(l) : null;
    out.push(`${g.repo?.name || "repository"}${l ? ` · ⎇ ${l.branch} ${st.sync.map((p) => p.text).join("")} · ${st.tree.text}` : ""}`);
    if (g.pr) {
      const c = g.pr.checks;
      out.push(row("PR", `#${g.pr.number} ${prState(g.pr).text} · ${mergePiece(g.pr).text}`));
      out.push(row("", clip(g.pr.title, 60)));
      out.push(row("Checks", `✓${c.pass} ●${c.pending} ✗${c.fail}`));
      const revs = g.pr.reviews.map((r) => `${r.state === "APPROVED" ? "✓" : "✗"} ${r.login}`).concat(g.pr.requested.map((x) => `● ${x}`));
      if (revs.length) out.push(row("Reviews", revs.join("  ")));
    } else {
      const open = g.prs.slice(0, 3).map((p) => `#${p.number} ${prPill(p, g).text}`);
      if (open.length) out.push(row("PRs", open.join(" · ")));
    }
    const runs = g.runs.slice(0, 3).map((r) => `${runGlyph(r, now).g} ${r.name}`);
    if (runs.length) out.push(row("Actions", runs.join(" · ")));
    if (g.pr) out.push(row("", g.pr.url));
  } else {
    const sessions = allSessions();
    out.push(`Agents · ${sessions.length} session${sessions.length === 1 ? "" : "s"}`);
    for (const s of sessions) {
      out.push(row(s.project, `${sessionBusy(s) ? "●" : "○"} ${s.activity?.state ?? "idle"} · ${shortModel(s.model)}${s.cost != null ? ` · ${fmtUsd(s.cost)}` : ""}`));
      for (const a of s.agents ?? []) out.push(`  ${isEnded(a.status) ? (a.status === "completed" ? "✓" : "✗") : "◐"} ${a.type}: ${clip(a.description, 40)}`);
    }
  }
  return out.join("\n");
}
