#!/usr/bin/env node
// PreToolUse (Edit|Write|MultiEdit): a migration that already exists has been applied somewhere,
// so it is never edited. Changes go in a new migration (CONTRIBUTING.md).
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const input = JSON.parse(readFileSync(0, "utf8") || "{}");
const file = input.tool_input?.file_path;
if (file) {
  const path = resolve(input.cwd ?? process.cwd(), file);
  if (/\/supabase\/migrations\/[^/]+\.sql$/.test(path) && existsSync(path)) {
    const name = path.split("/").pop();
    console.log(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason:
          `supabase/migrations/${name} is an existing migration and may already be applied. ` +
          "Leave it as it is and put the change in a new one: `supabase migration new <name>`, " +
          "with pgTAP tests in supabase/tests/ for any new access rule.",
      },
    }));
  }
}
