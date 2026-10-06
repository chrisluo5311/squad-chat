// squad-chat — Phase 0 spike.
//
// Proves the plumbing the real mod needs, with no Supabase yet:
//   - a Pane with an Input that sends on Enter, plus a /say command
//   - a Node child process (bridge) spawned with $.process.spawn, its NDJSON
//     stdout driving redraws through $.ui.invalidate
//   - control requests to the bridge over a private Unix socket ($.http.fetch
//     with socketPath)
//   - /say's text kept out of the conversation the model reads (session.append)

const PANE_ID = "squad-chat";
const MAX_MESSAGES = 100;
const MAX_BACKOFF_MS = 30_000;

const state = {
  status: "starting",       // starting | ready | restarting | unavailable
  detail: "",
  socket: null,
  token: null,
  messages: [],             // { id, user, body, at }
  ticks: 0,
  restarts: 0,
  ended: false,
};

const SAY_ARGS = /<command-args>[\s\S]*?<\/command-args>/g;
const SAY_REDACTED = "<command-args>[squad-chat message, hidden from Claude]</command-args>";
const SAY_PLACEHOLDER_ROW = `<command-name>/say</command-name>\n${SAY_REDACTED}`;

function blockTexts(content) {
  if (typeof content === "string") return [content];
  return (content ?? []).filter((b) => b?.type === "text").map((b) => b.text ?? "");
}

function isSayRow(message) {
  return blockTexts(message?.content).some((t) => t.includes("<command-name>/say</command-name>"));
}

function redactSay(content) {
  if (typeof content === "string") return content.replace(SAY_ARGS, SAY_REDACTED);
  return content.map((b) => (b?.type === "text" ? { ...b, text: String(b.text ?? "").replace(SAY_ARGS, SAY_REDACTED) } : b));
}

function randomToken() {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function pushMessage(message) {
  if (state.messages.some((m) => m.id === message.id)) return;
  state.messages.push(message);
  if (state.messages.length > MAX_MESSAGES) state.messages.splice(0, state.messages.length - MAX_MESSAGES);
}

function handleEvent($, event) {
  switch (event.type) {
    case "ready":
      state.status = "ready";
      state.socket = event.socket;
      state.detail = `bridge pid ${event.pid}`;
      break;
    case "message":
      pushMessage(event.message);
      break;
    case "tick":
      state.ticks = event.n;
      break;
    case "error":
      state.detail = event.message;
      break;
    default:
      return;
  }
  $.ui.invalidate("ui.render");
}

// Runs the bridge for the life of the module, restarting it with backoff.
// Leaving the for-await loop (or the module unloading) kills the child.
async function runBridge($) {
  let backoff = 1000;
  while (!state.ended) {
    state.token = randomToken();
    state.socket = null;
    const startedAt = await $.clock.now();
    let buffered = "";
    try {
      const child = $.process.spawn({
        argv: ["node", `${$.plugin.root}/bridge/spike-bridge.mjs`],
        env: { SQUAD_BRIDGE_TOKEN: state.token },
      });
      for await (const { stream, text } of child) {
        if (stream === "stderr") { $.ui.log(text.trimEnd(), { to: "debug" }); continue; }
        buffered += text;
        let nl;
        while ((nl = buffered.indexOf("\n")) >= 0) {
          const line = buffered.slice(0, nl).trim();
          buffered = buffered.slice(nl + 1);
          if (!line) continue;
          try { handleEvent($, JSON.parse(line)); }
          catch { $.ui.log(`bridge: unparsable line: ${line.slice(0, 120)}`, { to: "debug" }); }
        }
      }
    } catch (err) {
      // Cannot start: no `node` on PATH, or no process noun on this surface.
      state.status = "unavailable";
      state.detail = `cannot start bridge: ${err?.message ?? err}`;
      $.ui.invalidate("ui.render");
      return;
    }
    if (state.ended) return;
    if ((await $.clock.now()) - startedAt > 60_000) backoff = 1000;
    state.status = "restarting";
    state.restarts++;
    state.detail = `bridge exited; retrying in ${Math.round(backoff / 1000)}s`;
    $.ui.invalidate("ui.render");
    await $.clock.sleep(backoff);
    backoff = Math.min(backoff * 2, MAX_BACKOFF_MS);
  }
}

async function callBridge($, path, body) {
  if (!state.socket) throw new Error("chat is not connected yet");
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

async function send($, text) {
  const body = String(text ?? "").trim();
  if (!body) return;
  try {
    await callBridge($, "/send", { text: body });
  } catch (err) {
    $.ui.toast(`squad-chat: ${err.message}`);
  }
}

async function openPane($) {
  return $.ui.open({ id: PANE_ID, title: "Squad Chat", focus: true, rows: 10, columns: 48 });
}

function formatTime(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function statusDot() {
  if (state.status === "ready") return { color: "green", text: "● connected" };
  if (state.status === "unavailable") return { color: "red", text: "● unavailable" };
  return { color: "yellow", text: `● ${state.status}` };
}

function paneView($, e) {
  const { Box, Text, Input } = $.ui.resolve(e);
  const props = e.props ?? e;
  const inline = props.placement === "inline";
  const width = Math.max(20, (props.bodyColumns || 48) - 2);
  const shown = state.messages.slice(inline ? -4 : -20);
  const dot = statusDot();

  const rows = shown.length
    ? shown.map((m) => Text({
        key: `m${m.id}`,
        wrap: "truncate-end",
        children: `${formatTime(m.at)} ${m.user}: ${m.body}`.slice(0, width * 3),
      }))
    : [Text({ key: "empty", dimColor: true, children: "No messages yet. Type below and press Enter." })];

  return Box({
    flexDirection: "column",
    children: [
      Box({ flexDirection: "row", justifyContent: "space-between", children: [
        Text({ bold: true, color: "cyan", children: "#spike" }),
        Text({ color: dot.color, children: dot.text }),
      ] }),
      Text({ key: "detail", dimColor: true, wrap: "truncate-end", children:
        `${state.detail || " "} · ticks ${state.ticks}` }),
      Box({ flexDirection: "column", marginTop: 1, children: rows }),
      Box({ marginTop: 1, children: [
        Input({
          key: "compose",
          placeholder: "Message… (Enter sends, Esc returns to the prompt)",
          submitLabel: "send",
          value: "",
          autoFocus: true,
          onSubmit: (value) => { void send($, value); },
        }),
      ] }),
    ],
  });
}

export function register(on) {
  on("session.start", async ($, e, next) => {
    const r = await next(e);
    await $.command.register({ name: "say", description: "squad-chat: send a message to the current room", argumentHint: "<message>", immediate: true });
    await $.command.register({ name: "chat", description: "squad-chat: open the chat pane", immediate: true });
    void runBridge($);
    return r;
  });

  // /say returns no text and no context: nothing for the transcript or model.
  on("command.run", { command: "say" }, async ($, e) => {
    await send($, e.args);
    return {};
  });

  on("command.run", { command: "chat" }, async ($) => {
    const opened = await openPane($);
    if (opened?.isPlaced === false) $.ui.toast("squad-chat: widen the terminal to see the chat pane");
    return {};
  });

  on("ui.render", { component: "Pane" }, ($, e, next) => {
    if (e.requestId !== PANE_ID) return next(e);
    return paneView($, e);
  });

  // Keep /say's text out of the conversation. Claude Code records a slash
  // command as a user row ("<command-name>/say</command-name> ...
  // <command-args>TEXT</command-args>") that the model reads on later turns,
  // so the args are replaced before the row is stored or sent.
  on("session.append", { door: "command" }, ($, e, next) => {
    if (!isSayRow(e.message)) return next(e);
    return next({ ...e, message: { ...e.message, content: redactSay(e.message.content) } });
  }).catch(($, e, next) => {
    // Fail closed: if the rewrite threw, store a row with no args at all.
    if (next.called || !isSayRow(e.message)) return next(e);
    return next({ ...e, message: { ...e.message, content: [{ type: "text", text: SAY_PLACEHOLDER_ROW }] } });
  });

  // Best effort: the end chain has one short time bound. Presence must never
  // depend on this; the bridge dying is what takes us offline.
  on("session.end", async ($, e, next) => {
    if (e.reason !== "clear" && e.reason !== "resume") {
      state.ended = true;
      try { await callBridge($, "/shutdown", {}); } catch { /* exiting anyway */ }
    }
    return next(e);
  });
}
