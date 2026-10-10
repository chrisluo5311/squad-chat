// Music in the background, as Pixel Play (github.com/chrisluo5311/Pixel-Play)
// plays it: one mpv per bridge, with no video, driven over its JSON IPC
// socket. YouTube goes through yt-dlp. Nothing starts until play is pressed.
//
//   * mpv starts under a small sh watchdog that stops it within a second of
//     the bridge going away, however it goes (a kill -9 too), and in its own
//     process group, so closing the bridge stops both.
//   * A YouTube channel's live streams (lofi girl's change id now and then)
//     are looked up when it's played, not kept.
//   * The room's own list (URLs, files, folders, Pixel Play's playlist) is
//     one JSON file, changed under the same lock as Snippets.
//   * If Pixel Play is playing too, the room says so: two players at once
//     is rarely what anyone wants.
//   * A manifest's stations must be https and on the room's own hosts (a
//     YouTube one needs www.youtube.com, whose audio then comes from
//     Google's video servers), like any provider's reach. What the person
//     adds with /lofi add plays from wherever it is: that's their choice.
//   * There's one mpv, and it belongs to the room that last pressed play.
//     Another room using this provider shows nothing playing and can't
//     drive it, until it plays something itself.

import { join, resolve, extname, basename } from "node:path";
import { readFileSync, writeFileSync, renameSync, mkdirSync, chmodSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { RoomError } from "../net.mjs";
import { locked } from "../lock.mjs";

const AUDIO = new Set([".mp3", ".m4a", ".flac", ".wav", ".ogg", ".opus", ".aac", ".aiff"]);
const MAX_ITEMS = 200;
const CHANNEL_TTL_MS = 60 * 60_000;

// ---------------------------------------------------------------- what plays

export function kindOf(target) {
  const t = String(target ?? "").trim();
  if (/^https?:\/\/(www\.)?youtube\.com\/@[^/]+\/streams\/?$/i.test(t)) return "channel";
  if (/^https?:\/\/((www|m|music)\.)?(youtube\.com|youtu\.be)\//i.test(t)) return "youtube";
  if (/^https?:\/\//i.test(t)) return "stream";
  return "file";
}

const TAG = { channel: "YouTube live", youtube: "YouTube", stream: "stream", file: "file" };

// Pixel Play's playlist: a track a line, "#" lines skipped, " # title" after.
export function parsePlaylist(text) {
  return String(text ?? "").split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("#")).map((l) => {
    const [target, ...title] = l.split(" # ");
    return { target: target.trim(), name: title.join(" # ").trim() };
  });
}

function nameFor(target) {
  const t = String(target);
  if (kindOf(t) === "file") return basename(t).replace(/\.[^.]+$/, "");
  try {
    const u = new URL(t);
    return u.searchParams.get("v") ? `YouTube ${u.searchParams.get("v")}` : `${u.hostname}${u.pathname}`.replace(/\/$/, "").slice(0, 40);
  } catch { return t.slice(0, 40); }
}

function loadList(dir) {
  try {
    const data = JSON.parse(readFileSync(join(dir, "list.json"), "utf8"));
    return Array.isArray(data.items) ? data.items.filter((x) => x?.id && x.target) : [];
  } catch (err) {
    if (err.code === "ENOENT") return [];
    throw new RoomError(500, `Couldn't read the Lo-fi list (${err.code ?? "not JSON"}). Nothing was changed.`);
  }
}

function saveList(dir, items) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const file = join(dir, "list.json");
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify({ v: 1, items }, null, 1), { mode: 0o600 });
  renameSync(tmp, file);
}

// A station's host, when it's an https URL; else null.
export function stationHost(url) {
  try { const u = new URL(String(url)); return u.protocol === "https:" ? u.hostname.toLowerCase() : null; } catch { return null; }
}

// The room's stations (from the manifest, only those on its hosts), then
// its own list.
function entries(params, ctx) {
  const hosts = ctx.hosts ?? [];
  const stations = (Array.isArray(params.stations) ? params.stations : []).filter((s) => s?.url && s.name)
    .map((s, i) => ({ id: `s${i + 1}`, name: String(s.name), target: String(s.url), kind: kindOf(s.url) }))
    .filter((s) => hosts.includes(stationHost(s.target)));
  let own = [];
  try { own = loadList(ctx.dataDir); } catch { /* shown as an error by fetch */ }
  return [...stations, ...own.map((x) => ({ ...x, kind: kindOf(x.target) }))];
}

// ---------------------------------------------------------------- tools

let tools = null;   // { mpv, ytdlp } paths, found once per bridge

async function findTools(ctx) {
  if (tools) return tools;
  const find = async (names) => {
    for (const n of names) if (await ctx.run([n, "--version"], { timeoutMs: 5_000 })) return n;
    return null;
  };
  tools = {
    mpv: await find(["mpv", "/opt/homebrew/bin/mpv", "/usr/local/bin/mpv", "/usr/bin/mpv"]),
    ytdlp: await find(["yt-dlp", "/opt/homebrew/bin/yt-dlp", "/usr/local/bin/yt-dlp", "/usr/bin/yt-dlp"]),
  };
  return tools;
}

const channels = new Map();   // channel URL → { at, streams: [{ id, title }] }

async function liveStreams(url, ctx) {
  const was = channels.get(url);
  if (was && ctx.now() - was.at < CHANNEL_TTL_MS && was.streams.length) return was.streams;
  const t = await findTools(ctx);
  if (!t.ytdlp) throw new RoomError(400, "YouTube needs yt-dlp: brew install yt-dlp");
  const out = await ctx.run([t.ytdlp, "--flat-playlist", "--playlist-end", "10", "--print", "%(live_status)s\t%(id)s\t%(title)s", url], { timeoutMs: 30_000 });
  if (out == null) throw new RoomError(502, "yt-dlp couldn't read that channel");
  const streams = out.split("\n").map((l) => l.split("\t")).filter(([st, id]) => st === "is_live" && /^[\w-]{6,20}$/.test(id ?? "")).map(([, id, title]) => ({ id, title: title ?? id }));
  channels.set(url, { at: ctx.now(), streams });
  return streams;
}

// ---------------------------------------------------------------- mpv

let mpv = null;   // { child, conn, pending, seq, buf, entryId, owner }

// mpv is playing for this room (owner: the room's data folder).
const mine = (ctx) => !!mpv?.conn && mpv.owner === ctx.dataDir;

function ipc(command, timeoutMs = 2_000) {
  return new Promise((resolve, reject) => {
    if (!mpv?.conn) return reject(new RoomError(409, "Nothing's playing."));
    const id = ++mpv.seq;
    const timer = setTimeout(() => { mpv?.pending.delete(id); reject(new RoomError(504, "mpv didn't answer")); }, timeoutMs);
    mpv.pending.set(id, (reply) => { clearTimeout(timer); resolve(reply); });
    mpv.conn.write(`${JSON.stringify({ command, request_id: id })}\n`);
  });
}

async function get(prop) {
  try {
    const r = await ipc(["get_property", prop], 1_000);
    return r?.error === "success" ? r.data : null;
  } catch { return null; }
}

function stop() {
  if (!mpv) return;
  const { child, conn } = mpv;
  mpv = null;
  try { conn?.write(`${JSON.stringify({ command: ["quit"] })}\n`); } catch { /* gone */ }
  try { conn?.destroy(); } catch { /* gone */ }
  try { process.kill(-child.pid, "SIGTERM"); } catch { try { child.kill("SIGTERM"); } catch { /* gone */ } }
}

async function start(ctx, volume) {
  if (mpv?.conn) return mpv;
  const t = await findTools(ctx);
  if (!t.mpv) throw new RoomError(400, "Lo-fi needs mpv: brew install mpv yt-dlp");
  const sock = join(ctx.runtimeDir, `mpv-${process.pid}.sock`);
  // $0 is mpv; the loop ends it once the bridge ($PPID) or mpv itself is gone.
  const watch = '"$0" "$@" & m=$!; while kill -0 $PPID 2>/dev/null && kill -0 $m 2>/dev/null; do sleep 1; done; kill $m 2>/dev/null';
  const args = ["--idle=yes", "--no-video", "--no-terminal", "--force-window=no", `--volume=${volume}`, `--input-ipc-server=${sock}`, "--ytdl-format=bestaudio/best"];
  if (t.ytdlp?.startsWith("/")) args.push(`--script-opts=ytdl_hook-ytdl_path=${t.ytdlp}`);
  const child = ctx.spawn(["/bin/sh", "-c", watch, t.mpv, ...args], { detached: true });
  const state = { child, conn: null, pending: new Map(), seq: 0, buf: "", entryId: null, owner: ctx.dataDir };
  mpv = state;
  child.on?.("exit", () => { if (mpv === state) { try { state.conn?.destroy(); } catch { /* gone */ } mpv = null; } });
  for (let waited = 0; waited < 5_000 && mpv === state; waited += 100) {
    const conn = await new Promise((res) => {
      const c = ctx.connect(sock);
      c.once("connect", () => res(c));
      c.once("error", () => res(null));
    });
    if (conn) {
      state.conn = conn;
      conn.setEncoding?.("utf8");
      conn.on("data", (chunk) => {
        state.buf += chunk;
        let nl;
        while ((nl = state.buf.indexOf("\n")) >= 0) {
          const line = state.buf.slice(0, nl);
          state.buf = state.buf.slice(nl + 1);
          let msg;
          try { msg = JSON.parse(line); } catch { continue; }
          const done = msg.request_id != null && state.pending.get(msg.request_id);
          if (done) { state.pending.delete(msg.request_id); done(msg); }
        }
      });
      conn.on("close", () => { if (mpv === state) state.conn = null; });
      return state;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  stop();
  throw new RoomError(502, "mpv didn't start");
}

async function playEntry(entry, ctx, params) {
  if (entry.kind === "youtube" && !(await findTools(ctx)).ytdlp) throw new RoomError(400, "YouTube needs yt-dlp: brew install yt-dlp");
  const queue = entry.kind === "channel"
    ? (await liveStreams(entry.target, ctx)).map((s) => `https://www.youtube.com/watch?v=${s.id}`)
    : [entry.target];
  if (!queue.length) throw new RoomError(404, `${entry.name} has no live streams right now`);
  await start(ctx, params.volume ?? 60);
  await ipc(["loadfile", queue[0], "replace"]);
  for (const url of queue.slice(1)) await ipc(["loadfile", url, "append"]);
  await ipc(["set_property", "pause", false]);
  mpv.entryId = entry.id;
  mpv.owner = ctx.dataDir;
  return { ok: true, playing: entry.name };
}

// ---------------------------------------------------------------- Pixel Play

let pixelCheck = { at: 0, playing: false };

async function pixelPlaying(ctx) {
  if (ctx.now() - pixelCheck.at < 10_000) return pixelCheck.playing;
  pixelCheck = { at: ctx.now(), playing: false };
  const sock = join(ctx.home ?? "", ".claude", "pixel-play", "t.sock");
  if (!(await ctx.fs.stat(sock))) return false;
  pixelCheck.playing = await new Promise((res) => {
    const c = ctx.connect(sock);
    const done = (v) => { clearTimeout(timer); try { c.destroy(); } catch { /* gone */ } res(v); };
    const timer = setTimeout(() => done(false), 400);
    let buf = "";
    c.once("error", () => done(false));
    c.once("connect", () => c.write(`${JSON.stringify({ command: ["get_property", "pause"], request_id: 1 })}\n${JSON.stringify({ command: ["get_property", "idle-active"], request_id: 2 })}\n`));
    c.on("data", (d) => {
      buf += d;
      const replies = buf.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((m) => m?.request_id);
      if (replies.length >= 2) done(replies.every((m) => m.error === "success" && m.data === false));
    });
  });
  return pixelCheck.playing;
}

// ---------------------------------------------------------------- the provider

const clock = (s) => {
  if (!Number.isFinite(s) || s < 0) return "";
  const t = Math.floor(s);
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};

function pick(list, args) {
  const want = String(args.id ?? args.name ?? "").trim().toLowerCase();
  return list.find((e) => e.id === args.id) ?? list.find((e) => e.name.toLowerCase() === want) ?? null;
}

async function step(params, ctx, dir) {
  if (mine(ctx)) {
    const [pos, count] = await Promise.all([get("playlist-pos"), get("playlist-count")]);
    if (Number.isInteger(pos) && Number.isInteger(count) && count > 1 && pos + dir >= 0 && pos + dir < count) {
      await ipc([dir > 0 ? "playlist-next" : "playlist-prev", "force"]);
      return { ok: true };
    }
  }
  const list = entries(params, ctx);
  if (!list.length) throw new RoomError(404, "Nothing to play: /lofi add <url or path>");
  const i = mine(ctx) ? list.findIndex((e) => e.id === mpv.entryId) : -1;
  return playEntry(list[(i + dir + list.length) % list.length], ctx, params);
}

// Plays one entry by id or name, or else resumes, or else starts the list.
async function play(params, args, ctx) {
  const list = entries(params, ctx);
  if (args.id || args.name) {
    const e = pick(list, args);
    if (!e) throw new RoomError(404, `Nothing called "${args.name ?? args.id}" to play.`);
    return playEntry(e, ctx, params);
  }
  if (mine(ctx) && !(await get("idle-active"))) { await ipc(["set_property", "pause", false]); return { ok: true }; }
  if (!list.length) throw new RoomError(404, "Nothing to play: /lofi add <url or path>");
  return playEntry((mine(ctx) && list.find((e) => e.id === mpv.entryId)) || list[0], ctx, params);
}

export default {
  type: "player",
  // mpv reaches the streams itself, not through ctx.fetch: the manifest
  // lists the stations' hosts so the room says where it goes.
  hosts: [],
  async fetch(params, ctx) {
    const t = await findTools(ctx);
    const list = entries(params, ctx);
    let listError = "";
    try { loadList(ctx.dataDir); } catch (err) { listError = err.message; }
    const now = { state: "stopped", title: "", source: "", timeText: "", pct: null, volume: params.volume ?? 60, mark: "■" };
    if (mine(ctx)) {
      const [title, meta, pos, dur, paused, vol, idle] = await Promise.all(["media-title", "metadata", "time-pos", "duration", "pause", "volume", "idle-active"].map(get));
      const entry = list.find((e) => e.id === mpv?.entryId);
      if (!idle) {
        now.state = paused ? "paused" : "playing";
        now.mark = paused ? "⏸" : "▶";
        now.title = String(meta?.["icy-title"] || title || entry?.name || "");
        now.source = entry ? `${entry.name} · ${TAG[entry.kind]}` : "";
        const live = !Number.isFinite(dur) || dur <= 0 || entry?.kind === "channel" || entry?.kind === "stream";
        // A YouTube live stream's position is hours into its broadcast: "live" says more.
        now.timeText = entry?.kind === "channel" ? "live" : live ? `${clock(pos)} · live` : `${clock(pos)} / ${clock(dur)}`;
        now.pct = live ? null : Math.round((pos / dur) * 100);
      }
      if (Number.isFinite(vol)) now.volume = Math.round(vol);
    }
    const hint = !t.mpv ? "Lo-fi needs mpv: brew install mpv yt-dlp" : !t.ytdlp ? "YouTube needs yt-dlp: brew install yt-dlp" : "";
    const conflict = now.state === "playing" && (await pixelPlaying(ctx)) ? "Pixel Play is playing too." : "";
    return {
      available: !!t.mpv,
      ytdlp: !!t.ytdlp,
      now,
      entries: list.map((e) => ({ id: e.id, name: e.name, tag: TAG[e.kind] + (e.kind !== "file" && e.kind !== "stream" && !t.ytdlp ? " (needs yt-dlp)" : ""), on: mine(ctx) && e.id === mpv.entryId && now.state !== "stopped" ? "♫" : "" })),
      count: list.length,
      hint: [hint, listError].filter(Boolean).join(" "),
      conflict,
      band: now.state === "stopped" ? "not playing" : `${now.mark} ${now.title || "…"}${now.timeText ? ` · ${now.timeText}` : ""}`,
      share: now.state === "stopped" ? "♫ not playing anything" : `♫ now listening: ${now.title}${now.source ? ` (${now.source})` : ""}`,
    };
  },
  actions: {
    play,
    async pause(params, args, ctx) {
      if (!mine(ctx) || (await get("idle-active"))) return play(params, {}, ctx);
      await ipc(["cycle", "pause"]);
      return { ok: true };
    },
    async stop(params, args, ctx) {
      if (mine(ctx)) await ipc(["stop"]);
      return { ok: true };
    },
    next: (params, args, ctx) => step(params, ctx, 1),
    prev: (params, args, ctx) => step(params, ctx, -1),
    async up(params, args, ctx) { if (mine(ctx)) await ipc(["add", "volume", 5]); return { ok: true }; },
    async down(params, args, ctx) { if (mine(ctx)) await ipc(["add", "volume", -5]); return { ok: true }; },
    async volume(params, args, ctx) {
      const v = Math.max(0, Math.min(130, Number(args.level)));
      if (!Number.isFinite(v)) throw new RoomError(400, "Volume is 0-130.");
      if (mine(ctx)) await ipc(["set_property", "volume", v]);
      return { ok: true, volume: v };
    },
    // A URL, a file, or a folder of audio files (each one added).
    add: (params, args, ctx) => locked(ctx.dataDir, "list", async () => {
      const raw = String(args.target ?? "").trim();
      if (!raw) throw new RoomError(400, "Add what? A URL, a file or a folder.");
      const items = loadList(ctx.dataDir);
      const fresh = [];
      if (kindOf(raw) === "file") {
        const path = resolve(raw.replace(/^~(?=\/|$)/, ctx.home ?? "~"));
        const st = await ctx.fs.stat(path);
        if (!st) throw new RoomError(404, `No file or folder at ${path}.`);
        const files = st.isDirectory?.()
          ? (await ctx.fs.readdir(path)).filter((n) => AUDIO.has(extname(n).toLowerCase())).sort().map((n) => join(path, n))
          : AUDIO.has(extname(path).toLowerCase()) ? [path] : [];
        if (!files.length) throw new RoomError(400, `No audio files there (${[...AUDIO].join(" ")}).`);
        for (const f of files) fresh.push({ target: f, name: nameFor(f) });
      } else {
        try { new URL(raw); } catch { throw new RoomError(400, `Not a URL: ${raw}`); }
        fresh.push({ target: raw, name: String(args.name ?? "").trim().slice(0, 60) || nameFor(raw) });
      }
      const known = new Set(items.map((x) => x.target));
      const added = fresh.filter((x) => !known.has(x.target)).slice(0, MAX_ITEMS - items.length);
      if (!added.length) throw new RoomError(409, known.size >= MAX_ITEMS ? `That's ${MAX_ITEMS} already.` : "Already on the list.");
      items.push(...added.map((x) => ({ id: `u${randomBytes(4).toString("hex")}`, ...x })));
      saveList(ctx.dataDir, items);
      return { ok: true, added: added.length, first: added[0].name };
    }),
    remove: (params, args, ctx) => locked(ctx.dataDir, "list", () => {
      const items = loadList(ctx.dataDir);
      const want = String(args.name ?? "").trim().toLowerCase();
      const i = items.findIndex((x) => x.name.toLowerCase() === want || x.id === args.id);
      if (i < 0) throw new RoomError(404, `Nothing called "${args.name}" on your list. Stations can't be removed.`);
      const [gone] = items.splice(i, 1);
      saveList(ctx.dataDir, items);
      return { ok: true, removed: gone.name };
    }),
    // Pixel Play's playlist, ~/.claude/pixel-play/playlist.txt, added in.
    import: (params, args, ctx) => locked(ctx.dataDir, "list", async () => {
      const file = join(ctx.home ?? "", ".claude", "pixel-play", "playlist.txt");
      const text = await ctx.read(file);
      if (text == null) throw new RoomError(404, `No Pixel Play playlist at ${file}.`);
      const items = loadList(ctx.dataDir);
      const known = new Set(items.map((x) => x.target));
      const added = parsePlaylist(text).filter((x) => !known.has(x.target)).slice(0, MAX_ITEMS - items.length)
        .map((x) => ({ id: `u${randomBytes(4).toString("hex")}`, target: x.target, name: x.name || nameFor(x.target) }));
      items.push(...added);
      saveList(ctx.dataDir, items);
      return { ok: true, added: added.length };
    }),
  },
  close: stop,
};

// For tests: forget the tools found and the player.
export function resetPlayer() {
  stop();
  tools = null;
  channels.clear();
  pixelCheck = { at: 0, playing: false };
}
