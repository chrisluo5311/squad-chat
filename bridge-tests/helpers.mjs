// Helpers for driving real bridge processes against the local Supabase
// stack (`supabase start`, ports 564xx).

import { spawn } from "node:child_process";
import { request } from "node:http";
import { createServer, connect } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

export const LOCAL_URL = "http://127.0.0.1:56421";
// The local stack's dev key. CI passes the one `supabase status` reports.
export const LOCAL_KEY = process.env.SQUAD_TEST_SUPABASE_KEY || "sb_publishable_ACJWlzQHlZjBrEguHvfOxg_3BJgxAaH";
const MAILPIT = "http://127.0.0.1:56424";
const BRIDGE = join(dirname(fileURLToPath(import.meta.url)), "../plugins/squad-chat/bridge/dist/bridge.mjs");
const ROOMS = join(dirname(fileURLToPath(import.meta.url)), "../plugins/squad-chat/rooms");

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const runId = () => randomBytes(3).toString("hex");

export async function localStackUp() {
  try { return (await fetch(`${LOCAL_URL}/auth/v1/health`, { headers: { apikey: LOCAL_KEY } })).ok; }
  catch { return false; }
}

// One bridge process. Keeps every NDJSON event it printed.
export class Bridge {
  // `url: null` starts it without a server (heartbeats only); `sessionsDir`
  // shares the sessions' heartbeat folder between bridges.
  constructor(name, { url = LOCAL_URL, configDir, sessionsDir, roomsDir = ROOMS } = {}) {
    this.name = name;
    this.roomsDir = roomsDir;
    this.url = url;
    this.sessionsDir = sessionsDir;
    this.configDir = configDir ?? mkdtempSync(join(tmpdir(), `sq-${name}-`));
    this.socketDir = mkdtempSync("/tmp/sqs-");    // short: socket paths max ~100 bytes
    this.token = randomBytes(16).toString("hex");
    this.events = [];
    this.stderr = "";
    this.waiters = new Set();
  }

  start() {
    this.events = [];
    const env = {
      ...process.env,
      SQUAD_BRIDGE_TOKEN: this.token,
      SQUAD_SUPABASE_URL: this.url ?? "",
      SQUAD_SUPABASE_KEY: this.url ? LOCAL_KEY : "",
      SQUAD_CONFIG_DIR: this.configDir,
      SQUAD_SOCKET_DIR: this.socketDir,
      SQUAD_REFRESH_MS: "2000",   // notice deleted rooms quickly
    };
    if (this.sessionsDir) env.SQUAD_SESSIONS_DIR = this.sessionsDir;
    if (this.roomsDir) env.SQUAD_ROOMS_DIR = this.roomsDir;
    this.child = spawn(process.execPath, [BRIDGE], { env, stdio: ["ignore", "pipe", "pipe"] });
    this.exited = new Promise((r) => this.child.on("exit", (code, signal) => r({ code, signal })));
    let buf = "";
    this.child.stdout.setEncoding("utf8").on("data", (chunk) => {
      buf += chunk;
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        const event = JSON.parse(line);
        this.events.push(event);
        if (event.type === "ready") this.socket = event.socket;
        for (const w of this.waiters) w();
      }
    });
    this.child.stderr.setEncoding("utf8").on("data", (c) => { this.stderr += c; });
    return this.waitFor((e) => e.type === "ready");
  }

  // Resolves with the first event (past or future) matching `pred`.
  waitFor(pred, timeout = 15_000, what = "event") {
    return new Promise((resolve, reject) => {
      const check = () => {
        const hit = this.events.find(pred);
        if (hit) { done(); resolve(hit); }
      };
      const timer = setTimeout(() => {
        done();
        reject(new Error(`${this.name}: timed out after ${timeout} ms waiting for ${what}\nlast events: ${JSON.stringify(this.events.slice(-5))}\nstderr: ${this.stderr.slice(-500)}`));
      }, timeout);
      const done = () => { clearTimeout(timer); this.waiters.delete(check); };
      this.waiters.add(check);
      check();
    });
  }

  messages(roomId) {
    return this.events.filter((e) => e.type === "message" && (!roomId || e.message.room === roomId))
      .map((e) => ({ ...e.message, backfill: e.backfill }));
  }

  latestPresence(roomId) {
    return this.events.filter((e) => e.type === "presence" && e.room === roomId).at(-1)?.online ?? [];
  }

  call(method, path, body) {
    return new Promise((resolve, reject) => {
      const data = body === undefined ? undefined : JSON.stringify(body);
      const req = request({
        socketPath: this.socket, path, method,
        headers: { "x-squad-token": this.token, "content-type": "application/json" },
      }, (res) => {
        let text = "";
        res.setEncoding("utf8").on("data", (c) => { text += c; }).on("end", () => {
          resolve({ status: res.statusCode, body: text ? JSON.parse(text) : {} });
        });
      });
      req.on("error", reject);
      req.end(data);
    });
  }

  async ok(method, path, body) {
    const res = await this.call(method, path, body);
    if (res.status !== 200) throw new Error(`${this.name} ${method} ${path} → ${res.status} ${JSON.stringify(res.body)}`);
    return res.body;
  }

  async login(email) {
    const sentAt = Date.now();
    await this.ok("POST", "/login/start", { email });
    const code = await latestCode(email, sentAt);
    await this.ok("POST", "/login/verify", { code });
    return this.waitFor((e) => e.type === "auth" && e.state === "signed_in", 15_000, "signed_in");
  }

  async stop() {
    if (this.child && this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGTERM");
      await this.exited;
    }
  }

  cleanup() {
    rmSync(this.configDir, { recursive: true, force: true });
    rmSync(this.socketDir, { recursive: true, force: true });
  }
}

// The newest sign-in code mailed to `email` after `since`, read from Mailpit.
export async function latestCode(email, since, timeout = 10_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const { messages = [] } = await res.json();
    const fresh = messages.find((m) => Date.parse(m.Created) >= since - 1000);
    if (fresh) {
      const msg = await (await fetch(`${MAILPIT}/api/v1/message/${fresh.ID}`)).json();
      const code = msg.Text.match(/\b\d{6,10}\b/)?.[0];
      if (code) return code;
    }
    await sleep(250);
  }
  throw new Error(`no sign-in code for ${email}`);
}

// A TCP proxy in front of the local API that can drop every connection, to
// simulate the network going away.
export class CuttableProxy {
  constructor(target = { host: "127.0.0.1", port: 56421 }) {
    this.target = target;
    this.sockets = new Set();
    this.down = false;
    this.server = createServer((client) => {
      if (this.down) return client.destroy();
      const upstream = connect(this.target);
      for (const s of [client, upstream]) {
        this.sockets.add(s);
        s.on("close", () => this.sockets.delete(s));
        s.on("error", () => {});
      }
      client.pipe(upstream).pipe(client);
      client.on("close", () => upstream.destroy());
      upstream.on("close", () => client.destroy());
    });
  }

  listen() {
    return new Promise((r) => this.server.listen(0, "127.0.0.1", () => {
      this.url = `http://127.0.0.1:${this.server.address().port}`;
      r(this.url);
    }));
  }

  cut() {
    this.down = true;
    for (const s of this.sockets) s.destroy();
  }

  restore() {
    this.down = false;
  }

  close() {
    this.cut();
    return new Promise((r) => this.server.close(r));
  }
}
