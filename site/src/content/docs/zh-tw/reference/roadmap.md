---
title: 路線圖
description: 已完成和接下來要做的事。
---

- [x] Supabase 後端：有通行碼的房間、RLS、速率限制、30 天保存期限
- [x] Email 驗證碼登入，以及處理 Realtime 上線狀態和訊息的 Node bridge
- [x] 斷線後補回訊息，以及卡住的重新連線的 watchdog
- [x] 停靠窗格、精簡窗格、單行橫條和狀態列
- [x] 對話泡泡、房間分頁、未讀標記和 @提及通知
- [x] 離開和刪除房間
- [x] 自備伺服器，可用名字或 email 驗證碼登入
- [x] 用 `/chat-name` 更改顯示名稱
- [x] 正在輸入的提示
- [x] 勿擾模式，手動開啟或在 Claude 工作時自動開啟
- [x] 從工作階段分享程式碼和 diff
- [x] 內建的 Usage、Git 和 Agents 房間
- [x] 選擇快照要送到哪個房間
- [x] 功能房間第 0 階段：窗格、macOS、mpv 和報價來源能做到什麼（[調查結果](/squad-chat/zh-tw/reference/architecture/#function-rooms-phase-0)）
- [x] 功能房間框架：由 JSON manifest 定義、由 bridge 裡的 provider 提供資料的房間
- [x] Snippets 房間
- [x] 房間設定，以及 Weather 和 Tech News 房間
- [x] Monitor 房間
- [x] Stocks 房間
- [x] Lo-fi 房間
- [x] Ping 房間
- [x] Docker 房間
- [x] 房間商店：在 Claude Code 裡瀏覽、安裝、更新和移除任何人寫的房間
- [x] 通用 JSON provider，讓商店房間可以讀取 manifest 列出的任何 API
- [x] 任何房間都能在 manifest 裡宣告的警示
- [ ] 同一個房間開多個
- [x] Claude Code 桌面版 App：聊天和每個房間都以 App 原生的元件繪製

請參閱[開啟中的 issue](https://github.com/chrisluo5311/squad-chat/issues) 了解提議中的功能和已知問題，或[提出功能請求](https://github.com/chrisluo5311/squad-chat/issues/new?labels=enhancement)。

## 致謝

- [Supabase](https://supabase.com)，提供驗證、Postgres 和 Realtime
- [Resend](https://resend.com)（選用），為使用 email 登入的伺服器寄送驗證碼
- [glowup](https://github.com/NovusEdge/glowup)，它的 classic pack 啟發了配色和卡片版面，它的文件啟發了這個網站
- [token-weather](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/token-weather)，Usage 橫條畫的 context 預報來自它
- [Turn Inspector](https://x.com/dani_avila7/status/2109822699174559748)，Usage 房間的 Requests 卡片源自它的構想
- [awesome-claude-code-mods](https://github.com/karanb192/awesome-claude-code-mods) 和上面列出的 mod，為內建房間提供了許多構想
- [Starlight](https://starlight.astro.build)，用來建置這個網站
