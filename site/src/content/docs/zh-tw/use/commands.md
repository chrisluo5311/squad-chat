---
title: 指令
description: squad-chat 的所有 slash 指令、功能說明與範例。
---

## 從提示列

### 聊天和房間

| 指令 | 說明 |
| --- | --- |
| `/chat` | 開啟窗格 |
| `/say <message>` | 從提示列傳送訊息至目前的房間 |
| `/room` | 列出您的房間 |
| `/room <name>` | 切換至已加入的房間（亦可點選其分頁） |
| `/room <name> <passcode>` | 建立房間，或加入他人的房間 |
| `/room leave <name>` | 離開房間。之後可隨時以通行碼重新加入。 |
| `/room delete <name>` | 刪除自己建立的房間及其所有訊息，所有成員皆無法再存取。需執行兩次以確認。 |
| `/who` | 查看所有房間的線上成員 |

### 帳號

| 指令 | 說明 |
| --- | --- |
| `/chat-login <email>`，接著 `/chat-login <code>` | 從提示列以 email 登入，無須開啟窗格 |
| `/chat-login <name>` | 僅以名稱登入（需伺服器允許） |
| `/chat-name <new name>` | 更改顯示名稱。其他成員會立即看到新名稱。 |
| `/chat-logout` | 在本機登出 |

### 分享

| 指令 | 說明 |
| --- | --- |
| `/chat-share [#room]` | 分享選取的文字，若未選取則分享 Claude 回覆中的最後一個程式碼區塊，送至目前的房間或指定的房間。系統會先顯示預覽，再以 `/chat-share send` 送出（或以 `/chat-share cancel` 取消）。 |
| `/chat-share diff [path] [#room]` | 分享尚未 commit 的變更（`git diff HEAD`），可指定全部或單一檔案 |
| `/chat-share to #room` | 將預覽中的內容改送至另一個房間。`/chat-share send #room` 可同時指定房間並送出。 |
| `/chat-share usage` / `git` / `agents` / `focus` / `habits` / `snippet` / `monitor` / `weather` / `news` / `stock` / `lofi` `[#room]` | 將內建房間的快照分享至目前的房間或指定的房間 |

### Snippets

| 指令 | 說明 |
| --- | --- |
| `/snippet add <text>` | 將文字儲存為 snippet，並依序編號為 1、2、3… |
| `/snippet add` | 將選取的文字，若未選取則將 Claude 回覆中的最後一個程式碼區塊，儲存至 [Snippets 房間](/squad-chat/zh-tw/use/built-in-rooms/#-snippets) |
| `/snippet rename <old> -> <new>` / `delete <name>` | 重新命名或刪除已儲存的 snippet |
| `/snippet copy <name>` / `share <name> [#room]` | 複製已儲存的 snippet，或於預覽後分享至聊天室 |

### Lo-fi

| 指令 | 說明 |
| --- | --- |
| `/lofi play [name]` / `pause` / `next` / `prev` / `stop` / `vol <0-100>` | 從提示列操控 [Lo-fi 房間](/squad-chat/zh-tw/use/built-in-rooms/#-lo-fi)的播放器 |
| `/lofi add <url, file or folder> [# name]` / `remove <name>` / `import` | 加入清單、自清單移除，或匯入 Pixel Play 的播放清單 |

### 通知和內建房間

| 指令 | 說明 |
| --- | --- |
| `/chat notify on` / `off` | 有人提及 `@yourname` 時發出通知（預設關閉） |
| `/chat dnd on` / `off` / `auto` | 勿擾模式：不發出通知，橫條與狀態列保持靜音，其他成員會看到您處於忙碌狀態。`auto` 會在 Claude 處理超過 30 秒的工作時自動開啟，結束後彙整錯過的訊息。 |
| `/chat usage` / `git` / `agents` / `focus` / `habits` / `toolbox` / `clipboard` / `pet` / `snippet` / `monitor` / `weather` / `news` / `stock` / `lofi` | 開啟窗格並切換至指定的[內建房間](/squad-chat/zh-tw/use/built-in-rooms/)。`/chat chat` 返回聊天。 |
| `/chat band [room]` | 在不開啟窗格的情況下，於提示列上方的橫條顯示另一個房間。橫條上的 **‹** 和 **›** 功能相同，每次切換一個房間。 |
| `/chat rooms <list>` | 設定要顯示分頁的內建房間：`usage`、`git`、`agents`、`focus`、`habits`、`toolbox`、`clipboard`、`pet`、`snippet`、`monitor`、`weather`、`news`、`stock`、`lofi` 可任意組合，或使用 `all`、`none`。`+name` 和 `-name` 用於加入或移除單一房間。 |
| `/focus start` / `pause` / `skip` / `reset` / `<focus min> [break min]` | 從提示列操控 Focus 房間的計時器。單獨輸入 `/focus` 會開啟房間。 |
| `/habit add <name> [x<times>]` / `done <name>` / `undo <name>` / `remove <name>` / `rename <old> -> <new>` | 從提示列設定 Habits 房間的目標並標記完成。單獨輸入 `/habit` 會開啟房間。 |
| `/tool <name> [input]` | 執行 [Toolbox](/squad-chat/zh-tw/use/built-in-rooms/#-toolbox) 房間的工具並顯示結果，例如 `/tool uuid 5`、`/tool hash hello` 或 `/tool time 1739000000`。單獨輸入 `/tool` 會開啟房間。 |
| `/chat store [words]` | [房間商店](/squad-chat/zh-tw/rooms/store/)中的房間，以及已安裝的項目 |
| `/chat install <id>` / `update [id]` / `uninstall <id>` | 從商店安裝房間（第一次執行顯示內容，再次執行才會安裝）、更新已安裝的房間，或移除房間 |
| `/chat set <room> [<setting> <value>]` | 顯示或更改房間的設定，例如 `/chat set weather cities Tokyo`。清單類設定亦接受 `+one` 和 `-one`，`default` 可將設定恢復為預設值。部分清單（例如 Weather 的城市）會將輸入的內容加入清單，而非取代整個清單。 |

### 房間設定

| 指令 | 說明 |
| --- | --- |
| `/chat set weather cities Osaka, Seoul` / `-Tokyo` | 加入城市，或移除城市 |
| `/chat set weather city Tokyo` / `units imperial` | 顯示在 Now 下方的城市，以及單位 |
| `/chat set news hn best` | Hacker News 的列表：`top`、`best`、`new` 或 `off` |
| `/chat set news feeds -https://techcrunch.com/feed/` | 移除 feed（feed 必須來自房間允許的網站） |
| `/chat set stock watchlist TAIEX, 2330, AAPL` / `+2454` / `-NVDA` | 自選股清單，最多 12 檔。台股代號、`TAIEX`，或任何 Yahoo 代號，例如 `7203.T` |
| `/chat set stock colors red-up` / `green-up` | 所有市場套用相同的漲跌顏色，而非依各市場的慣例 |
| `/chat set stock move 3` | 個股單日漲跌達 3% 時發出通知（`0` 為關閉，預設為 5） |
| `/chat set monitor cpu_temp 90` / `memory 90` / `alerts off` | Monitor 的門檻值，或關閉通知 |

## 在窗格中

窗格的輸入框也接受 `/room`、`/who`、`/name`、`/dnd`、`/share`、`/snippet`、`/lofi`、`/set`、`/usage`、`/git`、`/agents`、`/focus`、`/habit`、`/tool`、`/clipboard`、`/pet`、`/chat`（搭配 `rooms`、`set`、`store`、`install`、`update` 和 `uninstall`）、`/logout` 和 `/help`，且分享預覽可選擇房間，並提供 **Send** 和 **Cancel** 按鈕。在 Git 房間和功能房間中，`r` 可重新整理，在 Lo-fi 中可透過單一按鍵操控播放器（`p` 播放或暫停、`n` 下一首、`b` 上一首、`s` 停止、`u` 和 `d` 調整音量）。在 Focus 中，`start`、`pause`、`skip`、`reset` 或 `50 10` 可操控計時器。在 Habits 中，輸入的內容即為新的習慣（`Read 30 min`，或 `Water x8` 代表一天 8 次），`remove`、`rename` 和 `undo` 用於修改。在 Toolbox 中，輸入的內容即為目前工具要處理的資料，僅輸入工具名稱則會切換至該工具。在 Pet 中，輸入心情名稱（`wave`、`sleepy`、`auto`）即可切換心情。在具有設定的房間中，可使用 `/set <setting> <value>` 更改設定。

:::tip
建議在窗格中輸入通行碼。窗格完全不會接觸對話，而 slash 指令的原始文字會保留於本機對話紀錄中的一行紀錄。請參閱[隱私與安全](/squad-chat/zh-tw/reference/privacy/)。
:::

## 範例

### 建立房間並邀請成員

```
/room design pixels42        建立 #design（若已存在則加入），通行碼為 pixels42
/room squad                  切換至已加入的 #squad
/room                        列出房間及未讀數
/say standup in 5?           不開啟窗格，直接傳送至目前的房間
/who                         查看線上成員及其所在房間
/chat-name captain           將名稱更改為 captain
```

<figure class="shot">
  <img src="/squad-chat/media/rooms.gif" alt="從提示列：/room design pixels42 加入他人的房間，/room 列出房間和未讀數，/room squad 切換回來，/say 發送訊息，/who 顯示誰在線上，/chat-name captain 更改名字。" />
  <figcaption>從提示列管理房間：以通行碼加入、列出、切換、以 /say 傳送訊息、查看線上成員，以及更改名稱。</figcaption>
</figure>

### 分享程式碼和 diff

```
/chat-share                  選取的文字或 Claude 的最後一個程式碼區塊，送至目前的房間
/chat-share #design          同上，送至 #design
/chat-share diff             所有尚未 commit 的變更
/chat-share diff src/a.ts    只有 src/a.ts
/chat-share diff src/a.ts #design
/chat-share send             送出預覽中的內容
/chat-share cancel           取消
```

若分享的內容疑似包含 API key、token、私鑰或 env 檔中的密鑰，預覽會提出警告，並要求送出兩次。

<figure class="shot">
  <img src="/squad-chat/media/share.gif" alt="Claude 寫了一個 debounce 輔助函式。/chat-share 預覽它的程式碼區塊，/chat-share send 送出。/chat-share diff 對尚未 commit 的變更做一樣的事。兩者在窗格裡都顯示成卡片，diff 有上色，接著成員回覆。" />
  <figcaption>分享 Claude 的程式碼區塊和尚未 commit 的 diff：先預覽，再以卡片形式顯示於房間中。</figcaption>
</figure>

### 保持專注

```
/chat dnd on                 不發出通知，其他成員會看到您處於忙碌狀態
/chat dnd auto               同上，但僅在 Claude 處理超過 30 秒的工作時開啟
/chat dnd off                恢復正常，並彙整錯過的訊息
/chat notify on              有人提及 @yourname 時發出通知
```

<figure class="shot">
  <img src="/squad-chat/media/dnd.gif" alt="開啟 /chat dnd on 後，成員傳送訊息時提示列上方的橫條變灰並顯示靜音的計數，不會跳通知。/chat dnd off 之後，一則通知總結錯過的訊息，窗格顯示這些訊息。" />
  <figcaption>勿擾模式：sam 傳送訊息時橫條保持灰色，結束後以一則通知彙整。</figcaption>
</figure>
