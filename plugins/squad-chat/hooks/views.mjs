// The chat pane, drawn from state alone (no $ here: the engine follows $
// only within the hooks module's own file). Docked (fullscreen, wide terminal): room header, friends,
// as many recent messages as fit, input box. Inline (above the prompt): a
// compact version with the last few messages.

import { state, currentRoom, roomMessages } from "./state.mjs";

function formatTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function statusDot() {
  if (state.bridge === "unavailable") return { color: "red", text: "● unavailable" };
  if (state.bridge !== "ready") return { color: "yellow", text: `● ${state.bridge}` };
  if (state.auth !== "signed_in") return { color: "yellow", text: "● signed out" };
  const room = currentRoom();
  if (!room) return { color: "green", text: "● connected" };
  const status = state.roomStatus.get(room.id);
  if (status === "SUBSCRIBED") return { color: "green", text: "● live" };
  return { color: "yellow", text: status ? "● reconnecting" : "● joining" };
}

function messageLine(m, nameWidth) {
  const name = nameWidth ? m.user.slice(0, nameWidth) : m.user;
  return `${formatTime(m.at)} ${name}: ${m.body}`;
}

// The newest messages whose wrapped lines fit in `rows` rows of `width`.
function fitMessages(list, rows, width, nameWidth) {
  const shown = [];
  let used = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const need = Math.max(1, Math.ceil(messageLine(list[i], nameWidth).length / Math.max(10, width)));
    if (used + need > rows && shown.length) break;
    used += need;
    shown.unshift(list[i]);
  }
  return shown;
}

// What the input box is for right now.
function inputMode() {
  if (state.bridge !== "ready") return null;
  if (state.auth === "signed_out") return { placeholder: "your email, to get a sign-in code", label: "sign in" };
  if (state.auth === "code_sent") return { placeholder: `the code emailed to ${state.email}`, label: "verify" };
  if (state.auth !== "signed_in") return null;
  if (!currentRoom()) return { placeholder: "/room <name> <passcode> to create or join", label: "join" };
  return { placeholder: "Message… (Enter sends, Esc returns to the prompt)", label: "send" };
}

// `els` is the surface's element table ($.ui.resolve(e)), `props` the Pane's.
export function paneView(els, props, { onSubmit, onInput }) {
  const { Box, Text, Input } = els;
  const inline = props.placement === "inline";
  const width = Math.max(20, (props.bodyColumns || 48) - 1);
  const bodyRows = props.scroll?.bodyRows || (inline ? 10 : 30);
  const room = currentRoom();
  const dot = statusDot();
  const rows = [];

  // Header: current room (or app name) and connection state.
  const others = state.rooms.filter((r) => r.id !== state.current)
    .map((r) => `#${r.slug}${r.unread ? `(${r.unread})` : ""}`).join(" ");
  rows.push(Box({ key: "header", flexDirection: "row", justifyContent: "space-between", children: [
    Text({ key: "title", bold: true, color: "cyan", wrap: "truncate-end", children: room ? `#${room.slug}` : "squad-chat" }),
    Text({ key: "dot", color: dot.color, children: dot.text }),
  ] }));
  if (others && !inline) rows.push(Text({ key: "rooms", dimColor: true, wrap: "truncate-end", children: `also: ${others}` }));

  // Who's around.
  if (state.auth === "signed_in" && room) {
    const here = state.online.get(room.id) ?? [];
    if (inline) {
      const names = here.filter((u) => u.user_id !== state.user?.id).map((u) => u.name);
      rows.push(Text({ key: "online", dimColor: true, wrap: "truncate-end", children: `online: ${names.length ? names.join(", ") : "just you"}` }));
    } else if (state.friends.length) {
      const list = state.friends.map((f) => `${f.online ? "●" : "○"} ${f.name}`).join("  ");
      const n = state.friends.filter((f) => f.online).length;
      rows.push(Text({ key: "friends", wrap: "truncate-end", children: `${n} online · ${list}` }));
    } else {
      rows.push(Text({ key: "friends", dimColor: true, wrap: "truncate-end", children: "no one else here yet" }));
    }
  }

  // Body: messages, or what to do next.
  const body = [];
  if (state.bridge === "unavailable") {
    body.push(Text({ key: "why", color: "red", children: state.detail }));
  } else if (state.bridge !== "ready" || state.auth === "starting") {
    body.push(Text({ key: "wait", dimColor: true, children: state.detail || "Connecting…" }));
  } else if (state.auth === "signed_out") {
    body.push(Text({ key: "hint", children: "Sign in to chat: type your email below and press Enter. We'll email you a code." }));
  } else if (state.auth === "code_sent") {
    body.push(Text({ key: "hint", children: `Code sent to ${state.email}. Type it below.` }));
  } else if (!room) {
    body.push(Text({ key: "hint", children: "Create a room or join a friend's: /room <name> <passcode>" }));
  } else {
    const fixed = rows.length + 4 + (state.notice ? 1 : 0);   // margins + input
    const space = inline ? Math.min(5, bodyRows - fixed) : bodyRows - fixed;
    const shown = fitMessages(roomMessages(), Math.max(3, space), width, inline ? 8 : 0);
    if (!shown.length) body.push(Text({ key: "empty", dimColor: true, children: "No messages yet. Say hi below." }));
    for (const m of shown) {
      body.push(Text({ key: `m${m.id}`, dimColor: m.mine, children: messageLine(m, inline ? 8 : 0) }));
    }
  }
  rows.push(Box({ key: "body", flexDirection: "column", marginTop: 1, children: body }));

  if (state.notice) rows.push(Text({ key: "notice", color: "yellow", wrap: "wrap", children: state.notice }));

  const mode = inputMode();
  if (mode) {
    rows.push(Box({ key: "compose-row", marginTop: state.notice ? 0 : 1, children: [
      Input({
        key: "compose",
        placeholder: mode.placeholder,
        submitLabel: mode.label,
        value: state.draft ?? "",
        autoFocus: true,
        onInput,
        onSubmit,
      }),
    ] }));
  }

  return Box({ flexDirection: "column", children: rows });
}
