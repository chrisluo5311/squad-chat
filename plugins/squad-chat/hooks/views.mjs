// The chat pane and the band, drawn from state alone (no $ here: the engine
// follows $ only within the hooks module's own file).
//
// Docked (fullscreen, wide terminal):
//   title bar · room tabs · FRIENDS card · room card with grouped messages ·
//   input box · key hints
// Inline (above the prompt): one header line, the last few messages, input.
// Band (pane not up): one line with an Open button.

import { state, currentRoom, roomMessages, lastMessage, totalUnread } from "./state.mjs";
import { theme, nameColor, glyph } from "./theme.mjs";

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
  if (state.bridge !== "ready") return { color: theme.warn, text: `${glyph.off} ${state.bridge}` };
  if (state.auth === "code_sent") return { color: theme.warn, text: `${glyph.off} code sent` };
  if (state.auth !== "signed_in") return { color: theme.muted, text: `${glyph.off} ${state.auth === "starting" ? "connecting" : "signed out"}` };
  const room = currentRoom();
  if (!room) return { color: theme.online, text: `${glyph.on} connected` };
  const status = state.roomStatus.get(room.id);
  if (status === "SUBSCRIBED") return { color: theme.online, text: `${glyph.on} live` };
  return { color: theme.warn, text: `${glyph.off} ${status ? "reconnecting" : "joining"}` };
}

function displayName(m) {
  return m.mine ? "you" : m.user;
}

// Terminal cells a string takes: wide characters (CJK, most emoji) take two.
function cells(str) {
  let n = 0;
  for (const ch of str) n += /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6]|\p{Extended_Pictographic}/u.test(ch) ? 2 : 1;
  return n;
}

// Rows a text takes when word-wrapped at `width`, the way the terminal wraps.
function rowsFor(text, width) {
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

// ---------------------------------------------------------------- messages

// The room's messages as rows: date separators, the "new" divider, a header
// per group of messages from one sender, and the bodies. Each row knows how
// many terminal rows it takes at `width`, so the newest ones can be fitted.
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
    if (!sameGroup) rows.push({ kind: "head", key: `h${m.id}`, m, height: 1 });
    rows.push({ kind: "body", key: `m${m.id}`, m, height: rowsFor(m.body, width - 2) });
    prev = m;
  }
  return rows;
}

// The newest rows that fit in `capacity` terminal rows, never starting
// with message bodies whose sender header didn't fit.
function fitRows(rows, capacity) {
  const shown = [];
  let used = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    if (used + rows[i].height > capacity && shown.length) break;
    used += rows[i].height;
    shown.unshift(rows[i]);
  }
  // Don't open on a group that has lost its header: start at the next one.
  while (shown.length > 1 && shown[0].kind === "body") shown.shift();
  return shown;
}

function drawRow(els, row, width) {
  const { Box, Text } = els;
  switch (row.kind) {
    case "day":
      return Box({ key: row.key, flexShrink: 0, justifyContent: "center", children: [
        Text({ key: "t", color: theme.muted, children: `${glyph.rule.repeat(3)} ${row.text} ${glyph.rule.repeat(3)}` }),
      ] });
    case "new":
      return Box({ key: row.key, flexShrink: 0, flexDirection: "row", children: [
        Text({ key: "t", color: theme.accent, bold: true, children: "new " }),
        Text({ key: "r", color: theme.accent, children: glyph.rule.repeat(Math.max(4, width - 4)) }),
      ] });
    case "head":
      return Box({ key: row.key, flexShrink: 0, flexDirection: "row", gap: 1, marginTop: 0, children: [
        Text({ key: "n", bold: true, color: row.m.mine ? theme.accent : nameColor(row.m.user_id), wrap: "truncate-end", children: displayName(row.m) }),
        Text({ key: "t", color: theme.muted, children: formatTime(row.m.at) }),
      ] });
    default:
      return Box({ key: row.key, flexShrink: 0, flexDirection: "column", paddingLeft: 2, children: [
        Text({ key: "b", wrap: "wrap", children: row.m.body }),
      ] });
  }
}

// ---------------------------------------------------------------- building blocks

// A rounded card, full width: a bold label and right-aligned meta on its
// first row. `grow` makes it take the pane's spare height, its content kept
// at the bottom (a chat reads upward from the input).
function card(els, { key, title, titleColor, meta, metaColor, children, grow = false, marginTop = 0 }) {
  const { Box, Text } = els;
  const head = Box({ key: "head", flexDirection: "row", justifyContent: "space-between", gap: 1, children: [
    Text({ key: "title", bold: true, color: titleColor, wrap: "truncate-end", children: title }),
    meta ? Text({ key: "meta", color: metaColor ?? theme.muted, children: meta }) : null,
  ].filter(Boolean) });
  const body = grow
    ? [Box({ key: "body", flexDirection: "column", flexGrow: 1, justifyContent: "flex-end", overflow: "hidden", children })]
    : children;
  return Box({
    key, flexDirection: "column", borderStyle: "round", borderColor: theme.border, paddingX: 1, marginTop,
    flexGrow: grow ? 1 : 0, flexShrink: grow ? 1 : 0, children: [head, ...body],
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

// Rooms as tabs: the current one filled with the accent, the others pressable.
function roomTabs(els, onSelectRoom) {
  const { Box, Text, Button } = els;
  return Box({ key: "tabs", flexDirection: "row", flexWrap: "wrap", columnGap: 1, children: state.rooms.map((r) => {
    if (r.id === state.current) {
      return Text({ key: `tab-${r.id}`, bold: true, color: theme.onAccent, backgroundColor: theme.accent, children: ` #${r.slug} ` });
    }
    const tab = Button({ key: `tab-${r.id}`, plain: true, label: ` #${r.slug}`, dimColor: !r.unread, onPress: () => onSelectRoom(r.id) });
    if (!r.unread) return tab;
    return Box({ key: `tabbox-${r.id}`, flexDirection: "row", gap: 1, children: [
      tab,
      Text({ key: "badge", bold: true, color: theme.amber, children: String(r.unread) }),
    ] });
  }) });
}

function friendsCard(els, width) {
  const { Box, Text } = els;
  const friends = state.friends;
  const online = friends.filter((f) => f.online).length;
  const chips = friends.map((f) => Box({ key: f.user_id, flexDirection: "row", children: [
    Text({ key: "dot", color: f.online ? theme.online : theme.muted, children: `${f.online ? glyph.on : glyph.off} ` }),
    Text({ key: "name", color: f.online ? undefined : theme.muted, children: f.name }),
  ] }));
  const body = friends.length
    ? Box({ key: "list", flexDirection: "row", flexWrap: "wrap", columnGap: 2, children: chips })
    : Text({ key: "none", color: theme.muted, children: "Share a room's name and passcode to add friends." });
  const textLen = friends.reduce((n, f) => n + f.name.length + 4, 0);
  const height = 3 + (friends.length ? rowsFor("x".repeat(textLen), width - 4) : rowsFor("Share a room's name and passcode to add friends.", width - 4));
  return { node: card(els, { key: "friends", title: "FRIENDS", meta: `${online}/${friends.length} online`, marginTop: 1, children: [body] }), height };
}

function inputBox(els, mode, { onSubmit, onInput }, focused) {
  const { Box, Text, Input } = els;
  return Box({ key: "compose-box", flexDirection: "row", borderStyle: "round", borderColor: focused ? theme.accent : theme.border, paddingX: 1, children: [
    Text({ key: "prompt", color: theme.accent, bold: true, children: `${glyph.prompt} ` }),
    Box({ key: "field", flexGrow: 1, children: [
      Input({ key: "compose", placeholder: mode.placeholder, submitLabel: mode.label, value: state.draft ?? "", autoFocus: true, onInput, onSubmit }),
    ] }),
  ] });
}

function hints(els, text) {
  const { Text } = els;
  return Text({ key: "hints", color: theme.muted, wrap: "truncate-end", children: text });
}

function notice(els) {
  const { Text } = els;
  return state.notice ? Text({ key: "notice", color: theme.warn, wrap: "wrap", children: state.notice }) : null;
}

// What the input box is for right now.
function inputMode() {
  if (state.bridge !== "ready") return null;
  if (state.auth === "signed_out") return { placeholder: "you@example.com", label: "send code" };
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
  if (state.bridge !== "ready" || state.auth === "starting") {
    return card(els, { key: "setup", marginTop: 1, title: "CONNECTING", meta: "…", children: [line("wait", state.detail || "Starting the chat in the background.", { color: theme.muted })] });
  }
  if (state.auth === "signed_out") {
    return card(els, { key: "setup", marginTop: 1, title: "SIGN IN", meta: "step 1 of 2", children: [
      line("a", "Chat with your friends while you code."),
      line("b", "Enter your email below and we'll send you a sign-in code.", { color: theme.muted }),
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
  const parts = [titleBar(els)];
  let used = 1;

  if (state.auth === "signed_in" && state.rooms.length) {
    parts.push(roomTabs(els, handlers.onSelectRoom));
    used += 1;
  }

  if (state.auth === "signed_in" && room) {
    const friends = friendsCard(els, width);
    parts.push(friends.node);
    used += 1 + friends.height;

    const n = notice(els);
    const tail = 3 + 1 + (n ? rowsFor(state.notice, width) : 0);   // input box + hints + notice
    // The card's border and head, and one row the dock reserves (its close mark).
    const capacity = Math.max(3, bodyRows - used - tail - 3 - 1);
    const here = (state.online.get(room.id) ?? []).filter((u) => u.user_id !== state.user?.id).length;
    const list = roomMessages();
    const rows = fitRows(messageRows(list, width - 4, state.dividerAt?.get(room.id) ?? 0), capacity);
    const body = list.length
      ? rows.map((r) => drawRow(els, r, width - 4))   // inside the card's border and padding
      : [Text({ key: "empty", color: theme.muted, children: "No messages yet. Say hi!" })];
    parts.push(card(els, {
      key: "room", title: `#${room.slug}`, titleColor: theme.accent,
      meta: here ? `${here} here` : "just you", metaColor: here ? theme.online : theme.muted,
      children: body, grow: true,
    }));
    if (n) parts.push(n);
    if (mode) parts.push(inputBox(els, mode, handlers, props.isFocused));
    parts.push(hints(els, "enter send · esc back · /room · /who · /help"));
  } else {
    parts.push(setupCard(els, width));
    const n = notice(els);
    if (n) parts.push(n);
    if (mode) parts.push(inputBox(els, mode, handlers, props.isFocused));
    if (mode) parts.push(hints(els, state.auth === "signed_in" ? "you can type /room right here" : "enter to continue · esc back"));
  }

  // Fill the dock's height so the input sits at the bottom.
  return Box({ flexDirection: "column", height: bodyRows, children: parts });
}

// Above the prompt: as little as reads well.
function inlineView(els, props, handlers) {
  const { Box, Text } = els;
  const width = Math.max(24, (props.bodyColumns || 48));
  const room = currentRoom();
  const mode = inputMode();
  const conn = connection();
  const parts = [];

  if (state.auth === "signed_in" && room) {
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
        Box({ key: "n", flexShrink: 0, children: [
          Text({ key: "t", bold: true, color: m.mine ? theme.accent : nameColor(m.user_id), children: name.padEnd(nameWidth) }),
        ] }),
        Text({ key: "b", wrap: "truncate-end", children: m.body }),
      ] }));
    }
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

// One line above the prompt while the pane can't be seen (terminal too
// narrow, or the pane closed): room, who's online, unread, the latest message.
export function bandView(els, props, { onOpen }) {
  const { Box, Text, Button } = els;
  const room = currentRoom();
  const here = (state.online.get(room?.id) ?? []).filter((u) => u.user_id !== state.user?.id).length;
  const unreadHere = room.unread ?? 0;
  const unreadElsewhere = totalUnread() - unreadHere;
  const live = state.bridge === "ready" && state.roomStatus.get(room.id) === "SUBSCRIBED";
  const last = lastMessage();
  // Everything but the message keeps its size; the message gives way.
  const fixed = (key, children, style = {}) => Box({ key, flexShrink: 0, children: [Text({ key: "t", children, ...style })] });
  const bits = [
    fixed("room", `${glyph.brand} #${room.slug}`, { bold: true, color: theme.accent }),
    fixed("online", live ? `${glyph.on} ${here}` : `${glyph.off} reconnecting`, { color: live ? (here ? theme.online : theme.muted) : theme.warn }),
  ];
  if (unreadHere) bits.push(fixed("unread", ` ${unreadHere} new `, { bold: true, color: theme.onAccent, backgroundColor: theme.accent }));
  if (unreadElsewhere) bits.push(fixed("elsewhere", `+${unreadElsewhere}`, { color: theme.muted }));
  if (last) {
    bits.push(fixed("sep", glyph.bar, { color: theme.muted }));
    bits.push(fixed("who", displayName(last), { bold: true, color: last.mine ? theme.accent : nameColor(last.user_id) }));
    bits.push(Box({ key: "msg", flexShrink: 1, flexGrow: 1, minWidth: 0, children: [Text({ key: "t", wrap: "truncate-end", children: last.body })] }));
  }
  return Box({ flexDirection: "row", children: [
    Box({ key: "line", flexDirection: "row", gap: 1, flexGrow: 1, flexShrink: 1, children: bits }),
    Box({ key: "open-box", flexShrink: 0, marginLeft: 1, children: [
      Button({ key: "open", label: "Open", variant: "primary", onPress: onOpen }),
    ] }),
  ] });
}
