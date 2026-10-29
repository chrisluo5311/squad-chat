// Small drawing pieces the built-in rooms share: text measuring, number
// formats, meters, sparklines, stat tiles and a height-aware card stack.
// Plain logic and element trees, no $ (see squad-chat.mjs).

import { theme, level } from "./theme.mjs";
import { svg, tint, TRACK } from "./bandkit.mjs";

// ---------------------------------------------------------------- measuring text

const WIDE = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|\p{Extended_Pictographic}/u;

// Terminal cells a string takes: wide characters (CJK, most emoji) take two.
export function cells(str) {
  let n = 0;
  for (const ch of String(str)) n += WIDE.test(ch) ? 2 : ch === "\uFE0F" ? 0 : 1;   // the emoji selector takes no cell
  return n;
}

// Symbols that are text by default but that Windows Terminal finds only in
// Segoe UI Emoji: it draws them in two cells where the engine gave one, over
// the cell after. The emoji selector makes them two cells for both. `cells`
// counts them as two either way. (↗ ▶ ™ ▪ stay text there, and stay as they are.)
const TEXT_EMOJI = /([☀☁☂🌤🌧🌦❄🌨⛈🌫⚠⏸⏭⚙⌨⏯⚒🌡⏮⏹])(?!️)/gu;
export const emojiSelected = (str) => String(str).replace(TEXT_EMOJI, "$1️");

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

// Text set inside an SVG drawing, escaped.
export const xml = (s) => String(s).replace(/[<>&"]/g, (ch) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[ch]);

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

// A bar `width` cells wide as an element. The terminal draws it in "━"; a
// surface with Svg (the desktop) draws a thin line instead, as the glyphs set
// in its proportional font run wider than their cells and end in "…". The
// line is drawn a little under 8 px a cell, so it never runs past its column.
const BAR_PX = 7;
export function barNode(els, key, pct, width, color, { track = true, min = false } = {}) {
  const { Box, Text, Svg } = els;
  width = Math.max(1, Math.floor(width));
  if (Svg) {
    const w = width * BAR_PX;
    const h = 8;
    const p = Math.min(100, Math.max(0, Number(pct) || 0));
    const fw = p > 0 || min ? Math.max(3, (p / 100) * w) : 0;   // even a sliver shows
    const hex = /^#[0-9a-f]{6}$/i.test(color ?? "") ? color : null;
    const body = (track ? `<rect x="0" y="2.5" width="${w}" height="3" rx="1.5" fill="${TRACK}"/>` : "")
      + (fw ? `<rect x="0" y="2.5" width="${fw.toFixed(1)}" height="3" rx="1.5" fill="${hex ?? tint("#7F7F7F", 0.6)}"/>` : "");
    return Box({ key, width, flexShrink: 0, alignItems: "center", children: [
      Svg({ key: "svg", source: svg(w, h, body), alt: `${Math.round(p)}%`, width: w, height: h }),
    ] });
  }
  const { fill, track: rest } = bar(pct, width);
  return Box({ key, flexDirection: "row", width, flexShrink: 1, minWidth: 0, overflow: "hidden", children: [
    Text({ key: "fill", color, wrap: "truncate-end", children: fill || (min ? "╸" : "") }),
    track ? Text({ key: "track", color: theme.muted, wrap: "truncate-end", children: rest }) : null,
  ].filter(Boolean) });
}

// One labeled meter row: `Context   ━━━━━━━╸━━━━━  62%  124k/200k`.
// `width` is the row's width in cells. The bar gives way first, so the
// numbers at the end always show.
export const LABEL_W = 10;
export function meter(els, { key, label, pct, width, right = "", color, rightColor, onPress }) {
  const { Box, Text, Button } = els;
  const rightW = Math.min(11, Math.max(0, width - LABEL_W - 16));
  const barW = Math.min(28, Math.max(4, width - LABEL_W - 1 - 4 - (rightW ? 1 + rightW : 0)));
  const tint = color ?? level(pct);
  const known = Number.isFinite(pct);
  const pctText = known ? `${Math.round(pct)}%` : "–";
  if (els.Svg) return meterStacked(els, { key, label, pct, right, tint, known, pctText, rightColor, onPress });
  return Box({ key, flexDirection: "row", alignItems: "center", children: [
    onPress
      ? Box({ key: "label", width: LABEL_W, flexShrink: 0, children: [Button({ key: "press", plain: true, label: clip(label, LABEL_W - 1), onPress })] })
      : col(els, "label", label, LABEL_W, { color: theme.muted }),
    barNode(els, "bar", pct, barW, tint),
    col(els, "pct", pctText, 5, { right: true, bold: true, color: known ? tint : theme.muted }),
    rightW ? col(els, "right", right, rightW, { color: rightColor ?? theme.muted, box: { marginLeft: 1 } }) : null,
  ].filter(Boolean) });
}

// A bar that takes whatever room its Box is given, for a surface with Svg:
// its markup is wider than any pane and stretches to fit, as the desktop
// sizes a drawing to its slot. `track: false` draws the fill alone; `min`
// gives even a zero a sliver.
export function stretchBar(els, key, pct, color, { track = true, min = false, thick = false, box = {} } = {}) {
  const { Box, Svg } = els;
  const W = 1000;
  const H = thick ? 10 : 6;
  const t = thick ? 8 : 3;
  const y = (H - t) / 2;
  const p = Math.min(100, Math.max(0, Number(pct) || 0));
  const fw = p > 0 || min ? Math.max(4, (p / 100) * W) : 0;
  const fill = hexOr(color);
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">`
    + (track ? `<rect x="0" y="${y}" width="${W}" height="${t}" fill="${TRACK}"/>` : "")
    + (fw ? `<rect x="0" y="${y}" width="${fw.toFixed(1)}" height="${t}" fill="${fill}"/>` : "")
    + `</svg>`;
  return Box({ key, flexGrow: 1, minWidth: 1, overflow: "hidden", ...box, children: [
    Svg({ key: "svg", source, alt: `${Math.round(p)}%`, height: H }),
  ] });
}

const hexOr = (color, fallback = "#7F7F7F") => (/^#[0-9a-f]{6}$/i.test(color ?? "") ? color : fallback);

// A number set large, as a drawing (a Text has one size): a stat's "24%".
export function bigNumber(els, key, text, color) {
  const { Svg } = els;
  // Wide enough for the font at hand: a "%" takes about half again a digit.
  const w = [...String(text)].reduce((n, ch) => n + (ch === "%" ? 22 : 14), 0) + 6;
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="28" viewBox="0 0 ${w} 28">`
    + `<text x="0" y="22" font-family="-apple-system, system-ui, sans-serif" font-size="22" font-weight="600" fill="${hexOr(color, "#E8E6E1")}">${String(text).replace(/[<&>]/g, "")}</text></svg>`;
  return Svg({ key, source, alt: String(text), width: w, height: 28 });
}

// One or two series as lines across the row, the first with a fill under
// it, scaled from zero to `max`, or without one from the lowest value to the
// highest (a price far from zero still shows its day). Oldest first.
export function lineChart(els, key, series, colors, { max, height = 40 } = {}) {
  const { Box, Svg } = els;
  const W = 1000;
  const all = series.flat().filter(Number.isFinite);
  const top = max ?? Math.max(...all, 1e-9);
  const bottom = max != null ? 0 : Math.min(...all, top);
  const span = Math.max(top - bottom, Math.abs(top) * 1e-6, 1e-9);
  const path = (vals) => {
    const v = vals.filter(Number.isFinite);
    if (v.length < 2) return "";
    return v.map((x, i) => `${i ? "L" : "M"}${((i / (v.length - 1)) * W).toFixed(1)} ${(height - 2 - ((Math.min(x, top) - bottom) / span) * (height - 4)).toFixed(1)}`).join(" ");
  };
  const body = series.map((vals, i) => {
    const d = path(vals);
    if (!d) return "";
    const c = hexOr(colors[i]);
    const area = i === 0 && series.length === 1 ? `<path d="${d} L${W} ${height} L0 ${height}Z" fill="${tint(c, 0.2)}"/>` : "";
    return `${area}<path d="${d}" fill="none" stroke="${c}" stroke-width="1.5" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
  }).join("");
  const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${height}" viewBox="0 0 ${W} ${height}" preserveAspectRatio="none">${body}</svg>`;
  return Box({ key, flexDirection: "row", children: [Box({ key: "c", flexGrow: 1, minWidth: 1, overflow: "hidden", children: [
    Svg({ key: "svg", source, alt: "chart", height }),
  ] })] });
}

// The desktop's meter: the label, its percent and the detail on one line,
// the bar across the whole row under them.
function meterStacked(els, { key, label, pct, right, tint, known, pctText, rightColor, onPress }) {
  const { Box, Text, Button } = els;
  return Box({ key, flexDirection: "column", children: [
    Box({ key: "line", flexDirection: "row", alignItems: "center", children: [
      onPress
        ? Button({ key: "press", plain: true, label, onPress })
        : Text({ key: "label", color: theme.muted, wrap: "truncate-end", children: label }),
      Text({ key: "pct", bold: true, color: known ? tint : theme.muted, children: ` ${pctText}` }),
      Box({ key: "push", flexGrow: 1, minWidth: 1 }),
      right ? Text({ key: "right", color: rightColor ?? theme.muted, wrap: "truncate-end", children: right }) : null,
    ].filter(Boolean) }),
    Box({ key: "bar", flexDirection: "row", children: [stretchBar(els, "fill", pct, tint)] }),
  ] });
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
// the others keep their size, so a status at the end of a row always shows
// (`right` sets its text against the right edge).
// One with `width` is a column of that many cells (`right` to right-align).
// One with `basis` starts that many cells wide and gives way when the row
// is short (`shrink`, how much faster than the others), and with `fill`
// takes the space left too. Rows with the same pieces line up.
// `gap` puts that many cells between the pieces, as a table's columns need.
// VS Code wraps a row that doesn't fit unless told not to: a long volume's
// name pushed its "in use" to a line of its own, and Ping's heartbeat went
// under its server. So the row never wraps, the growing piece is cut
// instead, and the gap is a column gap.
export function line(els, key, pieces, { gap = 0 } = {}) {
  const { Box, Text } = els;
  return Box({ key, flexDirection: "row", flexWrap: "nowrap", columnGap: gap, children: pieces.filter(Boolean).map((p, i) => (p.width != null
    ? col(els, `p${i}`, p.text, p.width, { right: p.right, color: p.color, bold: p.bold, dimColor: p.dim, italic: p.italic })
    : p.basis != null
    ? Box({ key: `p${i}`, flexDirection: "column", width: p.basis, flexGrow: p.fill ? 1 : 0, flexShrink: p.shrink ?? 1, minWidth: 0, overflow: "hidden", children: [p.node ?? Text({ key: "t", wrap: "truncate-end", color: p.color, children: p.text })] })
    : p.grow
    ? Box({ key: `p${i}`, flexGrow: 1, flexShrink: 1, minWidth: 0, overflow: "hidden", justifyContent: p.right ? "flex-end" : "flex-start", children: [p.node ?? Text({ key: "t", wrap: "truncate-end", color: p.color, bold: p.bold, dimColor: p.dim, italic: p.italic, children: p.text })] })
    : Box({ key: `p${i}`, flexShrink: 0, children: [p.node ?? Text({ key: "t", color: p.color, bold: p.bold, dimColor: p.dim, italic: p.italic, backgroundColor: p.bg, children: p.text })] }))) });
}

// An inline list cut to `max` rows: the rows to draw, and the line after
// them. Where the pane draws pictures (VS Code) "+ 2 more" is a button that
// opens the whole list (`open`), and "▴ less" shuts it; the terminal says
// "+ 2 more" in words. `text` follows it on the line, or stands alone.
export function inlineCut(els, key, items, max, { open = false, onToggle, text = "" } = {}) {
  const cut = items.length > max;
  const shown = cut && !(els.Svg && open) ? items.slice(0, max) : items;
  const label = !cut ? "" : shown.length < items.length ? `+ ${items.length - shown.length} more` : "▴ less";
  if (els.Svg && cut) {
    return { shown, node: line(els, key, [
      { node: els.Button({ key: `more-${key}`, plain: true, label, onPress: () => onToggle?.() }) },
      text ? { text, color: theme.muted, grow: true } : null,
    ], { gap: 1 }) };
  }
  const words = [label, text].filter(Boolean).join(" · ");
  return { shown, node: words ? els.Text({ key, color: theme.muted, wrap: "truncate-end", children: words }) : null };
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

// Cards in priority order, a row apart so their frames don't run together.
// When they're taller than `capacity` rows they sit in a window that long,
// a scrollbar at its right, and scroll a card at a time: `scroll.offset` is
// the card at the top, `scroll.max` the last one that can be (0 when all of
// them fit) and `scroll.starts` the row each card starts on.
// Each card is { node, height, name }.
export const CARD_GAP = 1;
export function stackCards(els, cards, capacity, scroll = { offset: 0 }) {
  const { Box } = els;
  const shown = cards.filter(Boolean);
  const starts = [];
  let content = 0;
  shown.forEach((c, i) => { content += i ? CARD_GAP : 0; starts.push(content); content += c.height; });
  const stack = (from) => shown.slice(from).flatMap((c, i) => (i ? [Box({ key: `gap-${c.name}`, height: CARD_GAP, flexShrink: 0 }), c.node] : [c.node]));
  const last = Math.max(0, starts.findIndex((at) => content - at <= capacity));
  scroll.max = content > capacity ? last || shown.length - 1 : 0;
  scroll.starts = starts;
  if (!scroll.max) return stack(0);
  const top = Math.min(scroll.max, Math.max(0, scroll.offset ?? 0));
  return [Box({ key: "cards", flexDirection: "row", height: capacity, flexShrink: 0, children: [
    Box({ key: "window", flexDirection: "column", flexGrow: 1, flexShrink: 1, minWidth: 0, overflow: "hidden", children: stack(top) }),
    scrollbar(els, capacity, content, top / scroll.max),
  ] })];
}

// A column of `rows` cells: the track, and a thumb as long as the window is
// next to the whole, `at` of the way down (0 to 1).
export function scrollbar(els, rows, content, at) {
  const { Box, Text } = els;
  const thumb = Math.max(1, Math.min(rows, Math.round((rows * rows) / content)));
  const top = Math.round(at * (rows - thumb));
  return Box({ key: "scrollbar", flexDirection: "column", width: 1, flexShrink: 0, children: Array.from({ length: rows }, (_, i) => {
    const on = i >= top && i < top + thumb;
    return Text({ key: `s${i}`, color: on ? theme.accent : theme.border, children: on ? "┃" : "│" });
  }) });
}
