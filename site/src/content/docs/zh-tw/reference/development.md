---
title: 開發
description: 從原始碼執行 squad-chat、連線至本機 Supabase，以及執行測試。
---

歡迎參與貢獻。[CONTRIBUTING.md](https://github.com/chrisluo5311/squad-chat/blob/main/CONTRIBUTING.md) 說明了環境設定、測試，以及如何送出 pull request。[架構](/squad-chat/zh-tw/reference/architecture/)說明各部分如何組合在一起，進行較大幅度的修改前建議先行閱讀。

## 您需要

- [Claude Code](https://claude.com/claude-code) 2.1.292 或更新版本
- Node.js 22 或更新版本
- [Docker](https://www.docker.com) 和 [Supabase CLI](https://supabase.com/docs/guides/local-development)，用於執行本機伺服器

## 指令

```sh
# The mod
claude plugin validate ./plugins/squad-chat   # check the manifest and hooks
claude plugin test ./plugins/squad-chat       # mod tests, against a fake bridge
claude --plugin-dir ./plugins/squad-chat      # run Claude Code with this checkout

# The bridge
cd plugins/squad-chat/bridge
npm install && npm run build                  # rebuild dist/bridge.mjs after editing src/
node --test ../../../bridge-tests/*.test.mjs  # two users, two bridges, local Supabase

# The database
supabase start                                # local stack on ports 56420-56429
supabase test db                              # pgTAP access-control tests
supabase db advisors --local --type all
```

## 連線至本機環境執行

```sh
SQUAD_SUPABASE_URL=http://127.0.0.1:56421 \
SQUAD_SUPABASE_KEY=<local publishable key from `supabase status`> \
SQUAD_CONFIG_DIR=$(mktemp -d) \
claude --plugin-dir ./plugins/squad-chat
```

登入信會送到本機郵件介面 http://127.0.0.1:56424。若要測試與自己聊天，請以不同的 `SQUAD_CONFIG_DIR` 開啟第二個終端機。

## 檔案位置

| 路徑 | 內容 |
| --- | --- |
| `plugins/squad-chat/hooks/squad-chat.mjs` | Hooks：指令、窗格、橫條、狀態列、bridge client，以及讓聊天內容不進入對話 |
| `plugins/squad-chat/hooks/state.mjs` | 由 bridge 事件建立的狀態 |
| `plugins/squad-chat/hooks/commands.mjs` | Slash 指令和窗格的輸入框 |
| `plugins/squad-chat/hooks/views.mjs` | 停靠窗格、精簡窗格和橫條 |
| `plugins/squad-chat/hooks/sysviews.mjs` | 內建房間：Usage、Git 和 Agents |
| `plugins/squad-chat/hooks/widgets.mjs` | 內建房間共用的量表、迷您走勢圖、數據方格、列和卡片堆疊 |
| `plugins/squad-chat/hooks/metrics.mjs` | 這個工作階段的用量、工具耗時和 subagent |
| `plugins/squad-chat/hooks/github.mjs` | Git 房間的資料，透過 `git` 和 `gh` 讀取 |
| `plugins/squad-chat/hooks/sessions.mjs` | 和這台電腦上其他工作階段共用的 heartbeat |
| `plugins/squad-chat/hooks/theme.mjs` | 顏色和字元圖形 |
| `plugins/squad-chat/bridge/src/` | Node bridge（打包成 `bridge/dist/bridge.mjs`） |
| `plugins/squad-chat/tests/` | Mod 測試 |
| `bridge-tests/` | 連線至本機 Supabase 的 bridge 測試 |
| `supabase/migrations/`、`supabase/tests/` | Schema、RLS 和 pgTAP 測試 |
| `site/` | 這個文件網站（Astro Starlight） |

## 這個網站

文件以 Markdown 格式存放於 `site/src/content/docs/`，繁體中文版在 `site/src/content/docs/zh-tw/`。預覽方式：

```sh
cd site
npm install
npm run dev
```

GIF 和截圖來自 `docs/assets/` 和 `docs/screenshots/`，架構頁來自 `docs/ARCHITECTURE.md`，請直接編輯這些檔案。推送至 `main` 後，網站會自動發布至 GitHub Pages。
