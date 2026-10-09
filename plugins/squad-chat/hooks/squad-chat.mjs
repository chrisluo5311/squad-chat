// squad-chat: friends' presence and a group chat in a side pane. Chat text
// never reaches the model.
//
// Everything that touches the engine ($) lives in this file, since $ is never
// followed across an import. The other files are plain logic:
//   state.mjs     the state built from the bridge's events
//   commands.mjs  slash commands and the pane's input box
//   views.mjs     the pane
//   sysviews.mjs  the built-in rooms (Usage, Git, Agents), with widgets.mjs
//   fnviews.mjs   function rooms, drawn from the manifests the bridge loads
//   metrics.mjs   this session's numbers, github.mjs the Git room's data,
//   sessions.mjs  heartbeats shared with the other sessions on this computer

import { state, applyEvent, resetBridgeState, currentRoom, roomMessages, statusText, isQuiet, missedText, activeView, SYS_ROOMS, DEFAULT_ROOMS, ROOM_ID, roomIds, enabledRooms, isFnRoom } from "./state.mjs";
import { PRIVATE_ARGS, login, logout, rename, room, who, dnd, share, shareItem, snippet, retargetShare, sendMessage, paneInput, sysRooms } from "./commands.mjs";
import { paneView, bandView } from "./views.mjs";
import { applyMeasure, applyTurnUsage, recordTurnContext, toolStarted, toolEnded, turnStarted, turnEnded, agentSpawned, applyAgentList, agentCounts, runningCalls } from "./metrics.mjs";
import { fetchGit, diffGit } from "./github.mjs";
import { heartbeat, beatKey } from "./sessions.mjs";

const PANE_ID = "squad-chat";
const MIN_NODE_MAJOR = 22;
const MAX_BACKOFF_MS = 30_000;
const TYPING_PING_MS = 2_000;
const LONG_TURN_MS = 30_000;   // a Claude turn this long turns "auto" do not disturb on
const GIT_SHOWN_MS = 60_000;   // how often the Git room refreshes while it's on show
const GIT_HIDDEN_MS = 5 * 60_000;   // and otherwise (for its tab's badge and the toasts)
const BEAT_IDLE_MS = 10_000;   // a heartbeat at least this often, so others don't drop us
const PUSHED = /\b(git\s+push|gh\s+pr\s+(create|merge|ready|close|review))\b/;

// ---------------------------------------------------------------- the bridge

let bridgeStarted = false;

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function unavailable($, detail) {
  state.bridge = "unavailable";
  state.detail = detail;
  $.ui.invalidate("ui.render");
}

async function nodeProblem($) {
  try {
    const { exitCode, stdout } = await $.process.run(["node", "--version"], { timeoutMs: 10_000 });
    const major = Number(/^v(\d+)/.exec(stdout.trim())?.[1]);
    if (exitCode !== 0 || !major) return "could not run `node --version`";
    if (major < MIN_NODE_MAJOR) return `squad-chat needs Node ${MIN_NODE_MAJOR} or newer (found ${stdout.trim()})`;
    return null;
  } catch (err) {
    return `squad-chat needs Node ${MIN_NODE_MAJOR}+ on PATH (${err?.message ?? err})`;
  }
}

// Runs bridge/dist/bridge.mjs for the life of the module, restarting it with
// backoff. Leaving the loop, or the module unloading, kills the child.
// The squad's server comes from the plugin's options (userConfig). An unset
// one is left out, so a SQUAD_SUPABASE_* variable in the environment (local
// development) still applies.
function serverEnv(options) {
  const env = {};
  if (options?.supabase_url) env.SQUAD_SUPABASE_URL = String(options.supabase_url).trim();
  if (options?.supabase_key) env.SQUAD_SUPABASE_KEY = String(options.supabase_key).trim();
  return env;
}

async function runBridge($, options) {
  const problem = await nodeProblem($);
  if (problem) return unavailable($, problem);

  let backoff = 1000;
  while (!state.ended) {
    state.token = randomToken();
    resetBridgeState();
    const startedAt = await $.clock.now();
    let buffered = "";
    try {
      const child = $.process.spawn({
        argv: ["node", `${$.plugin.root}/bridge/dist/bridge.mjs`],
        env: { SQUAD_BRIDGE_TOKEN: state.token, SQUAD_ROOMS_DIR: `${$.plugin.root}/rooms`, ...serverEnv(options) },
      });
      for await (const { stream, text } of child) {
        if (stream === "stderr") { $.ui.log(`squad-chat bridge: ${text.trimEnd()}`, { to: "debug" }); continue; }
        buffered += text;
        let nl;
        while ((nl = buffered.indexOf("\n")) >= 0) {
          const line = buffered.slice(0, nl).trim();
          buffered = buffered.slice(nl + 1);
          if (!line) continue;
          let event;
          try { event = JSON.parse(line); }
          catch { $.ui.log(`squad-chat bridge: unparsable line: ${line.slice(0, 120)}`, { to: "debug" }); continue; }
          if (event.type === "fnrooms") {
            lastVisible = "";   // a new bridge knows nothing yet
            for (const bad of event.invalid ?? []) $.ui.log(`squad-chat: room ${bad.dir} skipped: ${bad.errors.join("; ")}`, { to: "debug" });
          }
          if (applyEvent(event)) afterChange($);
          // A new or restarted bridge starts out available: tell it again.
          if (event.type === "auth" && event.state === "signed_in" && isQuiet()) sendStatus($);
        }
      }
    } catch (err) {
      // Cannot start: no process noun on this surface (desktop), or no node.
      return unavailable($, `cannot start the chat bridge: ${err?.message ?? err}`);
    }
    if (state.ended || state.bridge === "unconfigured") return;   // nothing to retry until options change
    if ((await $.clock.now()) - startedAt > 60_000) backoff = 1000;
    resetBridgeState();
    state.bridge = "restarting";
    state.detail = `bridge stopped; retrying in ${Math.round(backoff / 1000)}s`;
    $.ui.invalidate("ui.render");
    await $.clock.sleep(backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }
}

// One control request; resolves the bridge's JSON answer or throws its error.
async function callBridge($, path, body) {
  if (!state.socket) {
    throw new Error(state.bridge === "unavailable" ? state.detail : "chat is still connecting, try again in a moment");
  }
  const res = await $.http.fetch(`http://bridge${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { "content-type": "application/json", "x-squad-token": state.token },
    body: body === undefined ? undefined : JSON.stringify(body),
    socketPath: state.socket,
  });
  let data = {};
  try { data = JSON.parse(res.text || "{}"); } catch { /* keep {} */ }
  if (!res.ok) throw new Error(data.error || `bridge answered ${res.status}`);
  return data;
}

// ---------------------------------------------------------------- keeping chat out of the model

// Claude Code records a slash command as a user row the model reads on later
// turns ("<command-name>/say</command-name> ... <command-args>TEXT</command-args>").
// For commands that carry messages, emails, codes or passcodes, the args are
// replaced before the row is stored or sent.
const ARGS = /<command-args>[\s\S]*?<\/command-args>/g;
const REDACTED = "<command-args>[squad-chat input, hidden from Claude]</command-args>";
const NAME = /<command-name>\/(?:squad-chat:)?([\w-]+)<\/command-name>/;

function blockTexts(content) {
  if (typeof content === "string") return [content];
  return (content ?? []).filter((b) => b?.type === "text").map((b) => b.text ?? "");
}

function privateCommand(message) {
  return blockTexts(message?.content).some((t) => PRIVATE_ARGS.has(NAME.exec(t)?.[1]));
}

function redact(content) {
  if (typeof content === "string") return content.replace(ARGS, REDACTED);
  return content.map((b) => (b?.type === "text" ? { ...b, text: String(b.text ?? "").replace(ARGS, REDACTED) } : b));
}

// ---------------------------------------------------------------- pane and commands

async function openPane($) {
  const opened = await $.ui.open({ id: PANE_ID, title: "Squad Chat", focus: true, rows: 12, columns: 52 });
  if (opened?.isPlaced === false) $.ui.toast("squad-chat: widen the terminal to see the chat pane");
}

// After any state change: redraw, refresh the status line, and toast an
// @mention when the person asked for that (/chat notify on).
function afterChange($) {
  $.ui.invalidate("ui.render");
  syncRooms($);
  $.ui.status(statusText());
  if (state.mention) {
    const m = state.mention;
    state.mention = null;
    if (state.notify) $.ui.toast(`💬 ${m.user} in #${m.slug}: ${m.body.slice(0, 80)}`);
  }
}

// ---------------------------------------------------------------- function rooms

// Tell the bridge which function rooms have tabs and which is on show, so it
// runs their providers (and polls the one on show more often). Only on change.
let lastVisible = "";
function syncRooms($) {
  if (!state.socket || !state.fn.size) return;
  const enabled = enabledRooms().filter(isFnRoom);
  const view = activeView();
  const shown = state.paneShown && isFnRoom(view) ? view : null;
  const key = JSON.stringify([enabled, shown]);
  if (key === lastVisible) return;
  lastVisible = key;
  callBridge($, "/fnroom/visible", { enabled, shown }).catch((err) => {
    lastVisible = "";
    $.ui.log(`squad-chat: rooms: ${err?.message ?? err}`, { to: "debug" });
  });
}

async function refreshRoom($, id) {
  try {
    await callBridge($, "/fnroom/refresh", { room: id });
  } catch (err) {
    state.notice = err?.message ?? String(err);
    $.ui.invalidate("ui.render");
  }
}

// A function room's ⇪: held for a look, like any snippet.
function shareItemFromPane($, item) {
  const say = (text) => { state.notice = text; $.ui.invalidate("ui.render"); };
  try { shareItem(item, say, { inPane: true }); } catch (err) { say(err?.message ?? String(err)); }
  $.ui.invalidate("ui.render");
}

// ---------------------------------------------------------------- do not disturb

function sendStatus($) {
  callBridge($, "/status", { status: isQuiet() ? "busy" : "available" })
    .catch((err) => $.ui.log(`squad-chat: could not set status: ${err?.message ?? err}`, { to: "debug" }));
}

// Do not disturb may have started or ended: tell the room, and on the way
// out sum up what came in meanwhile (a toast, for people who asked for them).
let wasQuiet = false;
function quietChanged($) {
  const quiet = isQuiet();
  if (quiet === wasQuiet) return;
  wasQuiet = quiet;
  if (state.auth === "signed_in") sendStatus($);
  if (!quiet) {
    const summary = missedText();
    if (summary && state.notify) $.ui.toast(summary);
    state.missed = { messages: 0, mentions: 0 };
  }
  afterChange($);
}

async function setDnd($, mode) {
  state.dnd = mode;
  await $.store.set("dnd", mode);
  quietChanged($);
}

// ---------------------------------------------------------------- sharing snippets

// What /chat-share reads from the session: the mouse selection, Claude's replies,
// and `git diff` in the session's folder. Reading only: nothing is added to
// the conversation.
function shareSources($, { inPane = false } = {}) {
  return {
    inPane,
    // Claude Code 2.1.287 has no selection to read: share the last code block.
    selection: async () => { try { return (await $.ui.selection())?.text; } catch { return undefined; } },
    messages: () => $.session.messages(),
    diff: async (path) => {
      const cwd = await $.session.cwd();
      const argv = ["git", "diff", "HEAD", "--no-color", "--no-ext-diff", "--", ...(path ? [path] : [])];
      const r = await $.process.run(argv, { cwd, timeoutMs: 15_000 });
      if (r.exitCode !== 0) throw new Error(`git diff: ${r.stderr.trim().split("\n")[0] || `exit ${r.exitCode}`}`);
      if (r.isStdoutTruncated) throw new Error(`Too big to share. Share one file with ${inPane ? "/share" : "/chat-share"} diff <path>.`);
      return r.stdout;
    },
  };
}

// The preview card's Send and Cancel: like typing "/share send" in the box,
// without touching what's typed there.
async function shareFromPane($, verb) {
  const say = (text) => { state.notice = text; $.ui.invalidate("ui.render"); };
  try {
    await share((path, body) => callBridge($, path, body), verb, say, shareSources($, { inPane: true }));
  } catch (err) {
    say(err?.message ?? String(err));
  }
  $.ui.invalidate("ui.render");
}

// Copy from a command: at the prompt, or typed in the pane's box.
async function copyText($, text, say) {
  const r = await $.ui.copy({ text });
  say(r?.isCopied ? "Copied." : `Couldn't copy${r?.reason ? `: ${r.reason}` : ""}.`);
}

async function copySnippet($, text, surface) {
  const r = await $.ui.copy({ text, ...(surface ? { surface } : {}) });
  state.notice = r?.isCopied ? "Copied." : `Couldn't copy${r?.reason ? `: ${r.reason}` : ""}.`;
  $.ui.invalidate("ui.render");
}

// Tell the bridge the current room is read up to its newest message. Runs
// when the pane has the keyboard and when the person sends from it.
let marking = false;
async function markRead($) {
  const room = currentRoom();
  const newest = roomMessages().at(-1)?.id ?? 0;
  if (marking || !room || (!room.unread && newest <= room.last_read_id)) return;
  marking = true;
  // Remember where they'd read up to, so the pane can draw a "new" line there.
  if (!state.dividerAt.has(room.id) && room.last_read_id > 0) state.dividerAt.set(room.id, room.last_read_id);
  try {
    await callBridge($, "/read", { room: room.id, last_id: newest });
    room.last_read_id = Math.max(room.last_read_id, newest);
    room.unread = 0;
    afterChange($);
  } catch (err) {
    $.ui.log(`squad-chat: could not mark read: ${err?.message ?? err}`, { to: "debug" });
  } finally {
    marking = false;
  }
}

// When the tabs change (join, leave, switch a room or a built-in room), the
// pane's focus ring leaves the input box, and what the person types next
// falls through to the prompt: it would go to Claude. After a change they
// started in the pane, wait for the new tabs to be drawn, then put the ring
// back on the box.
async function keepFocusAcrossRoomChange($, before) {
  for (let waited = 0; waited < 2000; waited += 50) {
    if (state.current !== before.current || state.rooms.length !== before.count || state.view !== before.view) break;
    await $.clock.sleep(50);
  }
  await $.clock.sleep(80);   // let the new tree draw first
  await $.ui.open({ id: PANE_ID, title: "Squad Chat", focus: true });
  await $.ui.focus({ requestId: PANE_ID, key: "compose" });
}

// While a message is being typed in the pane, tell the room every couple of
// seconds. Commands and sign-in steps aren't messages, so they stay quiet.
let lastTypingPing = 0;
function typingPing($, value) {
  const text = String(value ?? "").trimStart();
  if (!text || text.startsWith("/") || state.auth !== "signed_in" || !currentRoom()) return;
  const now = Date.now();
  if (now - lastTypingPing < TYPING_PING_MS) return;
  lastTypingPing = now;
  callBridge($, "/typing", { room: state.current }).catch(() => { /* a missed ping only hides a hint */ });
}

async function submitFromPane($, value) {
  const say = (text) => { state.notice = text; $.ui.invalidate("ui.render"); };
  const before = { current: state.current, count: state.rooms.length, view: state.view };
  state.draft = "";
  state.notice = "";
  lastTypingPing = 0;
  $.ui.invalidate("ui.render");
  try {
    await paneInput((path, body) => callBridge($, path, body), value, say, {
      setDnd: (mode) => setDnd($, mode),
      sources: shareSources($, { inPane: true }),
      setView: (view) => setView($, view),
      refreshGit: () => refreshGit($),
      refreshRoom: (id) => refreshRoom($, id),
      copy: (text) => copyText($, text, say),
    });
    state.dividerAt.clear();   // they've replied: everything above is read
    await markRead($);         // they're looking at the room they just wrote in
  } catch (err) {
    say(err?.message ?? String(err));
  }
  if (/^\/room\b/.test(String(value).trim()) || state.view !== before.view) {
    try { await keepFocusAcrossRoomChange($, before); } catch { /* the box is one click away */ }
  }
}

async function selectRoom($, id) {
  const before = { current: state.current, count: state.rooms.length, view: state.view };
  try {
    await callBridge($, "/room/select", { room: id });
  } catch (err) {
    state.notice = err?.message ?? String(err);
    $.ui.invalidate("ui.render");
    return;
  }
  try { await keepFocusAcrossRoomChange($, before); } catch { /* the box is one click away */ }
}

// ---------------------------------------------------------------- the built-in rooms

async function setView($, view) {
  state.view = view;
  state.notice = "";
  await $.store.set("view", view);
  if (view === "git") void refreshGit($, { ifOlderThan: 15_000 });
  if (view === "usage") void refreshUsage($);
  afterChange($);
}

async function saveSysRooms($, list) {
  state.sysRooms = list;
  await $.store.set("sysRooms", list);
  afterChange($);
}

// The engine's figures, asked for directly: on opening the room, and for
// the context breakdown (estimated locally, so it costs nothing).
async function refreshUsage($) {
  try {
    const u = await $.session.usage(state.usage.showBreakdown ? { breakdown: "summary" } : {});
    applyMeasure(state.usage, u, Date.now());
    if (u?.context?.breakdown) state.usage.breakdown = u.context.breakdown;
    afterChange($);
  } catch (err) {
    $.ui.log(`squad-chat: could not read usage: ${err?.message ?? err}`, { to: "debug" });
  }
}

function toggleBreakdown($) {
  state.usage.showBreakdown = !state.usage.showBreakdown;
  $.ui.invalidate("ui.render");
  if (state.usage.showBreakdown) void refreshUsage($);
}

let gitBusy = false;
async function refreshGit($, { ifOlderThan = 0 } = {}) {
  if (gitBusy || !state.sysRooms.includes("git")) return;
  if (ifOlderThan && Date.now() - state.git.fetchedAt < ifOlderThan) return;
  gitBusy = true;
  const prev = state.git;
  if (!prev.fetchedAt) { state.git = { ...prev, status: "loading" }; $.ui.invalidate("ui.render"); }
  try {
    const cwd = await $.session.cwd();
    const run = (argv) => $.process.run(argv, { cwd, timeoutMs: 15_000 });
    const next = await fetchGit(run, prev);
    state.git = next;
    for (const text of diffGit(prev, next)) if (!isQuiet()) $.ui.toast(text);
  } catch (err) {
    state.git = { ...prev, status: "error", error: err?.message ?? String(err), stale: prev.status === "ok" };
  } finally {
    gitBusy = false;
  }
  afterChange($);
}

// Something in this session moved: redraw while a built-in room is on show
// (the tabs' badges change in the chat too), and tell the other sessions.
function sysChanged($) {
  $.ui.invalidate("ui.render");
  if (state.sysRooms.includes("agents")) beat($, false);
}

let lastBeat = { key: "", at: 0 };
let cwdCache = null;
function beat($, force) {
  if (!state.sessionId) return;
  const now = Date.now();
  state.self = heartbeat(state.usage, { id: state.sessionId, cwd: cwdCache, branch: state.git.local?.branch, now });
  const key = beatKey(state.self);
  if (!force && key === lastBeat.key && now - lastBeat.at < BEAT_IDLE_MS) return;
  if (!force && key !== lastBeat.key && now - lastBeat.at < 1000) return;   // the next tick sends it
  if (!state.socket) return;
  lastBeat = { key, at: now };
  callBridge($, "/sessions/beat", state.self).catch((err) => $.ui.log(`squad-chat: heartbeat: ${err?.message ?? err}`, { to: "debug" }));
}

function liveNow() {
  const u = state.usage;
  if (u.activity.state !== "idle" || runningCalls(u).length || agentCounts(u).running) return true;
  if (activeView() === "agents") return state.sessions.some((s) => (s.activity?.state && s.activity.state !== "idle") || (s.agents ?? []).length);
  if (activeView() === "git") return state.git.runs.some((r) => r.status !== "completed");
  return false;
}

// What a built-in room's drawing changes with as time passes. Usage moves by
// the second only while a subagent runs (its spinner and timer); otherwise
// the session's span and the spend buckets move by the minute. A redraw a
// second for nothing made the desktop's input box flicker all through a turn.
let lastFrame = "";
function frameKey(view, now) {
  if (view === "usage" && !agentCounts(state.usage).running) return `usage:${Math.floor(now / 60_000)}`;
  return `${view}:${Math.floor(now / 1000)}`;
}

// One loop for the built-in rooms: a redraw a second while something runs
// (spinners, timers), the agents' statuses, the heartbeat, and the Git poll.
async function tick($) {
  for (;;) {
    await $.clock.sleep(1000);
    if (state.ended) return;
    if (!state.sysRooms.length) continue;
    const view = activeView();
    if (agentCounts(state.usage).running) {
      try { if (applyAgentList(state.usage, await $.agent.list(), Date.now())) sysChanged($); } catch { /* the next tick */ }
    }
    if (view !== "chat" && liveNow()) {
      const key = frameKey(view, Date.now());
      if (key !== lastFrame) { lastFrame = key; $.ui.invalidate("ui.render"); }
    }
    if (state.sysRooms.includes("agents")) beat($, false);
    if (state.sysRooms.includes("git")) {
      const shown = view === "git" && state.paneShown;
      void refreshGit($, { ifOlderThan: shown ? GIT_SHOWN_MS : GIT_HIDDEN_MS });
    }
  }
}

// Runs a command body. Its answer and any error go to the transcript as a
// notice the model never sees; the command itself returns nothing.
async function answer($, fn) {
  // One notice per line: a single notice draws newlines as junk.
  const say = (text) => { for (const line of String(text).split("\n")) $.ui.log(line); };
  try {
    await fn((path, body) => callBridge($, path, body), say);
  } catch (err) {
    say(err?.message ?? String(err));   // the engine already labels notices "squad-chat:"
  }
  return {};
}

const COMMANDS = [
  { name: "chat", description: "squad-chat: open the pane: chat, or a room such as Usage, Git, Agents or Snippets (notify, dnd, rooms: settings)", argumentHint: "[usage|git|agents|snippet | rooms <list> | notify on|off | dnd on|off|auto]" },
  { name: "say", description: "squad-chat: send a message to the current room", argumentHint: "<message>" },
  { name: "room", description: "squad-chat: list, switch, join/create, leave or delete rooms", argumentHint: "[name] [passcode] | leave <name> | delete <name>" },
  { name: "who", description: "squad-chat: who's online" },
  { name: "chat-login", description: "squad-chat: sign in with an emailed code", argumentHint: "<email> | <code>" },
  { name: "chat-share", description: "squad-chat: share the selected text, Claude's last code block, your diff, or a Usage/Git/Agents snapshot to the room", argumentHint: "[diff [path] | usage | git | agents] [#room] | to #room | send [#room] | cancel" },
  { name: "chat-name", description: "squad-chat: change your display name", argumentHint: "<new name>" },
  { name: "chat-logout", description: "squad-chat: sign out on this computer" },
  { name: "snippet", description: "squad-chat: save code you reuse (the selection, or Claude's last code block), then copy or share it from the Snippet room", argumentHint: "add <name> | rename <old> -> <new> | delete <name> | copy <name> | share <name> [#room]" },
];

export function register(on, options) {
  on("session.start", async ($, e, next) => {
    const r = await next(e);
    // One by one: a name Claude Code refuses (one of its own, say) costs that
    // command, not the chat.
    for (const command of COMMANDS) {
      try { await $.command.register({ ...command, immediate: true }); }
      catch (err) { $.ui.log(`squad-chat: /${command.name} unavailable: ${err?.message ?? err}`, { to: "debug" }); }
    }
    state.notify = (await $.store.get("notify")) === true;
    const savedDnd = await $.store.get("dnd");
    state.dnd = ["on", "off", "auto"].includes(savedDnd) ? savedDnd : "off";
    wasQuiet = isQuiet();   // already in effect: no summary for a reload
    const savedRooms = await $.store.get("sysRooms");
    if (Array.isArray(savedRooms)) state.sysRooms = savedRooms.filter((x) => typeof x === "string" && ROOM_ID.test(x));
    // A room that's new in this version gets a tab once, even for people who
    // chose their tabs before it existed. Taken away, it stays away.
    const offered = await $.store.get("roomsOffered");
    const seen = Array.isArray(offered) ? offered : Array.isArray(savedRooms) ? [...SYS_ROOMS] : [...DEFAULT_ROOMS];
    const fresh = DEFAULT_ROOMS.filter((x) => !seen.includes(x));
    if (fresh.length) {
      state.sysRooms = [...state.sysRooms, ...fresh.filter((x) => !state.sysRooms.includes(x))];
      await $.store.set("sysRooms", state.sysRooms);
    }
    if (!Array.isArray(offered) || fresh.length) await $.store.set("roomsOffered", [...new Set([...seen, ...DEFAULT_ROOMS])]);
    const savedView = await $.store.get("view");
    if (savedView === "chat" || (typeof savedView === "string" && ROOM_ID.test(savedView))) state.view = savedView;
    try { state.sessionId = String(await $.session.id()); } catch { state.sessionId = null; }
    try { cwdCache = await $.session.cwd(); } catch { cwdCache = null; }
    try { state.usage.model = (await $.session.model()) || state.usage.model; } catch { /* the first turn tells */ }
    beat($, false);   // this session's own row in the Agents room, before any heartbeat goes out
    if (state.sysRooms.includes("usage")) void refreshUsage($);   // numbers right away after a reload
    if (!bridgeStarted) {
      bridgeStarted = true;
      void runBridge($, options);
      tick($).catch(() => { /* unloaded mid-sleep */ });
    }
    return r;
  });

  on("command.run", { command: "chat" }, ($, e) => answer($, async (call, say) => {
    const args = String(e.args ?? "").trim();
    const asked = args.toLowerCase();
    if (asked === "chat" || roomIds().includes(asked)) {
      const view = asked;
      if (view !== "chat" && !state.sysRooms.includes(view)) return say(`The ${view} room is hidden. Bring it back with /chat rooms +${view}.`);
      await setView($, view);
      return openPane($);
    }
    const rm = /^rooms\b\s*(.*)$/i.exec(args);
    if (rm) return sysRooms(rm[1], say, (list) => saveSysRooms($, list));
    const d = /^dnd\b\s*(.*)$/i.exec(args);
    if (d) return dnd(d[1], say, (mode) => setDnd($, mode));
    const m = /^notify\s+(on|off)$/i.exec(args);
    if (!m) return openPane($);
    state.notify = m[1].toLowerCase() === "on";
    await $.store.set("notify", state.notify);
    say(state.notify ? "Will toast when someone @mentions you." : "Mention toasts off.");
  }));
  on("command.run", { command: "say" }, ($, e) => answer($, (call, say) => sendMessage(call, e.args, say)));
  on("command.run", { command: "room" }, ($, e) => answer($, (call, say) => room(call, e.args, say)));
  on("command.run", { command: "who" }, ($) => answer($, (call, say) => who(say)));
  on("command.run", { command: "chat-login" }, ($, e) => answer($, async (call, say) => {
    if (!String(e.args ?? "").trim()) await openPane($);
    await login(call, e.args, say);
  }));
  on("command.run", { command: "chat-share" }, ($, e) => answer($, (call, say) => share(call, e.args, say, shareSources($))));
  on("command.run", { command: "chat-name" }, ($, e) => answer($, (call, say) => rename(call, e.args, say)));
  on("command.run", { command: "chat-logout" }, ($) => answer($, (call, say) => logout(call, say)));
  on("command.run", { command: "snippet" }, ($, e) => answer($, (call, say) => snippet(call, e.args, say, {
    sources: shareSources($),
    copy: (text) => copyText($, text, say),
    setView: async (view) => { await setView($, view); await openPane($); },
  })));

  on("ui.render", { component: "Pane" }, ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e);
    const props = e.props ?? {};
    state.paneFocused = props.isFocused === true;
    if (state.paneFocused) void markRead($);
    if (!state.paneShown) { state.paneShown = true; syncRooms($); }
    return paneView($.ui.resolve(e), { ...props, surface: e.surface }, {
      onInput: (value) => { state.draft = value; typingPing($, value); },
      onSubmit: (value) => { void submitFromPane($, value); },
      onSelectRoom: (id) => { void (async () => { if (state.view !== "chat") await setView($, "chat"); await selectRoom($, id); })(); },
      onSelectView: (view) => {
        void (async () => {
          const before = { current: state.current, count: state.rooms.length, view: state.view };
          await setView($, view);
          try { await keepFocusAcrossRoomChange($, before); } catch { /* the box is one click away */ }
        })();
      },
      onShare: (verb) => { void shareFromPane($, verb); },
      onShareTarget: (id) => {
        const r = retargetShare(id);
        state.notice = typeof r === "string" ? r : "";
        $.ui.invalidate("ui.render");
      },
      onCopy: (text, surface) => { void copySnippet($, text, surface); },
      onShareItem: (item) => shareItemFromPane($, item),
      onRefresh: () => { void refreshGit($); },
      onToggleBreakdown: () => toggleBreakdown($),
      onToggleSession: (id) => { if (!state.collapsed.delete(id)) state.collapsed.add(id); $.ui.invalidate("ui.render"); },
      onCycleFilter: () => { state.feedFilter = { all: "here", here: "errors", errors: "all" }[state.feedFilter]; $.ui.invalidate("ui.render"); },
    });
  });

  // While the pane can't be seen (too narrow to place, or closed), a one-line
  // band above the prompt keeps the room in view. It yields to surveys.
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const chatShown = state.auth === "signed_in" && currentRoom();
    if (e.props?.hasSurvey || (activeView() === "chat" && !chatShown)) return next(e);
    const panes = await $.ui.panes();
    if (panes.some((p) => p.id === PANE_ID && p.isPlaced && p.isShown)) return next(e);
    return bandView($.ui.resolve(e), e.props ?? {}, { onOpen: () => { void openPane($); } });
  });

  // "auto" do not disturb: a turn still running after LONG_TURN_MS goes quiet
  // until it completes. Short back-and-forth with Claude never flips it.
  let turn = null;
  on("turn.start", ($, e, next) => {
    const id = e.turnId;
    turn = id;
    if (!e.agentId) { turnStarted(state.usage, Date.now()); sysChanged($); }
    void (async () => {
      await $.clock.sleep(LONG_TURN_MS);
      if (turn !== id || state.dnd !== "auto") return;
      state.working = true;
      quietChanged($);
    })();
    return next(e);
  });

  on("turn.complete", async ($, e, next) => {
    const r = await next(e);
    applyTurnUsage(state.usage, r?.usage);   // the main loop's and each subagent's
    if (e.agentId) {   // a subagent finished: the main turn goes on
      sysChanged($);
      return r;
    }
    turn = null;
    turnEnded(state.usage, Date.now());
    sysChanged($);
    // The context after the turn, for the band's forecast chart: read fresh,
    // as the status line has it once the turn is done.
    (async () => {
      await refreshUsage($);
      if (recordTurnContext(state.usage)) $.ui.invalidate("ui.render");
    })().catch(() => {});
    if (state.working) {
      state.working = false;
      quietChanged($);
    }
    return r;
  });

  // The Usage room's figures, as the engine measures them.
  on("session.measure", async ($, e, next) => {
    const r = await next(e);
    applyMeasure(state.usage, e, Date.now());
    afterChange($);
    return r;
  });

  // Each tool call, timed. Passed through untouched: never denied, never changed.
  on("tool.call", async ($, e, next) => {
    let key = null;
    try { key = toolStarted(state.usage, { tool: e.tool, agentId: e.agentId, input: e, at: Date.now() }); sysChanged($); }
    catch { /* the call matters more than its timing */ }
    let r;
    try {
      r = await next(e);
      return r;
    } finally {
      try {
        toolEnded(state.usage, key, { at: Date.now(), isError: !r || !!r.isError || !!r.deny });
        sysChanged($);
        // A push or a new PR: the Git room catches up once GitHub has.
        if (e.tool === "Bash" && PUSHED.test(String(e.command ?? ""))) {
          (async () => { await $.clock.sleep(8_000); await refreshGit($); })().catch(() => {});
        }
      } catch { /* as above */ }
    }
  }).catch(($, e, next) => next(e));   // pass through: replays the call's own result

  on("agent.spawn", async ($, e, next) => {
    const r = await next(e);
    if (r?.agentId) {
      agentSpawned(state.usage, { id: r.agentId, type: e.subagentType || (e.isTeammate ? "teammate" : "agent"), description: e.description, parentId: e.parentAgentId, at: Date.now() });
      sysChanged($);
    }
    return r;
  }).catch(($, e, next) => next(e));

  on("ui.close", ($, e, next) => {
    if (e.id === PANE_ID) {
      state.paneFocused = false;
      state.paneShown = false;
      state.dividerAt.clear();
      syncRooms($);
      $.ui.invalidate("ui.render");
    }
    return next(e);
  });

  on("session.append", { door: "command" }, ($, e, next) => {
    if (!privateCommand(e.message)) return next(e);
    return next({ ...e, message: { ...e.message, content: redact(e.message.content) } });
  }).catch(($, e, next) => {
    // Fail closed: if the rewrite threw, store a row with no args at all.
    if (next.called || !privateCommand(e.message)) return next(e);
    const name = blockTexts(e.message?.content).map((t) => NAME.exec(t)?.[1]).find(Boolean) ?? "say";
    return next({ ...e, message: { ...e.message, content: [{ type: "text", text: `<command-name>/${name}</command-name>\n${REDACTED}` }] } });
  });

  // Best effort: the end chain has one short time bound. Presence never
  // depends on this; the bridge's dropped connection is what takes us offline.
  on("session.end", async ($, e, next) => {
    if (e.reason !== "clear" && e.reason !== "resume") {
      state.ended = true;
      try { await callBridge($, "/shutdown", {}); } catch { /* exiting anyway */ }
    }
    return next(e);
  });
}
