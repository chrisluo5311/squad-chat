// Pulls content the site shares with the repository, so neither is kept twice in git:
// the README's GIFs and screenshots go to public/media, docs/ARCHITECTURE.md
// becomes the Architecture page, and rooms/index.json the Room store page.
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const media = new URL("../public/media/", import.meta.url);
mkdirSync(media, { recursive: true });
for (const dir of ["assets", "screenshots"]) {
  cpSync(new URL(`../../docs/${dir}/`, import.meta.url), media, { recursive: true });
}

const repo = "https://github.com/chrisluo5311/squad-chat/blob/main/";
const body = readFileSync(new URL("../../docs/ARCHITECTURE.md", import.meta.url), "utf8")
  .replace(/^# .*\n+/, "")
  .replace(/^How squad-chat fits together.*\n+/m, "")
  .replace(/```mermaid\n([\s\S]*?)```/g, (_, src) => `<pre class="mermaid">\n${src.replace(/</g, "&lt;")}</pre>`)
  .replace(/\]\(\.\.\/([^)]+)\)/g, `](${repo}$1)`);

writeFileSync(
  new URL("../src/content/docs/reference/architecture.md", import.meta.url),
  `---
title: Architecture
description: How the mod, the bridge process and Supabase fit together, and why.
editUrl: ${repo.replace("/blob/", "/edit/")}docs/ARCHITECTURE.md
head:
  - tag: script
    attrs:
      type: module
    content: |
      import mermaid from "https://cdn.jsdelivr.net/npm/mermaid@11.4.1/dist/mermaid.esm.min.mjs";
      const dark = document.documentElement.dataset.theme !== "light";
      mermaid.initialize({ startOnLoad: true, theme: dark ? "dark" : "neutral", fontFamily: "Geist, system-ui, sans-serif" });
---

<!-- Generated from docs/ARCHITECTURE.md by site/scripts/sync.mjs. Edit that file instead. -->

${body}`,
);

// The room store, from the index the bridge reads.
const { rooms } = JSON.parse(readFileSync(new URL("../../rooms/index.json", import.meta.url), "utf8"));
// A table cell's text: backslashes first, then the pipes that would split the cell.
const cell = (t) => String(t).replace(/\\/g, "\\\\").replace(/\|/g, "\\|");
writeFileSync(
  new URL("../src/content/docs/rooms/store.md", import.meta.url),
  `---
title: Room store
description: Rooms other people wrote, to install from Claude Code with /chat install.
editUrl: ${repo.replace("/blob/", "/edit/")}rooms/
---

<!-- Generated from rooms/index.json by site/scripts/sync.mjs. Add a room under rooms/ instead. -->

These rooms come from the [room store](${repo}rooms/), a folder in squad-chat's repository. Each is a manifest: it can use only the providers squad-chat ships, reach only the hosts it names, and draw only with the pane's widgets, so installing one never runs anyone's code. \`/chat store\` lists them in Claude Code, and \`/chat install <id>\` shows a room, with the hosts it reaches, before it installs.

| Room | Install | What it is | Reaches | Version |
| --- | --- | --- | --- | --- |
${rooms.map((r) => `| ${cell(r.icon)} **${cell(r.name)}** | \`/chat install ${r.id}\` | ${cell(r.description)} | ${r.hosts.map((h) => `\`${h}\``).join(", ") || "nothing"} | ${r.version} |`).join("\n")}

Want yours here? [Write a room](/squad-chat/rooms/write-a-room/) shows how.
`,
);
