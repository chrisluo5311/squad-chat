// Every Claude Code session on this computer, for the Agents room. Each
// bridge keeps its session's latest heartbeat as a file in one shared,
// private folder, watches the folder, and reports the set to its mod as a
// "sessions" event. A file whose bridge is gone, or that hasn't been written
// for a while, is dropped.

import { mkdirSync, chmodSync, writeFileSync, renameSync, readdirSync, readFileSync, statSync, rmSync, watch } from "node:fs";
import { join } from "node:path";

const ID = /^[A-Za-z0-9_-]{1,100}$/;
const MAX_BEAT = 32 * 1024;

function alive(pid) {
  try { process.kill(pid, 0); return true; }
  catch (err) { return err.code === "EPERM"; }
}

export function sessionBoard({ dir, emit, pid = process.pid, staleMs = 30_000, reportMs = 10_000, debounceMs = 250 }) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  let ownId = null;
  let timer = null;

  function read() {
    const now = Date.now();
    const out = [];
    let names = [];
    try { names = readdirSync(dir).filter((n) => n.endsWith(".json")); } catch { return out; }
    for (const name of names) {
      const file = join(dir, name);
      try {
        const age = now - statSync(file).mtimeMs;
        const data = JSON.parse(readFileSync(file, "utf8"));
        if (age > staleMs || !Number.isInteger(data.pid) || !alive(data.pid)) {
          rmSync(file, { force: true });
          continue;
        }
        out.push(data);
      } catch {
        // Half-written by another bridge, or just removed: next time.
      }
    }
    return out;
  }

  function report() {
    clearTimeout(timer);
    timer = null;
    emit({ type: "sessions", sessions: read() });
  }

  function schedule() {
    if (!timer) timer = setTimeout(report, debounceMs);
  }

  let watcher = null;
  try { watcher = watch(dir, schedule); } catch { /* the interval still reports */ }
  const interval = setInterval(report, reportMs);

  return {
    // This session's heartbeat, written whole (a temporary file, then renamed).
    beat(hb) {
      if (!hb || !ID.test(String(hb.id ?? ""))) throw Object.assign(new Error("a heartbeat needs an id"), { status: 400 });
      const text = JSON.stringify({ ...hb, pid });
      if (text.length > MAX_BEAT) throw Object.assign(new Error("heartbeat too large"), { status: 413 });
      if (ownId && ownId !== hb.id) rmSync(join(dir, `${ownId}.json`), { force: true });
      ownId = hb.id;
      const file = join(dir, `${hb.id}.json`);
      const tmp = `${file}.${pid}.tmp`;
      writeFileSync(tmp, text, { mode: 0o600 });
      renameSync(tmp, file);
      schedule();
    },
    report,
    close() {
      watcher?.close();
      clearInterval(interval);
      clearTimeout(timer);
      if (ownId) rmSync(join(dir, `${ownId}.json`), { force: true });
    },
  };
}
