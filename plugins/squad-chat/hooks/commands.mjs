// What the person types: slash commands, and the pane's input box (which
// also takes the same commands, so a passcode or sign-in code typed there
// never reaches the transcript at all).
//
// The hooks module hands in `call(path, body)`, a bridge request, and
// `say(text)`, the answer: $.ui.log for slash commands (shown, never sent to
// the model), the pane's notice line for the input box.

import { state, currentRoom, activeView, SYS_ROOMS } from "./state.mjs";
import { lastCodeBlock, looksLikeDiff, snippetTitle, findSecret, tooBig, displayLines } from "./share.mjs";
import { snapshotText } from "./sysviews.mjs";

// Commands whose arguments must never reach the model: messages, emails,
// sign-in codes, room passcodes.
export const PRIVATE_ARGS = new Set(["say", "room", "chat-login", "chat-share"]);

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CODE = /^\d[\d\s]{4,12}\d$/;

const NAME = /^[A-Za-z0-9_-]{1,24}$/;

// Sign in with an email (a code follows by email) or, where the server
// allows it, with just a name (an anonymous account).
export async function login(call, arg, say) {
  arg = String(arg ?? "").trim();
  if (state.auth === "signed_in") return say(`Already signed in as ${state.user?.name}. /chat-logout first to switch accounts.`);
  if (EMAIL.test(arg)) {
    await call("/login/start", { email: arg });
    return say(`Code sent to ${arg}. Type it here (or /chat-login <code>).`);
  }
  if (CODE.test(arg)) {
    if (state.auth !== "code_sent") return say("Ask for a code first: /chat-login <email>");
    // The answer carries the user: the auth event on stdout may land later.
    const r = await call("/login/verify", { code: arg.replace(/\s+/g, "") });
    return say(`Signed in as ${r.user?.name ?? "you"}.`);
  }
  if (NAME.test(arg) && state.auth !== "code_sent") {
    const r = await call("/login/name", { name: arg });
    return say(`Signed in as ${r.user?.name ?? arg}.`);
  }
  return say(state.auth === "code_sent"
    ? `Enter the code emailed to ${state.email}, or another email address.`
    : "Sign in with your email (/chat-login you@example.com) or a name of 1-24 letters, digits, - or _.");
}

// A new display name for this account, unique on the server.
export async function rename(call, arg, say) {
  arg = String(arg ?? "").trim().replace(/^@/, "");
  requireSignedIn();
  if (!arg) return say(`You're ${state.user?.name}. Change it with /chat-name <new name>.`);
  if (!NAME.test(arg)) return say("A name is 1-24 letters, digits, - or _.");
  const r = await call("/name", { name: arg });
  return say(`You're now ${r.name}.`);
}

let pendingLogout = 0;   // until when a second /chat-logout confirms

export async function logout(call, say) {
  if (state.auth !== "signed_in") return say("Not signed in.");
  // An account without an email can't be signed back into: ask twice.
  if (state.user?.anonymous && Date.now() > pendingLogout) {
    pendingLogout = Date.now() + 30_000;
    return say(`You signed in with just a name, so signing out loses "${state.user.name}" and your rooms for good. Run /chat-logout again within 30 seconds to confirm.`);
  }
  pendingLogout = 0;
  await call("/logout", {});
  return say("Signed out.");
}

export async function room(call, args, say) {
  const [slug, ...rest] = String(args ?? "").trim().split(/\s+/).filter(Boolean);
  const passcode = rest.join(" ") || undefined;
  requireSignedIn();
  if (!slug) {
    if (!state.rooms.length) return say("No rooms yet. Create or join one: /room <name> <passcode>");
    const list = state.rooms.map((r) => `${r.id === state.current ? "▸" : " "} #${r.slug}${r.unread ? ` (${r.unread} unread)` : ""}`);
    return say(`Rooms:\n${list.join("\n")}`);
  }
  // "/room leave <name>" and "/room delete <name>". A room literally called
  // "leave" or "delete" is still reachable as "/room #leave".
  if ((slug === "leave" || slug === "delete") && rest.length) return manageRoom(call, slug, rest[0], say);

  const name = slug.replace(/^#/, "").toLowerCase();
  const joined = state.rooms.find((r) => r.slug === name);
  if (joined && !passcode) {
    await call("/room/select", { room: joined.id });
    return say(`Now in #${name}.`);
  }
  const r = await call("/room", { slug: name, passcode });
  return say(`Now in #${r.slug}.`);
}

const CONFIRM_MS = 30_000;
let pendingDelete = null;   // { slug, until }: a delete waiting for its second ask

async function manageRoom(call, action, ref, say) {
  const name = ref.replace(/^#/, "").toLowerCase();
  const target = state.rooms.find((r) => r.slug === name);
  if (!target) return say(`You're not in a room called #${name}.`);
  if (action === "leave") {
    await call("/room/leave", { room: target.id });
    return say(`Left #${name}. Rejoin any time with its passcode.`);
  }
  // Deleting is for everyone and can't be undone: ask twice.
  const now = Date.now();
  if (!pendingDelete || pendingDelete.slug !== name || now > pendingDelete.until) {
    pendingDelete = { slug: name, until: now + CONFIRM_MS };
    return say(`This deletes #${name} and all its messages for everyone in it. Run /room delete ${name} again within 30 seconds to confirm.`);
  }
  pendingDelete = null;
  await call("/room/delete", { room: target.id });
  return say(`Deleted #${name}.`);
}

export function who(say) {
  requireSignedIn();
  if (!state.friends.length) return say("No friends yet: people show up here once you share a room.");
  const lines = state.friends.map((f) => `${f.busy ? "◐" : f.online ? "●" : "○"} ${f.name}${f.busy ? " (busy)" : ""}  ${f.rooms.map((s) => `#${s}`).join(" ")}`);
  const n = state.friends.filter((f) => f.online).length;
  return say(`${n} of ${state.friends.length} online\n${lines.join("\n")}`);
}

const DND_MODES = {
  on: "Do not disturb is on: no toasts, and your friends see you as busy. /chat dnd off to end it.",
  off: "Do not disturb is off.",
  auto: "Do not disturb turns on by itself while Claude works on something longer than 30 seconds.",
};

// "/chat dnd [on|off|auto]". `setDnd(mode)` keeps the choice and tells the room.
export async function dnd(args, say, setDnd) {
  const mode = String(args ?? "").trim().toLowerCase();
  if (!mode) return say(`Do not disturb: ${state.dnd}. Change it with /chat dnd on, off or auto.`);
  if (!(mode in DND_MODES)) return say("Use /chat dnd on, off or auto.");
  await setDnd(mode);
  return say(DND_MODES[mode]);
}

// "/chat rooms usage,git": which built-in rooms have tabs. "all" or "none" too.
// `save(list)` keeps the choice.
export async function sysRooms(args, say, save) {
  const arg = String(args ?? "").trim().toLowerCase();
  if (!arg) return say(`Built-in rooms: ${state.sysRooms.join(", ") || "none"}. Change with /chat rooms usage,git,agents (or all, or none).`);
  const list = arg === "all" ? [...SYS_ROOMS] : arg === "none" ? [] : arg.split(/[\s,]+/).filter(Boolean);
  const unknown = list.filter((x) => !SYS_ROOMS.includes(x));
  if (unknown.length) return say(`No built-in room called ${unknown.join(", ")}. They are usage, git and agents.`);
  await save(SYS_ROOMS.filter((x) => list.includes(x)));
  return say(state.sysRooms.length ? `Built-in rooms: ${state.sysRooms.join(", ")}.` : "Built-in rooms hidden.");
}

const SHARE_HOLD_MS = 120_000;   // a preview waits this long for a send

// "/chat-share" (what's selected, or the last code block in Claude's reply),
// "/chat-share diff [path]", then "/chat-share send" or "/chat-share cancel".
// A "#room" anywhere picks one of your other rooms; the current one otherwise.
// (A path that starts with "#" can be written "./#name".)
// In the pane's box it's "/share" (Claude Code's own /share is taken).
// Nothing goes out without a look first. `sources` reads the session: selection(),
// messages() and diff(path), each from the hooks module.
export async function share(call, args, say, sources) {
  const words = String(args ?? "").trim().split(/\s+/).filter(Boolean);
  const targets = words.filter((w) => w.startsWith("#"));
  const [verb, ...rest] = words.filter((w) => !w.startsWith("#"));
  const c = sources.inPane ? "/share" : "/chat-share";
  requireSignedIn();
  if (targets.length > 1) return say("Pick one room to share to.");
  if (targets.length && (verb === "send" || verb === "cancel")) {
    return say(`Pick the room when you start: ${c} ${targets[0]} or ${c} diff ${targets[0]}.`);
  }
  if (verb === "cancel") {
    const had = state.pendingShare;
    state.pendingShare = null;
    return say(had ? "Dropped it." : "Nothing waiting to share.");
  }
  if (verb === "send") return sendShare(call, say, c);
  let room = currentRoom();
  if (targets.length) {
    const name = targets[0].slice(1).toLowerCase();
    room = state.rooms.find((r) => r.slug === name);
    if (!room) return say(`You're not in #${name}. Join it first: /room ${name} <passcode>`);
  }
  if (!room) return say("Join a room first: /room <name> <passcode>");

  let snippet;
  if (SYS_ROOMS.includes(verb)) {
    snippet = { kind: "code", lang: verb, body: snapshotText(verb) };
  } else if (verb === "diff") {
    const body = String(await sources.diff(rest.join(" ")) ?? "").replace(/\n$/, "");
    if (!body.trim()) return say(rest.length ? `No uncommitted changes in ${rest.join(" ")}.` : "No uncommitted changes to share.");
    snippet = { kind: "diff", lang: "diff", body };
  } else if (verb) {
    return say(`Use ${c} [#room], ${c} diff [path] [#room], ${c} usage|git|agents [#room], ${c} send or ${c} cancel.`);
  } else {
    const selected = String(await sources.selection() ?? "").replace(/^(\s*\n)+/, "").trimEnd();
    if (selected.trim()) snippet = looksLikeDiff(selected) ? { kind: "diff", lang: "diff", body: selected } : { kind: "code", lang: null, body: selected };
    else {
      const block = lastCodeBlock(await sources.messages());
      if (!block?.body.trim()) return say(`Select some text first, or ask Claude for some code. ${c} diff shares your uncommitted changes.`);
      snippet = { kind: "code", ...block };
    }
  }
  const big = tooBig(snippet.body);
  if (big) return say(`Too big to share: ${big}.${snippet.kind === "diff" ? ` Share one file with ${c} diff <path>.` : " Select a smaller part."}`);

  const secret = findSecret(snippet.body);
  state.pendingShare = { ...snippet, room: room.id, slug: room.slug, secret, confirmed: false, until: Date.now() + SHARE_HOLD_MS };
  // The pane draws its own preview card: say only what needs saying.
  if (sources.inPane) return secret ? say(`⚠ It looks like it has ${secret}. Check it before you send.`) : undefined;
  const preview = displayLines(snippet.body, snippet.kind).slice(0, 3).map((l) => `  │ ${l.slice(0, 100)}`);
  return say([
    `Ready to share to #${room.slug}: ${snippetTitle(snippet)}`,
    ...preview,
    ...(secret ? [`⚠ It looks like it has ${secret}. Check it before you send.`] : []),
    `${c} send to post it, ${c} cancel to drop it.`,
  ].join("\n"));
}

async function sendShare(call, say, c) {
  const p = state.pendingShare;
  if (!p || Date.now() > p.until) {
    state.pendingShare = null;
    return say(`Nothing waiting to share. Start with ${c} or ${c} diff.`);
  }
  if (!state.rooms.some((r) => r.id === p.room)) {
    state.pendingShare = null;
    return say(`You're no longer in #${p.slug}.`);
  }
  // A likely secret takes a second send.
  if (p.secret && !p.confirmed) {
    p.confirmed = true;
    return say(`This looks like it has ${p.secret}. Run ${c} send again to post it anyway, or ${c} cancel.`);
  }
  await call("/send", { text: p.body, room: p.room, kind: p.kind, ...(p.lang ? { lang: p.lang } : {}) });
  state.pendingShare = null;
  return say(`Shared to #${p.slug}.`);
}

export async function sendMessage(call, text, say) {
  const body = String(text ?? "").trim();
  if (!body) return;
  requireSignedIn();
  if (!currentRoom()) return say("Join a room first: /room <name> <passcode>");
  await call("/send", { text: body, room: state.current });
}

function requireSignedIn() {
  if (state.auth === "starting" || state.bridge !== "ready") {
    throw new Error(state.bridge === "unavailable" ? state.detail : "Chat is still connecting, try again in a moment.");
  }
  if (state.auth !== "signed_in") {
    throw new Error(state.auth === "code_sent"
      ? `Enter the code emailed to ${state.email} first.`
      : "Sign in first: /chat-login you@example.com");
  }
}

function showView(view, say, setView) {
  if (!state.sysRooms.includes(view)) return say(`The ${view} room is hidden. Bring it back with /chat rooms all.`);
  return setView?.(view);
}

const HELP = "/room [name] [passcode] · /room leave|delete <name> · /who · /name <new name> · /dnd on|off|auto · /share [diff|usage|git|agents] [#room] · /usage · /git · /agents · /chat · /logout · anything else is a message";

// The pane's input box: commands, the sign-in steps, or a message.
// `setView(id)` shows a built-in room ("chat" for the chat), `refreshGit()`
// fetches the Git room again.
export async function paneInput(call, value, say, { setDnd, sources, setView, refreshGit } = {}) {
  const text = String(value ?? "").trim();
  if (!text) return;
  const view = activeView();
  if (view === "git" && /^r(efresh)?$/i.test(text)) return refreshGit?.();
  const m = /^\/([\w-]+)\s*([\s\S]*)$/.exec(text);
  if (m) {
    const [, cmd, args] = m;
    switch (cmd) {
      case "usage": case "git": case "agents": return showView(cmd, say, setView);
      case "chat": {
        // "/chat git" typed here does what it does at the prompt.
        const [sub, ...more] = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (!sub || sub === "chat") return setView?.("chat");
        if (SYS_ROOMS.includes(sub)) return showView(sub, say, setView);
        if (sub === "dnd") return dnd(more.join(" "), say, setDnd);
        return say("Here, /chat takes usage, git, agents or dnd. Type it at the prompt for the rest.");
      }
      case "room": return room(call, args, say);
      case "who": return who(say);
      case "login": case "chat-login": return login(call, args, say);
      case "logout": case "chat-logout": return logout(call, say);
      case "name": case "chat-name": return rename(call, args, say);
      case "say": return sendMessage(call, args, say);
      case "dnd": return dnd(args, say, setDnd);
      case "share": return share(call, args, say, sources);
      case "help": return say(HELP);
      default: return say(`Unknown command /${cmd}. Try /help.`);
    }
  }
  if (view !== "chat") return say(`This is the ${view} room: type a command (/help), or pick a chat room to talk.`);
  // The pane itself shows each sign-in step, so only errors (thrown) need words.
  if (state.auth === "signed_out" || state.auth === "code_sent") return login(call, text, () => {});
  return sendMessage(call, text, say);
}
