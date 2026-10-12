// The Clipboard room: what was copied lately, newest first, to copy again.
// The mod reads the clipboard every couple of seconds while the room has a
// tab (pbpaste on a Mac, wl-paste or xclip on Linux). The history lives in
// this session's memory only and is gone when the session ends. Anything
// that looks like a secret is drawn masked, though ⧉ still copies it, and a
// room's history is never shared to a chat.
//
// Plain logic and drawing: the mod runs the reader.

import { state } from "./state.mjs";
import { theme } from "./theme.mjs";
import { line, card, stackCards, clip, age } from "./widgets.mjs";
import { findSecret } from "./share.mjs";
import { value, sub, msg } from "./bands.mjs";

export const CLIP_META = { icon: "⧉", label: "Clipboard", color: "#6FC2B5" };
export const MAX_CLIPS = 30;
export const MAX_CLIP_CHARS = 20_000;   // past this an item is kept cut, and says so

// The readers to try, in order; the first that works is kept.
export const CLIP_READERS = [
  ["pbpaste"],
  ["wl-paste", "--no-newline"],
  ["xclip", "-selection", "clipboard", "-o"],
];

export function createClipboard() {
  return {
    items: [],       // [{ id, text, at, secret, cut }], newest first
    reader: null,    // the argv that worked
    seen: null,      // what the clipboard held at the last read
    error: "",       // no reader works here
    seq: 0,
  };
}

// What the reader just read. Only a change counts: the clipboard holds an
// item you dropped until something else is copied, and it mustn't come
// back. A new text goes on top; one already in the list moves to the top
// (copying an item again from the room does that). Whitespace alone is left
// out. True when the list changed.
export function addClip(c, raw, now) {
  const text = String(raw ?? "");
  if (text === c.seen) return false;
  c.seen = text;
  if (!text.trim()) return false;
  const cut = text.length > MAX_CLIP_CHARS;
  const kept = cut ? text.slice(0, MAX_CLIP_CHARS) : text;
  if (c.items[0]?.text === kept) return false;
  const was = c.items.findIndex((x) => x.text === kept);
  if (was >= 0) {
    const [item] = c.items.splice(was, 1);
    c.items.unshift({ ...item, at: now });
    return true;
  }
  c.items.unshift({ id: `c${++c.seq}`, text: kept, at: now, secret: findSecret(kept), cut });
  if (c.items.length > MAX_CLIPS) c.items.length = MAX_CLIPS;
  return true;
}

export function removeClip(c, id) {
  c.items = c.items.filter((x) => x.id !== id);
}

// One line of an item: its first line that has something on it, or masked.
export function clipPreview(item, width) {
  if (item.secret) return `•••••••• ${item.secret}`;
  const first = item.text.split("\n").find((l) => l.trim()) ?? "";
  return clip(first.replace(/\s+/g, " ").trim(), width);
}

function clipMeta(item, now) {
  const lines = item.text.split("\n").length;
  return [age(item.at, now), lines > 1 ? `${lines} lines` : `${item.text.length} chars`, item.cut ? "cut" : null].filter(Boolean).join(" · ");
}

function itemRow(els, item, w, handlers, now) {
  const { Box, Text, Button } = els;
  const meta = clipMeta(item, now);
  return Box({ key: item.id, flexDirection: "row", alignItems: "center", columnGap: 1, children: [
    Box({ key: "text", flexDirection: "column", flexGrow: 1, flexShrink: 1, minWidth: 0, children: [
      Text({ key: "t", wrap: "truncate-end", color: item.secret ? theme.amber : undefined, italic: !!item.secret, children: clipPreview(item, Math.max(10, w - 8)) }),
      Text({ key: "m", color: theme.muted, wrap: "truncate-end", children: meta }),
    ] }),
    Box({ key: "acts", flexDirection: "row", flexShrink: 0, columnGap: 1, children: [
      Button({ key: `copy-${item.id}`, plain: true, label: "⧉", onPress: (press) => handlers.onClipCopy?.(item.id, press?.surface) }),
      Button({ key: `drop-${item.id}`, plain: true, dimColor: true, label: "✕", onPress: () => handlers.onClipRemove?.(item.id) }),
    ] }),
  ] });
}

export function clipboardDock(els, w, capacity, handlers, now) {
  const c = state.clipboard;
  const { Text, Button, Box } = els;
  let rows;
  if (c.error) rows = [Text({ key: "err", color: theme.warn, wrap: "wrap", children: c.error })];
  else if (!c.items.length) rows = [Text({ key: "empty", color: theme.muted, wrap: "wrap", children: "Copy something anywhere and it shows up here." })];
  else {
    // Two rows an item on the terminal: keep to what fits.
    const room = els.Svg ? c.items.length : Math.max(1, Math.floor((capacity - 3) / 2));
    rows = c.items.slice(0, room).map((item) => itemRow(els, item, w, handlers, now));
    if (c.items.length > room) rows.push(Text({ key: "more", color: theme.muted, children: `+ ${c.items.length - room} more` }));
  }
  const metaNode = c.items.length ? Box({ key: "meta", flexDirection: "row", columnGap: 1, flexShrink: 0, children: [
    Text({ key: "n", color: theme.muted, children: `${c.items.length} item${c.items.length === 1 ? "" : "s"}` }),
    Button({ key: "clip-clear", plain: true, dimColor: true, label: "Clear", onPress: () => handlers.onClipClear?.() }),
  ] }) : null;
  const height = 3 + (c.items.length ? rows.length * 2 : 1);
  return stackCards(els, [{ name: "Clipboard", node: card(els, { key: "clips", title: "COPIED LATELY", color: CLIP_META.color, metaNode, rows }), height }], capacity, handlers.scroll);
}

export function clipboardInline(els, w, handlers, now) {
  const c = state.clipboard;
  const head = line(els, "head", [
    { text: `${CLIP_META.icon} ${CLIP_META.label}`, bold: true, color: CLIP_META.color },
    { text: `  ${c.items.length} item${c.items.length === 1 ? "" : "s"}`, color: theme.muted, grow: true },
  ]);
  if (c.error) return [head, els.Text({ key: "err", color: theme.warn, wrap: "wrap", children: c.error })];
  return [head, ...c.items.slice(0, 3).map((item) => itemRow(els, item, w, handlers, now))];
}

export function clipboardBandPieces() {
  const c = state.clipboard;
  if (c.error) return [{ text: "can't read the clipboard here", color: theme.warn }];
  if (!c.items.length) return [{ text: "nothing copied yet", color: theme.muted }];
  return [
    { text: `${c.items.length} copied`, color: CLIP_META.color, bold: true },
    { text: " · latest ", color: theme.muted },
    { text: clipPreview(c.items[0], 40), color: c.items[0].secret ? theme.amber : undefined },
  ];
}

// The desktop's band: how many are kept, then the newest one's first line,
// cut to the room left (masked when it looks secret). Hover lists the three newest.
export function clipboardBandDesk() {
  const c = state.clipboard;
  const color = CLIP_META.color;
  if (c.error) return { color, sections: [{ key: "err", color: theme.warn, parts: [sub("can't read the clipboard here")], tip: [c.error] }] };
  if (!c.items.length) return { color, sections: [{ key: "none", color, parts: [sub("nothing copied yet")] }] };
  return { color, sections: [
    { key: "count", color, parts: [value(String(c.items.length), color), sub("copied")] },
    { key: "latest", color, grow: true, parts: [sub("latest"), msg(clipPreview(c.items[0], 80))],
      tip: ["Copied lately", ...c.items.slice(0, 3).map((x) => clipPreview(x, 48))] },
  ] };
}
