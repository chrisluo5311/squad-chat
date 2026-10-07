// The mod's one state object, built from the bridge's events. The module's
// variables start over on every reload; the bridge restarts with it and
// replays what the state needs (auth, rooms, recent history).

export const MAX_MESSAGES = 100;   // per room

export const state = {
  bridge: "starting",     // starting | ready | restarting | unavailable
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
  roomStatus: new Map(),  // room id → SUBSCRIBED | CHANNEL_ERROR | ...
  friends: [],            // [{ user_id, name, online, rooms }]
  notice: "",             // last error or hint, shown in the pane
  draft: "",              // what's typed in the pane's input box, kept across redraws
  ended: false,
};

export function currentRoom() {
  return state.rooms.find((r) => r.id === state.current) ?? null;
}

export function roomMessages(roomId = state.current) {
  return state.messages.get(roomId) ?? [];
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
        state.friends = [];
        if (event.reason) state.notice = event.reason;
      }
      return true;
    case "rooms": {
      const known = new Set(event.rooms.map((r) => r.id));
      for (const id of [...state.messages.keys()]) if (!known.has(id)) state.messages.delete(id);
      if (event.current !== state.current) state.notice = "";   // it was about the old room
      state.rooms = event.rooms;
      state.current = event.current;
      return true;
    }
    case "message": {
      const m = event.message;
      if (!addMessage(m)) return false;
      if (!event.backfill && !m.mine && m.room !== state.current) {
        const room = state.rooms.find((r) => r.id === m.room);
        if (room) room.unread = (room.unread ?? 0) + 1;
      }
      return true;
    }
    case "presence":
      state.online.set(event.room, event.online);
      return true;
    case "friends":
      state.friends = event.friends;
      return true;
    case "status":
      state.roomStatus.set(event.room, event.status);
      return true;
    case "error":
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
}
