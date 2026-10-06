// Phase 0 spike bridge: proves the mod <-> child process plumbing before any
// Supabase code exists. Events go out on stdout as NDJSON; the mod sends
// control requests over HTTP on a private Unix socket.
//
// Run by the mod as: node spike-bridge.mjs   (env SQUAD_BRIDGE_TOKEN set)

import { createServer } from "node:http";
import { mkdirSync, rmSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const token = process.env.SQUAD_BRIDGE_TOKEN;
if (!token) {
  emit({ type: "error", message: "SQUAD_BRIDGE_TOKEN is not set" });
  process.exit(2);
}

// Socket paths are limited to ~100 bytes, so use /tmp rather than macOS's
// long per-user TMPDIR.
const dir = join(process.platform === "darwin" ? "/tmp" : tmpdir(), `squad-chat-${process.getuid?.() ?? "u"}`);
mkdirSync(dir, { recursive: true, mode: 0o700 });
chmodSync(dir, 0o700);
const socketPath = join(dir, `${process.pid}.sock`);
rmSync(socketPath, { force: true });

function emit(event) {
  process.stdout.write(JSON.stringify(event) + "\n");
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (c) => { data += c; if (data.length > 64 * 1024) req.destroy(); });
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
  try {
    if (req.method === "GET" && req.url === "/ping") return reply(200, { ok: true, pid: process.pid });
    if (req.method === "POST" && req.url === "/send") {
      const { text } = JSON.parse((await readBody(req)) || "{}");
      if (typeof text !== "string" || !text.trim()) return reply(400, { error: "empty message" });
      const message = { id: Date.now(), user: "me", body: text.slice(0, 500), at: new Date().toISOString() };
      emit({ type: "message", message });
      return reply(200, { ok: true, id: message.id });
    }
    if (req.method === "POST" && req.url === "/shutdown") {
      reply(200, { ok: true });
      return shutdown(0);
    }
    return reply(404, { error: "not found" });
  } catch (err) {
    return reply(500, { error: String(err?.message ?? err) });
  }
});

let n = 0;
const tick = setInterval(() => emit({ type: "tick", n: ++n }), 5000);

// The mod's spawn closes stdin from the start, so it can't signal our end.
// When the parent dies we get re-parented (ppid 1 on macOS/Linux): exit then.
const parent = process.ppid;
const watch = setInterval(() => { if (process.ppid !== parent) shutdown(0); }, 5000);

function shutdown(code) {
  clearInterval(tick);
  clearInterval(watch);
  server.close();
  rmSync(socketPath, { force: true });
  process.exit(code);
}
process.on("SIGTERM", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));

server.listen(socketPath, () => {
  chmodSync(socketPath, 0o600);
  emit({ type: "ready", socket: socketPath, pid: process.pid });
});
