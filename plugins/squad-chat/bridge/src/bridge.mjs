// squad-chat bridge: a Node child of the mod that holds the Supabase
// connection (the mod runtime has no WebSocket).
//
//   events  → stdout, one JSON object per line (NDJSON)
//   control ← HTTP on a private Unix socket; every request carries
//             x-squad-token: $SQUAD_BRIDGE_TOKEN
//
// Environment:
//   SQUAD_BRIDGE_TOKEN   required, per-run secret shared with the mod
//   SQUAD_SUPABASE_URL   default: the hosted squad-chat project
//   SQUAD_SUPABASE_KEY   publishable key for that project
//   SQUAD_CONFIG_DIR     session + prefs (default ~/.config/squad-chat)
//   SQUAD_SOCKET_DIR     where the socket goes (default /tmp/squad-chat-<uid>)
//   SQUAD_DEBUG=1        log Realtime traffic to stderr
//   SQUAD_REFRESH_MS     how often to refresh friends and rooms (tests)
//
// Built into dist/bridge.mjs (one file, dependencies bundled): npm run build

import { createServer } from "node:http";
import { mkdirSync, rmSync, chmodSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { Chat, HttpError } from "./chat.mjs";

const HOSTED_URL = "https://pijyocogpbiiwccfxqkp.supabase.co";
const HOSTED_KEY = "sb_publishable_AciVm_P47NRs-HCKooiNHQ_SNR1fxEQ";   // publishable: safe to ship
const MAX_BODY = 16 * 1024;

const env = process.env;
const token = env.SQUAD_BRIDGE_TOKEN;

function emit(event) {
  process.stdout.write(JSON.stringify(event) + "\n");
}
function log(text) {
  process.stderr.write(`${text}\n`);
}

if (!token) {
  emit({ type: "error", message: "SQUAD_BRIDGE_TOKEN is not set" });
  process.exit(2);
}

const configDir = env.SQUAD_CONFIG_DIR
  || join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "squad-chat");
// Socket paths are limited to ~100 bytes, so avoid macOS's long TMPDIR.
const socketDir = env.SQUAD_SOCKET_DIR
  || join(process.platform === "darwin" ? "/tmp" : tmpdir(), `squad-chat-${process.getuid?.() ?? "u"}`);
mkdirSync(socketDir, { recursive: true, mode: 0o700 });
chmodSync(socketDir, 0o700);
const socketPath = join(socketDir, `${process.pid}.sock`);
rmSync(socketPath, { force: true });

const chat = new Chat({
  url: env.SQUAD_SUPABASE_URL || HOSTED_URL,
  key: env.SQUAD_SUPABASE_KEY || HOSTED_KEY,
  configDir,
  emit,
  log,
  debug: env.SQUAD_DEBUG === "1",
});

// ------------------------------------------------------------ control API

const routes = {
  "GET /ping": () => ({ ok: true, pid: process.pid }),
  "GET /state": () => chat.snapshot(),
  "GET /who": () => ({ friends: chat.user ? chat.friendList() : [] }),
  "POST /login/start": (b) => chat.loginStart(b.email).then(() => ({ ok: true })),
  "POST /login/verify": (b) => chat.loginVerify(b.code, b.email).then(() => ({ ok: true, user: chat.snapshot().user })),
  "POST /logout": () => chat.logout().then(() => ({ ok: true })),
  "POST /room": (b) => chat.join(b.slug, b.passcode),
  "POST /room/select": (b) => (chat.selectRoom(b.room), { ok: true }),
  "POST /room/leave": (b) => chat.leave(b.room).then(() => ({ ok: true })),
  "POST /room/delete": (b) => chat.deleteRoom(b.room),
  "POST /send": (b) => chat.send(b.text, b.room),
  "POST /read": (b) => chat.markRead(b.room, b.last_id),
  "POST /shutdown": () => { setTimeout(() => shutdown(0), 0); return { ok: true }; },
};

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (c) => {
      data += c;
      if (data.length > MAX_BODY) { reject(new HttpError(413, "request too large")); req.destroy(); }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

const server = createServer(async (req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(body));
  };
  if (req.headers["x-squad-token"] !== token) return reply(401, { error: "bad token" });
  const route = routes[`${req.method} ${req.url}`];
  if (!route) return reply(404, { error: "not found" });
  try {
    const raw = req.method === "POST" ? await readBody(req) : "";
    let body = {};
    try { body = raw ? JSON.parse(raw) : {}; } catch { throw new HttpError(400, "body is not JSON"); }
    reply(200, (await route(body)) ?? { ok: true });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status === 500) log(err?.stack ?? String(err));
    reply(status, { error: err?.message ?? String(err) });
  }
});

// ------------------------------------------------------------ lifecycle

let stopping = false;
async function shutdown(code) {
  if (stopping) return;
  stopping = true;
  clearInterval(watch);
  server.close();
  rmSync(socketPath, { force: true });
  await chat.shutdown().catch(() => {});
  process.exit(code);
}
process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
process.on("unhandledRejection", (err) => log(`unhandled: ${err?.stack ?? err}`));

// The mod's spawn closes stdin from the start, so it can't signal our end.
// When the parent dies we get re-parented: exit then.
const parent = process.ppid;
const watch = setInterval(() => { if (process.ppid !== parent) shutdown(0); }, 5000);

server.listen(socketPath, () => {
  chmodSync(socketPath, 0o600);
  emit({ type: "ready", socket: socketPath, pid: process.pid });
  chat.start().catch((err) => emit({ type: "error", message: `startup failed: ${err.message}` }));
});
