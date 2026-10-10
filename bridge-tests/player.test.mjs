// The Lo-fi room's player against a fake mpv: an in-memory IPC socket that
// answers like mpv does and records every command. No sound, no processes.

import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import player, { kindOf, parsePlaylist, resetPlayer } from "../plugins/squad-chat/bridge/src/rooms/providers/player.mjs";

const STATIONS = [{ name: "Lofi Girl", url: "https://www.youtube.com/@LofiGirl/streams" }, { name: "Groove Salad", url: "https://ice2.somafm.com/groovesalad-128-mp3" }];

// mpv as its socket shows it: properties to read, and the commands it got.
function fakeMpv({ tools = { mpv: true, ytdlp: true }, files = {}, dirs = {}, channel = "is_live\tjfKfPfyJRdk\tlofi hip hop radio\nwas_live\told\told one\nis_live\t4xDzrJKXOOY\tsynthwave radio\n" } = {}) {
  const props = { "idle-active": true, pause: false, volume: 60, "media-title": "", metadata: {}, "time-pos": 0, duration: null, "playlist-pos": 0, "playlist-count": 0 };
  const sent = [];
  const spawned = [];
  const runs = [];
  const killed = [];
  const playlist = [];
  const ctx = {
    dataDir: mkdtempSync(join(tmpdir(), "sq-lofi-")),
    runtimeDir: "/tmp/sq-test",
    home: "/Users/me",
    now: () => 1_000_000,
    run: async (argv) => {
      runs.push(argv.join(" "));
      if (argv[1] === "--version") return (argv[0].endsWith("mpv") && tools.mpv) || (argv[0].endsWith("yt-dlp") && tools.ytdlp) ? "ok" : null;
      if (argv[0].endsWith("yt-dlp")) return channel;
      return null;
    },
    read: async (f) => files[f] ?? null,
    fs: { stat: async (f) => (dirs[f] ? { isDirectory: () => true } : files[f] != null || f.endsWith(".mp3") ? { isDirectory: () => false } : null), readdir: async (d) => dirs[d] ?? [] },
    spawn: (argv, opts) => {
      const child = new EventEmitter();
      child.pid = 4242;
      spawned.push({ argv, opts });
      const vol = argv.find((x) => x.startsWith("--volume="));   // mpv starts at the volume it's given
      if (vol) props.volume = Number(vol.split("=")[1]);
      return child;
    },
    connect: (path) => {
      const c = new EventEmitter();
      c.setEncoding = () => {};
      c.destroy = () => {};
      if (path.includes("pixel-play")) { setImmediate(() => c.emit("error", new Error("ENOENT"))); return c; }
      c.write = (line) => {
        for (const l of line.split("\n").filter(Boolean)) {
          const { command, request_id: id } = JSON.parse(l);
          sent.push(command);
          const [name, a, b] = command;
          let data;
          if (name === "get_property") data = props[a];
          if (name === "set_property") props[a] = b;
          if (name === "cycle") props[a] = !props[a];
          if (name === "add") props[a] += b;
          if (name === "loadfile") { if (b === "replace") playlist.length = 0; playlist.push(a); Object.assign(props, { "idle-active": false, "playlist-count": playlist.length }); }
          if (name === "stop") props["idle-active"] = true;
          if (name === "playlist-next") props["playlist-pos"]++;
          if (id != null) setImmediate(() => c.emit("data", `${JSON.stringify({ request_id: id, error: "success", data })}\n`));
        }
      };
      setImmediate(() => c.emit("connect"));
      return c;
    },
  };
  return { ctx, props, sent, spawned, runs, killed, playlist };
}

const params = { stations: STATIONS, volume: 40 };

describe("player", () => {
  beforeEach(() => resetPlayer());

  it("tells what each entry is, and reads Pixel Play's playlist", () => {
    assert.deepEqual(["https://www.youtube.com/@LofiGirl/streams", "https://youtu.be/abc", "https://www.youtube.com/watch?v=x", "https://ice2.somafm.com/fluid-128-mp3", "/Users/me/a.mp3"].map(kindOf), ["channel", "youtube", "youtube", "stream", "file"]);
    assert.deepEqual(parsePlaylist("# a comment\nhttps://www.youtube.com/watch?v=abc # Lofi beats\n\n/Users/me/song.mp3\n"), [
      { target: "https://www.youtube.com/watch?v=abc", name: "Lofi beats" },
      { target: "/Users/me/song.mp3", name: "" },
    ]);
  });

  it("starts nothing until played, then starts mpv under its watchdog and loads the stream", async () => {
    const m = fakeMpv();
    const idle = await player.fetch(params, m.ctx);
    assert.equal(m.spawned.length, 0);
    assert.deepEqual([idle.available, idle.now.state, idle.band, idle.count], [true, "stopped", "not playing", 2]);
    assert.deepEqual(idle.entries.map((e) => `${e.id} ${e.tag}`), ["s1 YouTube live", "s2 stream"]);

    assert.deepEqual(await player.actions.play(params, { id: "s2" }, m.ctx), { ok: true, playing: "Groove Salad" });
    const { argv, opts } = m.spawned[0];
    assert.equal(argv[0], "/bin/sh");
    assert.match(argv[2], /kill -0 \$PPID/);   // stops with the bridge, however it goes
    assert.ok(argv.includes("--no-video") && argv.includes("--volume=40") && argv.includes("--input-ipc-server=/tmp/sq-test/mpv-" + process.pid + ".sock"));
    assert.equal(opts.detached, true);   // its own process group, so closing stops sh and mpv together
    assert.deepEqual(m.sent.filter((c) => c[0] !== "get_property"), [["loadfile", "https://ice2.somafm.com/groovesalad-128-mp3", "replace"], ["set_property", "pause", false]]);

    Object.assign(m.props, { metadata: { "icy-title": "Puff Dragon - Cascade" }, "time-pos": 201 });
    const d = await player.fetch(params, m.ctx);
    assert.deepEqual(d.now, { state: "playing", title: "Puff Dragon - Cascade", source: "Groove Salad · stream", timeText: "3:21 · live", pct: null, volume: 40, mark: "▶" });
    assert.equal(d.band, "▶ Puff Dragon - Cascade · 3:21 · live");
    assert.equal(d.entries[1].on, "♫");
    assert.equal(d.share, "♫ now listening: Puff Dragon - Cascade (Groove Salad · stream)");
  });

  it("plays a YouTube channel's live streams, looked up when played", async () => {
    const m = fakeMpv();
    await player.actions.play(params, { name: "lofi girl" }, m.ctx);
    assert.ok(m.runs.some((r) => /yt-dlp --flat-playlist .*@LofiGirl\/streams/.test(r)));
    assert.deepEqual(m.playlist, ["https://www.youtube.com/watch?v=jfKfPfyJRdk", "https://www.youtube.com/watch?v=4xDzrJKXOOY"]);   // live ones only
    // Next moves within the channel's streams first.
    m.props["playlist-pos"] = 0;
    await player.actions.next(params, {}, m.ctx);
    assert.ok(m.sent.some((c) => c[0] === "playlist-next"));
    const d = await player.fetch(params, m.ctx);
    assert.equal(d.now.timeText, "live");
  });

  it("pauses, steps the volume, stops, and goes to the next entry", async () => {
    const m = fakeMpv();
    await player.actions.pause(params, {}, m.ctx);   // nothing playing: pause starts the list
    assert.equal(m.playlist.length, 2);   // the first entry, Lofi Girl's two streams
    await player.actions.pause(params, {}, m.ctx);
    assert.equal(m.props.pause, true);
    await player.actions.up(params, {}, m.ctx);
    await player.actions.down(params, {}, m.ctx);
    await player.actions.down(params, {}, m.ctx);
    assert.equal(m.props.volume, 35);   // started at 40, +5, -5, -5
    m.props["playlist-pos"] = 1;   // the channel's last stream: next is the next entry
    await player.actions.next(params, {}, m.ctx);
    assert.deepEqual(m.playlist, ["https://ice2.somafm.com/groovesalad-128-mp3"]);
    await player.actions.stop(params, {}, m.ctx);
    assert.equal((await player.fetch(params, m.ctx)).now.state, "stopped");
  });

  it("says what's missing: mpv, or yt-dlp for YouTube", async () => {
    let m = fakeMpv({ tools: { mpv: false, ytdlp: false } });
    const d = await player.fetch(params, m.ctx);
    assert.equal(d.hint, "Lo-fi needs mpv: brew install mpv yt-dlp");
    assert.equal(d.entries[0].tag, "YouTube live (needs yt-dlp)");
    await assert.rejects(player.actions.play(params, { id: "s2" }, m.ctx), /Lo-fi needs mpv/);
    resetPlayer();
    m = fakeMpv({ tools: { mpv: true, ytdlp: false } });
    await assert.rejects(player.actions.play(params, { id: "s1" }, m.ctx), /YouTube needs yt-dlp/);
    await assert.rejects(player.actions.play(params, { name: "nope" }, m.ctx), /Nothing called "nope"/);
  });

  it("adds URLs, files and folders, removes, and imports Pixel Play's playlist", async () => {
    const m = fakeMpv({
      dirs: { "/Users/me/Music/chill": ["b.flac", "a.mp3", "cover.jpg", "notes.txt"] },
      files: { "/Users/me/.claude/pixel-play/playlist.txt": "https://www.youtube.com/watch?v=abc # Lofi beats\nhttps://ice2.somafm.com/groovesalad-128-mp3\n" },
    });
    assert.deepEqual(await player.actions.add(params, { target: "~/Music/chill" }, m.ctx), { ok: true, added: 2, first: "a" });
    assert.deepEqual(await player.actions.add(params, { target: "https://ice2.somafm.com/deepspaceone-128-mp3", name: "Deep Space One" }, m.ctx), { ok: true, added: 1, first: "Deep Space One" });
    await assert.rejects(player.actions.add(params, { target: "https://ice2.somafm.com/deepspaceone-128-mp3" }, m.ctx), /Already on the list/);
    await assert.rejects(player.actions.add(params, { target: "~/nowhere" }, m.ctx), /No file or folder at \/Users\/me\/nowhere/);
    assert.deepEqual(await player.actions.import(params, {}, m.ctx), { ok: true, added: 2 });
    assert.deepEqual(await player.actions.remove(params, { name: "deep space one" }, m.ctx), { ok: true, removed: "Deep Space One" });
    await assert.rejects(player.actions.remove(params, { name: "Groove Salad" }, m.ctx), /Stations can't be removed/);
    const list = JSON.parse(readFileSync(join(m.ctx.dataDir, "list.json"), "utf8")).items.map((x) => `${x.name} ${x.target}`);
    assert.deepEqual(list, ["a /Users/me/Music/chill/a.mp3", "b /Users/me/Music/chill/b.flac", "Lofi beats https://www.youtube.com/watch?v=abc", "ice2.somafm.com/groovesalad-128-mp3 https://ice2.somafm.com/groovesalad-128-mp3"]);
    assert.equal((await player.fetch(params, m.ctx)).count, 6);
  });

  it("stops mpv with the bridge", async () => {
    const m = fakeMpv();
    await player.actions.play(params, { id: "s2" }, m.ctx);
    const kills = [];
    const real = process.kill;
    process.kill = (pid, sig) => { kills.push([pid, sig]); return true; };
    try { player.close(); } finally { process.kill = real; }
    assert.deepEqual(kills, [[-4242, "SIGTERM"]]);   // the whole group: sh and mpv
    assert.equal((await player.fetch(params, m.ctx)).now.state, "stopped");
  });
});
