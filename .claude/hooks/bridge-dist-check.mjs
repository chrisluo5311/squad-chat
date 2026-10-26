#!/usr/bin/env node
// Stop: when bridge/src has uncommitted changes, rebuild into a temp file and compare it with
// the committed bundle. CI fails when dist/bridge.mjs doesn't match the source, so catch it here.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
if (input.stop_hook_active) process.exit(0);

const root = process.env.CLAUDE_PROJECT_DIR ?? input.cwd ?? process.cwd();
const bridge = join(root, "plugins/squad-chat/bridge");
const esbuild = join(bridge, "node_modules/.bin/esbuild");
if (!existsSync(esbuild)) process.exit(0);

const status = spawnSync("git", ["status", "--porcelain", "--", "src", "dist"], { cwd: bridge, encoding: "utf8" });
if (status.status !== 0 || !status.stdout.trim()) process.exit(0);

const block = (reason) => {
  console.log(JSON.stringify({ decision: "block", reason }));
  process.exit(0);
};

const dir = mkdtempSync(join(tmpdir(), "bridge-check-"));
try {
  const out = join(dir, "bridge.mjs");
  const script = JSON.parse(readFileSync(join(bridge, "package.json"), "utf8")).scripts.build;
  const args = script.split(/\s+/).slice(1).map((a) => (a.startsWith("--outfile=") ? `--outfile=${out}` : a));
  const build = spawnSync(esbuild, [...args, "--log-level=error"], { cwd: bridge, encoding: "utf8" });
  if (build.status !== 0) {
    block(`The bridge doesn't build:\n${build.stderr.trim()}\nFix plugins/squad-chat/bridge/src, then run \`npm run build\` there.`);
  }
  if (!readFileSync(out).equals(readFileSync(join(bridge, "dist/bridge.mjs")))) {
    block(
      "plugins/squad-chat/bridge/src changed but dist/bridge.mjs wasn't rebuilt. " +
      "Run `npm run build` in plugins/squad-chat/bridge and commit dist/bridge.mjs with the source (CI checks they match).",
    );
  }
} finally {
  rmSync(dir, { recursive: true, force: true });
}
