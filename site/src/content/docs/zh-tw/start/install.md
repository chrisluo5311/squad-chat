---
title: 安裝
description: 系統需求，以及如何從 marketplace 安裝、更新和移除 squad-chat。
---

## 需求

- Claude Code 2.1.292 或更新版本，終端機版或桌面版 App 皆可。在桌面版 App 上，聊天和每個房間都以 App 原生的元件繪製。
- `PATH` 中需有 Node 22 或更新版本，可用 `node --version` 確認。
- 一台伺服器：每個群組使用一個 Supabase 專案。請向架設者取得 URL 和 key，或[自行架設](/squad-chat/zh-tw/host/server/)。
- 支援 truecolor 的終端機，例如 iTerm2、Ghostty、kitty 或 WezTerm。
- 若要使用左右並排的版面，需要 Claude Code 的全螢幕版面（`/tui fullscreen`），以及至少 110 欄寬的終端機。

:::note
窗格的位置由 Claude Code 決定，而非由 mod 決定。少於 110 欄時，窗格會以精簡版面顯示於提示列上方。窗格關閉時，提示列上方會顯示一行摘要和 **Open** 按鈕。請參閱[版面](/squad-chat/zh-tw/use/layouts/)。
:::

## 安裝

本 repository 本身即為一個外掛 marketplace。

1. 加入 marketplace 並安裝外掛：

   ```sh
   claude plugin marketplace add chrisluo5311/squad-chat
   claude plugin install squad-chat@squad-chat
   ```

   或在 Claude Code 中執行：

   ```
   /plugin install squad-chat --marketplace chrisluo5311/squad-chat
   ```

2. 重新啟動 Claude Code，或執行 `/reload-plugins`。
3. [連線到伺服器](/squad-chat/zh-tw/start/connect/)，然後用 `/chat` 開啟窗格。

## 更新

```sh
claude plugin marketplace update squad-chat && claude plugin update squad-chat@squad-chat
```

若您負責架設群組的伺服器，請另外從更新過的 clone 再執行一次 `supabase db push`，使伺服器具備新版本所需的變更。例如分享 snippet 需要 0.7.0 的資料庫變更。

## 免安裝試用

```sh
git clone https://github.com/chrisluo5311/squad-chat.git
claude --plugin-dir ./squad-chat/plugins/squad-chat
```

## 解除安裝

```sh
claude plugin uninstall squad-chat@squad-chat && claude plugin marketplace remove squad-chat
```

登入狀態會保留在 `~/.config/squad-chat`，直到手動刪除為止。若要一併清除，請先執行 `/chat-logout`。
