// Pulls content the site shares with the repository, so neither is kept twice in git:
// the README's GIFs and screenshots go to public/media, and docs/ARCHITECTURE.md
// becomes the Architecture page.
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
