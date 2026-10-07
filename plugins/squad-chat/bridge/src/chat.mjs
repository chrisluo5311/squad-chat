// All Supabase work for one signed-in user: auth (email code), rooms,
// per-room private Realtime channels (presence, new messages, typing), backfill
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
const FRIENDS_MS = Number(process.env.SQUAD_REFRESH_MS) || 60_000;   // friends + room list refresh
const ONLINE_WINDOW_MS = 75_000; // heartbeat-only clients count as online this long
const WATCHDOG_MS = 5_000;
const STUCK_MS = 10_000;         // realtime down this long → force a reconnect
const MAX_KICK_GAP_MS = 30_000;
const TYPING_SEND_MS = 2_000;    // send "typing" at most this often per room
const TYPING_TTL_MS = 5_000;     // someone stops "typing" this long after their last one
const NAME = /^[A-Za-z0-9_-]{1,24}$/;

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
    this.leftAt = new Map();        // user id → when presence last saw them leave

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

  // Sign in without email: an anonymous account that names itself. Only
  // works where the server has anonymous sign-ins switched on.
  async loginName(name) {
    name = String(name ?? "").trim();
    if (!NAME.test(name)) {
      throw new HttpError(400, "a name is 1-24 letters, digits, - or _ (or enter an email address)");
    }
    if (this.authState === "signed_in") throw new HttpError(409, "already signed in");
    const { data, error } = await this.sb.auth.signInAnonymously({ options: { data: { display_name: name } } });
    if (error) {
      if (/anonymous/i.test(error.message) && /disabled/i.test(error.message)) {
        throw new HttpError(403, "this server signs in by email: enter your email address instead");
      }
      throw new HttpError(error.status === 429 ? 429 : 502, `could not sign in: ${error.message}`);
    }
    await this.signedIn(data.user);
  }

  // A new display name, kept unique by the database. Roommates see it
  // through presence right away, and through the friends list after that.
  async rename(name) {
    const me = this.requireUser();
    name = String(name ?? "").trim();
    if (!NAME.test(name)) throw new HttpError(400, "a name is 1-24 letters, digits, - or _");
    if (name === me.name) return { name };
    const { error } = await this.sb.from("profiles").update({ display_name: name }).eq("id", me.id);
    if (error?.code === "23505") throw new HttpError(409, `${name} is taken, try another`);
    if (error) throw fail(error, "could not change your name");
    me.name = name;
    this.noteName(me.id, name);
    this.setAuth("signed_in");
    for (const room of this.rooms.values()) {
      if (room.status === "SUBSCRIBED") room.channel.track({ user_id: me.id, name, at: new Date().toISOString() }).catch(() => {});
    }
    this.emitFriends();
    return { name };
  }

  async logout() {
    await this.leaveChannels();
    await this.sb.auth.signOut({ scope: "local" }).catch(() => {});
    this.storage.removeItem("session");
    this.reset("signed out");
  }

  async signedIn(user) {
    this.user = { id: user.id, email: user.email || null, anonymous: !!user.is_anonymous, name: user.email?.split("@")[0] || "me" };
    const { data } = await this.sb.from("profiles").select("display_name").eq("id", user.id).maybeSingle();
    if (data) this.user.name = data.display_name;
    this.names.set(this.user.id, this.user.name);
    this.setAuth("signed_in");
    await this.loadRooms();
    await this.refreshFriends();
    this.heartbeat();
    this.timers.push(setInterval(() => this.heartbeat(), HEARTBEAT_MS));
    this.timers.push(setInterval(() => {
      this.refreshFriends();
      this.loadRooms().catch((e) => this.log(`rooms: ${e.message}`));   // notice rooms deleted elsewhere
    }, FRIENDS_MS));
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
    for (const room of this.rooms.values()) {
      this.clearTyping(room);
      this.sb.removeChannel(room.channel).catch(() => {});
    }
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
    this.emit({ type: "auth", state, user: this.user && { id: this.user.id, name: this.user.name, email: this.user.email, anonymous: this.user.anonymous }, ...extra });
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
    const added = [];
    for (const row of data) {
      if (!this.rooms.has(row.room_id)) added.push(this.addRoom(row.room_id, row.rooms.slug, row.last_read_id));
    }
    // Rooms we're no longer in (deleted by their creator, or left elsewhere).
    const still = new Set(data.map((row) => row.room_id));
    for (const room of [...this.rooms.values()]) if (!still.has(room.id)) await this.dropRoom(room);
    // Only new rooms start from the database's count; the others keep their
    // running count (a recount would double what catch-up adds after it).
    await Promise.all(added.map((room) => this.countUnread(room)));
    if (!this.rooms.has(this.current)) {
      const preferred = [...this.rooms.values()].find((r) => r.slug === prefs.room);
      this.current = preferred?.id ?? this.rooms.keys().next().value ?? null;
    }
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
      typing: new Map(),          // user id → timer that ends their "typing"
      typingSent: 0,              // when we last told the room we're typing
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
    await this.dropRoom(room);
  }

  // Deletes the room for everyone; only its creator may (RLS). A delete
  // that matched no row means this person didn't create it.
  async deleteRoom(roomRef) {
    const room = this.room(roomRef);
    const { data, error } = await this.sb.from("rooms").delete().eq("id", room.id).select("id");
    if (error) throw fail(error, "could not delete");
    if (!data?.length) throw new HttpError(403, `only the person who created #${room.slug} can delete it`);
    await this.dropRoom(room);
    return { slug: room.slug };
  }

  // Forget a room here: its channel, its place in the list.
  async dropRoom(room) {
    this.clearTyping(room);
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
        ({ new: row }) => this.enqueue(room, [row], { backfill: false, count: true }))
      .on("presence", { event: "sync" }, () => this.presenceChanged(room))
      .on("broadcast", { event: "typing" }, ({ payload }) => this.typingSeen(room, payload?.user_id))
      .subscribe(async (status, err) => {
        if (this.closing || this.rooms.get(room.id) !== room) return;
        room.status = status;
        this.emit({ type: "status", room: room.id, status, ...(err ? { error: err.message } : {}) });
        if (status !== "SUBSCRIBED") {
          // Presence from a dropped channel is stale until it rejoins.
          if (room.online.size) this.presenceChanged(room, { clear: true });
          return;
        }
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

  presenceChanged(room, { clear = false } = {}) {
    const before = new Set(room.online.keys());
    room.online.clear();
    for (const [key, metas] of clear ? [] : Object.entries(room.channel.presenceState())) {
      const name = metas.at(-1)?.name;
      room.online.set(key, name ?? this.names.get(key) ?? "someone");
      this.noteName(key, name);
    }
    // Someone dropped out of a live channel: they left (unless it is our own
    // channel that dropped, `clear`). A newer heartbeat can bring them back.
    if (!clear) for (const id of before) if (!room.online.has(id)) this.leftAt.set(id, Date.now());
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
      await this.enqueue(room, data.reverse(), { backfill: true, count: false });   // already in the unread count
      return;
    }
    let after = Math.max(0, room.lastSeenId - BACKFILL_OVERLAP);
    for (;;) {
      const { data, error } = await this.sb.from("messages").select(cols)
        .eq("room_id", room.id).gt("id", after).order("id", { ascending: true }).limit(BACKFILL_PAGE);
      if (error) throw fail(error, "could not catch up");
      await this.enqueue(room, data, { backfill: true, count: true });
      if (data.length < BACKFILL_PAGE) return;
      after = data[data.length - 1].id;
    }
  }

  // `count`: these may be news to the person (live, or caught up after a
  // reconnect), so others' messages past the read marker add to room.unread.
  // Every message event carries the room's unread count after it.
  enqueue(room, rows, { backfill, count }) {
    room.queue = room.queue.then(async () => {
      const fresh = rows.filter((r) => !room.seen.has(r.id));
      if (!fresh.length) return;
      await this.resolveNames(fresh.map((r) => r.user_id));
      for (const row of fresh) {
        if (room.seen.has(row.id)) continue;
        room.seen.add(row.id);
        room.lastSeenId = Math.max(room.lastSeenId, row.id);
        if (!backfill) this.typingStopped(room, row.user_id);   // their message is here
        const counted = count && row.user_id !== this.user?.id && row.id > room.lastReadId;
        if (counted) room.unread++;
        this.emit({
          type: "message",
          backfill,
          counted,
          unread: room.unread,
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
    for (const p of data ?? []) this.noteName(p.id, p.display_name);
  }

  // Remember someone's name. When it changed, tell the pane, so messages
  // already on screen show the new one.
  noteName(id, name) {
    if (!name) return;
    const old = this.names.get(id);
    this.names.set(id, name);
    if (old && old !== name) this.emit({ type: "name", user_id: id, name });
  }

  async send(text, roomRef) {
    const room = this.room(roomRef);
    const body = String(text ?? "").trim();
    if (!body) throw new HttpError(400, "empty message");
    if (body.length > 500) throw new HttpError(400, "messages are limited to 500 characters");
    const { data, error } = await this.sb.from("messages").insert({ room_id: room.id, body })
      .select("id, room_id, user_id, body, created_at").single();
    if (error) throw fail(error, "could not send");
    await this.enqueue(room, [data], { backfill: false, count: true });   // show it now; the realtime copy is dropped as a duplicate
    return { id: data.id };
  }

  // ------------------------------------------------------------ typing

  // Tell the room we're typing. The pane calls this on keystrokes; at most
  // one broadcast goes out per TYPING_SEND_MS.
  async typing(roomRef) {
    const room = this.room(roomRef);
    const now = Date.now();
    if (room.status !== "SUBSCRIBED" || now - room.typingSent < TYPING_SEND_MS) return;
    room.typingSent = now;
    await room.channel.send({ type: "broadcast", event: "typing", payload: { user_id: this.user.id } });
  }

  // Only the room's members can broadcast on its channel (RLS). The name
  // comes from our own records, never from the broadcast.
  async typingSeen(room, id) {
    if (typeof id !== "string" || id === this.user?.id) return;
    if (!this.names.has(id)) await this.resolveNames([id]).catch(() => {});
    if (!this.names.has(id) || this.rooms.get(room.id) !== room) return;
    const fresh = !room.typing.has(id);
    clearTimeout(room.typing.get(id));
    room.typing.set(id, setTimeout(() => this.typingStopped(room, id), TYPING_TTL_MS));
    if (fresh) this.emitTyping(room);
  }

  typingStopped(room, id) {
    if (!room.typing.has(id)) return;
    clearTimeout(room.typing.get(id));
    room.typing.delete(id);
    this.emitTyping(room);
  }

  clearTyping(room) {
    for (const timer of room.typing.values()) clearTimeout(timer);
    room.typing.clear();
  }

  emitTyping(room) {
    this.emit({
      type: "typing",
      room: room.id,
      users: [...room.typing.keys()].map((id) => ({ user_id: id, name: this.names.get(id) })),
    });
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
      for (const f of data) this.noteName(f.user_id, f.display_name);
      this.emitFriends();
    })().finally(() => { this.friendsLoading = null; });
    return this.friendsLoading;
  }

  // Online = tracked in any room channel, or a recent heartbeat (clients
  // without a socket only send heartbeats) newer than their last presence leave.
  friendList() {
    const now = Date.now();
    const present = new Set();
    for (const room of this.rooms.values()) for (const id of room.online.keys()) present.add(id);
    const recentBeat = (f) => {
      if (f.last_seen == null) return false;
      const beat = Date.parse(f.last_seen);
      return now - beat < ONLINE_WINDOW_MS && beat > (this.leftAt.get(f.user_id) ?? 0);
    };
    return this.friends.map((f) => ({
      user_id: f.user_id,
      name: this.names.get(f.user_id) ?? f.display_name,
      rooms: f.rooms,
      online: present.has(f.user_id) || recentBeat(f),
    })).sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
  }

  emitFriends() {
    if (this.user) this.emit({ type: "friends", friends: this.friendList() });
  }

  // ------------------------------------------------------------ snapshot & prefs

  snapshot() {
    return {
      auth: this.authState,
      user: this.user && { id: this.user.id, name: this.user.name, email: this.user.email, anonymous: this.user.anonymous },
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
