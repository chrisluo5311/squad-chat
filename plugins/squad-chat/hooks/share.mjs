// Snippets: code or a diff from the session, shared to a room as one
// message. Plain logic: what to share, how it's titled, and whether it looks
// like it holds a secret.

export const MAX_SNIPPET = 8000;
export const MAX_SNIPPET_LINES = 200;
const LANG = /^[a-z0-9+#._-]{1,20}$/;

// The last fenced code block in Claude's latest reply that has one.
export function lastCodeBlock(messages) {
  for (let i = (messages?.length ?? 0) - 1; i >= 0; i--) {
    const m = messages[i];
    if (m?.role !== "assistant") continue;
    const blocks = [...String(m.text ?? "").matchAll(/```([^\n`]*)\n([\s\S]*?)```/g)];
    if (!blocks.length) continue;
    const [, info, body] = blocks.at(-1);
    return { body: body.replace(/\n$/, ""), lang: tag(info) };
  }
  return null;
}

// "ts" from "ts title=x.ts", lowercased; null for anything that isn't a short word.
export function tag(info) {
  const word = String(info ?? "").trim().split(/\s+/)[0].toLowerCase();
  return LANG.test(word) ? word : null;
}

export function looksLikeDiff(text) {
  return /^(diff --git |@@ -\d|--- a\/|\+\+\+ b\/)/m.test(String(text));
}

// "--- a/x", "+++ b/x", "--- /dev/null": git's file headers, not a removed
// line that happens to start with "--".
const FILE_HEADER = /^(---|\+\+\+) (a\/|b\/|\/dev\/null)/;

// Files touched and lines added and removed, read from a unified diff.
export function diffStats(body) {
  let files = 0, added = 0, removed = 0;
  for (const line of String(body).split("\n")) {
    if (line.startsWith("diff --git ")) files++;
    else if (FILE_HEADER.test(line)) continue;
    else if (line.startsWith("+")) added++;
    else if (line.startsWith("-")) removed++;
  }
  return { files, added, removed };
}

// The lines a person reads: tabs as two spaces, and for a diff each file as
// "▸ path" with its changes, without git's header lines.
export function displayLines(body, kind = "code") {
  const all = String(body).replace(/\t/g, "  ").split("\n");
  if (kind !== "diff") return all;
  return all.flatMap((line) => {
    const file = /^diff --git a\/(.+?) b\//.exec(line);
    if (file) return [`▸ ${file[1]}`];
    return FILE_HEADER.test(line) || /^(index |new file mode|deleted file mode|similarity index|rename (from|to) )/.test(line) ? [] : [line];
  });
}

export function lineCount(body) {
  return String(body).split("\n").length;
}

// "diff · 3 files +42 −7", "code · ts · 12 lines".
export function snippetTitle({ kind, lang, body }) {
  if (kind === "diff") {
    const { files, added, removed } = diffStats(body);
    const where = files ? `${files} file${files === 1 ? "" : "s"} ` : "";
    return `diff · ${where}+${added} −${removed}`;
  }
  const n = lineCount(body);
  return ["code", lang, `${n} line${n === 1 ? "" : "s"}`].filter(Boolean).join(" · ");
}

// What a one-line view shows for a message: its text, or the snippet's title.
export function oneLine(m) {
  return !m.kind || m.kind === "text" ? m.body : `📎 ${snippetTitle(m)}`;
}

// Things that shouldn't leave the computer. Each match names what it looks
// like, for the warning.
const SECRETS = [
  [/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/, "an API key"],
  [/\bsb_secret_[A-Za-z0-9_-]{10,}/, "a Supabase secret key"],
  [/\b(?:ghp|gho|ghs|github_pat)_[A-Za-z0-9_]{20,}/, "a GitHub token"],
  [/\bAKIA[0-9A-Z]{16}\b/, "an AWS access key"],
  [/\bxox[abprs]-[A-Za-z0-9-]{10,}/, "a Slack token"],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, "a private key"],
  [/^\+?\s*(?:export\s+)?[A-Z][A-Z0-9_]*(?:SECRET|TOKEN|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*\s*=\s*\S{8,}/m, "a secret in an env file"],
];

export function findSecret(body) {
  for (const [pattern, what] of SECRETS) if (pattern.test(body)) return what;
  return null;
}

// Why a snippet can't be shared as it is, or null.
export function tooBig(body) {
  const lines = lineCount(body);
  if (lines > MAX_SNIPPET_LINES) return `that's ${lines} lines, more than ${MAX_SNIPPET_LINES}`;
  if (body.length > MAX_SNIPPET) return `that's ${body.length} characters, more than ${MAX_SNIPPET}`;
  return null;
}
