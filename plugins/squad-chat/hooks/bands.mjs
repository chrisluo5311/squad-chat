// The desktop band: one capsule above the prompt, the room's name in its
// color, then sections, each a few parts (small drawings from bandkit.mjs and
// words) with a card on hover. Every room draws its band through capsule();
// the terminal keeps its line of text.

import { theme } from "./theme.mjs";
import { tint } from "./bandkit.mjs";
import { cells } from "./widgets.mjs";

// The parts a section is made of.
export const draw = (d, alt) => (d ? { svg: d, alt } : null);
export const label = (text, color) => ({ text, kind: "label", color });
export const value = (text, color) => ({ text, kind: "value", color });
export const sub = (text) => ({ text, kind: "sub" });
export const msg = (text, { dim = false } = {}) => ({ text, kind: "msg", dim });
export const sep = () => ({ text: "│", kind: "sub" });
export const chip = (text, background, color) => ({ text, kind: "chip", background, color });
export const tag = (text, color) => ({ text, kind: "tag", color });

function partNode({ Text, Svg }, p, i, color) {
  const key = `p${i}`;
  if (p.svg) {
    const d = p.svg;
    return Svg({ key, source: d.source, alt: p.alt || "drawing", width: d.width, height: d.height, ...(d.isInteractive ? { isInteractive: true } : {}) });
  }
  if (p.kind === "label") return Text({ key, color: p.color ?? theme.muted, children: p.text });
  if (p.kind === "value") return Text({ key, bold: true, ...(p.color ? { color: p.color } : {}), children: p.text });
  if (p.kind === "msg") return Text({ key, wrap: "truncate-end", ...(p.dim ? { color: theme.muted, italic: true } : {}), children: p.text });
  if (p.kind === "chip") return Text({ key, bold: true, color: p.color, backgroundColor: p.background, children: ` ${p.text} ` });
  if (p.kind === "tag") return Text({ key, color: p.color ?? color, children: `[${p.text}]` });
  return Text({ key, color: theme.muted, children: p.text });
}

// The card a section opens on hover, above the band: the first line in the
// section's color, the rest dim.
function hoverCard({ Box, Text }, color, lines) {
  return Box({
    position: "absolute",
    bottom: 1,
    left: 0,
    display: "none",
    hover: { display: "flex" },
    flexDirection: "column",
    paddingX: 1,
    borderStyle: "round",
    borderColor: tint(color, 0.55),
    backgroundColor: "background",
    children: lines.map((t, i) => (i === 0
      ? Text({ key: `t${i}`, bold: true, color, children: t })
      : Text({ key: `t${i}`, color: theme.muted, children: t }))),
  });
}

// A section: { key, color, parts, tip, grow }. A section with a message
// (`grow`) takes the room left and cuts its text; the others keep their size.
function section(els, s) {
  const { Box } = els;
  const parts = s.parts.filter(Boolean).map((p, i) => partNode(els, p, i, s.color));
  const tip = (s.tip ?? []).filter((t) => t && String(t).trim());
  return Box({
    key: `bs-${s.key}`,
    flexDirection: "row",
    alignItems: "center",
    columnGap: 1,
    paddingX: 1,
    ...(s.grow ? { flexShrink: 1, minWidth: 0 } : { flexShrink: 0 }),
    hover: { backgroundColor: tint(s.color, 0.16) },
    children: tip.length ? [...parts, hoverCard(els, s.color, tip)] : parts,
  });
}

// About how many cells a section takes on the desktop: its words, its
// drawings at some 8 px a cell, the gaps between them, its padding and the
// rule before it. A message gives way, so it counts for a short one.
const PX_PER_CELL = 8;
const MSG_MIN = 16;
function sectionCells(s) {
  const parts = s.parts.filter(Boolean);
  const each = parts.map((p) => (p.svg ? Math.ceil(p.svg.width / PX_PER_CELL)
    : p.kind === "msg" ? Math.min(cells(p.text), MSG_MIN)
      : cells(p.text) + (p.kind === "chip" ? 2 : p.kind === "tag" ? 2 : 0)));
  return each.reduce((n, c) => n + c, 0) + Math.max(0, parts.length - 1) + 2 + 1;
}

// The sections that fit in `columns` beside the room's name and the Open
// button, the first always: the ones at the end go first, as a drawing
// would otherwise run under the button.
const OPEN_CELLS = 10;
export function fitSections(sections, room, columns) {
  const list = sections.filter(Boolean);
  if (!columns) return list;
  let room_left = Math.floor(columns * 0.92) - OPEN_CELLS - (cells(room) + 2) - 2;
  const out = [];
  for (const s of list) {
    const need = sectionCells(s);
    if (out.length && need > room_left) break;
    out.push(s);
    room_left -= need;
  }
  return out;
}

// The band: the capsule, then the Open button at the far right. With
// `columns`, the sections that don't fit are left out.
export function capsule(els, { room, color, sections, onOpen, columns = 0 }) {
  const { Box, Text, Button } = els;
  const children = [Box({ key: "bs-room", flexShrink: 0, paddingX: 1, children: [Text({ key: "t", bold: true, color, children: room })] })];
  for (const s of fitSections(sections, room, columns)) {
    children.push(Box({ key: `bs-sep-${s.key}`, flexShrink: 0, children: [Text({ key: "t", color: theme.muted, children: "│" })] }));
    children.push(section(els, s));
  }
  return Box({ flexDirection: "row", alignItems: "center", children: [
    Box({
      key: "capsule",
      flexDirection: "row",
      alignItems: "center",
      flexShrink: 1,
      minWidth: 0,
      borderStyle: "round",
      borderColor: tint(color, 0.35),
      backgroundColor: tint(color, 0.07),
      paddingY: 0,
      children,
    }),
    Box({ key: "gap", flexGrow: 1 }),
    Box({ key: "open-box", flexShrink: 0, marginLeft: 1, children: [Button({ key: "open", label: "Open", variant: "primary", onPress: onOpen })] }),
  ] });
}
