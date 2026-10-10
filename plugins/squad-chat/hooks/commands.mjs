// What the person types: slash commands, and the pane's input box (which
// also takes the same commands, so a passcode or sign-in code typed there
// never reaches the transcript at all).
//
// The hooks module hands in `call(path, body)`, a bridge request, and
// `say(text)`, the answer: $.ui.log for slash commands (shown, never sent to
// the model), the pane's notice line for the input box.

import { state, currentRoom, activeView, roomIds, enabledRooms, isFnRoom } from "./state.mjs";
import { lastCodeBlock, looksLikeDiff, snippetTitle, findSecret, tooBig, displayLines } from "./share.mjs";
import { snapshotText } from "./sysviews.mjs";

// Commands whose arguments must never reach the model: messages, emails,
// sign-in codes, room passcodes, snippets.
export const PRIVATE_ARGS = new Set(["say", "room", "chat-login", "chat-share", "snippet", "lofi"]);

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

// "/chat rooms usage,git,snippet": which built-in and function rooms have
// tabs. "all" or "none" too, and "+snippet" or "-git" to add or drop one.
// `save(list)` keeps the choice.
export async function sysRooms(args, say, save) {
  const arg = String(args ?? "").trim().toLowerCase();
  const known = roomIds();
  const names = () => enabledRooms().join(", ") || "none";
  if (!arg) return say(`Rooms with tabs: ${names()}. There are ${known.join(", ")}. Change with /chat rooms ${known.join(",")}, all, none, +name or -name.`);
  const words = arg === "all" ? [...known] : arg === "none" ? [] : arg.split(/[\s,]+/).filter(Boolean);
  const unknown = words.map((w) => w.replace(/^[+-]/, "")).filter((x) => !known.includes(x));
  if (unknown.length) return say(`No room called ${unknown.join(", ")}. There are ${known.join(", ")}.`);
  let list;
  if (words.length && words.every((w) => /^[+-]/.test(w))) {
    const set = new Set(state.sysRooms);
    for (const w of words) (w[0] === "+" ? set.add(w.slice(1)) : set.delete(w.slice(1)));
    list = [...set];
  } else list = words.map((w) => w.replace(/^\+/, ""));
  // Keep rooms the bridge hasn't reported yet as they were.
  const pending = state.sysRooms.filter((x) => !known.includes(x));
  const before = enabledRooms();
  await save([...known.filter((x) => list.includes(x)), ...pending]);
  // A room that goes online says where, the moment it gets a tab.
  const online = enabledRooms().filter((id) => !before.includes(id) && state.fn.get(id)?.manifest.permissions?.hosts?.length)
    .map((id) => { const m = state.fn.get(id).manifest; return `${m.name} reaches ${m.permissions.hosts.join(", ")}.`; });
  return say([enabledRooms().length ? `Rooms with tabs: ${names()}.` : "Room tabs hidden.", ...online].join("\n"));
}

// ---------------------------------------------------------------- the room store

const CONFIRM_STORE_MS = 60_000;
let pendingStore = null;   // { what: "install" | "update" | "uninstall", id, sha256, until }

const confirmed = (what, id) => pendingStore && pendingStore.what === what && pendingStore.id === id && Date.now() < pendingStore.until;

// "/chat store [words]": the rooms other people wrote, and which you have.
export async function roomStore(call, args, say) {
  const q = String(args ?? "").trim().toLowerCase();
  const { rooms } = await call("/store/list", { refresh: q === "refresh" });
  const shown = rooms.filter((r) => !q || q === "refresh" || `${r.id} ${r.name} ${r.description}`.toLowerCase().includes(q));
  if (!shown.length) return say(q ? `No room in the store matches "${q}".` : "The store is empty.");
  const mark = (r) => (r.shipped ? "comes with squad-chat" : !r.compatible ? `needs squad-chat ${r.minSquadChat}` : r.update ? `installed ${r.installed}, update to ${r.version}` : r.installed ? "installed" : "");
  return say([
    `Room store: ${shown.length} room${shown.length === 1 ? "" : "s"}`,
    ...shown.map((r) => `  ${r.icon} ${r.id} · ${r.name} ${r.version}${mark(r) ? ` (${mark(r)})` : ""}: ${r.description}`),
    "Install one with /chat install <id>.",
  ].join("\n"));
}

function describeRoom(r) {
  return [
    `${r.icon} ${r.name} ${r.version}${r.author ? ` by ${r.author}` : ""}`,
    ...(r.description ? [`  ${r.description}`] : []),
    r.hosts.length ? `  Reaches: ${r.hosts.join(", ")}` : "  Reaches nothing on the network.",
    ...(r.settings?.length ? [`  Settings: ${r.settings.join(", ")}`] : []),
  ];
}

// "/chat install <id>": a look first (what it is, where it reaches), then
// the same command again to install. It gets a tab.
export async function installRoom(call, args, say, addTab) {
  const id = String(args ?? "").trim().toLowerCase();
  if (!id) return say("Which room? /chat store lists them.");
  if (confirmed("install", id)) {
    const { sha256 } = pendingStore;
    pendingStore = null;
    const r = await call("/store/install", { id, sha256 });
    await addTab?.(id);
    return say(`Installed ${r.name}. Its tab is there now: /chat ${id}.`);
  }
  const r = await call("/store/preview", { id });
  if (r.installed && !r.update) return say(`${r.name} ${r.installed} is installed and up to date.`);
  pendingStore = { what: "install", id, sha256: r.sha256, until: Date.now() + CONFIRM_STORE_MS };
  return say([...describeRoom(r), `Run /chat install ${id} again within a minute to install it.`].join("\n"));
}

// "/chat update [id]": which rooms have a newer version, or update one. A
// version that reaches new hosts asks first.
export async function updateRoom(call, args, say) {
  const id = String(args ?? "").trim().toLowerCase();
  if (!id) {
    const { rooms } = await call("/store/list", { refresh: true });
    const due = rooms.filter((r) => r.update && r.compatible);
    if (!due.length) return say("Every room you installed is up to date.");
    return say([...due.map((r) => `  ${r.icon} ${r.id}: ${r.installed} → ${r.version}`), "Update one with /chat update <id>."].join("\n"));
  }
  if (confirmed("update", id)) {
    const { sha256 } = pendingStore;
    pendingStore = null;
    const r = await call("/store/install", { id, sha256 });
    return say(`Updated ${r.name} to ${r.version}.`);
  }
  const r = await call("/store/preview", { id });
  if (!r.installed) return say(`${r.name} isn't installed: /chat install ${id}.`);
  if (!r.update) return say(`${r.name} ${r.installed} is up to date.`);
  if (r.hostsChanged) {
    pendingStore = { what: "update", id, sha256: r.sha256, until: Date.now() + CONFIRM_STORE_MS };
    return say([`${r.name} ${r.version} reaches different hosts: ${r.hosts.join(", ") || "none"}${r.newHosts.length ? ` (new: ${r.newHosts.join(", ")})` : ""}.`, `Run /chat update ${id} again within a minute to update it.`].join("\n"));
  }
  const done = await call("/store/install", { id, sha256: r.sha256 });
  return say(`Updated ${done.name} to ${done.version}.`);
}

// "/chat uninstall <id>": removes an installed room, its settings and data.
export async function uninstallRoom(call, args, say, dropTab) {
  const id = String(args ?? "").trim().toLowerCase();
  if (!id) return say("Which room? /chat store marks the ones installed.");
  if (!confirmed("uninstall", id)) {
    const name = state.fn.get(id)?.manifest.name ?? id;
    pendingStore = { what: "uninstall", id, until: Date.now() + CONFIRM_STORE_MS };
    return say(`This removes ${name}, its settings and what it keeps. Run /chat uninstall ${id} again within a minute to do it.`);
  }
  pendingStore = null;
  const r = await call("/store/uninstall", { id });
  await dropTab?.(id);
  return say(`Uninstalled ${r.name}.`);
}

// A setting's value as typed back: "Taipei, Tokyo", "on".
function showSetting(v) {
  if (Array.isArray(v)) return v.length ? v.join(", ") : "(none)";
  if (typeof v === "boolean") return v ? "on" : "off";
  return String(v ?? "");
}

// "/chat set weather cities Taipei, Tokyo": a function room's settings.
// Without a value it shows them; "+Osaka" or "-Tokyo" changes a list,
// "default" puts one back. In the pane, "/set cities …" is for the room on
// show (`room`).
export async function roomSettings(call, args, say, { room: here = null } = {}) {
  const words = String(args ?? "").trim().split(/\s+/).filter(Boolean);
  const id = here ?? (words.shift() ?? "").toLowerCase();
  const c = here ? "/set" : `/chat set ${id}`;
  const withSettings = roomIds().filter((x) => state.fn.get(x)?.manifest.settings);
  if (!isFnRoom(id)) return say(here ? "Open a room with settings first." : `Which room? ${withSettings.length ? `These have settings: ${withSettings.join(", ")}.` : "No room has settings."} /chat set <room> <setting> <value>`);
  const room = state.fn.get(id);
  const schema = room.manifest.settings ?? {};
  const keys = Object.keys(schema);
  if (!keys.length) return say(`${room.manifest.name} has no settings.`);
  const [key, ...rest] = words;
  if (!key) {
    return say([`${room.manifest.name} settings:`, ...keys.map((k) => `  ${k}: ${showSetting(room.settings[k] ?? schema[k].default)}`), `Change one with ${c} <setting> <value>.`].join("\n"));
  }
  const k = key.toLowerCase();
  if (!keys.includes(k)) return say(`${room.manifest.name} has no setting ${key}. It has ${keys.join(", ")}.`);
  const st = schema[k];
  if (!rest.length) {
    const how = st.type === "list" ? "a list split by commas, +one to add, -one to drop" : st.type === "enum" ? st.values.join(", ") : st.type === "bool" ? "on or off" : st.type;
    return say(`${st.label ?? k}: ${showSetting(room.settings[k] ?? st.default)}. Set it with ${c} ${k} <${how}>, or ${c} ${k} default.`);
  }
  const r = await call("/fnroom/settings", { room: id, key: k, value: rest.join(" ") });
  room.settings = r.values ?? room.settings;
  return say(`${st.label ?? k}: ${showSetting(room.settings[k])}.`);
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
  if (targets.length && verb === "cancel") return say(`${c} cancel takes no room.`);
  // "/share to #room" points what's waiting at another room, "/share send #room" sends it there.
  if (verb === "to" || (verb === "send" && targets.length)) {
    if (!targets.length) return say(`Name the room: ${c} to #room.`);
    const r = retargetShare(targets[0].slice(1));
    if (typeof r === "string") return say(r);
    if (verb === "to") return say(`It will go to #${r.slug}. ${c} send to post it.`);
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
  if (roomIds().includes(verb)) {
    snippet = { kind: "code", lang: verb.slice(0, 20), body: snapshotText(verb) };
  } else if (verb === "diff") {
    const body = String(await sources.diff(rest.join(" ")) ?? "").replace(/\n$/, "");
    if (!body.trim()) return say(rest.length ? `No uncommitted changes in ${rest.join(" ")}.` : "No uncommitted changes to share.");
    snippet = { kind: "diff", lang: "diff", body };
  } else if (verb) {
    return say(`Use ${c} [#room], ${c} diff [path] [#room], ${c} ${roomIds().join("|")} [#room], ${c} to #room, ${c} send [#room] or ${c} cancel.`);
  } else {
    const selected = String(await sources.selection() ?? "").replace(/^(\s*\n)+/, "").trimEnd();
    if (selected.trim()) snippet = looksLikeDiff(selected) ? { kind: "diff", lang: "diff", body: selected } : { kind: "code", lang: null, body: selected };
    else {
      const block = lastCodeBlock(await sources.messages());
      if (!block?.body.trim()) return say(`Select some text first, or ask Claude for some code. ${c} diff shares your uncommitted changes.`);
      snippet = { kind: "code", ...block };
    }
  }
  return stageShare(snippet, room, say, { inPane: sources.inPane, c });
}

// Holds a snippet for a look before it goes to `room`: the pane draws a
// preview card, a slash command answers with a few lines of it.
function stageShare(snippet, room, say, { inPane = false, c = inPane ? "/share" : "/chat-share" } = {}) {
  const big = tooBig(snippet.body);
  if (big) return say(`Too big to share: ${big}.${snippet.kind === "diff" ? ` Share one file with ${c} diff <path>.` : " Select a smaller part."}`);

  const secret = findSecret(snippet.body);
  state.pendingShare = { ...snippet, room: room.id, slug: room.slug, secret, confirmed: false, until: Date.now() + SHARE_HOLD_MS };
  // The pane draws its own preview card: say only what needs saying.
  if (inPane) return secret ? say(`⚠ It looks like it has ${secret}. Check it before you send.`) : undefined;
  const preview = displayLines(snippet.body, snippet.kind).slice(0, 3).map((l) => `  │ ${l.slice(0, 100)}`);
  return say([
    `Ready to share to #${room.slug}: ${snippetTitle(snippet)}`,
    ...preview,
    ...(secret ? [`⚠ It looks like it has ${secret}. Check it before you send.`] : []),
    `${c} send to post it, ${c} to #room to pick another room, ${c} cancel to drop it.`,
  ].join("\n"));
}

// Something from a function room (a saved snippet's ⇪) to share: held for a
// look like any snippet, for the current room or `target` ("#room").
export function shareItem(item, say, { inPane = false, target = null } = {}) {
  requireSignedIn();
  let room = currentRoom();
  if (target) {
    const name = target.replace(/^#/, "").toLowerCase();
    room = state.rooms.find((r) => r.slug === name);
    if (!room) return say(`You're not in #${name}. Join it first: /room ${name} <passcode>`);
  }
  if (!room) return say("Join a room first: /room <name> <passcode>");
  return stageShare({ kind: "code", lang: item.lang ?? null, body: String(item.body ?? "") }, room, say, { inPane });
}

// ---------------------------------------------------------------- the Snippet room

const SNIPPET_HELP = "Use /snippet add <name>, /snippet rename <old> -> <new>, /snippet delete <name>, /snippet copy <name> or /snippet share <name> [#room].";

// "/snippet add <name>" saves what's selected, or else the last code block
// in Claude's reply. The list stays on this computer, in the Snippet room.
// `copy(text)` puts text on the clipboard, `setView(id)` shows a room.
export async function snippet(call, args, say, { sources, copy, setView, inPane = false } = {}) {
  const [verb = "", ...rest] = String(args ?? "").trim().split(/\s+/).filter(Boolean);
  const name = rest.filter((w) => !(verb.toLowerCase() === "share" && w.startsWith("#"))).join(" ");
  if (!isFnRoom("snippet")) return say("The Snippet room hasn't loaded yet. Try again in a moment.");
  const act = (action, a) => call("/fnroom/action", { room: "snippet", provider: "list", action, args: a });
  const find = async (n) => {
    if (!n) return null;
    let items = state.fn.get("snippet")?.data.list?.items;
    if (!items) items = (await call("/fnroom/refresh", { room: "snippet" })).data?.list?.items ?? [];
    return items.find((x) => x.name.toLowerCase() === n.toLowerCase()) ?? null;
  };
  switch (verb.toLowerCase()) {
    case "": {
      if (!state.sysRooms.includes("snippet")) return say("The Snippet room is hidden. Bring it back with /chat rooms +snippet.");
      return setView?.("snippet");
    }
    case "add": case "save": {
      if (!name) return say("Name it: /snippet add <name>");
      const selected = String(await sources.selection() ?? "").replace(/^(\s*\n)+/, "").trimEnd();
      const block = selected.trim() ? { body: selected, lang: null } : lastCodeBlock(await sources.messages());
      if (!block?.body?.trim()) return say("Select some text first, or ask Claude for some code.");
      const r = await act("add", { name, body: block.body, lang: block.lang ?? null });
      const lines = r.item.body.split("\n").length;
      const secret = findSecret(r.item.body);
      return say(`Saved "${r.item.name}"${r.item.lang ? ` (${r.item.lang})` : ""}, ${lines} line${lines === 1 ? "" : "s"}.${secret ? ` ⚠ It looks like it has ${secret}. It stays on this computer, but check it before you share it.` : ""}`);
    }
    case "delete": case "remove": case "rm": {
      if (!name) return say("Which one? /snippet delete <name>");
      const r = await act("delete", { name });
      return say(`Deleted "${r.item.name}".`);
    }
    case "rename": case "mv": {
      const m = /^(.+?)\s*(?:->|→)\s*(.+)$/.exec(name) ?? (rest.length === 2 ? [null, rest[0], rest[1]] : null);
      if (!m) return say("Use /snippet rename <old name> -> <new name>");
      const r = await act("rename", { name: m[1].trim(), to: m[2].trim() });
      return say(`Renamed it "${r.item.name}".`);
    }
    case "copy": case "cp": {
      const item = await find(name);
      if (!item) return say(name ? `No snippet called "${name}".` : "Which one? /snippet copy <name>");
      return copy?.(item.body);
    }
    case "share": {
      const item = await find(name);
      if (!item) return say(name ? `No snippet called "${name}".` : "Which one? /snippet share <name> [#room]");
      return shareItem(item, say, { inPane, target: rest.find((w) => w.startsWith("#")) ?? null });
    }
    default:
      return say(SNIPPET_HELP);
  }
}

// ---------------------------------------------------------------- the Lo-fi room

const LOFI_HELP = "Use /lofi play [name], pause, next, prev, stop, vol <0-100>, add <url, file or folder> [# name], remove <name> or import (Pixel Play's playlist).";

// "/lofi add <url or path>", "/lofi play Groove Salad", "/lofi vol 40": the
// Lo-fi room's player, from the prompt or the pane.
export async function lofi(call, args, say, { setView } = {}) {
  const text = String(args ?? "").trim();
  const [verb = "", ...rest] = text.split(/\s+/).filter(Boolean);
  const arg = rest.join(" ");
  if (!isFnRoom("lofi")) return say("The Lo-fi room hasn't loaded yet. Try again in a moment.");
  const act = (action, a = {}) => call("/fnroom/action", { room: "lofi", provider: "p", action, args: a });
  switch (verb.toLowerCase()) {
    case "": {
      if (!state.sysRooms.includes("lofi")) return say("The Lo-fi room is hidden. Bring it back with /chat rooms +lofi.");
      return setView?.("lofi");
    }
    case "play": {
      const r = await act("play", arg ? { name: arg } : {});
      return say(r.playing ? `Playing ${r.playing}.` : "Playing.");
    }
    case "pause": case "stop": case "next": case "prev":
      await act(verb.toLowerCase());
      return undefined;
    case "vol": case "volume": {
      if (!/^\d{1,3}$/.test(arg)) return say("Use /lofi vol <0-100>.");
      await act("volume", { level: Number(arg) });
      return say(`Volume ${arg}.`);
    }
    case "add": {
      const [target, ...name] = arg.split(" # ");
      if (!target.trim()) return say("Add what? /lofi add <url, file or folder> [# name]");
      const r = await act("add", { target: target.trim(), name: name.join(" # ").trim() || undefined });
      return say(r.added > 1 ? `Added ${r.added} tracks.` : `Added "${r.first}".`);
    }
    case "remove": case "rm": {
      if (!arg) return say("Which one? /lofi remove <name>");
      const r = await act("remove", { name: arg });
      return say(`Removed "${r.removed}".`);
    }
    case "import": {
      const r = await act("import");
      return say(r.added ? `Added ${r.added} from Pixel Play's playlist.` : "Everything in Pixel Play's playlist is already here.");
    }
    default:
      return say(LOFI_HELP);
  }
}

// Points the waiting snippet at another of your rooms, by slug or id.
// Returns the room, or what went wrong.
export function retargetShare(nameOrId) {
  const p = state.pendingShare;
  if (!p || Date.now() > p.until) return "Nothing waiting to share.";
  const name = String(nameOrId).toLowerCase();
  const room = state.rooms.find((r) => r.id === nameOrId || r.slug === name);
  if (!room) return `You're not in #${name}. Join it first: /room ${name} <passcode>`;
  if (room.id !== p.room) Object.assign(p, { room: room.id, slug: room.slug, confirmed: false });
  return room;
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
  if (!state.sysRooms.includes(view)) return say(`The ${view} room is hidden. Bring it back with /chat rooms +${view}.`);
  return setView?.(view);
}

const HELP = "/room [name] [passcode] · /room leave|delete <name> · /who · /name <new name> · /dnd on|off|auto · /share [diff|usage|git|agents|snippet] [#room] · /share to #room · /snippet add|rename|delete|copy|share · /lofi play|pause|next|add|import · /set <setting> <value> (in a room with settings) · /usage · /git · /agents · /chat · /logout · anything else is a message";

// The pane's input box: commands, the sign-in steps, or a message.
// `setView(id)` shows a built-in or function room ("chat" for the chat),
// `refreshGit()` fetches the Git room again, `refreshRoom(id)` a function
// room, `copy(text)` puts text on the clipboard.
export async function paneInput(call, value, say, { setDnd, sources, setView, refreshGit, refreshRoom, copy } = {}) {
  const text = String(value ?? "").trim();
  if (!text) return;
  const view = activeView();
  if (view === "git" && /^r(efresh)?$/i.test(text)) return refreshGit?.();
  if (isFnRoom(view) && /^r(efresh)?$/i.test(text)) return refreshRoom?.(view);
  // A room's own keys: "p" in Lo-fi plays or pauses.
  const key = isFnRoom(view) && text.length === 1 ? state.fn.get(view).manifest.layout.keys?.[text.toLowerCase()] : null;
  if (key) return call("/fnroom/action", { room: view, action: key, args: {} });
  const m = /^\/([\w-]+)\s*([\s\S]*)$/.exec(text);
  if (m) {
    const [, cmd, args] = m;
    switch (cmd) {
      case "usage": case "git": case "agents": return showView(cmd, say, setView);
      case "chat": {
        // "/chat git" typed here does what it does at the prompt.
        const [sub, ...more] = args.trim().toLowerCase().split(/\s+/).filter(Boolean);
        if (!sub || sub === "chat") return setView?.("chat");
        if (roomIds().includes(sub)) return showView(sub, say, setView);
        if (sub === "dnd") return dnd(more.join(" "), say, setDnd);
        if (sub === "store") return roomStore(call, more.join(" "), say);
        return say(`Here, /chat takes ${roomIds().join(", ")} or dnd. Type it at the prompt for the rest.`);
      }
      case "room": return room(call, args, say);
      case "who": return who(say);
      case "login": case "chat-login": return login(call, args, say);
      case "logout": case "chat-logout": return logout(call, say);
      case "name": case "chat-name": return rename(call, args, say);
      case "say": return sendMessage(call, args, say);
      case "dnd": return dnd(args, say, setDnd);
      case "share": return share(call, args, say, sources);
      case "snippet": return snippet(call, args, say, { sources, copy, setView, inPane: true });
      case "lofi": return lofi(call, args, say, { setView });
      case "set": return roomSettings(call, args, say, { room: isFnRoom(view) ? view : null });
      case "help": return say(HELP);
      default:
        if (isFnRoom(cmd)) return showView(cmd, say, setView);
        return say(`Unknown command /${cmd}. Try /help.`);
    }
  }
  if (view !== "chat") return say(`This is the ${view} room: type a command (/help), or pick a chat room to talk.`);
  // The pane itself shows each sign-in step, so only errors (thrown) need words.
  if (state.auth === "signed_out" || state.auth === "code_sent") return login(call, text, () => {});
  return sendMessage(call, text, say);
}
