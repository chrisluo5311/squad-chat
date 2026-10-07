// supabase-js auth storage backed by files in the squad-chat config dir.
// Each key is one JSON file, written 0600 via temp file + rename so a reader
// in another bridge never sees half a session.

import { mkdirSync, chmodSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

export function fileStorage(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const path = (key) => join(dir, `${key.replace(/[^\w.-]/g, "_")}.json`);
  return {
    getItem(key) {
      try { return readFileSync(path(key), "utf8"); } catch { return null; }
    },
    setItem(key, value) {
      const tmp = `${path(key)}.${process.pid}.tmp`;
      writeFileSync(tmp, value, { mode: 0o600 });
      renameSync(tmp, path(key));
    },
    removeItem(key) {
      rmSync(path(key), { force: true });
    },
  };
}
