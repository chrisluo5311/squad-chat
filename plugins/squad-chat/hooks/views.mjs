// The chat pane and the band, drawn from state alone (no $ here: the engine
// follows $ only within the hooks module's own file).
//
// Docked (fullscreen, wide terminal):
//   title bar · tabs (built-in rooms, then chat rooms) · FRIENDS card ·
//   room card with grouped messages · input box · key hints
// A built-in room (Usage, Git, Agents) takes the space under the tabs with
// its own cards (sysviews.mjs).
// Inline (above the prompt): one header line, the last few messages, input.
// Band (pane not up): one line with an Open button.

import { state, currentRoom, roomMessages, lastMessage, totalUnread, typingText, isQuiet, activeView, enabledRooms, roomIds } from "./state.mjs";
import { theme, palette, nameColor, glyph } from "./theme.mjs";
import { snippetTitle, snapshotCard, oneLine, displayLines } from "./share.mjs";
import { cells, rowsFor } from "./widgets.mjs";
import { roomMeta, sysDock, sysInline, sysBandPieces, sysBadge, sysBandDesktop, textW, hasSnapshot } from "./sysviews.mjs";
import { petBeside } from "./pet.mjs";
import { fnHint, fnPlaceholder, fnBandDesktop, fnMeta, fnAdds } from "./fnviews.mjs";
import * as K from "./bandkit.mjs";
import { capsule, cycleButtons, CYCLE_CELLS, draw, value as pValue, sub as pSub, msg as pMsg, chip as pChip } from "./bands.mjs";
import { usageBandDesktop } from "./usageband.mjs";

const GROUP_GAP_MS = 5 * 60_000;   // same sender within 5 minutes: one group

// ---------------------------------------------------------------- small helpers

function formatTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function dayKey(iso) {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function dayLabel(iso, now = new Date()) {
  const d = new Date(iso);
  const start = (x) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((start(now) - start(d)) / 86_400_000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}

function connection() {
  if (state.bridge === "unavailable") return { color: theme.error, text: `${glyph.on} unavailable` };
  if (state.bridge === "unconfigured") return { color: theme.warn, text: `${glyph.off} no server` };
  if (state.bridge !== "ready") return { color: theme.warn, text: `${glyph.off} ${state.bridge}` };
  if (state.auth === "code_sent") return { color: theme.warn, text: `${glyph.off} code sent` };
  if (state.auth !== "signed_in") return { color: theme.muted, text: `${glyph.off} ${state.auth === "starting" ? "connecting" : "signed out"}` };
  const room = currentRoom();
  if (!room) return { color: theme.online, text: `${glyph.on} connected` };
  const status = state.roomStatus.get(room.id);
  if (status === "SUBSCRIBED" && isQuiet()) return { color: theme.amber, text: `${glyph.busy} busy` };
  if (status === "SUBSCRIBED") return { color: theme.online, text: `${glyph.on} live` };
  return { color: theme.warn, text: `${glyph.off} ${status ? "reconnecting" : "joining"}` };
}

function displayName(m) {
  return m.mine ? "you" : m.user;
}

// ---------------------------------------------------------------- messages

// The room's messages as rows: date separators, the "new" divider, a header
// per group of messages from one sender, and the bodies. Each row knows how
// many terminal rows it takes at `width`, so the newest ones can be fitted.
// A bubble is as wide as its text (plus a cell of padding each side), up to
// about three quarters of the room's width; longer text wraps inside it.
function bubbleWidth(body, width) {
  const max = Math.max(12, Math.floor(width * 0.78));
  const longest = Math.max(...String(body).split("\n").map(cells));
  return Math.min(max, longest + 2);
}

function messageRows(list, width, dividerAt) {
  const rows = [];
  let prev = null;
  let dividerShown = false;
  for (const m of list) {
    const newDay = !prev || dayKey(prev.at) !== dayKey(m.at);
    if (newDay) rows.push({ kind: "day", key: `d${m.id}`, text: dayLabel(m.at), height: 1 });
    const isNew = dividerAt > 0 && !dividerShown && m.id > dividerAt && !m.mine;
    if (isNew) {
      rows.push({ kind: "new", key: `n${m.id}`, height: 1 });
      dividerShown = true;
    }
    const sameGroup = prev && !newDay && !isNew && prev.user_id === m.user_id
      && Date.parse(m.at) - Date.parse(prev.at) < GROUP_GAP_MS;
    if (!sameGroup) rows.push({ kind: "head", key: `h${m.id}`, m, height: 2 });   // a blank row, then the header
    if (m.kind === "code" || m.kind === "diff") {
      const lines = snippetLines(snippetParts(m).body, m.kind);
      const gap = sameGroup ? 1 : 0;   // a blank row from the message above
      rows.push({ kind: "snippet", key: `m${m.id}`, m, ...lines, gap, height: gap + 1 + lines.shown.length + (lines.more ? 1 : 0) });
    } else {
      const bubble = bubbleWidth(m.body, width);
      rows.push({ kind: "body", key: `m${m.id}`, m, bubble, height: rowsFor(m.body, bubble - 2) });
    }
    prev = m;
  }
  return rows;
}

// The desktop's phone layout: the time goes small under the last message of
// each group instead of beside the name, so each group gets a row after it.
function withGroupTimes(rows) {
  const out = [];
  rows.forEach((r, i) => {
    // A bubble right under another of the same group sits a little below it.
    const prev = rows[i - 1];
    out.push(r.kind === "body" && (prev?.kind === "body" || prev?.kind === "snippet") ? { ...r, gapAbove: true } : r);
    const next = rows[i + 1];
    const ends = (r.kind === "body" || r.kind === "snippet") && (!next || next.kind === "head" || next.kind === "day" || next.kind === "new");
    if (ends) out.push({ kind: "time", key: `t${r.m.id}`, m: r.m, height: 1 });
  });
  return out;
}

// A room's card, shared: its room's color.
const CARD_COLORS = { usage: theme.usage, git: theme.git, agents: theme.agents, monitor: palette.teal };

// What a snippet draws: a title, and the lines under it. A room's card takes
// its title from its first line and wears its room's color.
function snippetParts(m) {
  const card = snapshotCard(m);
  return card ? { ...card, color: CARD_COLORS[m.lang] } : { title: `📎 ${snippetTitle(m)}`, body: m.body, color: null };
}

// A snippet shows its first lines, one terminal row each (never wrapped, so
// its height is known), and how many more there are. Copy takes it all.
const SNIPPET_ROWS = 8;
function snippetLines(body, kind = "code", max = SNIPPET_ROWS) {
  const all = displayLines(body, kind);
  return { shown: all.slice(0, max), more: Math.max(0, all.length - max) };
}

function diffColor(line) {
  if (line.startsWith("▸ ")) return theme.muted;
  if (line.startsWith("@@")) return theme.sky;
  if (line.startsWith("+")) return theme.online;
  if (line.startsWith("-")) return theme.error;
  return theme.theirText;
}

// A card's line: its label dimmed, a bar's fill in the room's color and its
// track dimmed.
function cardLine(els, key, line, color) {
  const { Box, Text } = els;
  const m = /^\S(?:.*?\S)?( {2,})/.exec(line);
  const label = m && m[0].length <= 12 ? m[0] : "";
  const bits = [
    ...(label ? [{ text: label, color: theme.muted }] : []),
    ...line.slice(label.length).split(/([━╸]+|─+)/).filter(Boolean)
      .map((t) => ({ text: t, color: /^[━╸]/.test(t) ? color : t.startsWith("─") ? theme.muted : theme.theirText })),
  ];
  return Box({ key, flexDirection: "row", overflow: "hidden", children: bits.map((b, i) => (i === bits.length - 1
    ? Box({ key: `b${i}`, flexGrow: 1, flexShrink: 1, minWidth: 0, children: [Text({ key: "t", wrap: "truncate-end", color: b.color, children: b.text })] })
    : Box({ key: `b${i}`, flexShrink: 0, children: [Text({ key: "t", color: b.color, children: b.text })] }))) });
}

// The snippet's lines on a dark fill, diffs colored line by line, a card's
// labels and bars by its room.
function snippetBody(els, { kind, shown, more, color = null }) {
  const { Text } = els;
  return [
    ...shown.map((line, i) => (color && line ? cardLine(els, `l${i}`, line, color)
      : Text({ key: `l${i}`, wrap: "truncate-end", color: kind === "diff" ? diffColor(line) : theme.theirText, children: line || " " }))),
    ...(more ? [Text({ key: "more", color: theme.muted, children: `… ${more} more line${more === 1 ? "" : "s"}` })] : []),
  ];
}

// The newest rows that fit in `capacity` terminal rows, never starting
// with message bodies whose sender header didn't fit.
function fitRows(rows, capacity) {
  const shown = [];
  let used = 0;
  let i = rows.length - 1;
  for (; i >= 0; i--) {
    if (used + rows[i].height > capacity && shown.length) break;
    used += rows[i].height;
    shown.unshift(rows[i]);
  }
  // A snippet that would open the view without its sender's header (it, or
  // the header, didn't fit) shows fewer lines under a header instead of
  // leaving the space empty. First the snippet that didn't fit, else the one
  // that lost its header.
  const shrink = (at) => {
    const row = rows[at];
    let room = capacity - used;
    if (shown[0] === row) room += row.height;
    const own = rows[at - 1]?.kind === "head";
    const head = own ? rows[at - 1] : { kind: "head", key: `h${row.m.id}-cut`, m: row.m, height: 2 };
    const gap = own ? row.gap : 0;   // a header of its own sits right above it
    const all = displayLines(snippetParts(row.m).body, row.m.kind);
    const lines = room - head.height - gap - 1;   // below its title
    const fit = all.length <= lines ? all.length : lines - 1;   // keep a row for "… more"
    if (fit < 2) return false;
    if (shown[0] === row) { shown.shift(); used -= row.height; }
    const more = all.length - fit;
    const cut = { ...row, gap, shown: all.slice(0, fit), more, height: gap + 1 + fit + (more ? 1 : 0) };
    shown.unshift(head, cut);
    used += head.height + cut.height;
    return true;
  };
  if (!(i >= 0 && rows[i].kind === "snippet" && shrink(i)) && shown[0]?.kind === "snippet" && shown.length > 1) shrink(i + 1);
  // Don't open on a group that has lost its header: start at the next one.
  while (shown.length > 1 && (shown[0].kind === "body" || shown[0].kind === "snippet")) shown.shift();
  return shown;
}

function drawRow(els, row, width, onCopy) {
  const { Box, Text, Button } = els;
  switch (row.kind) {
    case "snippet": {
      // Full width whoever sent it: code reads left to right. A room's card
      // has its title on a bar of the room's color.
      const parts = snippetParts(row.m);
      return Box({ key: row.key, flexShrink: 0, flexDirection: "column", marginTop: row.gap, backgroundColor: theme.theirBubble, children: [
        Box({ key: "head", flexDirection: "row", justifyContent: "space-between", gap: 1, paddingX: 1, ...(parts.color ? { backgroundColor: parts.color } : {}), children: [
          Text({ key: "t", bold: true, color: parts.color ? theme.onAccent : theme.amber, wrap: "truncate-end", children: parts.title }),
          onCopy ? Button({ key: "copy", plain: true, label: "Copy", onPress: (press) => onCopy(row.m.body, press?.surface) }) : null,
        ].filter(Boolean) }),
        Box({ key: "body", flexDirection: "column", paddingX: 1, children: snippetBody(els, { kind: row.m.kind, shown: row.shown, more: row.more, color: parts.color }) }),
      ] });
    }
    case "day":
      return Box({ key: row.key, flexShrink: 0, justifyContent: "center", children: [
        Text({ key: "t", color: theme.muted, children: `${glyph.rule.repeat(3)} ${row.text} ${glyph.rule.repeat(3)}` }),
      ] });
    case "new":
      // The terminal counts its columns for the rule. The desktop's font is
      // proportional, where a count of "─" ran past the row and wrapped, so
      // there the rule is a drawn line that stretches to the room left.
      if (els.Svg) {
        const W = 1000;
        return Box({ key: row.key, flexShrink: 0, flexDirection: "row", alignItems: "center", columnGap: 1, children: [
          Text({ key: "t", color: theme.accent, bold: true, children: "new" }),
          Box({ key: "r", flexGrow: 1, width: 0, minWidth: 1, overflow: "hidden", children: [
            els.Svg({ key: "line", alt: "new messages", height: 2, source: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="2" viewBox="0 0 ${W} 2" preserveAspectRatio="none"><rect width="${W}" height="2" fill="${theme.accent}"/></svg>` }),
          ] }),
        ] });
      }
      return Box({ key: row.key, flexShrink: 0, flexDirection: "row", children: [
        Text({ key: "t", color: theme.accent, bold: true, children: "new " }),
        Text({ key: "r", color: theme.accent, children: glyph.rule.repeat(Math.max(4, width - 4)) }),
      ] });
    case "time":
      return Box({ key: row.key, flexShrink: 0, flexDirection: "row", justifyContent: row.m.mine ? "flex-end" : "flex-start", paddingX: 1, children: [
        Text({ key: "t", color: theme.muted, children: formatTime(row.m.at) }),
      ] });
    case "head":
      // The desktop, like a phone: their name over their bubbles, nothing
      // over yours (they're at the right, in your color), the time under.
      if (els.Svg) {
        return Box({ key: row.key, flexShrink: 0, flexDirection: "row", marginTop: 1, paddingX: 1, children: row.m.mine ? [] : [
          Text({ key: "n", bold: true, color: nameColor(row.m.user_id), wrap: "truncate-end", children: displayName(row.m) }),
        ] });
      }
      // Theirs: "name 12:04" on the left. Yours: "12:04 you" on the right.
      return Box({ key: row.key, flexShrink: 0, flexDirection: "row", gap: 1, marginTop: 1,
        justifyContent: row.m.mine ? "flex-end" : "flex-start", children: row.m.mine ? [
          Text({ key: "t", color: theme.muted, children: formatTime(row.m.at) }),
          Text({ key: "n", bold: true, color: theme.you, children: "you" }),
        ] : [
          Text({ key: "n", bold: true, color: nameColor(row.m.user_id), wrap: "truncate-end", children: displayName(row.m) }),
          Text({ key: "t", color: theme.muted, children: formatTime(row.m.at) }),
        ] });
    default: {
      // A bubble: yours on the right in the accent, theirs on the left in grey.
      const mine = row.m.mine;
      const fill = mine ? theme.mineBubble : theme.theirBubble;
      // The desktop rounds each bubble with an outline in its own fill, which
      // also keeps two bubbles in a row apart. Its font is proportional, so
      // the bubble takes its words' width there, not a count of cells.
      const round = els.Svg ? { borderStyle: "round", borderColor: fill } : { width: row.bubble };
      // A gap of a few pixels (a Box is rows tall, so it's an empty drawing).
      const gap = row.gapAbove && els.Svg ? els.Svg({ key: "gap", source: K.svg(1, 6, ""), alt: "gap", width: 1, height: 6 }) : null;
      const line = Box({ key: gap ? "line" : row.key, flexShrink: 0, flexDirection: "row", justifyContent: mine ? "flex-end" : "flex-start", children: [
        Box({ key: "bubble", flexDirection: "column", ...round, flexShrink: 1, paddingX: 1,
          backgroundColor: fill, children: [
            Text({ key: "b", wrap: "wrap", color: mine ? theme.mineText : theme.theirText, children: row.m.body }),
          ] }),
      ] });
      return gap ? Box({ key: row.key, flexShrink: 0, flexDirection: "column", children: [gap, line] }) : line;
    }
  }
}

// ---------------------------------------------------------------- building blocks

// A rounded card, full width: a bold label and right-aligned meta on its
// first row. `grow` makes it take the pane's spare height, its content kept
// at the bottom (a chat reads upward from the input).
function card(els, { key, title, titleColor, meta, metaColor, metaNode, children, grow = false, marginTop = 0 }) {
  const { Box, Text } = els;
  const head = Box({ key: "head", flexDirection: "row", justifyContent: "space-between", gap: 1, children: [
    Text({ key: "title", bold: true, color: titleColor, wrap: "truncate-end", children: title }),
    metaNode ?? (meta ? Text({ key: "meta", color: metaColor ?? theme.muted, children: meta }) : null),
  ].filter(Boolean) });
  // A growing card takes the height left and no more (minHeight 0: left to
  // its content, it would grow past the pane and make the pane scroll), its
  // newest rows at the bottom and the oldest cut off at the top.
  const body = grow
    ? [Box({ key: "body", flexDirection: "column", flexGrow: 1, flexShrink: 1, minHeight: 0, justifyContent: "flex-end", overflow: "hidden", children })]
    : children;
  return Box({
    key, flexDirection: "column", borderStyle: "round", borderColor: theme.border, paddingX: 1, marginTop,
    flexGrow: grow ? 1 : 0, flexShrink: grow ? 1 : 0, ...(grow ? { minHeight: 0 } : {}), children: [head, ...body],
  });
}

function titleBar(els) {
  const { Box, Text } = els;
  const conn = connection();
  const who = state.auth === "signed_in" && state.user ? state.user.name : null;
  return Box({ key: "titlebar", flexDirection: "row", justifyContent: "space-between", children: [
    Box({ key: "brand", flexDirection: "row", gap: 1, children: [
      Text({ key: "logo", color: theme.accent, bold: true, children: `${glyph.brand} squad-chat` }),
      who ? Text({ key: "me", color: theme.muted, wrap: "truncate-end", children: who }) : null,
    ].filter(Boolean) }),
    Text({ key: "conn", color: conn.color, children: conn.text }),
  ] });
}

// The tabs: built-in and function rooms first, each in its own color, then
// a thin rule and the chat rooms. The tab on show is filled with its color;
// the others are pressable and carry a badge when something there is worth
// a glance. When the labels would wrap, the rooms not on show are drawn as
// their icon alone.
function roomTabs(els, handlers, width) {
  const { Box, Text, Button } = els;
  const view = activeView();
  const compact = tabRows(width, false) > 1;
  const tabs = [];
  for (const id of enabledRooms()) {
    const meta = roomMeta(id);
    const badge = view === id ? null : sysBadge(id);
    if (view === id) {
      tabs.push(Text({ key: `sys-${id}`, bold: true, color: theme.onAccent, backgroundColor: meta.color, children: ` ${meta.icon} ${meta.label} ` }));
      continue;
    }
    const tab = Button({ key: `sys-${id}`, plain: true, label: compact ? ` ${meta.icon}` : ` ${meta.icon} ${meta.label}`, dimColor: !badge, onPress: () => handlers.onSelectView?.(id) });
    tabs.push(badge ? Box({ key: `sysbox-${id}`, flexDirection: "row", gap: 1, children: [tab, Text({ key: "badge", bold: true, color: badge.color, children: badge.text })] }) : tab);
  }
  const chatTabs = [];
  if (state.auth === "signed_in" && state.rooms.length) {
    for (const r of state.rooms) {
      if (r.id === state.current && view === "chat") {
        chatTabs.push(Text({ key: `tab-${r.id}`, bold: true, color: theme.onAccent, backgroundColor: theme.accent, children: ` #${r.slug} ` }));
        continue;
      }
      const tab = Button({ key: `tab-${r.id}`, plain: true, label: ` #${r.slug}`, dimColor: !r.unread, onPress: () => handlers.onSelectRoom(r.id) });
      chatTabs.push(r.unread
        ? Box({ key: `tabbox-${r.id}`, flexDirection: "row", gap: 1, children: [tab, Text({ key: "badge", bold: true, color: theme.amber, children: String(r.unread) })] })
        : tab);
    }
  } else if (enabledRooms().length) {
    // Signed out or no room yet: one tab back to the chat's own screens.
    chatTabs.push(view === "chat"
      ? Text({ key: "tab-chat", bold: true, color: theme.onAccent, backgroundColor: theme.accent, children: " # chat " })
      : Button({ key: "tab-chat", plain: true, dimColor: true, label: " # chat", onPress: () => handlers.onSelectView?.("chat") }));
  }
  const rule = tabs.length && chatTabs.length ? [Text({ key: "rule", color: theme.muted, children: glyph.bar })] : [];
  return Box({ key: "tabs", flexDirection: "row", flexWrap: "wrap", columnGap: 1, children: [...tabs, ...rule, ...chatTabs] });
}

// How many rows the tabs take at `width`: they wrap like words. `compact`
// as roomTabs decides it, unless given.
// The desktop's header: the ◆ and the built-in rooms as icons on one line
// (the one shown with its name), a "+" after them that lists the rooms
// without a tab to add, and live at the end; the chat rooms on a line of
// their own under it, with "＋ join".
function headerDesk(els, handlers) {
  const { Box, Text, Button } = els;
  const view = activeView();
  const conn = connection();
  const lines = [];
  // A pill: rounded, filled, its words set in it. A Text's ground is square
  // on the desktop, so the tab shown and the badges are drawings (they're
  // not pressed: the tab shown is already shown, a badge rides its tab).
  const pill = (key, text, fill, ink, { bold = true, h = 22 } = {}) => {
    const t = String(text).replace(/[<&>"]/g, "");
    const tw = Math.ceil(textW(t) * (13 / 11.5)) + [...t].filter((ch) => cells(ch) === 1 && !/[\x20-\x7e]/.test(ch)).length * 4;
    const W = tw + 16;
    return els.Svg({ key, alt: t, width: W, height: h, source: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" font-family="-apple-system, system-ui, sans-serif">`
      + `<rect width="${W}" height="${h}" rx="${h / 2.6}" fill="${fill}"/>`
      + `<text x="8" y="${h / 2 + 4.5}" font-size="13" font-weight="${bold ? 600 : 400}" fill="${ink}" textLength="${tw}" lengthAdjust="spacingAndGlyphs">${t}</text></svg>` });
  };
  const hex = (c, fallback) => (/^#[0-9a-f]{6}$/i.test(c ?? "") ? c : fallback);
  const tabs = enabledRooms().map((id) => {
    const meta = roomMeta(id);
    if (view === id) return pill(`sys-${id}`, `${meta.icon} ${meta.label}`, hex(meta.color, theme.accent), theme.onAccent);
    const badge = sysBadge(id);
    const tab = Button({ key: `sys-${id}`, plain: true, label: ` ${meta.icon}`, dimColor: !badge, onPress: () => handlers.onSelectView?.(id) });
    return badge ? Box({ key: `sysbox-${id}`, flexDirection: "row", alignItems: "center", columnGap: 1, children: [tab, pill("badge", badge.text, hex(badge.color, theme.amber), theme.onAccent, { h: 18 })] }) : tab;
  });
  lines.push(Box({ key: "titlebar", flexDirection: "row", alignItems: "center", columnGap: 1, children: [
    Text({ key: "logo", color: theme.accent, bold: true, children: glyph.brand }),
    Box({ key: "tabs", flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 1, flexShrink: 1, minWidth: 0, children: [
      ...tabs,
      Button({ key: "add-room", plain: true, dimColor: !state.addingRoom, label: " +", onPress: () => handlers.onToggleAddRoom?.() }),
    ] }),
    Box({ key: "push", flexGrow: 1, minWidth: 1 }),
    Text({ key: "conn", color: conn.color, children: conn.text }),
  ] }));
  // A few pixels between the lines (a Box is rows tall: an empty drawing).
  const gap = (key) => els.Svg({ key, source: K.svg(1, 6, ""), alt: "gap", width: 1, height: 6 });
  if (state.addingRoom) {
    // The rooms without a tab: one press gives each its tab, as
    // /chat rooms +name does (a room that reaches the web says where).
    const hidden = roomIds().filter((id) => !enabledRooms().includes(id));
    lines.push(gap("gap-add"));
    lines.push(Box({ key: "add-rooms", flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 2, children: [
      Text({ key: "l", color: theme.muted, children: hidden.length ? "add a room" : "Every room has a tab. More come from /chat store." }),
      ...hidden.map((id) => {
        const meta = roomMeta(id);
        return Button({ key: `add-${id}`, plain: true, label: `+ ${meta.icon} ${meta.label}`, onPress: () => handlers.onAddRoom?.(id) });
      }),
      Button({ key: "add-close", plain: true, dimColor: true, label: "✕", onPress: () => handlers.onToggleAddRoom?.() }),
    ] }));
  }
  // Each chat room a chip: the desktop's own button, rounded and a line
  // tall (an outlined Box takes a row above and below), its unread count in
  // the accent beside the name. The one shown is a drawn pill, outlined in
  // the accent; "＋ join" a dim button.
  const outlined = (key, text) => {
    const t = String(text).replace(/[<&>"]/g, "");
    const tw = Math.ceil(textW(t) * (13 / 11.5));
    const W = tw + 20, h = 24;
    return els.Svg({ key, alt: t, width: W, height: h, source: `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${h}" viewBox="0 0 ${W} ${h}" font-family="-apple-system, system-ui, sans-serif">`
      + `<rect x="0.75" y="0.75" width="${W - 1.5}" height="${h - 1.5}" rx="7" fill="none" stroke="${theme.accent}" stroke-width="1.5"/>`
      + `<text x="10" y="16.5" font-size="13" font-weight="600" fill="${theme.accent}" textLength="${tw}" lengthAdjust="spacingAndGlyphs">${t}</text></svg>` });
  };
  const chats = [];
  if (state.auth === "signed_in") {
    for (const r of state.rooms) {
      if (r.id === state.current && view === "chat") { chats.push(outlined(`tab-${r.id}`, `#${r.slug}`)); continue; }
      // A Button holds only its label (older releases refuse Text inside it):
      // the unread count is a pill beside the chip.
      const chipBtn = Button({ key: `tab-${r.id}`, label: `#${r.slug}`, onPress: () => handlers.onSelectRoom(r.id) });
      chats.push(r.unread
        ? Box({ key: `chipbox-${r.id}`, flexDirection: "row", alignItems: "center", columnGap: 1, children: [chipBtn, pill("badge", String(r.unread), theme.accent, theme.onAccent, { h: 18 })] })
        : chipBtn);
    }
    // "＋ join" opens one field at a time to its right: the room's name, then
    // (Enter, or next) its passcode with the name as a chip before it.
    // It stays where it is and opens the fields to its right; pressed
    // again it folds them. A button a press takes away took the pane's focus
    // with it (the next click only gave it back), so the buttons here stay:
    // a plain one (the desktop's own chip lost clicks to a redraw), and one
    // "next →" that turns into "Join" under the same key.
    const j = state.join;
    chats.push(Button({ key: "join-room", plain: true, dimColor: !j, label: "＋ join", onPress: () => (j ? handlers.onJoinCancel?.() : handlers.onJoinStart?.()) }));
    if (j) {
      if (j.step === "pass") chats.push(Button({ key: "join-back", label: `#${j.name}`, onPress: () => handlers.onJoinBack?.() }));
      // The field's own submit button shows only while it has the focus, so
      // a click elsewhere hid it and moved what came after it: the button
      // here is drawn always, and reads what was typed (onInput).
      chats.push(j.step === "name"
        ? els.Input({ key: "join-name", placeholder: "room name", ...(j.name ? { value: j.name } : {}), onInput: (v) => handlers.onJoinTyping?.(v), onSubmit: (v) => handlers.onJoinName?.(v) })
        : els.Input({ key: "join-pass", placeholder: "passcode", onInput: (v) => handlers.onJoinTyping?.(v), onSubmit: (v) => handlers.onJoinPass?.(v) }));
      chats.push(Button({ key: "join-go", plain: true, label: j.step === "name" ? "next →" : "Join", onPress: () => (state.join?.step === "name"
        ? handlers.onJoinName?.(state.join?.draft ?? state.join?.name ?? "")
        : handlers.onJoinPass?.(state.join?.draft ?? "")) }));
      chats.push(Button({ key: "join-cancel", plain: true, dimColor: true, label: "✕", onPress: () => handlers.onJoinCancel?.() }));
    }
  } else {
    chats.push(view === "chat"
      ? outlined("tab-chat", "# chat")
      : Button({ key: "tab-chat", dimColor: true, label: "# chat", onPress: () => handlers.onSelectView?.("chat") }));
  }
  lines.push(gap("gap-chats"));
  lines.push(Box({ key: "chats", flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: 1, children: [
    Text({ key: "l", color: theme.muted, children: "chats" }),
    ...chats,
  ] }));
  if (state.join?.error) lines.push(Text({ key: "join-error", color: theme.error, wrap: "wrap", children: `✗ ${state.join.error}` }));
  return lines;
}

function tabRows(width, compact = tabRows(width, false) > 1) {
  const view = activeView();
  const widths = enabledRooms().map((id) => {
    const badge = view === id ? null : sysBadge(id);
    const meta = roomMeta(id);
    const label = view === id ? ` ${meta.icon} ${meta.label} ` : compact ? ` ${meta.icon}` : ` ${meta.icon} ${meta.label}`;
    return cells(label) + (badge ? 1 + cells(badge.text) : 0);
  });
  if (widths.length) widths.push(1);   // the rule
  if (state.auth === "signed_in" && state.rooms.length) {
    for (const r of state.rooms) widths.push(cells(` #${r.slug} `) + (r.unread ? 1 + String(r.unread).length : 0));
  } else if (widths.length) widths.push(8);
  let rows = 1;
  let used = 0;
  for (const w of widths) {
    if (used && used + 1 + w > width) { rows++; used = w; } else used += (used ? 1 : 0) + w;
  }
  return rows;
}

function friendsCard(els, width) {
  const { Box, Text } = els;
  const friends = state.friends;
  const online = friends.filter((f) => f.online).length;
  const chips = friends.map((f) => Box({ key: f.user_id, flexDirection: "row", children: [
    Text({ key: "dot", color: f.busy ? theme.amber : f.online ? theme.online : theme.muted, children: `${f.busy ? glyph.busy : f.online ? glyph.on : glyph.off} ` }),
    Text({ key: "name", color: f.online ? undefined : theme.muted, children: f.busy ? `${f.name} (busy)` : f.name }),
  ] }));
  // The desktop: each friend a chip, a round initial in their color (grey
  // while away), the name, and a dot: green online, amber busy, grey away.
  // One drawing, so it's a slim pill: a bordered Box takes a row above and
  // below. The drawing can't measure words, so the name is set to the width
  // guessed for it (textLength), at 13 px from the 11.5 px guess.
  const deskChip = (f) => {
    const c = f.online ? nameColor(f.user_id) : "#5A5955";
    const dot = f.busy ? theme.amber : f.online ? theme.online : "#5A5955";
    const esc = (t) => String(t).replace(/[<&>"]/g, "");
    const initial = esc((String(f.name).match(/[\p{L}\p{N}]/u)?.[0] ?? "?").toUpperCase());
    const name = esc(f.busy ? `${f.name} (busy)` : f.name);
    const nw = Math.ceil(textW(name) * (13 / 11.5));
    const W = 3 + 20 + 7 + nw + 8 + 8 + 10, H = 26;
    const source = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="-apple-system, system-ui, sans-serif">`
      + `<rect x="0.5" y="0.5" width="${W - 1}" height="${H - 1}" rx="${(H - 1) / 2}" fill="#262624" stroke="#3A3936"/>`
      + `<circle cx="13" cy="13" r="10" fill="${c}"/>`
      + `<text x="13" y="17" text-anchor="middle" font-size="11" font-weight="700" fill="#1F1E1D">${initial}</text>`
      + `<text x="30" y="17.5" font-size="13" fill="${f.online ? "#E8E6E1" : "#8F8D87"}" textLength="${nw}" lengthAdjust="spacingAndGlyphs">${name}</text>`
      + `<circle cx="${W - 14}" cy="13" r="4" fill="${dot}"/></svg>`;
    return els.Svg({ key: f.user_id, source, alt: `${name} ${f.busy ? "busy" : f.online ? "online" : "away"}`, width: W, height: H });
  };
  const body = friends.length
    ? Box({ key: "list", flexDirection: "row", flexWrap: "wrap", columnGap: els.Svg ? 1 : 2, rowGap: 0, children: els.Svg ? friends.map(deskChip) : chips })
    : Text({ key: "none", color: theme.muted, children: "Share a room's name and passcode to add friends." });
  const textLen = friends.reduce((n, f) => n + f.name.length + (f.busy ? 7 : 0) + 4, 0);
  const height = 3 + (friends.length ? rowsFor("x".repeat(textLen), width - 4) : rowsFor("Share a room's name and passcode to add friends.", width - 4));
  return { node: card(els, { key: "friends", title: "FRIENDS", meta: `${online}/${friends.length} online`, marginTop: 1, children: [body] }), height };
}

// The terminal lights the frame while the pane holds the keyboard. The
// desktop's field draws its own focus, and a tree that changed with focus
// there made the box blink as focus moved, so it stays one color and the
// field waits for a click instead of taking the focus on every draw. The
// desktop draws its field at a width of its own, and Clawd sits in the room
// the frame has past it when the Pet room has a tab.
function inputBox(els, mode, { onSubmit, onInput }, focused, surface, columns = 0) {
  const { Box, Text, Input } = els;
  const terminal = surface !== "desktop";
  return Box({ key: "compose-box", flexDirection: "row", alignItems: "center", marginTop: 1, flexShrink: 0, borderStyle: "round", borderColor: terminal && !focused ? theme.border : theme.accent, paddingX: 1, children: [
    Text({ key: "prompt", color: theme.accent, bold: true, children: `${glyph.prompt} ` }),
    // The desktop's field keeps its own width: Clawd's track takes what's left.
    Box({ key: "field", flexGrow: terminal ? 1 : 0, ...(terminal ? {} : { flexShrink: 0 }), minWidth: 0, children: [
      Input({ key: "compose", placeholder: mode.placeholder, submitLabel: mode.label, value: state.draft ?? "", ...(terminal ? { autoFocus: true } : {}), onInput, onSubmit }),
    ] }),
    // Clawd walks the room after the field, or sits at its end.
    ...(terminal ? [] : (() => {
      const clawd = petBeside(els, { columns });
      return [clawd.fills ? null : Box({ key: "push", flexGrow: 1, minWidth: 1 }), clawd.row];
    })()),
  ].filter(Boolean) });
}

// The hints under the box keep their row: a cut ("truncate-end") text can
// otherwise be squeezed by the column as the chat card shrinks, and the
// desktop drew it cut off at the bottom.
function hints(els, text) {
  const { Box, Text } = els;
  return Box({ key: "hints", flexShrink: 0, children: [Text({ key: "t", color: theme.muted, wrap: "truncate-end", children: text })] });
}

// "sam is typing…", in the row the key hints use, so nothing moves.
function typingLine(els, text) {
  const { Box, Text } = els;
  return Box({ key: "hints", flexShrink: 0, children: [Text({ key: "t", color: theme.muted, italic: true, wrap: "truncate-end", children: `${glyph.typing} ${text}` })] });
}

// The notice, and beside it the button that takes back what it says was
// done (a habit deleted: Cancel), while that can still be taken back.
function notice(els, handlers) {
  const { Box, Text, Button } = els;
  if (!state.notice) return null;
  const text = Text({ key: "notice", color: theme.warn, wrap: "wrap", children: state.notice });
  const undo = state.undo;
  if (!handlers || !undo || undo.text !== state.notice || Date.now() >= undo.until) return text;
  return Box({ key: "notice-row", flexDirection: "row", alignItems: "center", columnGap: 1, children: [
    Box({ key: "t", flexShrink: 1, minWidth: 0, children: [text] }),
    Button({ key: "notice-undo", label: undo.label, onPress: () => handlers.onUndo?.() }),
  ] });
}

// What the input box is for right now.
const SYS_INPUT = {
  usage: { placeholder: "/git · /agents · /share usage [#room] · /help", label: "run" },
  git: { placeholder: "r to refresh · /share git [#room] · /help", label: "run" },
  agents: { placeholder: "/usage · /git · /share agents [#room] · /help", label: "run" },
  focus: { placeholder: "start · pause · skip · reset · 50 10 sets the minutes", label: "run" },
  habits: { placeholder: "a new habit: Read 30 min, or Water x8 for 8 times a day", label: "add" },
  toolbox: { placeholder: "text for the tool, a tool's name, or /tool hash hello", label: "run" },
  clipboard: { placeholder: "clear · /help", label: "run" },
  pet: { placeholder: "auto, or a mood: vibe typing wave cheer sleepy …", label: "run" },
};
function inputMode() {
  const view = activeView();
  if (view === "snippet" || fnAdds(view)) return { placeholder: fnPlaceholder(view), label: "add" };   // what's typed there is saved
  if (view !== "chat") return SYS_INPUT[view] ?? { placeholder: fnPlaceholder(view), label: "run" };
  if (state.bridge !== "ready") return null;
  if (state.auth === "signed_out") return { placeholder: "you@example.com, or a name", label: "continue" };
  if (state.auth === "code_sent") return { placeholder: "8-digit code from the email", label: "sign in" };
  if (state.auth !== "signed_in") return null;
  if (!currentRoom()) return { placeholder: "/room <name> <passcode>", label: "join" };
  return { placeholder: "Message", label: "send" };
}

// Screens before there's a room to show: sign-in steps, errors, waiting.
function setupCard(els, width) {
  const { Text } = els;
  const line = (key, children, extra = {}) => Text({ key, wrap: "wrap", children, ...extra });
  if (state.bridge === "unavailable") {
    return card(els, { key: "setup", marginTop: 1, title: "CAN'T START", titleColor: theme.error, children: [line("why", state.detail)] });
  }
  if (state.bridge === "unconfigured") {
    return card(els, { key: "setup", marginTop: 1, title: "CONNECT A SERVER", titleColor: theme.accent, children: [
      line("a", "squad-chat talks to your squad's own Supabase server."),
      line("b", "Ask whoever runs it for the URL and publishable key, or host one yourself (see the README)."),
      line("c", "Then set them in /config under squad-chat, or run:", { color: theme.muted }),
      line("d", "claude plugin configure squad-chat@squad-chat", { color: theme.accent }),
    ] });
  }
  if (state.bridge !== "ready" || state.auth === "starting") {
    return card(els, { key: "setup", marginTop: 1, title: "CONNECTING", meta: "…", children: [line("wait", state.detail || "Starting the chat in the background.", { color: theme.muted })] });
  }
  if (state.auth === "signed_out") {
    return card(els, { key: "setup", marginTop: 1, title: "SIGN IN", meta: "step 1 of 2", children: [
      line("a", "Chat with your friends while you code."),
      line("b", "Enter your email to get a sign-in code, or just pick a name if your server allows it.", { color: theme.muted }),
    ] });
  }
  if (state.auth === "code_sent") {
    return card(els, { key: "setup", marginTop: 1, title: "SIGN IN", meta: "step 2 of 2", children: [
      line("a", `Code sent to ${state.email}.`),
      line("b", "Type it below. Wrong address? Enter another email.", { color: theme.muted }),
    ] });
  }
  return card(els, { key: "setup", marginTop: 1, title: "JOIN A ROOM", children: [
    line("a", "Create a room, or join a friend's with its passcode:"),
    line("b", "/room <name> <passcode>", { color: theme.accent }),
    line("c", "Share the name and passcode with whoever you want in it.", { color: theme.muted }),
  ] });
}

// ---------------------------------------------------------------- the pane

// `els` is the surface's element table ($.ui.resolve(e)), `props` the Pane's.
export function paneView(els, props, handlers) {
  return props.placement === "inline" ? inlineView(els, props, handlers) : dockView(els, props, handlers);
}

function dockView(els, props, handlers) {
  const { Box, Text } = els;
  const width = Math.max(24, (props.bodyColumns || 48));
  const bodyRows = props.scroll?.bodyRows || 30;
  const room = currentRoom();
  const mode = inputMode();
  const view = activeView();
  const desk = props.surface === "desktop" && els.Svg;
  const parts = desk ? headerDesk(els, handlers) : [titleBar(els)];
  let used = desk ? parts.length : 1;

  if (desk) {
    // A room's first card sits half a row below the header (a Box is rows
    // tall, so the gap is an empty drawing); the chat's first card keeps its margin.
    if (view !== "chat") parts.push(els.Svg({ key: "gap-tabs", source: K.svg(1, 10, ""), alt: "gap", width: 1, height: 10 }));
  } else if (enabledRooms().length || (state.auth === "signed_in" && state.rooms.length)) {
    parts.push(roomTabs(els, handlers, width));
    used += tabRows(width);
    // The desktop sets a room's first card half a row below its tabs. A Box
    // is rows tall, so the gap is an empty drawing, sized in pixels; the
    // chat's first card keeps its own margin.
    if (props.surface === "desktop" && els.Svg && view !== "chat") {
      parts.push(els.Svg({ key: "gap-tabs", source: K.svg(1, 10, ""), alt: "gap", width: 1, height: 10 }));
    }
  }

  if (view !== "chat") {
    const n = notice(els, handlers);
    const pending = shareCard(els, handlers, width);
    const tail = 1 + 3 + 1 + (n ? rowsFor(state.notice, width) : 0) + (pending?.height ?? 0);   // gap + input box + hints + notice + preview
    // The desktop scrolls the pane itself (its own bar, the wheel and the
    // trackpad), so there every card is drawn whole and nothing is windowed;
    // the terminal keeps the cards in a window that fits, with its own bar.
    const capacity = props.surface === "desktop" ? 1000 : Math.max(4, bodyRows - used - tail - 1);       // one row the dock reserves
    // The room's own scroll: it starts at the top, and cards taller than the
    // window are laid out a cell narrower to leave the scrollbar its column.
    if (state.dockScroll.view !== view) state.dockScroll = { view, offset: 0, max: 0 };
    const scroll = state.dockScroll;
    let cards = sysDock(els, view, width, capacity, { ...handlers, scroll });
    if (scroll.max) cards = sysDock(els, view, width - 1, capacity, { ...handlers, scroll });
    scroll.offset = Math.min(scroll.offset, scroll.max);
    parts.push(...cards);
    parts.push(Box({ key: "spacer", flexGrow: 1 }));
    if (pending) parts.push(pending.node);
    if (n) parts.push(n);
    parts.push(inputBox(els, mode, handlers, props.isFocused, props.surface, props.bodyColumns));
    parts.push(sysHints(els, view, handlers));
  } else if (state.auth === "signed_in" && room) {
    const friends = friendsCard(els, width);
    parts.push(friends.node);
    used += 1 + friends.height;

    const n = notice(els);
    const pending = shareCard(els, handlers, width);
    const tail = 1 + 3 + 1 + (n ? rowsFor(state.notice, width) : 0) + (pending?.height ?? 0);   // gap + input box + hints + notice + preview
    // The gap above the card, its border and head, and one row the dock reserves (its close mark).
    const capacity = Math.max(3, bodyRows - used - tail - 1 - 3 - 1);
    const here = (state.online.get(room.id) ?? []).filter((u) => u.user_id !== state.user?.id).length;
    const list = roomMessages();
    // Scrolled up (the wheel over the chat, or ▲): the newest `back` stay
    // below the window. The desktop's rows are taller than the cells counted
    // here: it gets more than fit, and the card cuts the oldest off at its top.
    if (state.chatScroll.room !== room.id) state.chatScroll = { room: room.id, back: 0 };
    const back = Math.min(state.chatScroll.back, Math.max(0, list.length - 1));
    const upTo = back ? list.slice(0, list.length - back) : list;
    const fitted = fitRows(messageRows(upTo, width - 4, state.dividerAt?.get(room.id) ?? 0), els.Svg ? capacity * 3 : capacity);
    // How many are above the window: counted on the terminal. The desktop's
    // card cuts its top off unseen, so there ▲ shows while anything at all
    // is above the newest drawn, uncounted.
    const firstShown = fitted.find((r) => r.m)?.m.id;
    const older = els.Svg ? (upTo.length > 1 ? -1 : 0) : Math.max(0, list.findIndex((m) => m.id === firstShown));
    const rows = els.Svg ? withGroupTimes(fitted) : fitted;
    const body = list.length
      ? rows.map((r) => drawRow(els, r, width - 4, handlers.onCopy))   // inside the card's border and padding
      : [Text({ key: "empty", color: theme.muted, children: "No messages yet. Say hi!" })];
    // ▲ shows older messages, ↓ goes back to the newest; who's here after them.
    const metaNode = Box({ key: "meta", flexDirection: "row", alignItems: "center", columnGap: 1, flexShrink: 0, children: [
      older ? els.Button({ key: "chat-older", plain: true, dimColor: true, label: older > 0 ? `▲ ${older} older` : "▲ older", onPress: () => handlers.onChatScroll?.(1) }) : null,
      back ? els.Button({ key: "chat-newest", plain: true, label: `↓ ${back} newer`, onPress: () => handlers.onChatScroll?.(0) }) : null,
      Text({ key: "here", color: here ? theme.online : theme.muted, children: here ? `${here} here` : "just you" }),
    ].filter(Boolean) });
    parts.push(card(els, {
      key: "room", title: `#${room.slug}`, titleColor: theme.accent, marginTop: 1, metaNode,
      children: body, grow: true,
    }));
    if (pending) parts.push(pending.node);
    if (n) parts.push(n);
    if (mode) parts.push(inputBox(els, mode, handlers, props.isFocused, props.surface, props.bodyColumns));
    const typing = typingText(room.id);
    parts.push(typing ? typingLine(els, typing) : hints(els, "enter send · esc back · /room · /who · /help"));
  } else {
    parts.push(setupCard(els, width));
    const n = notice(els);
    if (n) parts.push(n);
    if (mode) parts.push(inputBox(els, mode, handlers, props.isFocused, props.surface, props.bodyColumns));
    if (mode) parts.push(hints(els, state.auth === "signed_in" ? "you can type /room right here" : "enter to continue · esc back"));
  }

  // Fill the dock's height so the input sits at the bottom.
  return Box({ flexDirection: "column", height: bodyRows, children: parts });
}

const SYS_HINTS = {
  usage: "Context ▸ breaks it down",
  git: "↻ or r refreshes · ⧉ copies a link",
  agents: "▾ folds a session · all ▾ filters the feed",
  focus: "a chime when focus or a break ends",
  habits: "✓ checks off today · ✕ deletes · rename <old> -> <new>",
  toolbox: "⧉ copies · kept in memory, never shared",
  clipboard: "⧉ copies again · kept in memory, never shared",
  pet: "Clawd follows what goes on, or keeps one mood",
};

// A built-in room's hints, after a Share button that posts its snapshot
// (the preview card picks the room).
function sysHints(els, view, handlers) {
  const { Box, Text, Button } = els;
  const share = hasSnapshot(view);
  return Box({ key: "hints", flexDirection: "row", gap: 1, flexShrink: 0, children: [
    share ? Box({ key: "share", flexShrink: 0, children: [
      Button({ key: "share-snapshot", plain: true, label: "⇪ Share", onPress: () => handlers.onShare?.(view) }),
    ] }) : null,
    Text({ key: "t", color: theme.muted, wrap: "truncate-end", children: `${share ? "· " : ""}${(els.Svg && view === "git" ? "↻ or r refreshes · ↗ opens a link" : SYS_HINTS[view]) ?? fnHint(view)}` }),
  ].filter(Boolean) });
}

// Where a waiting snippet goes: "‹ #room ›", stepping through your rooms
// (wrapping at either end), then its place in the list and who's there.
function shareTargets(els, p, handlers) {
  const { Box, Text, Button } = els;
  const n = state.rooms.length;
  if (n < 2) return null;
  const i = Math.max(0, state.rooms.findIndex((r) => r.id === p.room));
  const step = (d) => handlers.onShareTarget?.(state.rooms[(i + d + n) % n].id);
  const here = (state.online.get(p.room) ?? []).filter((u) => u.user_id !== state.user?.id).length;
  return Box({ key: "to", flexDirection: "row", alignItems: "center", gap: 1, children: [
    Text({ key: "label", color: theme.muted, children: "to" }),
    Box({ key: "stepper", flexDirection: "row", flexShrink: 0, children: [
      Button({ key: "to-prev", plain: true, label: "‹", onPress: () => step(-1) }),
      Text({ key: "room", bold: true, children: ` #${p.slug} ` }),
      Button({ key: "to-next", plain: true, label: "›", onPress: () => step(1) }),
    ] }),
    Text({ key: "pos", color: theme.muted, wrap: "truncate-end", children: `${i + 1} / ${n} · ` }),
    Text({ key: "here", color: here ? theme.online : theme.muted, wrap: "truncate-end", children: here ? `${here} here` : "just you" }),
  ] });
}

// A snippet waiting for a look before it goes out: where it goes, Send and Cancel.
const PREVIEW_ROWS = 5;
function shareCard(els, handlers, width = 48) {
  const p = state.pendingShare;
  if (!p || Date.now() > p.until) return null;
  const { Box, Text, Button } = els;
  const targets = shareTargets(els, p, handlers);
  // A line of chat shows as it will read, a card with its title bar, other
  // snippets their first lines.
  let preview, rows;
  if (p.kind === "text") {
    preview = Box({ key: "text", paddingX: 1, backgroundColor: theme.theirBubble, children: [Text({ key: "t", color: theme.theirText, children: p.body })] });
    rows = rowsFor(p.body, width - 6);
  } else {
    const parts = snippetParts(p);
    const lines = snippetLines(parts.body, p.kind, PREVIEW_ROWS);
    preview = Box({ key: "code", flexDirection: "column", backgroundColor: theme.theirBubble, children: [
      parts.color ? Box({ key: "head", paddingX: 1, backgroundColor: parts.color, children: [Text({ key: "t", bold: true, color: theme.onAccent, wrap: "truncate-end", children: parts.title })] }) : null,
      Box({ key: "body", flexDirection: "column", paddingX: 1, children: snippetBody(els, { kind: p.kind, ...lines, color: parts.color }) }),
    ].filter(Boolean) });
    rows = (parts.color ? 1 : 0) + lines.shown.length + (lines.more ? 1 : 0);
  }
  const children = [
    preview,
    p.secret ? Text({ key: "secret", color: theme.warn, wrap: "truncate-end", children: `⚠ looks like it has ${p.secret}` }) : null,
    targets,
    Box({ key: "actions", flexDirection: "row", gap: 2, marginTop: 1, children: [
      Button({ key: "send", label: `Send to #${p.slug}`, variant: "primary", onPress: () => handlers.onShare?.("send") }),
      Button({ key: "cancel", label: "Cancel", onPress: () => handlers.onShare?.("cancel") }),
    ] }),
  ].filter(Boolean);
  const height = 1 + 3 + rows + (p.secret ? 1 : 0) + (targets ? 1 : 0) + 1 + 1;   // the gap above it, and one above the buttons
  return { node: card(els, { key: "share", marginTop: 1, title: "SHARE?", titleColor: theme.amber, meta: snippetTitle(p), children }), height };
}

// The compact pane's one line for a waiting snippet.
function pendingLine(els) {
  const p = state.pendingShare;
  if (!p || Date.now() > p.until) return null;
  const to = state.rooms.length > 1 ? ", /share to #room" : "";
  return els.Text({ key: "share", color: theme.amber, wrap: "truncate-end", children: `📎 ${snippetTitle(p)} for #${p.slug}: /share send${to} or /share cancel` });
}

// Above the prompt: as little as reads well.
function inlineView(els, props, handlers) {
  const { Box, Text } = els;
  const width = Math.max(24, (props.bodyColumns || 48));
  const room = currentRoom();
  const mode = inputMode();
  const conn = connection();
  const view = activeView();
  const parts = [];

  if (view !== "chat") {
    parts.push(...sysInline(els, view, width, handlers));
    const share = pendingLine(els);
    if (share) parts.push(share);
  } else if (state.auth === "signed_in" && room) {
    const names = (state.online.get(room.id) ?? []).filter((u) => u.user_id !== state.user?.id).map((u) => u.name);
    parts.push(Box({ key: "header", flexDirection: "row", justifyContent: "space-between", children: [
      Box({ key: "left", flexDirection: "row", gap: 1, flexShrink: 1, children: [
        Text({ key: "room", bold: true, color: theme.accent, children: `${glyph.brand} #${room.slug}` }),
        Text({ key: "online", color: names.length ? theme.online : theme.muted, wrap: "truncate-end", children: names.length ? `${glyph.on} ${names.join(", ")}` : "just you" }),
      ] }),
      Text({ key: "conn", color: conn.color, children: conn.text }),
    ] }));
    const list = roomMessages().slice(-5);
    if (!list.length) parts.push(Text({ key: "empty", color: theme.muted, children: "No messages yet. Say hi!" }));
    // A name column, filled only where the sender changes.
    const nameWidth = Math.min(12, Math.max(...list.map((m) => displayName(m).length), 3));
    let prevUser = null;
    for (const m of list) {
      const name = m.user_id === prevUser ? "" : displayName(m).slice(0, nameWidth);
      prevUser = m.user_id;
      parts.push(Box({ key: `m${m.id}`, flexDirection: "row", gap: 1, children: [
        Box({ key: "n", width: nameWidth, flexShrink: 0, children: [
          Text({ key: "t", bold: true, color: m.mine ? theme.you : nameColor(m.user_id), children: name }),
        ] }),
        Text({ key: "b", wrap: "truncate-end", children: oneLine(m) }),
      ] }));
    }
    const typing = typingText(room.id);
    if (typing) parts.push(typingLine(els, typing));
    const share = pendingLine(els);
    if (share) parts.push(share);
  } else {
    parts.push(titleBar(els));
    parts.push(setupCard(els, width));
  }
  const n = notice(els);
  if (n) parts.push(n);
  if (mode) {
    const { Input } = els;
    parts.push(Box({ key: "compose-row", flexDirection: "row", marginTop: 0, children: [
      Text({ key: "prompt", color: theme.accent, bold: true, children: `${glyph.prompt} ` }),
      Box({ key: "field", flexGrow: 1, children: [
        Input({ key: "compose", placeholder: mode.placeholder, submitLabel: mode.label, value: state.draft ?? "", autoFocus: true, onInput: handlers.onInput, onSubmit: handlers.onSubmit }),
      ] }),
    ] }));
  }
  return Box({ flexDirection: "column", children: parts });
}

// ---------------------------------------------------------------- the band

// The chat room on the desktop: faces of who's online, what's new, and the
// latest message (or who's typing).
function chatBandDesktop(els, { onOpen, onCycle, columns }) {
  const room = currentRoom();
  const others = (state.online.get(room.id) ?? []).filter((u) => u.user_id !== state.user?.id);
  const live = state.bridge === "ready" && state.roomStatus.get(room.id) === "SUBSCRIBED";
  const unreadHere = room.unread ?? 0;
  const unreadElsewhere = totalUnread() - unreadHere;
  const sections = [];
  if (!live) sections.push({ key: "live", color: theme.warn, parts: [pValue("○ reconnecting", theme.warn)] });
  else {
    const faces = others.map((u) => ({ initial: String(u.name ?? "?").trim().charAt(0).toUpperCase() || "?", color: nameColor(u.user_id) }));
    sections.push({ key: "online", color: theme.online, parts: [
      faces.length ? draw(K.faces(faces), `${faces.length} online`) : null,
      pValue(String(others.length)),
      pSub("online"),
    ], tip: others.length ? [`${others.length} online in #${room.slug}`, ...others.slice(0, 6).map((u) => u.name)] : [`Nobody else in #${room.slug} right now`] });
  }
  if (isQuiet()) {
    const n = unreadHere + unreadElsewhere;
    sections.push({ key: "quiet", color: theme.muted, parts: [pSub(`${glyph.quiet} ${n ? `${n} new · ` : ""}do not disturb`)] });
  } else {
    if (unreadHere || unreadElsewhere) {
      sections.push({ key: "new", color: theme.accent, parts: [
        unreadHere ? pChip(`${unreadHere} new`, theme.accent, theme.onAccent) : null,
        unreadElsewhere ? pSub(`+${unreadElsewhere} elsewhere`) : null,
      ] });
    }
    const typing = typingText(room.id);
    const last = lastMessage();
    if (typing) sections.push({ key: "msg", color: theme.muted, grow: true, parts: [draw(K.typing(theme.muted), typing), pMsg(typing, { dim: true })] });
    else if (last) {
      const who = last.mine ? theme.you : nameColor(last.user_id);
      sections.push({ key: "msg", color: who, grow: true, parts: [pValue(displayName(last), who), pMsg(oneLine(last))] });
    }
  }
  return capsule(els, { room: `${glyph.brand} #${room.slug}`, color: theme.accent, sections, onOpen, onCycle, columns });
}

// A band's text. The terminal cuts it to its columns, which are exact there.
// VS Code counts columns in a proportional font's "0"s, too few for the room
// the text has, so it draws all of it and the row ends it with "…" where the
// band runs out, as wide or narrow as the panel is.
function bandMsg(els, view, props, meta, onCycle) {
  const { Box, Text } = els;
  const terminal = props.surface === "terminal";
  const pieces = sysBandPieces(view, terminal ? Math.max(20, (props.bodyColumns || 100) - cells(`${meta.icon} ${meta.label}`) - 16 - (onCycle ? CYCLE_CELLS : 0)) : 0);
  const text = (p, wrap) => Text({ key: "t", color: p.color, bold: p.bold, wrap, children: p.text });
  if (terminal) return pieces.map((p, i) => Box({ key: `p${i}`, flexShrink: 0, children: [text(p)] }));
  // Each piece sits beside a box of the ones after it, which gives way
  // first: the band shortens from its end, one piece at a time, and only the
  // piece where it runs out shows "…". Shrink weights alone squeezed them all.
  const rest = (i) => i >= pieces.length ? [] : [
    Box({ key: `p${i}`, flexShrink: 1, minWidth: 0, children: [text(pieces[i], "truncate-end")] }),
    ...(i + 1 < pieces.length ? [Box({ key: `r${i + 1}`, flexDirection: "row", flexWrap: "nowrap", flexShrink: 10000, minWidth: 0, overflow: "hidden", children: rest(i + 1) })] : []),
  ];
  return rest(0);
}

// One line above the prompt while the pane can't be seen (terminal too
// narrow, or the pane closed): room, who's online, unread, the latest message.
// The desktop draws it as a capsule of small drawings (bands.mjs).
export function bandView(els, props, { onOpen, onCycle }) {
  const { Box, Text, Button } = els;
  const view = activeView();
  if (props.surface === "desktop" && els.Svg) {
    const fit = { onOpen, onCycle, columns: props.bodyColumns || 100 };
    const desk = view === "chat" ? chatBandDesktop(els, fit)
      : view === "usage" ? usageBandDesktop(els, props, { onOpen, onCycle })
        : fnMeta(view) ? fnBandDesktop(view, els, fit)
          : sysBandDesktop(view, els, fit);
    if (desk) return desk;
  }
  if (view !== "chat") {
    const meta = roomMeta(view);
    // VS Code wraps a row that doesn't fit: these give way instead.
    return Box({ flexDirection: "row", flexWrap: "nowrap", children: [
      Box({ key: "line", flexDirection: "row", flexWrap: "nowrap", columnGap: 1, flexGrow: 1, flexShrink: 1, minWidth: 0, children: [
        Box({ key: "room", flexShrink: 0, children: [Text({ key: "t", bold: true, color: meta.color, children: `${meta.icon} ${meta.label}` })] }),
        Box({ key: "sep", flexShrink: 0, children: [Text({ key: "t", color: theme.muted, children: glyph.bar })] }),
        Box({ key: "msg", flexDirection: "row", flexWrap: "nowrap", flexShrink: 1, flexGrow: 1, minWidth: 0, overflow: "hidden", children: bandMsg(els, view, props, meta, onCycle) }),
      ] }),
      Box({ key: "open-box", flexDirection: "row", columnGap: 1, flexShrink: 0, marginLeft: 1, children: [
        ...cycleButtons(els, onCycle),
        Button({ key: "open", label: "Open", variant: "primary", onPress: onOpen }),
      ] }),
    ] });
  }
  const room = currentRoom();
  const here = (state.online.get(room?.id) ?? []).filter((u) => u.user_id !== state.user?.id).length;
  const unreadHere = room.unread ?? 0;
  const unreadElsewhere = totalUnread() - unreadHere;
  const live = state.bridge === "ready" && state.roomStatus.get(room.id) === "SUBSCRIBED";
  const last = lastMessage();
  const typing = typingText(room.id);
  // Everything but the message keeps its size; the message gives way.
  const fixed = (key, children, style = {}) => Box({ key, flexShrink: 0, children: [Text({ key: "t", children, ...style })] });
  const bits = [
    fixed("room", `${glyph.brand} #${room.slug}`, { bold: true, color: theme.accent }),
    fixed("online", live ? `${glyph.on} ${here}` : `${glyph.off} reconnecting`, { color: live ? (here ? theme.online : theme.muted) : theme.warn }),
  ];
  if (isQuiet()) {
    // Do not disturb: counts stay, in grey, and no message text pulls the eye.
    const n = unreadHere + unreadElsewhere;
    bits.push(fixed("quiet", `${glyph.quiet} ${n ? `${n} new · ` : ""}do not disturb`, { color: theme.muted }));
    bits.push(Box({ key: "msg", flexGrow: 1, children: [] }));
  } else {
    if (unreadHere) bits.push(fixed("unread", ` ${unreadHere} new `, { bold: true, color: theme.onAccent, backgroundColor: theme.accent }));
    if (unreadElsewhere) bits.push(fixed("elsewhere", `+${unreadElsewhere}`, { color: theme.muted }));
    if (typing) {
      bits.push(fixed("sep", glyph.bar, { color: theme.muted }));
      bits.push(Box({ key: "msg", flexShrink: 1, flexGrow: 1, minWidth: 0, children: [Text({ key: "t", color: theme.muted, italic: true, wrap: "truncate-end", children: typing })] }));
    } else if (last) {
      bits.push(fixed("sep", glyph.bar, { color: theme.muted }));
      bits.push(fixed("who", displayName(last), { bold: true, color: last.mine ? theme.you : nameColor(last.user_id) }));
      bits.push(Box({ key: "msg", flexShrink: 1, flexGrow: 1, minWidth: 0, children: [Text({ key: "t", wrap: "truncate-end", children: oneLine(last) })] }));
    }
  }
  return Box({ flexDirection: "row", children: [
    Box({ key: "line", flexDirection: "row", columnGap: 1, flexGrow: 1, flexShrink: 1, children: bits }),
    Box({ key: "open-box", flexDirection: "row", columnGap: 1, flexShrink: 0, marginLeft: 1, children: [
      ...cycleButtons(els, onCycle),
      Button({ key: "open", label: "Open", variant: "primary", onPress: onOpen }),
    ] }),
  ] });
}
