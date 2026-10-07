// All Supabase work for one signed-in user: auth (email code), rooms,
// per-room private Realtime channels (presence + new messages), backfill
// after (re)connects, heartbeats and the friends list.
//
// Everything the mod needs to know goes out through `emit(event)`; the
// control API in bridge.mjs calls the public methods.

import { createClient } from "@supabase/supabase-js";
import { fileStorage } from "./file-storage.mjs";

const HISTORY = 50;              // messages shown when a room is first opened
const BACKFILL_PAGE = 200;
const BACKFILL_OVERLAP = 20;     // re-read a few ids back: rows can commit out of id order
const SEEN_LIMIT = 1000;
const HEARTBEAT_MS = 30_000;
const FRIENDS_MS = 60_000;
const ONLINE_WINDOW_MS = 75_000; // heartbeat-only clients count as online this long
const WATCHDOG_MS = 5_000;
const STUCK_MS = 10_000;         // realtime down this long → force a reconnect
const MAX_KICK_GAP_MS = 30_000;

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

// PostgREST / Postgres errors → something a person can read, with an HTTP status.
function fail(error, fallback) {
  const code = error?.code;
  if (code === "54000") return new HttpError(429, error.message);
  if (code === "22023" || code === "23514") return new HttpError(400, error.message);
  if (code === "42501") return new HttpError(403, "not allowed (are you still in that room?)");
  if (code === "28000" || error?.status === 401) return new HttpError(401, "not signed in");
  return new HttpError(502, `${fallback}: ${error?.message ?? error}`);
}

export class Chat {
  constructor({ url, key, configDir, emit, log = () => {}, debug = false }) {
    this.emit = emit;
    this.log = log;
    this.storage = fileStorage(configDir);
    this.sb = createClient(url, key, {
      auth: {
        storage: this.storage,
        storageKey: "session",
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      realtime: debug ? { logger: (kind, msg, data) => log(`realtime ${kind} ${msg} ${data ? JSON.stringify(data).slice(0, 300) : ""}`) } : {},
    });
    this.authState = "starting";    // starting | signed_out | code_sent | signed_in
    this.user = null;               // { id, email, name }
    this.rooms = new Map();         // room id → room
    this.current = null;            // room id
    this.names = new Map();         // user id → display name
    this.friends = [];              // rows from my_friends()
    this.timers = [];
    this.closing = false;
    this.downSince = null;          // watchdog state
    this.nextKick = 0;
    this.kickGap = 0;
    this.friendsLoading = null;

    // A refresh token that stops working (revoked, signed out elsewhere)
    // ends the session. Don't call Supabase from inside this callback.
    this.sb.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT" && this.user) setTimeout(() => this.reset("signed out"), 0);
    });
  }

  // ------------------------------------------------------------ lifecycle

  async start() {
    const { data: { session } } = await this.sb.auth.getSession();
    if (!session) return this.setAuth("signed_out");
    const { data, error } = await this.sb.auth.getUser();
    if (error && (error.status === 401 || error.status === 403)) {
      await this.sb.auth.signOut({ scope: "local" });
      return this.setAuth("signed_out", { reason: "session expired, sign in again" });
    }
    // Offline at startup: carry on with the stored user; channels reconnect later.
    await this.signedIn(data?.user ?? session.user);
  }

  async shutdown() {
    this.closing = true;
    this.stopTimers();
    const untracks = [...this.rooms.values()].map((r) => r.channel?.untrack().catch(() => {}));
    await Promise.race([Promise.all(untracks), new Promise((r) => setTimeout(r, 1500))]);
    await this.sb.removeAllChannels().catch(() => {});
  }

  // ------------------------------------------------------------ auth

  async loginStart(email) {
    email = String(email ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "that doesn't look like an email address");
    if (this.authState === "signed_in") throw new HttpError(409, "already signed in");
    const { error } = await this.sb.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    if (error) throw new HttpError(error.status === 429 ? 429 : 502, `could not send the code: ${error.message}`);
    this.pendingEmail = email;
    this.setAuth("code_sent", { email });
  }

  async loginVerify(code, email = this.pendingEmail) {
    code = String(code ?? "").replace(/\s+/g, "");
    if (!email) throw new HttpError(400, "ask for a code first");
    if (!/^\d{6,10}$/.test(code)) throw new HttpError(400, "the code is the 6-10 digit number from the email");
    const { data, error } = await this.sb.auth.verifyOtp({ email, token: code, type: "email" });
    if (error) throw new HttpError(error.status === 429 ? 429 : 401, `code not accepted: ${error.message}`);
    this.pendingEmail = null;
    await this.signedIn(data.user);
  }

  async logout() {
    await this.leaveChannels();
    await this.sb.auth.signOut({ scope: "local" }).catch(() => {});
    this.storage.removeItem("session");
    this.reset("signed out");
  }

  async signedIn(user) {
    this.user = { id: user.id, email: user.email, name: user.email?.split("@")[0] ?? "me" };
    const { data } = await this.sb.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
    if (data) this.user.name = data.display_name;
    this.names.set(this.user.id, this.user.name);
    this.setAuth("signed_in");
    await this.loadRooms();
    await this.refreshFriends();
    this.heartbeat();
    this.timers.push(setInterval(() => this.heartbeat(), HEARTBEAT_MS));
    this.timers.push(setInterval(() => this.refreshFriends(), FRIENDS_MS));
    this.timers.push(setInterval(() => this.watchdog(), WATCHDOG_MS));
  }

  // realtime-js retries once after the connection drops. If that attempt
  // fails while the network is still down, the socket stays "connecting"
  // forever and never retries. Tear it down and connect again; the room
  // channels rejoin, report SUBSCRIBED, and backfill what we missed.
  watchdog() {
    const rt = this.sb.realtime;
    if (!this.user || this.rooms.size === 0 || this.closing) return;
    const now = Date.now();
    if (rt.isConnected()) {
      this.downSince = null;
      this.kickGap = 0;
      return;
    }
    this.downSince ??= now;
    if (now - this.downSince < STUCK_MS || now < this.nextKick) return;
    this.kickGap = Math.min((this.kickGap || STUCK_MS / 2) * 2, MAX_KICK_GAP_MS);
    this.nextKick = now + this.kickGap;
    this.log(`realtime down for ${Math.round((now - this.downSince) / 1000)}s, reconnecting`);
    rt.disconnect().catch(() => {}).finally(() => { if (!this.closing) rt.connect(); });
  }

  reset(reason) {
    this.stopTimers();
    for (const room of this.rooms.values()) this.sb.removeChannel(room.channel).catch(() => {});
    this.rooms.clear();
    this.current = null;
    this.user = null;
    this.friends = [];
    this.names.clear();
    this.emitRooms();
    this.setAuth("signed_out", { reason });
  }

  setAuth(state, extra = {}) {
    this.authState = state;
    this.emit({ type: "auth", state, user: this.user && { id: this.user.id, name: this.user.name, email: this.user.email }, ...extra });
  }

  requireUser() {
    if (!this.user) throw new HttpError(401, "not signed in");
    return this.user;
  }

  stopTimers() {
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  // ------------------------------------------------------------ rooms

  async loadRooms() {
    const me = this.requireUser();
    const { data, error } = await this.sb
      .from("room_members")
      .select("room_id, last_read_id, rooms(slug)")
      .eq("user_id", me.id);
    if (error) throw fail(error, "could not load rooms");
    const prefs = this.prefs();
    for (const row of data) {
      if (!this.rooms.has(row.room_id)) this.addRoom(row.room_id, row.rooms.slug, row.last_read_id);
    }
    await Promise.all([...this.rooms.values()].map((room) => this.countUnread(room)));
    const preferred = [...this.rooms.values()].find((r) => r.slug === prefs.room);
    this.current = preferred?.id ?? this.rooms.keys().next().value ?? null;
    this.emitRooms();
  }

  addRoom(id, slug, lastReadId = 0) {
    const room = {
      id, slug,
      lastReadId: Number(lastReadId) || 0,
      lastSeenId: 0,
      unread: 0,
      seen: new Set(),
      online: new Map(),          // user id → name
      status: "joining",
      queue: Promise.resolve(),   // keeps message emits in order
      channel: null,
    };
    this.rooms.set(id, room);
    this.subscribe(room);
    return room;
  }

  async countUnread(room) {
    const { count } = await this.sb
      .from("messages")
      .select("id", { count: "exact", head: true })
      .eq("room_id", room.id)
      .gt("id", room.lastReadId)
      .neq("user_id", this.user.id);
    room.unread = count ?? 0;
  }

  async join(slug, passcode) {
    this.requireUser();
    const { data: roomId, error } = await this.sb.rpc("join_room", { p_slug: slug, p_passcode: passcode ?? null });
    if (error) throw fail(error, "could not join");
    if (!roomId) throw new HttpError(403, "wrong passcode");
    let room = this.rooms.get(roomId);
    if (!room) {
      const { data } = await this.sb.from("room_members").select("last_read_id, rooms(slug)")
        .eq("room_id", roomId).eq("user_id", this.user.id).single();
      room = this.addRoom(roomId, data.rooms.slug, data.last_read_id);
    }
    this.selectRoom(room.id);
    this.refreshFriends();
    return { id: room.id, slug: room.slug };
  }

  async leave(roomRef = this.current) {
    const room = this.room(roomRef);
    const { error } = await this.sb.from("room_members").delete().eq("room_id", room.id).eq("user_id", this.user.id);
    if (error) throw fail(error, "could not leave");
    await room.channel.untrack().catch(() => {});
    await this.sb.removeChannel(room.channel).catch(() => {});
    this.rooms.delete(room.id);
    if (this.current === room.id) this.current = this.rooms.keys().next().value ?? null;
    this.emitRooms();
    this.refreshFriends();
  }

  selectRoom(roomRef) {
    const room = this.room(roomRef);
    this.current = room.id;
    this.savePrefs({ room: room.slug });
    this.emitRooms();
  }

  // Accepts a room id or slug; defaults to the current room.
  room(ref = this.current) {
    this.requireUser();
    const room = this.rooms.get(ref) ?? [...this.rooms.values()].find((r) => r.slug === ref);
    if (!room) throw new HttpError(404, ref ? `you're not in a room called ${ref}` : "join a room first: /room <name> <passcode>");
    return room;
  }

  emitRooms() {
    this.emit({
      type: "rooms",
      current: this.current,
      rooms: [...this.rooms.values()].map((r) => ({ id: r.id, slug: r.slug, last_read_id: r.lastReadId, unread: r.unread })),
    });
  }

  // ------------------------------------------------------------ realtime

  subscribe(room) {
    const me = this.user;
    const channel = this.sb.channel(`room:${room.id}`, {
      config: {
        private: true,
        presence: { key: me.id, enabled: true },
        // Report SUBSCRIBED only once new-message delivery is live, so the
        // backfill that follows can't leave a gap.
        postgres_changes_options: { wait: true },
      },
    });
    channel
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "messages", filter: `room_id=eq.${room.id}` },
        ({ new: row }) => this.enqueue(room, [row], false))
      .on("presence", { event: "sync" }, () => this.presenceChanged(room))
      .subscribe(async (status, err) => {
        if (this.closing || this.rooms.get(room.id) !== room) return;
        room.status = status;
        this.emit({ type: "status", room: room.id, status, ...(err ? { error: err.message } : {}) });
        if (status !== "SUBSCRIBED") return;
        await channel.track({ user_id: me.id, name: me.name, at: new Date().toISOString() }).catch(() => {});
        await this.backfill(room).catch((e) => this.emit({ type: "error", message: `backfill failed: ${e.message}` }));
      });
    room.channel = channel;
  }

  async leaveChannels() {
    for (const room of this.rooms.values()) {
      await room.channel.untrack().catch(() => {});
      await this.sb.removeChannel(room.channel).catch(() => {});
    }
  }

  presenceChanged(room) {
    room.online.clear();
    for (const [key, metas] of Object.entries(room.channel.presenceState())) {
      const name = metas[0]?.name;
      room.online.set(key, name ?? this.names.get(key) ?? "someone");
      if (name) this.names.set(key, name);
    }
    this.emit({ type: "presence", room: room.id, online: [...room.online].map(([user_id, name]) => ({ user_id, name })) });
    // Someone new in the room isn't in the friends list yet: reload it.
    const known = new Set(this.friends.map((f) => f.user_id));
    if ([...room.online.keys()].some((id) => id !== this.user?.id && !known.has(id))) this.refreshFriends();
    else this.emitFriends();
  }

  // ------------------------------------------------------------ messages

  // Fetch what we missed. First time: the latest HISTORY messages. After a
  // reconnect: everything after the newest id we've seen (with a small
  // overlap; duplicates are dropped by id).
  async backfill(room) {
    const cols = "id, room_id, user_id, body, created_at";
    if (room.lastSeenId === 0) {
      const { data, error } = await this.sb.from("messages").select(cols)
        .eq("room_id", room.id).order("id", { ascending: false }).limit(HISTORY);
      if (error) throw fail(error, "could not load history");
      await this.enqueue(room, data.reverse(), true);
      return;
    }
    let after = Math.max(0, room.lastSeenId - BACKFILL_OVERLAP);
    for (;;) {
      const { data, error } = await this.sb.from("messages").select(cols)
        .eq("room_id", room.id).gt("id", after).order("id", { ascending: true }).limit(BACKFILL_PAGE);
      if (error) throw fail(error, "could not catch up");
      await this.enqueue(room, data, true);
      if (data.length < BACKFILL_PAGE) return;
      after = data[data.length - 1].id;
    }
  }

  enqueue(room, rows, backfill) {
    room.queue = room.queue.then(async () => {
      const fresh = rows.filter((r) => !room.seen.has(r.id));
      if (!fresh.length) return;
      await this.resolveNames(fresh.map((r) => r.user_id));
      for (const row of fresh) {
        if (room.seen.has(row.id)) continue;
        room.seen.add(row.id);
        room.lastSeenId = Math.max(room.lastSeenId, row.id);
        this.emit({
          type: "message",
          backfill,
          message: {
            id: row.id,
            room: room.id,
            slug: room.slug,
            user_id: row.user_id,
            user: this.names.get(row.user_id) ?? "someone",
            mine: row.user_id === this.user?.id,
            body: row.body,
            at: row.created_at,
          },
        });
      }
      if (room.seen.size > SEEN_LIMIT) {
        const drop = [...room.seen].sort((a, b) => a - b).slice(0, room.seen.size - SEEN_LIMIT);
        for (const id of drop) room.seen.delete(id);
      }
    }).catch((e) => this.log(`message queue: ${e.message}`));
    return room.queue;
  }

  async resolveNames(ids) {
    const missing = [...new Set(ids)].filter((id) => !this.names.has(id));
    if (!missing.length) return;
    const { data } = await this.sb.from("profiles").select("id, display_name").in("id", missing);
    for (const p of data ?? []) this.names.set(p.id, p.display_name);
  }

  async send(text, roomRef) {
    const room = this.room(roomRef);
    const body = String(text ?? "").trim();
    if (!body) throw new HttpError(400, "empty message");
    if (body.length > 500) throw new HttpError(400, "messages are limited to 500 characters");
    const { data, error } = await this.sb.from("messages").insert({ room_id: room.id, body })
      .select("id, room_id, user_id, body, created_at").single();
    if (error) throw fail(error, "could not send");
    await this.enqueue(room, [data], false);   // show it now; the realtime copy is dropped as a duplicate
    return { id: data.id };
  }

  async markRead(roomRef, lastId) {
    const room = this.room(roomRef);
    const id = Number(lastId ?? room.lastSeenId);
    if (!Number.isSafeInteger(id) || id <= room.lastReadId) return { last_read_id: room.lastReadId };
    const { error } = await this.sb.from("room_members").update({ last_read_id: id })
      .eq("room_id", room.id).eq("user_id", this.user.id);
    if (error) throw fail(error, "could not mark read");
    room.lastReadId = id;
    room.unread = 0;
    return { last_read_id: id };
  }

  // ------------------------------------------------------------ presence & friends

  async heartbeat() {
    if (!this.user) return;
    const { error } = await this.sb.rpc("heartbeat");
    if (error) this.log(`heartbeat: ${error.message}`);
  }

  // Concurrent callers share one request.
  refreshFriends() {
    if (!this.user) return Promise.resolve();
    this.friendsLoading ??= (async () => {
      const { data, error } = await this.sb.rpc("my_friends");
      if (error) return this.log(`friends: ${error.message}`);
      this.friends = data;
      for (const f of data) this.names.set(f.user_id, f.display_name);
      this.emitFriends();
    })().finally(() => { this.friendsLoading = null; });
    return this.friendsLoading;
  }

  // Online = tracked in any room channel, or a recent heartbeat (clients
  // without a socket only send heartbeats).
  friendList() {
    const now = Date.now();
    const present = new Set();
    for (const room of this.rooms.values()) for (const id of room.online.keys()) present.add(id);
    return this.friends.map((f) => ({
      user_id: f.user_id,
      name: f.display_name,
      rooms: f.rooms,
      online: present.has(f.user_id) || (f.last_seen != null && now - Date.parse(f.last_seen) < ONLINE_WINDOW_MS),
    })).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  }

  emitFriends() {
    if (this.user) this.emit({ type: "friends", friends: this.friendList() });
  }

  // ------------------------------------------------------------ snapshot & prefs

  snapshot() {
    return {
      auth: this.authState,
      user: this.user && { id: this.user.id, name: this.user.name, email: this.user.email },
      current: this.current,
      rooms: [...this.rooms.values()].map((r) => ({
        id: r.id, slug: r.slug, status: r.status, last_read_id: r.lastReadId, last_seen_id: r.lastSeenId, unread: r.unread,
        online: [...r.online].map(([user_id, name]) => ({ user_id, name })),
      })),
      friends: this.user ? this.friendList() : [],
    };
  }

  prefs() {
    try { return JSON.parse(this.storage.getItem("prefs") ?? "{}"); } catch { return {}; }
  }

  savePrefs(patch) {
    this.storage.setItem("prefs", JSON.stringify({ ...this.prefs(), ...patch }));
  }
}
