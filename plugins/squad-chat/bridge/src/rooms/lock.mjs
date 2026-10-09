// A lock between the bridges of every session on this computer, for a file
// they all change: a folder made beside it (making one is atomic). A lock
// left by a bridge that died holding it is dropped after a while.

import { mkdirSync, chmodSync, rmdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { RoomError } from "./net.mjs";

const WAIT_MS = 5_000;
const STALE_MS = 15_000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs `fn` holding `<dir>/<name>.lock`: read, change and write as one step.
export async function locked(dir, name, fn) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const lock = join(dir, `${name}.lock`);
  const until = Date.now() + WAIT_MS;
  for (;;) {
    try { mkdirSync(lock); break; }
    catch (err) {
      if (err.code !== "EEXIST") throw err;
      try { if (Date.now() - statSync(lock).mtimeMs > STALE_MS) { rmdirSync(lock); continue; } } catch { continue; }
      if (Date.now() > until) throw new RoomError(503, "Another session is changing this. Try again in a moment.");
      await sleep(20 + Math.random() * 30);
    }
  }
  try { return await fn(); } finally { try { rmdirSync(lock); } catch { /* already gone */ } }
}
