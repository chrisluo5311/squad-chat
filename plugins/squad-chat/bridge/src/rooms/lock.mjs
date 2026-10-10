// A lock between the bridges of every session on this computer, for a file
// they all change: a folder made beside it (making one is atomic), holding
// an `owner` file with the holder's pid and a token of its own.
//
//   * A lock is stale only when its holder is gone (its pid no longer runs),
//     never because it's slow: a live holder keeps it, however long.
//   * A stale lock is broken by renaming it aside, which only one waiter can
//     do. The winner then checks what it moved: if it wasn't the dead
//     holder's after all (another waiter broke it and took a new one in
//     between), it puts it back.
//   * Releasing removes the lock only while it's still this holder's.

import { mkdirSync, chmodSync, rmSync, readFileSync, writeFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { RoomError } from "./net.mjs";

const WAIT_MS = 5_000;
const NO_OWNER_MS = 15_000;   // a lock with no owner file yet, from a holder that died making it

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (err) { return err.code === "EPERM"; }
}

function ownerOf(dir) {
  try {
    const [pid, token] = readFileSync(join(dir, "owner"), "utf8").trim().split(":");
    return { pid: Number(pid), token };
  } catch { return null; }
}

function stale(dir) {
  const o = ownerOf(dir);
  if (o) return !alive(o.pid);
  try { return Date.now() - statSync(dir).mtimeMs > NO_OWNER_MS; } catch { return false; }
}

// Runs `fn` holding `<dir>/<name>.lock`: read, change and write as one step.
export async function locked(dir, name, fn) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const lock = join(dir, `${name}.lock`);
  const token = randomBytes(8).toString("hex");
  const until = Date.now() + WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, "owner"), `${process.pid}:${token}`);
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      if (stale(lock)) {
        const aside = `${lock}.${process.pid}.${token}.stale`;
        try { renameSync(lock, aside); } catch { continue; }   // another waiter got there first
        if (stale(aside)) rmSync(aside, { recursive: true, force: true });
        else { try { renameSync(aside, lock); } catch { rmSync(aside, { recursive: true, force: true }); } }
        continue;
      }
      if (Date.now() > until) throw new RoomError(503, "Another session is changing this. Try again in a moment.");
      await sleep(20 + Math.random() * 30);
    }
  }
  try { return await fn(); } finally {
    if (ownerOf(lock)?.token === token) rmSync(lock, { recursive: true, force: true });
  }
}
