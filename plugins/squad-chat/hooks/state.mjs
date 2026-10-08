// The mod's one state object, built from the bridge's events. The module's
// variables start over on every reload; the bridge restarts with it and
// replays what the state needs (auth, rooms, recent history).

export const MAX_MESSAGES = 100;   // per room

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
  notify: false,          // toast @mentions (/chat notify on), kept in $.store
  mention: null,          // newest unseen message that @mentions me, until toasted
  dnd: "off",             // do not disturb: off | on | auto (while Claude works), kept in $.store
  working: false,         // a long Claude turn is running (what "auto" waits for)
  missed: { messages: 0, mentions: 0 },   // what came in while quiet, for the summary
  dividerAt: new Map(),   // room id → read marker when the pane last caught up: the "new" line
  ended: false,
};

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
export function statusText() {
  if (state.auth !== "signed_in") return undefined;
  const unread = state.rooms.filter((r) => r.unread > 0);
  const counts = unread.map((r) => `#${r.slug} ${r.unread}`).join(" · ");
  if (isQuiet()) return `🔕 ${counts || "do not disturb"}`;
  if (!unread.length) return undefined;
  return `💬 ${counts}`;
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
      state.bridge = "ready";
      state.socket = event.socket;
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
      const mentioned = event.counted && !seen && mentions(m.body, state.user?.name);
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
