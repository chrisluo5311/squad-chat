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
//   focus.mjs, habits.mjs, toolbox.mjs, clipboard.mjs, pet.mjs   the Focus, Habits, Toolbox, Clipboard and Pet rooms

import { state, applyEvent, resetBridgeState, currentRoom, roomMessages, statusText, isQuiet, missedText, activeView, DEFAULT_ROOMS, ROOM_ID, roomIds, enabledRooms, isFnRoom } from "./state.mjs";
import { PRIVATE_ARGS, TOOL_USAGE, login, logout, rename, room, who, dnd, share, shareItem, snippet, lofi, chatAdmin, retargetShare, sendMessage, paneInput } from "./commands.mjs";
import { paneView, bandView } from "./views.mjs";
import { applyMeasure, applyTurnUsage, recordTurnContext, usageSnapshot, restoreUsage, toolStarted, toolEnded, turnStarted, turnEnded, agentSpawned, applyAgentList, agentCounts, runningCalls, stepPrompt, stepToolResult, stepStarted, stepToolUse, stepEnded, applyOverhead, wantsOverhead, toolSummary } from "./metrics.mjs";
import { fetchGit, diffGit } from "./github.mjs";
import { heartbeat, beatKey } from "./sessions.mjs";
import { createFocus, isRunning, start as focusStart, pause as focusPause, skip as focusSkip, reset as focusReset, adjust as focusAdjust, setLengths, tickFocus, focusSettings, focusTimer, restoreFocus, focusStatus, focusBadge, dayOf } from "./focus.mjs";
import { createHabits, habitWords, habitsSaved, restoreHabits, markHabit, toggleHabit, deleteHabit, undeleteHabit } from "./habits.mjs";
import { createToolbox, toolWords, pickTool, rerun as toolAgain } from "./toolbox.mjs";
import { createClipboard, addClip, removeClip, CLIP_READERS } from "./clipboard.mjs";
import { createPet, petMood, petFrameMs, petTick, petNote, petRound, petSaved, restorePet, MOODS } from "./pet.mjs";

state.focus = createFocus();
state.habits = createHabits();
state.toolbox = createToolbox();
state.clipboard = createClipboard();
state.pet = createPet();

const PANE_ID = "squad-chat";
const UNDO_MS = 10_000;   // how long Cancel stays beside "Removed …"

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
          if (applyEvent(event)) {
            // Someone else wrote: Clawd waves, and notes who and where (never what).
            // A message that comes in while the chat is scrolled up leaves the view where it is.
            if (event.type === "message" && !event.backfill && event.message?.room === state.chatScroll.room && state.chatScroll.back > 0) state.chatScroll.back += 1;
            if (event.type === "message" && event.counted && !event.message?.mine) {
              state.pet.waveAt = Date.now();
              petNote(state.pet, "👋", `${event.message.user} wrote in #${event.message.slug}`);
            }
            afterChange($);
          }
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
  // A function room's alert (Monitor's "CPU at 96°C"): toasted unless quiet.
  while (state.fnToasts.length) {
    const text = state.fnToasts.shift();
    if (!isQuiet()) $.ui.toast(text);
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

// A function room's button (Lo-fi's ⏯, a row's ▶): one of its provider's
// actions. The bridge runs the room again after it, which redraws.
async function roomAction($, room, { provider, action, args }) {
  try {
    await callBridge($, "/fnroom/action", { room, ...(provider ? { provider } : {}), action, args });
  } catch (err) {
    state.notice = err?.message ?? String(err);
    $.ui.invalidate("ui.render");
  }
}

// A room's setting changed from its cards: a row's ✕ ("-Tokyo") or a row
// picked, as "/set <key> <value>" would.
async function setRoomSetting($, room, key, value) {
  try {
    const r = await callBridge($, "/fnroom/settings", { room, key, value });
    const fn = state.fn.get(room);
    if (fn && r?.values) fn.settings = r.values;
  } catch (err) {
    state.notice = err?.message ?? String(err);
  }
  $.ui.invalidate("ui.render");
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

// Empty the box after a submit. A field holds what's typed until the hook
// draws another value, and typing doesn't redraw (it would flicker), so the
// value last drawn is often "" already and drawing "" again changes nothing:
// the desktop kept the words sent. So the text sent is drawn first, then "".
function clearBox($, sent) {
  state.draft = String(sent ?? "");
  $.ui.invalidate("ui.render");
  void (async () => {
    await $.clock.sleep(120);
    if (state.draft === String(sent ?? "")) { state.draft = ""; $.ui.invalidate("ui.render"); }
  })().catch(() => { state.draft = ""; });
}

// The chat's own scroll: `by` messages older (+) or newer (-), or 0 for the
// newest.
function scrollChat($, by) {
  const c = state.chatScroll;
  const max = Math.max(0, roomMessages().length - 1);
  const back = by === 0 ? 0 : Math.min(max, Math.max(0, c.back + by));
  if (back === c.back) return;
  c.back = back;
  $.ui.invalidate("ui.render");
}

async function submitFromPane($, value) {
  const say = (text) => { state.notice = text; $.ui.invalidate("ui.render"); };
  const before = { current: state.current, count: state.rooms.length, view: state.view };
  clearBox($, value);
  state.notice = "";
  lastTypingPing = 0;
  try {
    await paneInput((path, body) => callBridge($, path, body), value, say, {
      setDnd: (mode) => setDnd($, mode),
      sources: shareSources($, { inPane: true }),
      setView: (view) => setView($, view),
      refreshGit: () => refreshGit($),
      refreshRoom: (id) => refreshRoom($, id),
      copy: (text) => copyText($, text, say),
      saveRooms: (list) => saveSysRooms($, list),
      roomInput: (view, text, say, opts) => roomInput($, view, text, say, opts),
    });
    state.dividerAt.clear();   // they've replied: everything above is read
    state.chatScroll.back = 0;   // and they see what they just sent
    await markRead($);         // they're looking at the room they just wrote in
  } catch (err) {
    say(err?.message ?? String(err));
  }
  if (/^\/room\b/.test(String(value).trim()) || state.view !== before.view) {
    try { await keepFocusAcrossRoomChange($, before); } catch { /* the box is one click away */ }
  } else if (paneSurface === "terminal") {
    // What's typed can add or take away buttons in the room (Focus's "start"
    // brings ⏭ and ↺), and on the terminal a pane whose buttons change loses
    // the keyboard to the prompt, where the next words would go to Claude:
    // once the new tree is drawn, the box takes it back. The desktop's field
    // takes the keyboard by a click, and is left as the person left it.
    focusAfterDraw($, "compose");
  }
}

// The desktop header's join: the field in front takes the keyboard, and
// the fields fold back after 5 seconds with nothing typed.
const JOIN_IDLE_MS = 5_000;
let joinIdle = null;
function armJoinIdle($) {
  joinIdle?.cancel?.();
  joinIdle = null;
  if (!state.join) return;
  Promise.resolve($.clock.after(JOIN_IDLE_MS, () => {
    joinIdle = null;
    if (state.join && !state.join.busy) { state.join = null; focusAfterDraw($, "compose"); }
  })).then((t) => { joinIdle = t; }, () => { /* no timer: ✕ still folds it */ });
}
// A pressed button that the press takes away (＋ join turning into its
// field, ✕ folding the fields, a room added from the "+" list) took the
// pane's focus with it, so the next click only gave the focus back. Once
// the new tree is drawn, the focus goes where the person carries on.
function focusAfterDraw($, key) {
  $.ui.invalidate("ui.render");
  void (async () => {
    await $.clock.sleep(80);   // let the new tree draw first
    // The pane lost the keyboard with the element: take it back, then put
    // the ring on the element (focus alone moves it only inside a pane that has it).
    await $.ui.open({ id: PANE_ID, title: "Squad Chat", focus: true });
    await $.ui.focus({ requestId: PANE_ID, key });
  })().catch(() => { /* a click away */ });
}
function closeJoin($) {
  joinIdle?.cancel?.();
  joinIdle = null;
  state.join = null;
  focusAfterDraw($, "compose");
}
function joinFocus($, key) {
  armJoinIdle($);
  focusAfterDraw($, key);
}

// Join (or make) the room named in the header's fields, as /room does: in
// it, the fields close and the chat shows it; refused, the passcode field
// stays with the reason under it.
async function joinFromPane($, value) {
  const j = state.join;
  if (!j) return;
  const passcode = String(value ?? "").trim();
  const joined = state.rooms.some((r) => r.slug === j.name.toLowerCase());
  if (!passcode && !joined) { state.join = { ...j, error: "Type the room's passcode." }; return joinFocus($, "join-pass"); }
  const before = { current: state.current, count: state.rooms.length, view: state.view };
  j.busy = true;   // not folded away while the server answers
  try {
    await room((path, body) => callBridge($, path, body), `${j.name} ${passcode}`.trim(), () => {});
  } catch (err) {
    state.join = { ...j, busy: false, draft: "", error: err?.message ?? String(err) };
    return joinFocus($, "join-pass");
  }
  closeJoin($);
  state.notice = "";
  if (state.view !== "chat") await setView($, "chat");
  else $.ui.invalidate("ui.render");
  try { await keepFocusAcrossRoomChange($, before); } catch { /* the box is one click away */ }
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

// The band shows the room on show; ‹ › and /chat band move it along the
// rooms with tabs (and the chat, once you're in a room) with the pane shut.
function bandRooms() {
  return [...enabledRooms(), ...(state.auth === "signed_in" && currentRoom() ? ["chat"] : [])];
}
async function cycleBand($, dir) {
  const list = bandRooms();
  if (!list.length) return;
  const at = list.indexOf(activeView());
  // From a view not in the list, › goes to the first and ‹ to the last.
  const next = at < 0 ? (dir > 0 ? 0 : list.length - 1) : (at + dir + list.length) % list.length;
  await setView($, list[next]);
}

async function saveSysRooms($, list) {
  state.sysRooms = list;
  await $.store.set("sysRooms", list);
  afterChange($);
}

// The engine's figures, asked for directly: on opening the room, and for
// the context breakdown (estimated locally, so it costs nothing).
// This session's tokens and chart, kept per session across reloads, and
// dropped once a session has been idle for a week.
const USAGE_PREFIX = "usage:";
const USAGE_KEEP_MS = 7 * 86_400_000;
async function restoreSessionUsage($) {
  try {
    const now = Date.now();
    for (const key of await $.store.keys()) {
      if (!key.startsWith(USAGE_PREFIX)) continue;
      const saved = await $.store.get(key);
      if (key === USAGE_PREFIX + state.sessionId) restoreUsage(state.usage, saved);
      else if (!(now - (saved?.at ?? 0) < USAGE_KEEP_MS)) await $.store.delete(key);
    }
  } catch (err) {
    $.ui.log(`squad-chat: could not restore usage: ${err?.message ?? err}`, { to: "debug" });
  }
}

async function refreshUsage($) {
  try {
    // The breakdown when it's open, and now and then for the Requests card's bedrock.
    const breakdown = state.usage.showBreakdown || wantsOverhead(state.usage);
    const u = await $.session.usage(breakdown ? { breakdown: "summary" } : {});
    applyMeasure(state.usage, u, Date.now());
    if (u?.context?.breakdown) {
      state.usage.breakdown = u.context.breakdown;
      applyOverhead(state.usage, u.context.breakdown);
    }
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
  if (activeView() === "focus") return isRunning(state.focus);
  return false;
}

// ---------------------------------------------------------------- Focus, Clipboard, Pet

// The Focus room's lengths and today's count are every session's; the
// running timer is this session's, kept so a reload carries on. Pet's mood
// choice is every session's.
const FOCUS_TIMER_PREFIX = "focus:";
async function restoreRooms($) {
  try {
    const now = await $.clock.now();
    const timer = state.sessionId ? await $.store.get(FOCUS_TIMER_PREFIX + state.sessionId) : null;
    restoreFocus(state.focus, await $.store.get("focus"), timer, now);
    restoreHabits(state.habits, await $.store.get("habits"));
    restorePet(state.pet, await $.store.get("pet"));
    state.pet.lastBusyAt = Date.now();
    state.focusStatus = focusStatus(now);
  } catch (err) {
    $.ui.log(`squad-chat: could not restore the rooms: ${err?.message ?? err}`, { to: "debug" });
  }
}

async function saveFocus($) {
  try {
    await $.store.set("focus", focusSettings(state.focus));
    if (state.sessionId) {
      const key = FOCUS_TIMER_PREFIX + state.sessionId;
      if (state.focus.phase === "idle") await $.store.delete(key);
      else await $.store.set(key, focusTimer(state.focus));
    }
  } catch (err) {
    $.ui.log(`squad-chat: could not save the timer: ${err?.message ?? err}`, { to: "debug" });
  }
}

// The lengths and today's count are every session's, and another session
// may have saved since this one read them: read them again before a change,
// so one session's save doesn't undo another's.
async function syncFocus($, now) {
  try {
    restoreFocus(state.focus, await $.store.get("focus"), null, now);
  } catch (err) {
    $.ui.log(`squad-chat: could not read the timer's settings: ${err?.message ?? err}`, { to: "debug" });
  }
}

// A change to the timer, on the settings as they are now.
async function changeFocus($, fn) {
  const now = await $.clock.now();
  await syncFocus($, now);
  fn(state.focus, now);
  focusChanged($, now);
}

// The timer changed: show it, keep it.
function focusChanged($, now) {
  state.focusStatus = focusStatus(now);
  afterChange($);
  void saveFocus($);
}

// A press or a typed word: start, pause, skip or reset, on the engine's clock.
const FOCUS_DO = {
  start: focusStart,
  resume: focusStart,
  go: focusStart,
  pause: focusPause,
  skip: focusSkip,
  reset: focusReset,
};
async function focusAct($, verb) {
  await changeFocus($, (f, now) => FOCUS_DO[verb](f, now));
}

// A phase ran out: the chime, a toast (a timer you set rings even while
// quiet), and the next phase.
function focusEnded($, ended, now) {
  const f = state.focus;
  if (ended === "focus") petRound(state.pet);
  else petNote(state.pet, "☕", "Break's over");
  savePet($);
  const asset = ended === "focus" ? "sounds/focus-done.wav" : "sounds/break-done.wav";
  $.audio.play({ asset }).catch((err) => $.ui.log(`squad-chat: chime: ${err?.message ?? err}`, { to: "debug" }));
  $.ui.toast(ended === "focus"
    ? `🍅 Focus done (${f.done} today). Break for ${f.rest} min.`
    : "☕ Break's over. ▶ in the Focus room starts the next round.");
  focusChanged($, now);
}

// The Habits room's goals and days are every session's: read again before
// a change, so one session's save doesn't undo another's, then kept. One
// change at a time: two presses that overlap would both read the store
// before either saved, and the second would put back what the first changed.
let habitsBusy = Promise.resolve();
function changeHabits($, fn) {
  const run = habitsBusy.then(() => changeHabitsNow($, fn));
  habitsBusy = run.catch(() => {});
  return run;
}

async function changeHabitsNow($, fn) {
  // The wall clock, as the drawing has it: a day is the calendar's.
  const now = Date.now();
  try { restoreHabits(state.habits, await $.store.get("habits")); } catch (err) {
    $.ui.log(`squad-chat: could not read the habits: ${err?.message ?? err}`, { to: "debug" });
  }
  const said = fn(state.habits, now);
  afterChange($);
  try { await $.store.set("habits", habitsSaved(state.habits)); } catch (err) {
    $.ui.log(`squad-chat: could not save the habits: ${err?.message ?? err}`, { to: "debug" });
  }
  return said;
}

// Words typed in a room of the mod's own: Focus's start, pause, skip, reset
// or minutes; Habits' add, done, undo, remove, rename or a habit's name;
// Toolbox's tool names and what they run on; Clipboard's clear; Pet's moods. True when taken; `say` answers. `typed`
// is the room's own box, where a new habit needs no "add".
async function roomInput($, view, text, say = () => {}, { typed = false } = {}) {
  const word = text.trim().toLowerCase();
  if (view === "habits") {
    const said = await changeHabits($, (h, now) => habitWords(h, text, now, { typed }));
    if (said == null) return false;
    say(said);
    return true;
  }
  if (view === "toolbox") {
    const said = await toolWords(state.toolbox, text, Date.now(), { typed });
    if (said == null) return false;
    if (said) say(said);
    $.ui.invalidate("ui.render");
    return true;
  }
  if (view === "focus") {
    if (Object.hasOwn(FOCUS_DO, word)) { await focusAct($, word); return true; }
    const now = await $.clock.now();
    await syncFocus($, now);
    if (setLengths(state.focus, word)) { focusChanged($, now); return true; }
    return false;
  }
  if (view === "clipboard" && word === "clear") { clearClips($); return true; }
  if (view === "pet" && (word === "auto" || MOODS.includes(word))) { setPetMode($, word); return true; }
  return false;
}

function savePet($) {
  $.store.set("pet", petSaved(state.pet))
    .catch((err) => $.ui.log(`squad-chat: could not save the pet: ${err?.message ?? err}`, { to: "debug" }));
}
function setPetMode($, mode) {
  state.pet.mode = mode;
  savePet($);
  $.ui.invalidate("ui.render");
}

// The clipboard, read every couple of seconds while the room has a tab.
// The first reader that runs is kept; when none does, the room says so.
const CLIP_EVERY_MS = 2_000;
const CLIP_RETRY_MS = 30_000;   // while no reader works: tried again this often
// A reader that ran but had nothing to give: wl-paste and xclip exit 1 until
// something is copied.
const CLIP_EMPTY = /nothing is copied|no selection|not available/i;
const CLIP_ENV = { LC_ALL: "en_US.UTF-8", LANG: "en_US.UTF-8" };
let clipBusy = false;
let clipAt = 0;
async function readClipboard($, now) {
  const c = state.clipboard;
  if (clipBusy || now - clipAt < (c.error ? CLIP_RETRY_MS : CLIP_EVERY_MS)) return;
  clipBusy = true;
  clipAt = now;
  try {
    for (const argv of c.reader ? [c.reader] : CLIP_READERS) {
      let r;
      // pbpaste writes in the locale's charset, and with none set it writes
      // "?" for every character outside ASCII: ask for UTF-8.
      try { r = await $.process.run(argv, { timeoutMs: 2_000, env: CLIP_ENV }); } catch { continue; }
      const empty = r.exitCode !== 0 && CLIP_EMPTY.test(String(r.stderr ?? ""));
      if (r.exitCode !== 0 && !empty && !c.reader) continue;
      c.reader = argv;
      if (c.error) { c.error = ""; $.ui.invalidate("ui.render"); }
      if (r.exitCode === 0 && addClip(c, r.stdout, now)) $.ui.invalidate("ui.render");
      return;
    }
    if (!c.error) {
      c.error = "Can't read the clipboard here: install wl-clipboard or xclip (macOS has pbpaste).";
      $.ui.invalidate("ui.render");
    }
  } finally {
    clipBusy = false;
  }
}

// The clipboard read once, when the Toolbox's paste is pressed: the text,
// or null when there's no reader here.
async function readClipOnce($) {
  const c = state.clipboard;
  for (const argv of c.reader ? [c.reader] : CLIP_READERS) {
    let r;
    try { r = await $.process.run(argv, { timeoutMs: 2_000, env: CLIP_ENV }); } catch { continue; }
    if (r.exitCode !== 0 && !c.reader) continue;
    c.reader = argv;
    return r.exitCode === 0 ? String(r.stdout ?? "") : "";
  }
  return null;
}

// The Toolbox's buttons: a tool picked, run again, a result copied, a
// secret shown, the clipboard pasted in.
async function toolAct($, fn) {
  try { await fn(state.toolbox, Date.now()); } catch (err) {
    $.ui.log(`squad-chat: the toolbox: ${err?.message ?? err}`, { to: "debug" });
  }
  $.ui.invalidate("ui.render");
}

async function copyTool($, text, surface) {
  await copySnippet($, text, surface);
  if (state.notice !== "Copied.") return;
  const at = Date.now();
  state.toolbox.copiedAt = at;
  // The band says "copied" for a moment, then goes back to the result.
  $.clock.sleep(5_000).then(() => { if (state.toolbox.copiedAt === at) $.ui.invalidate("ui.render"); }).catch(() => {});
}

async function pasteTool($) {
  const text = await readClipOnce($);
  if (text == null) { state.notice = "Can't read the clipboard here: install wl-clipboard or xclip (macOS has pbpaste)."; return $.ui.invalidate("ui.render"); }
  if (!text.trim()) { state.notice = "The clipboard is empty."; return $.ui.invalidate("ui.render"); }
  state.notice = "";
  await toolAct($, (tb, now) => { tb.input = text.trim(); return toolAgain(tb, now); });
}

function clearClips($) {
  state.clipboard.items = [];
  $.ui.invalidate("ui.render");
}

async function copyClip($, id, surface) {
  const item = state.clipboard.items.find((x) => x.id === id);
  if (item) await copySnippet($, item.text, surface);
}

// The terminal draws Clawd a frame per redraw: while the Pet room is on
// show there, redraw as fast as its frames go. The desktop animates itself.
let paneSurface = null;
async function petLoop($) {
  for (;;) {
    const shown = paneSurface === "terminal" && state.paneShown && activeView() === "pet";
    await $.clock.sleep(shown ? Math.max(100, petFrameMs()) : 1000);
    if (state.ended) return;
    if (shown) $.ui.invalidate("ui.render");
  }
}

// What a built-in room's drawing changes with as time passes. Usage moves by
// the second only while a subagent runs (its spinner and timer); otherwise
// the session's span and the spend buckets move by the minute. A redraw a
// second for nothing made the desktop's input box flicker all through a turn.
// Habits, Toolbox, Clipboard and Pet have nothing that moves by the second
// (Clawd's frames have a loop of their own), so they keep to the minute too.
let lastFrame = "";
const BY_MINUTE = new Set(["habits", "toolbox", "clipboard", "pet"]);
export function frameKey(view, now) {
  if (BY_MINUTE.has(view) || (view === "usage" && !agentCounts(state.usage).running)) return `${view}:${Math.floor(now / 60_000)}`;
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
    await roomsTick($);
  }
}

// Each second, for the mod's own rooms: the timer (its end, the status
// line, the tab's badge), the clipboard, and Clawd's mood.
let lastRoomsKey = "";
let lastPetSave = 0;
async function roomsTick($) {
  const now = await $.clock.now();
  // A round about to count: on today's count as every session has it.
  if (isRunning(state.focus) && now >= state.focus.endsAt) await syncFocus($, now);
  const ended = tickFocus(state.focus, now);
  if (ended) focusEnded($, ended, now);
  const status = focusStatus(now);
  if (status !== state.focusStatus) { state.focusStatus = status; $.ui.status(statusText()); }
  if (state.sysRooms.includes("clipboard")) void readClipboard($, now);
  const u = state.usage;
  // Clawd keeps to the wall clock, as its drawing does.
  const wall = Date.now();
  const busy = u.activity.state !== "idle" || agentCounts(u).running > 0;
  // The checks count once the Git room has looked (null until then).
  const failing = state.git?.status === "ok" ? !!state.git.pr?.checks?.fail : null;
  const noted = petTick(state.pet, { busy, failing, now: wall });
  // Kept when something happened, and a minute at a time while you work.
  if (noted || (busy && wall - lastPetSave > 60_000)) { lastPetSave = wall; savePet($); }
  // Redraw when the badge or Clawd's mood changes (Clawd walks by the
  // input box in every room), and at midnight, when every habit is undone
  // again: its tab's count, its band and its ✓s.
  const key = JSON.stringify([focusBadge(now)?.text ?? null, state.sysRooms.includes("pet") ? [petMood(wall), state.pet.log.length, state.pet.log[0]?.at] : null,
    state.sysRooms.includes("habits") ? dayOf(wall) : null]);
  if (key !== lastRoomsKey) { lastRoomsKey = key; $.ui.invalidate("ui.render"); }
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
  { name: "chat", description: "squad-chat: open the pane: chat, or a room such as Usage, Git, Agents, Focus or Snippets (notify, dnd, rooms: settings)", argumentHint: "[usage|git|agents|focus|habits|toolbox|clipboard|pet|snippet|monitor|weather|news|stock|lofi | band <room> | rooms <list> | set <room> <setting> <value> | store [words] | install|update|uninstall <room> | notify on|off | dnd on|off|auto]" },
  { name: "say", description: "squad-chat: send a message to the current room", argumentHint: "<message>" },
  { name: "room", description: "squad-chat: list, switch, join/create, leave or delete rooms", argumentHint: "[name] [passcode] | leave <name> | delete <name>" },
  { name: "who", description: "squad-chat: who's online" },
  { name: "chat-login", description: "squad-chat: sign in with an emailed code", argumentHint: "<email> | <code>" },
  { name: "chat-share", description: "squad-chat: share the selected text, Claude's last code block, your diff, or a Usage/Git/Agents snapshot to the room", argumentHint: "[diff [path] | usage | git | agents] [#room] | to #room | send [#room] | cancel" },
  { name: "chat-name", description: "squad-chat: change your display name", argumentHint: "<new name>" },
  { name: "chat-logout", description: "squad-chat: sign out on this computer" },
  { name: "lofi", description: "squad-chat: music in the background (lo-fi streams, YouTube, your files) through mpv, in the Lo-fi room", argumentHint: "play [name] | pause | next | prev | stop | vol <0-100> | add <url or path> | remove <name> | import" },
  { name: "focus", description: "squad-chat: a Pomodoro timer in the Focus room, with a chime when focus or a break ends", argumentHint: "start | pause | skip | reset | <focus min> [break min]" },
  { name: "habit", description: "squad-chat: daily habits in the Habits room, each with its streak", argumentHint: "add <name> [x<times a day>] | done <name> | undo <name> | remove <name> | rename <old> -> <new>" },
  { name: "tool", description: "squad-chat: developer tools in the Toolbox room: Base64, URL, JWT, UUID, hashes, Unix times, cron, JSON …", argumentHint: "<tool> [input] | base64|url|html|jwt|uuid|ulid|hash|password|lorem|time|base|cron|json|escape|count|case" },
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
    const seen = Array.isArray(offered) ? offered : Array.isArray(savedRooms) ? ["usage", "git", "agents"] : [...DEFAULT_ROOMS];
    const fresh = DEFAULT_ROOMS.filter((x) => !seen.includes(x));
    if (fresh.length) {
      state.sysRooms = [...state.sysRooms, ...fresh.filter((x) => !state.sysRooms.includes(x))];
      await $.store.set("sysRooms", state.sysRooms);
    }
    if (!Array.isArray(offered) || fresh.length) await $.store.set("roomsOffered", [...new Set([...seen, ...DEFAULT_ROOMS])]);
    const savedView = await $.store.get("view");
    if (savedView === "chat" || (typeof savedView === "string" && ROOM_ID.test(savedView))) state.view = savedView;
    try { state.sessionId = String(await $.session.id()); } catch { state.sessionId = null; }
    await restoreSessionUsage($);
    await restoreRooms($);
    try { cwdCache = await $.session.cwd(); } catch { cwdCache = null; }
    try { state.usage.model = (await $.session.model()) || state.usage.model; } catch { /* the first turn tells */ }
    beat($, false);   // this session's own row in the Agents room, before any heartbeat goes out
    if (state.sysRooms.includes("usage")) void refreshUsage($);   // numbers right away after a reload
    if (!bridgeStarted) {
      bridgeStarted = true;
      void runBridge($, options);
      tick($).catch(() => { /* unloaded mid-sleep */ });
      petLoop($).catch(() => { /* unloaded mid-sleep */ });
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
    // "/chat band git": the band above the prompt shows Git, the pane stays shut.
    const band = /^band\b\s*(\S*)$/i.exec(args);
    if (band) {
      const want = band[1].toLowerCase();
      const list = bandRooms();
      if (!want) return say(`The band shows ${activeView()}. /chat band <room> switches it: ${list.join(", ")}. ‹ › on the band do it too.`);
      if (!list.includes(want)) return say(`No room called ${want} with a tab. There are ${list.join(", ")}.`);
      await setView($, want);
      return say(`The band shows ${want}.`);
    }
    const admin = chatAdmin(call, args, say, { saveRooms: (list) => saveSysRooms($, list) });
    if (admin) return admin;
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
  on("command.run", { command: "lofi" }, ($, e) => answer($, (call, say) => lofi(call, e.args, say, {
    setView: async (view) => { await setView($, view); await openPane($); },
  })));
  on("command.run", { command: "focus" }, ($, e) => answer($, async (call, say) => {
    const args = String(e.args ?? "").trim();
    if (!state.sysRooms.includes("focus")) return say("The Focus room is hidden. Bring it back with /chat rooms +focus.");
    if (args && !(await roomInput($, "focus", args))) return say("/focus takes start, pause, skip, reset, or the minutes: /focus 50 10.");
    if (!args) { await setView($, "focus"); return openPane($); }
    const f = state.focus;
    say(f.phase === "idle" ? `Focus ${f.work} min, break ${f.rest} min.` : `${state.focusStatus} · ${f.work}/${f.rest} min`);
  }));
  on("command.run", { command: "habit" }, ($, e) => answer($, async (call, say) => {
    const args = String(e.args ?? "").trim();
    if (!state.sysRooms.includes("habits")) return say("The Habits room is hidden. Bring it back with /chat rooms +habits.");
    if (!args) { await setView($, "habits"); return openPane($); }
    if (!(await roomInput($, "habits", args, say))) say("/habit takes add <name>, done <name>, undo <name>, remove <name> or rename <old> -> <new>.");
  }));
  on("command.run", { command: "tool" }, ($, e) => answer($, async (call, say) => {
    const args = String(e.args ?? "").trim();
    if (!state.sysRooms.includes("toolbox")) return say("The Toolbox room is hidden. Bring it back with /chat rooms +toolbox.");
    if (args && !(await roomInput($, "toolbox", args, say))) return say(TOOL_USAGE);
    await setView($, "toolbox");
    return openPane($);
  }));
  on("command.run", { command: "snippet" }, ($, e) => answer($, (call, say) => snippet(call, e.args, say, {
    sources: shareSources($),
    copy: (text) => copyText($, text, say),
    setView: async (view) => { await setView($, view); await openPane($); },
  })));

  on("ui.render", { component: "Pane" }, ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e);
    const props = e.props ?? {};
    state.paneFocused = props.isFocused === true;
    paneSurface = e.surface;
    if (state.paneFocused) void markRead($);
    if (!state.paneShown) { state.paneShown = true; syncRooms($); }
    // The pane draws lines and charts as Svg where a surface paints them; the
    // terminal keeps its glyphs, so it is drawn as though it had no Svg.
    const els = $.ui.resolve(e);
    return paneView(e.surface === "terminal" ? { ...els, Svg: undefined } : els, { ...props, surface: e.surface }, {
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
      onToggleAddRoom: () => { state.addingRoom = !state.addingRoom; focusAfterDraw($, "add-room"); },
      onAddRoom: (id) => { state.addingRoom = false; void submitFromPane($, `/chat rooms +${id}`).then(() => focusAfterDraw($, "compose")); },
      onJoinStart: () => { state.join = { step: "name", name: "" }; joinFocus($, "join-name"); },
      // What's typed, kept for the buttons beside the field (no redraw: the
      // field holds its own text); each key pushes the fold back 5 seconds.
      onJoinTyping: (value) => { if (state.join) { state.join.draft = value; armJoinIdle($); } },
      onJoinName: (value) => {
        const name = String(value ?? "").trim().replace(/^#/, "");
        if (!name || /\s/.test(name)) { state.join = { step: "name", name, error: name ? "A room's name is one word." : "Type a room's name." }; return joinFocus($, "join-name"); }
        state.join = { step: "pass", name };
        joinFocus($, "join-pass");
      },
      onJoinPass: (value) => { void joinFromPane($, value); },
      onJoinBack: () => { state.join = { step: "name", name: state.join?.name ?? "" }; joinFocus($, "join-name"); },
      onJoinCancel: () => closeJoin($),
      onShareTarget: (id) => {
        const r = retargetShare(id);
        state.notice = typeof r === "string" ? r : "";
        $.ui.invalidate("ui.render");
      },
      onCopy: (text, surface) => { void copySnippet($, text, surface); },
      onShareItem: (item) => shareItemFromPane($, item),
      onAction: (room, act) => { void roomAction($, room, act); },
      onRedraw: () => $.ui.invalidate("ui.render"),
      onSetSetting: (room, key, value) => { void setRoomSetting($, room, key, value); },
      onRefresh: () => { void refreshGit($); },
      onToggleBreakdown: () => toggleBreakdown($),
      onToggleSession: (id) => { if (!state.collapsed.delete(id)) state.collapsed.add(id); $.ui.invalidate("ui.render"); },
      // The desktop's messages are tall: three a press there, five on the terminal.
      onChatScroll: (dir) => scrollChat($, dir === 0 ? 0 : dir * (paneSurface === "terminal" ? 5 : 3)),
      onCycleFilter: () => { state.feedFilter = { all: "here", here: "errors", errors: "all" }[state.feedFilter]; $.ui.invalidate("ui.render"); },
      onFocusStart: () => { void focusAct($, "start"); },
      onFocusPause: () => { void focusAct($, "pause"); },
      onFocusSkip: () => { void focusAct($, "skip"); },
      onFocusReset: () => { void focusAct($, "reset"); },
      onFocusAdjust: (which, dir) => { void changeFocus($, (f) => focusAdjust(f, which, dir)); },
      onHabitToggle: (id) => { void changeHabits($, (h, now) => { toggleHabit(h, id, now); }); },
      // ✕ deletes at once; Cancel beside the notice puts it back for 10 seconds.
      onHabitDelete: (id) => {
        void changeHabits($, (h) => {
          const done = deleteHabit(h, id);
          if (!done) return;
          const undo = { text: done.said, label: "Cancel", until: Date.now() + UNDO_MS, kept: done.kept };
          state.notice = done.said;
          state.undo = undo;
          $.clock.sleep(UNDO_MS).then(() => {
            if (state.undo !== undo) return;
            state.undo = null;
            if (state.notice === undo.text) state.notice = "";
            $.ui.invalidate("ui.render");
          }).catch(() => {});
        });
      },
      onUndo: () => {
        const undo = state.undo;
        if (!undo || Date.now() >= undo.until) return;
        state.undo = null;
        void changeHabits($, (h) => { state.notice = undeleteHabit(h, undo.kept); });
      },
      onHabitMark: (id, dir) => { if (dir) void changeHabits($, (h, now) => { markHabit(h, id, dir, now); }); },
      onToolPick: (id) => { void toolAct($, (tb, now) => pickTool(tb, id, now)); },
      onToolAgain: () => { void toolAct($, (tb, now) => toolAgain(tb, now)); },
      onToolCopy: (text, surface) => { void copyTool($, text, surface); },
      onToolReveal: () => { state.toolbox.reveal = !state.toolbox.reveal; $.ui.invalidate("ui.render"); },
      onToolPaste: () => { void pasteTool($); },
      onClipCopy: (id, surface) => { void copyClip($, id, surface); },
      onClipRemove: (id) => { removeClip(state.clipboard, id); $.ui.invalidate("ui.render"); },
      onClipClear: () => clearClips($),
      onPetMode: (mode) => setPetMode($, mode),
      onPetWalk: (walk) => { state.pet.walk = walk; savePet($); $.ui.invalidate("ui.render"); },
    });
  });

  // The wheel or the scroll keys over a room's cards move them in their
  // window. The chat and a room that fits leave the pane to the engine.
  on("ui.scroll", { component: "Pane" }, ($, e, next) => {
    // Over the chat: a message a wheel tick (more for a page key), older
    // toward the top, and the pane itself stays put.
    if (e.requestId === PANE_ID && activeView() === "chat" && currentRoom()) {
      const step = Math.sign(e.by) * Math.max(1, Math.round(Math.abs(e.by) / 2));
      scrollChat($, -step);
      return {};
    }
    const scroll = state.dockScroll;
    if (e.requestId !== PANE_ID || activeView() === "chat" || scroll.view !== activeView() || !scroll.max) return next(e);
    // A card at a time, or as many as the rows asked for pass (a page key).
    let offset = scroll.offset;
    const at = scroll.starts[offset] ?? 0;
    do offset += Math.sign(e.by);
    while (offset > 0 && offset < scroll.max && Math.abs((scroll.starts[offset] ?? 0) - at) < Math.abs(e.by));
    offset = Math.min(scroll.max, Math.max(0, offset));
    if (offset !== scroll.offset) { scroll.offset = offset; $.ui.invalidate("ui.render"); }
    return {};
  });

  // While the pane can't be seen (too narrow to place, or closed), a one-line
  // band above the prompt keeps the room in view. It yields to surveys.
  on("ui.render", { component: "AbovePrompt" }, async ($, e, next) => {
    const chatShown = state.auth === "signed_in" && currentRoom();
    if (e.props?.hasSurvey || (activeView() === "chat" && !chatShown)) return next(e);
    const panes = await $.ui.panes();
    if (panes.some((p) => p.id === PANE_ID && p.isPlaced && p.isShown)) return next(e);
    return bandView($.ui.resolve(e), { ...(e.props ?? {}), surface: e.surface }, { onOpen: () => { void openPane($); }, onCycle: (dir) => { void cycleBand($, dir); } });
  });

  // "auto" do not disturb: a turn still running after LONG_TURN_MS goes quiet
  // until it completes. Short back-and-forth with Claude never flips it.
  let turn = null;
  on("turn.start", ($, e, next) => {
    const id = e.turnId;
    turn = id;
    if (!e.agentId) { turnStarted(state.usage, Date.now()); stepPrompt(state.usage, e.text); sysChanged($); }
    void (async () => {
      await $.clock.sleep(LONG_TURN_MS);
      if (turn !== id || state.dnd !== "auto") return;
      state.working = true;
      quietChanged($);
    })().catch(() => {});   // the session may end while it waits
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
    // as the status line has it once the turn is done. Kept, so a reload
    // brings the chart and the cache figures back.
    (async () => {
      await refreshUsage($);
      if (recordTurnContext(state.usage)) $.ui.invalidate("ui.render");
      if (state.sessionId) await $.store.set(USAGE_PREFIX + state.sessionId, usageSnapshot(state.usage, Date.now()));
    })().catch(() => {});
    if (state.working) {
      state.working = false;
      quietChanged($);
    }
    return r;
  });

  // Each request of the main loop, for the Usage room's Requests card: the
  // tools it called as they stream, then the API's usage for it. The stream
  // is passed on piece by piece, untouched.
  on("turn.step", async function* ($, e, next) {
    if (e.agentId) return yield* next(e);
    let step = null;
    try { step = stepStarted(state.usage, { turnId: e.turnId, index: e.index, at: Date.now() }); sysChanged($); }
    catch { /* the request matters more than its tally */ }
    // Ended either way: a stream that breaks or is dropped leaves it failed,
    // not streaming for good.
    let r = null;
    try {
      const stream = next(e);
      for await (const c of stream) {
        if (c.kind === "tool") stepToolUse(step, c.name);
        yield c;
      }
      r = await stream.result;
      return r;
    } finally {
      try { stepEnded(state.usage, step, r?.usage, r?.stopReason); sysChanged($); }
      catch { /* as above */ }
    }
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
        // Its answer goes back to the model with the next request: only its size is kept.
        if (!e.agentId && r) stepToolResult(state.usage, e.tool, String(r.deny ?? r.text ?? (r.result === undefined ? "" : JSON.stringify(r.result) ?? "")).length, toolSummary(e.tool, e));
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
