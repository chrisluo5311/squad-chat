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
const rows = rooms.map((r) => `| ${cell(r.icon)} **${cell(r.name)}** | \`/chat install ${r.id}\` | ${cell(r.description)} | ${r.hosts.map((h) => `\`${h}\``).join(", ") || "nothing"} | ${r.version} |`).join("\n");
const store = { en: "rooms/store.md", zh: "zh-tw/rooms/store.md" };
mkdirSync(new URL("../src/content/docs/zh-tw/rooms/", import.meta.url), { recursive: true });
writeFileSync(
  new URL(`../src/content/docs/${store.en}`, import.meta.url),
  `---
title: Room store
description: Rooms written by the community, installable from Claude Code with /chat install.
---

<!-- Generated from rooms/index.json by site/scripts/sync.mjs. Add a room under rooms/ instead. -->

These rooms come from the [room store](${repo}rooms/), a folder in squad-chat's repository. Each is a manifest: it can use only the providers squad-chat ships, reach only the hosts it names, and draw only with the pane's widgets, so installing one never runs anyone's code. \`/chat store\` lists them in Claude Code, and \`/chat install <id>\` shows a room, with the hosts it reaches, before it installs.

| Room | Install | What it is | Reaches | Version |
| --- | --- | --- | --- | --- |
${rows}

To add your own room, see [Write a room](/squad-chat/rooms/write-a-room/).
`,
);
writeFileSync(
  new URL(`../src/content/docs/${store.zh}`, import.meta.url),
  `---
title: 房間商店
description: 由社群撰寫的房間，在 Claude Code 裡用 /chat install 安裝。
---

<!-- Generated from rooms/index.json by site/scripts/sync.mjs. Add a room under rooms/ instead. -->

這些房間來自[房間商店](${repo}rooms/)，也就是 squad-chat repository 裡的一個資料夾。每個房間都是一份 manifest：只能用 squad-chat 內建的 provider、只能連線至它列出的 host、只能使用窗格的元件繪製，所以安裝房間永遠不會執行任何人的程式碼。在 Claude Code 裡，\`/chat store\` 會列出它們，\`/chat install <id>\` 會在安裝前顯示房間內容及其連線的 host。

| 房間 | 安裝 | 內容 | 連線到 | 版本 |
| --- | --- | --- | --- | --- |
${rows}

若要將您的房間加入商店，請參閱[撰寫房間](/squad-chat/zh-tw/rooms/write-a-room/)。
`,
);
