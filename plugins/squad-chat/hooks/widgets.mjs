// Small drawing pieces the built-in rooms share: text measuring, number
// formats, meters, sparklines, stat tiles and a height-aware card stack.
// Plain logic and element trees, no $ (see squad-chat.mjs).

import { theme, level } from "./theme.mjs";

// ---------------------------------------------------------------- measuring text

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u;

// Terminal cells a string takes: wide characters (CJK, most emoji) take two.
export function cells(str) {
  let n = 0;
  for (const ch of String(str)) n += WIDE.test(ch) ? 2 : 1;
  return n;
}

// Rows a text takes when word-wrapped at `width`, the way the terminal wraps.
export function rowsFor(text, width) {
  width = Math.max(10, width);
  let rows = 0;
  for (const para of String(text).split("\n")) {
    let line = 0;
    rows++;
    for (const word of para.split(/(\s+)/)) {
      const w = cells(word);
      if (!w) continue;
      if (line + w <= width) { line += w; continue; }
      if (/^\s+$/.test(word)) { line = 0; rows++; continue; }
      rows += line > 0 ? 1 : 0;
      line = w % width || (w > 0 ? width : 0);
      rows += Math.max(0, Math.ceil(w / width) - 1);
    }
  }
  return Math.max(1, rows);
}

// Cut to `width` cells, with "…" when anything was cut.
export function clip(str, width) {
  str = String(str ?? "");
  if (width <= 0) return "";
  if (cells(str) <= width) return str;
  let out = "";
  let n = 0;
  for (const ch of str) {
    const w = WIDE.test(ch) ? 2 : 1;
    if (n + w > width - 1) break;
    out += ch;
    n += w;
  }
  return `${out}…`;
}

// Clip, then pad with spaces to exactly `width` cells (on the left with `right`).
export function fit(str, width, { right = false } = {}) {
  const s = clip(str, width);
  const pad = " ".repeat(Math.max(0, width - cells(s)));
  return right ? pad + s : s + pad;
}

// ---------------------------------------------------------------- numbers

export function fmtTokens(n) {
  n = Number(n) || 0;
  if (n >= 999_500) return `${(n / 1e6).toFixed(n >= 9_950_000 ? 0 : 1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}k`;
  return String(Math.round(n));
}

export function fmtUsd(n) {
  n = Number(n) || 0;
  if (n >= 100) return `$${Math.round(n)}`;
  return `$${n.toFixed(2)}`;
}

// 0.2s, 1.8s, 42s, 1:12, 1:02:03
export function fmtDur(ms) {
  ms = Math.max(0, Number(ms) || 0);
  if (ms < 10_000) return `${(ms / 1000).toFixed(1)}s`;
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

// How long a session has run: 12m, 1h12m.
export function fmtSpan(ms) {
  const m = Math.max(0, Math.floor((Number(ms) || 0) / 60_000));
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, "0")}m`;
}

// "now", "12s ago", "3m ago", "2h ago", "4d ago"
export function relTime(ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000));
  if (s < 5) return "now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86_400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86_400)}d ago`;
}

// The same, without "ago": for columns.
export function age(ms, now = Date.now()) {
  const r = relTime(ms, now);
  return r === "now" ? "now" : r.replace(" ago", "");
}

// When a rate-limit window resets: "2:40pm" within a day (past midnight
// too), "Fri" further out.
export function resetLabel(iso, now = new Date()) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (d.getTime() - now.getTime() < 24 * 3_600_000) {
    const h = d.getHours();
    return `${h % 12 || 12}:${String(d.getMinutes()).padStart(2, "0")}${h < 12 ? "am" : "pm"}`;
  }
  return d.toLocaleDateString("en-US", { weekday: "short" });
}

// ---------------------------------------------------------------- bars and sparks

const SPARKS = "▁▂▃▄▅▆▇█";

// A bar `width` cells wide, `pct` full, to half a cell: a heavy line, the
// filled part in the meter's color and the rest in grey, both one weight.
export function bar(pct, width) {
  width = Math.max(1, Math.floor(width));
  const halves = Math.round((Math.min(100, Math.max(0, Number(pct) || 0)) / 100) * width * 2);
  const whole = Math.floor(halves / 2);
  const half = halves % 2 ? "╸" : "";
  return { fill: "━".repeat(whole) + half, track: "━".repeat(Math.max(0, width - whole - (half ? 1 : 0))) };
}

// Values as a row of rising blocks, scaled from zero to the largest.
export function sparkline(values, width = values.length) {
  const vals = values.slice(-width);
  const max = Math.max(...vals, 0);
  if (!vals.length) return "";
  return vals.map((v) => (max > 0 && v > 0 ? SPARKS[Math.min(7, Math.max(1, Math.round((v / max) * 7)))] : SPARKS[0])).join("");
}

// ---------------------------------------------------------------- elements

// A column `width` cells wide, the text cut to fit and, with `right`, set
// against the column's right edge. The Box holds the width, not padding
// spaces, so columns line up where text is drawn in a proportional font (the
// desktop) as they do in the terminal.
export function col(els, key, text, width, { right = false, box = {}, ...style } = {}) {
  const { Box, Text } = els;
  return Box({ key, width, flexShrink: 0, justifyContent: right ? "flex-end" : "flex-start", ...box, children: [
    Text({ key: "t", wrap: "truncate-end", ...style, children: clip(text, width) }),
  ] });
}

// One labeled meter row: `Context   ━━━━━━━╸━━━━━  62%  124k/200k`.
// `width` is the row's width in cells. The bar gives way first, so the
// numbers at the end always show.
export const LABEL_W = 10;
export function meter(els, { key, label, pct, width, right = "", color, rightColor, onPress }) {
  const { Box, Text, Button } = els;
  const rightW = Math.min(11, Math.max(0, width - LABEL_W - 16));
  const barW = Math.min(28, Math.max(4, width - LABEL_W - 1 - 4 - (rightW ? 1 + rightW : 0)));
  const { fill, track } = bar(pct, barW);
  const tint = color ?? level(pct);
  const known = Number.isFinite(pct);
  return Box({ key, flexDirection: "row", children: [
    onPress
      ? Box({ key: "label", width: LABEL_W, flexShrink: 0, children: [Button({ key: "press", plain: true, label: clip(label, LABEL_W - 1), onPress })] })
      : col(els, "label", label, LABEL_W, { color: theme.muted }),
    Box({ key: "bar", flexDirection: "row", width: barW, flexShrink: 1, minWidth: 0, overflow: "hidden", children: [
      Text({ key: "fill", color: tint, wrap: "truncate-end", children: fill }),
      Text({ key: "track", color: theme.muted, wrap: "truncate-end", children: track }),
    ] }),
    col(els, "pct", known ? `${Math.round(pct)}%` : "–", 5, { right: true, bold: true, color: known ? tint : theme.muted }),
    rightW ? col(els, "right", right, rightW, { color: rightColor ?? theme.muted, box: { marginLeft: 1 } }) : null,
  ].filter(Boolean) });
}

// A big number over a small caption, side by side with others in a row.
export function statTile(els, { key, value, sub, color, width }) {
  const { Box, Text } = els;
  return Box({ key, flexDirection: "column", width, flexShrink: 0, children: [
    Text({ key: "v", bold: true, color, wrap: "truncate-end", children: clip(value, width - 1) }),
    Text({ key: "s", color: theme.muted, wrap: "truncate-end", children: clip(sub, width - 1) }),
  ] });
}

export function tiles(els, list, width) {
  const { Box } = els;
  const w = Math.floor(width / list.length);
  return Box({ key: "tiles", flexDirection: "row", children: list.map((t, i) => statTile(els, { key: `t${i}`, width: w, ...t })) });
}

// A short piece of colored status: "✓ 4", "● review", "draft".
export function pill(els, key, text, color, extra = {}) {
  const { Text } = els;
  return Text({ key, color, children: text, ...extra });
}

// Pieces of one row, left to right, each { text, color, bold, grow } or
// { node }. The piece marked `grow` takes the space left and is cut to fit;
// the others keep their size, so a status at the end of a row always shows.
// One with `width` is a column of that many cells (`right` to right-align).
// `gap` puts that many cells between the pieces, as a table's columns need.
export function line(els, key, pieces, { gap = 0 } = {}) {
  const { Box, Text } = els;
  return Box({ key, flexDirection: "row", gap, children: pieces.filter(Boolean).map((p, i) => (p.width != null
    ? col(els, `p${i}`, p.text, p.width, { right: p.right, color: p.color, bold: p.bold, dimColor: p.dim, italic: p.italic })
    : p.grow
    ? Box({ key: `p${i}`, flexGrow: 1, flexShrink: 1, minWidth: 0, children: [Text({ key: "t", wrap: "truncate-end", color: p.color, bold: p.bold, dimColor: p.dim, italic: p.italic, children: p.text })] })
    : Box({ key: `p${i}`, flexShrink: 0, children: [p.node ?? Text({ key: "t", color: p.color, bold: p.bold, dimColor: p.dim, italic: p.italic, backgroundColor: p.bg, children: p.text })] }))) });
}

// A rounded card like the chat's: a bold title, right-aligned meta (text or
// an element), the rows. Returns the node and the rows it takes.
export function card(els, { key, title, color, meta, metaColor, metaNode, rows, grow = false }) {
  const { Box, Text } = els;
  const head = Box({ key: "head", flexDirection: "row", justifyContent: "space-between", gap: 1, children: [
    Text({ key: "title", bold: true, color, wrap: "truncate-end", children: title }),
    metaNode ?? (meta ? Text({ key: "meta", color: metaColor ?? theme.muted, wrap: "truncate-start", children: meta }) : null),
  ].filter(Boolean) });
  const body = grow
    ? [Box({ key: "body", flexDirection: "column", flexGrow: 1, overflow: "hidden", children: rows })]
    : rows;
  return Box({
    key, flexDirection: "column", borderStyle: "round", borderColor: theme.border, paddingX: 1,
    flexGrow: grow ? 1 : 0, flexShrink: grow ? 1 : 0, children: [head, ...body],
  });
}

// Cards in priority order, as many as the height allows, a row apart so
// their frames don't run together. What doesn't fit is named on one muted
// line, so the person knows a taller pane shows more.
// Each card is { node, height, name }; `capacity` is the rows there are.
export const CARD_GAP = 1;
export function stackCards(els, cards, capacity) {
  const { Box, Text } = els;
  const shown = [];
  const hidden = [];
  let used = 0;
  for (const c of cards.filter(Boolean)) {
    const need = c.height + (shown.length ? CARD_GAP : 0);
    if (!hidden.length && used + need <= capacity) { shown.push(c); used += need; }
    else hidden.push(c.name);
  }
  // The footer needs a row: give up the last card shown if there isn't one.
  if (hidden.length && used + 1 > capacity && shown.length > 1) hidden.unshift(shown.pop().name);
  const nodes = shown.flatMap((c, i) => (i ? [Box({ key: `gap-${c.name}`, height: CARD_GAP, flexShrink: 0 }), c.node] : [c.node]));
  if (hidden.length) nodes.push(Text({ key: "more", color: theme.muted, wrap: "truncate-end", children: `+ ${hidden.join(" · ")}  (a taller pane shows them)` }));
  return nodes;
}
