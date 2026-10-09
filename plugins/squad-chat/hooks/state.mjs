// The mod's one state object, built from the bridge's events. The module's
// variables start over on every reload; the bridge restarts with it and
// replays what the state needs (auth, rooms, recent history).

import { createUsage } from "./metrics.mjs";
import { emptyGit } from "./github.mjs";

export const MAX_MESSAGES = 100;   // per room

// The built-in rooms, in tab order. They need no server and no sign-in.
export const SYS_ROOMS = ["usage", "git", "agents"];
// Function rooms come from the bridge (manifests in rooms/<id>/room.json).
// These have tabs until /chat rooms says otherwise.
export const DEFAULT_ROOMS = [...SYS_ROOMS, "snippet", "monitor"];
export const ROOM_ID = /^[a-z][a-z0-9-]{1,23}$/;

export const state = {
  bridge: "starting",     // starting | ready | restarting | unavailable | unconfigured
  detail: "",             // why the bridge isn't ready
  socket: null,
  token: null,
  auth: "starting",       // starting | signed_out | code_sent | signed_in
  email: null,            // where the code went
  user: null,             // { id, name, email }
  rooms: [],              // [{ id, slug, last_read_id, unread }]
  current: null,          // room id
  messages: new Map(),    // room id → [{ id, user, user_id, mine, body, at }] sorted by id
  online: new Map(),      // room id → [{ user_id, name }]
  typing: new Map(),      // room id → [{ user_id, name }] typing there now
  roomStatus: new Map(),  // room id → SUBSCRIBED | CHANNEL_ERROR | ...
  friends: [],            // [{ user_id, name, online, rooms }]
  notice: "",             // last error or hint, shown in the pane
  draft: "",              // what's typed in the pane's input box, kept across redraws
  paneFocused: false,     // the pane holds the keyboard: messages there count as read
  paneShown: false,       // the pane is drawn (the Git room polls faster then)
  notify: false,          // toast @mentions (/chat notify on), kept in $.store
  mention: null,          // newest unseen message that @mentions me, until toasted
  dnd: "off",             // do not disturb: off | on | auto (while Claude works), kept in $.store
  working: false,         // a long Claude turn is running (what "auto" waits for)
  missed: { messages: 0, mentions: 0 },   // what came in while quiet, for the summary
  pendingShare: null,     // a snippet shown for a look before /share send
  dividerAt: new Map(),   // room id → read marker when the pane last caught up: the "new" line
  // The built-in rooms.
  view: "chat",           // chat | usage | git | agents: what the pane shows, kept in $.store
  sysRooms: [...DEFAULT_ROOMS],   // which built-in and function rooms have tabs (/chat rooms), kept in $.store
  fn: new Map(),          // function room id → { manifest, settings, data: { provider: data }, at, error, stale }
  fnInvalid: [],          // manifests the bridge refused: [{ dir, errors }]
  fnToasts: [],           // function rooms' new alerts, waiting to be toasted
  usage: createUsage(),   // this session's numbers (metrics.mjs)
  git: emptyGit(),        // the Git room's snapshot (github.mjs)
  sessionId: null,
  self: null,             // this session's latest heartbeat (sessions.mjs)
  sessions: [],           // other sessions' heartbeats, from the bridge
  feedFilter: "all",      // the Agents room's feed: all | here | errors
  collapsed: new Set(),   // sessions whose agent trees are folded in the Agents room
  ended: false,
};

// Every room there is besides the chat: built-in first, then the function
// rooms in the order the bridge found them.
export function roomIds() {
  return [...SYS_ROOMS, ...state.fn.keys()];
}

export function isFnRoom(id) {
  return state.fn.has(id);
}

// The rooms with tabs, in tab order.
export function enabledRooms() {
  return roomIds().filter((id) => state.sysRooms.includes(id));
}

// What the pane shows: a built-in or function room, or the chat (a hidden
// room's tab, or a function room the bridge hasn't reported, falls back to
// the chat).
export function activeView() {
  return state.view !== "chat" && enabledRooms().includes(state.view) ? state.view : "chat";
}

export function currentRoom() {
  return state.rooms.find((r) => r.id === state.current) ?? null;
}

export function roomMessages(roomId = state.current) {
  return state.messages.get(roomId) ?? [];
}

export function totalUnread() {
  return state.rooms.reduce((n, r) => n + (r.unread ?? 0), 0);
}

// "@ann" or "@Ann," mentions ann, not "@anna".
export function mentions(body, name) {
  if (!name) return false;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\w@])@${escaped}(?![\\w-])`, "i").test(body);
}

// Do not disturb holds right now: switched on, or "auto" and Claude is busy.
export function isQuiet() {
  return state.dnd === "on" || (state.dnd === "auto" && state.working);
}

// The status line: unread counts, or nothing. While quiet, a 🔕 says so.
// The built-in rooms add a word only when something needs a look: context
// nearly full, or this branch's checks failing.
export function statusText() {
  const extra = sysStatus();
  if (state.auth !== "signed_in") return extra || undefined;
  const unread = state.rooms.filter((r) => r.unread > 0);
  const counts = unread.map((r) => `#${r.slug} ${r.unread}`).join(" · ");
  if (isQuiet()) return [`🔕 ${counts || "do not disturb"}`, extra].filter(Boolean).join(" · ");
  if (!unread.length) return extra || undefined;
  return [`💬 ${counts}`, extra].filter(Boolean).join(" · ");
}

function sysStatus() {
  const bits = [];
  const ctx = state.usage.context?.percent;
  if (state.sysRooms.includes("usage") && ctx >= 80) bits.push(`◔ ${Math.round(ctx)}%`);
  if (state.sysRooms.includes("git") && state.git.status === "ok" && state.git.pr?.checks.fail) bits.push("✗ CI");
  return bits.join(" · ");
}

// "💬 Missed 5 messages · 1 @mention", or "" for nothing. Short enough for
// one line of a toast.
export function missedText() {
  const { messages, mentions: at } = state.missed;
  if (!messages) return "";
  const s = (n) => (n === 1 ? "" : "s");
  return `💬 Missed ${messages} message${s(messages)}${at ? ` · ${at} @mention${s(at)}` : ""}`;
}

// "sam is typing…" for a room, or "".
export function typingText(roomId = state.current) {
  const names = (state.typing.get(roomId) ?? []).filter((u) => u.user_id !== state.user?.id).map((u) => u.name);
  if (!names.length) return "";
  if (names.length === 1) return `${names[0]} is typing…`;
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`;
  return "several people are typing…";
}

// The latest message in the current room, for the band.
export function lastMessage() {
  return roomMessages().at(-1) ?? null;
}

function addMessage(m) {
  const list = state.messages.get(m.room) ?? [];
  if (list.some((x) => x.id === m.id)) return false;
  // Live and catch-up copies can interleave: keep the list in id order.
  let i = list.length;
  while (i > 0 && list[i - 1].id > m.id) i--;
  list.splice(i, 0, m);
  if (list.length > MAX_MESSAGES) list.splice(0, list.length - MAX_MESSAGES);
  state.messages.set(m.room, list);
  return true;
}

// Applies one bridge event; returns true when the pane should redraw.
export function applyEvent(event) {
  switch (event.type) {
    case "ready":
      state.socket = event.socket;
      // Without a server the bridge runs for the Agents room's heartbeats alone.
      if (event.chat === false) return true;
      state.bridge = "ready";
      state.detail = "";
      return true;
    case "auth":
      state.auth = event.state;
      state.user = event.user ?? null;
      if (event.state === "code_sent") state.email = event.email;
      if (event.state === "signed_in") state.notice = "";
      if (event.state === "signed_out") {
        state.email = null;
        state.messages.clear();
        state.online.clear();
        state.typing.clear();
        state.friends = [];
        if (event.reason) state.notice = event.reason;
      }
      return true;
    case "rooms": {
      const known = new Set(event.rooms.map((r) => r.id));
      for (const id of [...state.messages.keys()]) if (!known.has(id)) state.messages.delete(id);
      if (event.current !== state.current) {
        state.notice = "";          // it was about the old room
        state.dividerAt.clear();
      }
      state.rooms = event.rooms;
      state.current = event.current;
      return true;
    }
    case "message": {
      const m = event.message;
      if (!addMessage(m)) return false;
      // The bridge keeps the unread count (it knows the read marker and what
      // it has already counted); a focused pane marks the room read at once.
      const room = state.rooms.find((r) => r.id === m.room);
      if (room && typeof event.unread === "number") room.unread = event.unread;
      const seen = m.room === state.current && state.paneFocused;
      const mentioned = event.counted && !seen && (!m.kind || m.kind === "text") && mentions(m.body, state.user?.name);
      if (isQuiet()) {
        // Nothing pops up now: count it for the summary instead.
        if (event.counted && !seen) state.missed.messages++;
        if (mentioned) state.missed.mentions++;
      } else if (mentioned) state.mention = m;
      return true;
    }
    case "presence":
      state.online.set(event.room, event.online);
      return true;
    case "typing":
      state.typing.set(event.room, event.users);
      return true;
    case "name":
      // Someone changed their name: messages already here show the new one.
      for (const list of state.messages.values()) {
        for (const m of list) if (m.user_id === event.user_id) m.user = event.name;
      }
      return true;
    case "friends":
      state.friends = event.friends;
      return true;
    case "status":
      state.roomStatus.set(event.room, event.status);
      return true;
    case "fnrooms": {
      const next = new Map();
      for (const manifest of event.rooms ?? []) {
        const had = state.fn.get(manifest.id);
        next.set(manifest.id, { manifest, settings: had?.settings ?? {}, data: had?.data ?? {}, at: had?.at ?? {}, error: had?.error ?? {}, stale: had?.stale ?? {} });
      }
      state.fn = next;
      state.fnInvalid = event.invalid ?? [];
      return true;
    }
    case "fnsettings": {
      const room = state.fn.get(event.id);
      if (!room) return false;
      room.settings = event.values ?? {};
      return true;
    }
    case "fnroom": {
      const room = state.fn.get(event.id);
      if (!room) return false;
      // A failed run with nothing to show (a new bridge has no cache yet)
      // keeps what this pane already has, marked stale.
      const keep = event.error && event.data == null && room.data[event.provider] != null;
      if (!keep) {
        room.data[event.provider] = event.data;
        room.at[event.provider] = event.at;
      }
      room.error[event.provider] = event.error ?? null;
      room.stale[event.provider] = keep || !!event.stale;
      // A provider's alerts ({ id, text }) toast once each, until they clear.
      if (Array.isArray(event.data?.alerts)) {
        const was = room.alerted ?? new Set();
        const now = event.data.alerts.filter((a) => a?.id && a.text);
        for (const a of now) if (!was.has(`${event.provider}/${a.id}`)) state.fnToasts.push(String(a.text).slice(0, 120));
        room.alerted = new Set(now.map((a) => `${event.provider}/${a.id}`));
      }
      return true;
    }
    case "sessions":
      state.sessions = (event.sessions ?? []).filter((x) => x?.id && x.id !== state.sessionId);
      return true;
    case "error":
      if (event.code === "unconfigured") {
        state.bridge = "unconfigured";
        state.detail = event.message;
        return true;
      }
      state.notice = event.message;
      return true;
    default:
      return false;
  }
}

// Forget what only a live bridge can vouch for (it is gone or restarting).
export function resetBridgeState() {
  state.socket = null;
  state.auth = "starting";
  state.roomStatus.clear();
  state.online.clear();
  state.typing.clear();
}
