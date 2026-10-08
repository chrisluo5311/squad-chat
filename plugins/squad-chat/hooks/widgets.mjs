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

// One labeled meter row: `Context   ━━━━━━━╸━━━━━  62%  124k/200k`.
// `width` is the row's width in cells.
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
      ? Box({ key: "label", width: LABEL_W, flexShrink: 0, children: [Button({ key: "press", plain: true, label: fit(label, LABEL_W - 1), onPress })] })
      : Text({ key: "label", color: theme.muted, children: fit(label, LABEL_W) }),
    Text({ key: "fill", color: tint, children: fill }),
    Text({ key: "track", color: theme.muted, children: track }),
    Text({ key: "pct", bold: true, color: known ? tint : theme.muted, children: fit(known ? `${Math.round(pct)}%` : "–", 5, { right: true }) }),
    rightW ? Text({ key: "right", color: rightColor ?? theme.muted, children: ` ${fit(right, rightW)}` }) : null,
  ].filter(Boolean) });
}

// A big number over a small caption, side by side with others in a row.
export function statTile(els, { key, value, sub, color, width }) {
  const { Box, Text } = els;
  return Box({ key, flexDirection: "column", width, flexShrink: 0, children: [
    Text({ key: "v", bold: true, color, children: fit(value, width - 1) }),
    Text({ key: "s", color: theme.muted, children: fit(sub, width - 1) }),
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
export function line(els, key, pieces) {
  const { Box, Text } = els;
  return Box({ key, flexDirection: "row", children: pieces.filter(Boolean).map((p, i) => (p.grow
    ? Box({ key: `p${i}`, flexGrow: 1, flexShrink: 1, minWidth: 0, children: [Text({ key: "t", wrap: "truncate-end", color: p.color, bold: p.bold, dimColor: p.dim, italic: p.italic, children: p.text })] })
    : Box({ key: `p${i}`, flexShrink: 0, children: [p.node ?? Text({ key: "t", color: p.color, bold: p.bold, dimColor: p.dim, italic: p.italic, backgroundColor: p.bg, children: p.text })] }))) });
}

// Cards in priority order, as many as the height allows. What doesn't fit is
// named on one muted line, so the person knows a taller pane shows more.
// Each card is { node, height, name }; `capacity` is the rows there are.
export function stackCards(els, cards, capacity) {
  const { Text } = els;
  const shown = [];
  const hidden = [];
  let used = 0;
  for (const c of cards.filter(Boolean)) {
    if (!hidden.length && used + c.height <= capacity) { shown.push(c); used += c.height; }
    else hidden.push(c.name);
  }
  // The footer needs a row: give up the last card shown if there isn't one.
  if (hidden.length && used + 1 > capacity && shown.length > 1) hidden.unshift(shown.pop().name);
  const nodes = shown.map((c) => c.node);
  if (hidden.length) nodes.push(Text({ key: "more", color: theme.muted, wrap: "truncate-end", children: `+ ${hidden.join(" · ")}  (a taller pane shows them)` }));
  return nodes;
}
