// squad-chat: friends' presence and a group chat in a side pane. Chat text
// never reaches the model.
//
// Everything that touches the engine ($) lives in this file, since $ is never
// followed across an import. The other files are plain logic:
//   state.mjs     the state built from the bridge's events
//   commands.mjs  slash commands and the pane's input box
//   views.mjs     the pane

import { state, applyEvent, resetBridgeState } from "./state.mjs";
import { PRIVATE_ARGS, login, logout, room, who, sendMessage, paneInput } from "./commands.mjs";
import { paneView } from "./views.mjs";

const PANE_ID = "squad-chat";
const MIN_NODE_MAJOR = 22;
const MAX_BACKOFF_MS = 30_000;

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
async function runBridge($) {
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
        env: { SQUAD_BRIDGE_TOKEN: state.token },
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
          if (applyEvent(event)) $.ui.invalidate("ui.render");
        }
      }
    } catch (err) {
      // Cannot start: no process noun on this surface (desktop), or no node.
      return unavailable($, `cannot start the chat bridge: ${err?.message ?? err}`);
    }
    if (state.ended) return;
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

async function submitFromPane($, value) {
  const say = (text) => { state.notice = text; $.ui.invalidate("ui.render"); };
  state.draft = "";
  state.notice = "";
  $.ui.invalidate("ui.render");
  try {
    await paneInput((path, body) => callBridge($, path, body), value, say);
  } catch (err) {
    say(err?.message ?? String(err));
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
    say(`squad-chat: ${err?.message ?? err}`);
  }
  return {};
}

export function register(on) {
  on("session.start", async ($, e, next) => {
    const r = await next(e);
    await $.command.register({ name: "chat", description: "squad-chat: open the chat pane", immediate: true });
    await $.command.register({ name: "say", description: "squad-chat: send a message to the current room", argumentHint: "<message>", immediate: true });
    await $.command.register({ name: "room", description: "squad-chat: list rooms, switch, or join/create one", argumentHint: "[name] [passcode]", immediate: true });
    await $.command.register({ name: "who", description: "squad-chat: who's online", immediate: true });
    await $.command.register({ name: "chat-login", description: "squad-chat: sign in with an emailed code", argumentHint: "<email> | <code>", immediate: true });
    await $.command.register({ name: "chat-logout", description: "squad-chat: sign out on this computer", immediate: true });
    if (!bridgeStarted) {
      bridgeStarted = true;
      void runBridge($);
    }
    return r;
  });

  on("command.run", { command: "chat" }, ($) => answer($, () => openPane($)));
  on("command.run", { command: "say" }, ($, e) => answer($, (call, say) => sendMessage(call, e.args, say)));
  on("command.run", { command: "room" }, ($, e) => answer($, (call, say) => room(call, e.args, say)));
  on("command.run", { command: "who" }, ($) => answer($, (call, say) => who(say)));
  on("command.run", { command: "chat-login" }, ($, e) => answer($, async (call, say) => {
    if (!String(e.args ?? "").trim()) await openPane($);
    await login(call, e.args, say);
  }));
  on("command.run", { command: "chat-logout" }, ($) => answer($, (call, say) => logout(call, say)));

  on("ui.render", { component: "Pane" }, ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e);
    return paneView($.ui.resolve(e), e.props ?? {}, {
      onInput: (value) => { state.draft = value; },
      onSubmit: (value) => { void submitFromPane($, value); },
    });
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
