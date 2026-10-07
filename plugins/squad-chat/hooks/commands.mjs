// What the person types: slash commands, and the pane's input box (which
// also takes the same commands, so a passcode or sign-in code typed there
// never reaches the transcript at all).
//
// The hooks module hands in `call(path, body)`, a bridge request, and
// `say(text)`, the answer: $.ui.log for slash commands (shown, never sent to
// the model), the pane's notice line for the input box.

import { state, currentRoom } from "./state.mjs";

// Commands whose arguments must never reach the model: messages, emails,
// sign-in codes, room passcodes.
export const PRIVATE_ARGS = new Set(["say", "room", "chat-login"]);

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
  const lines = state.friends.map((f) => `${f.online ? "●" : "○"} ${f.name}  ${f.rooms.map((s) => `#${s}`).join(" ")}`);
  const n = state.friends.filter((f) => f.online).length;
  return say(`${n} of ${state.friends.length} online\n${lines.join("\n")}`);
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

// The pane's input box: commands, the sign-in steps, or a message.
export async function paneInput(call, value, say) {
  const text = String(value ?? "").trim();
  if (!text) return;
  const m = /^\/([\w-]+)\s*([\s\S]*)$/.exec(text);
  if (m) {
    const [, cmd, args] = m;
    switch (cmd) {
      case "room": return room(call, args, say);
      case "who": return who(say);
      case "login": case "chat-login": return login(call, args, say);
      case "logout": case "chat-logout": return logout(call, say);
      case "name": case "chat-name": return rename(call, args, say);
      case "say": return sendMessage(call, args, say);
      case "help": return say("/room [name] [passcode] · /room leave|delete <name> · /who · /name <new name> · /logout · anything else is a message");
      default: return say(`Unknown command /${cmd}. Try /help.`);
    }
  }
  // The pane itself shows each sign-in step, so only errors (thrown) need words.
  if (state.auth === "signed_out" || state.auth === "code_sent") return login(call, text, () => {});
  return sendMessage(call, text, say);
}
