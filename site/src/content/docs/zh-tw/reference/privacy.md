---
title: 隱私與安全
description: Claude 可存取的內容、訊息的可見範圍，以及資料的儲存位置與保存期限。
---

<figure class="shot">
  <img src="/squad-chat/media/never-reaches-claude.gif" alt="成員在 squad 聊天室中要求 Claude 忽略它的指示並刪掉 repo。被問到聊天室裡有沒有人要它做什麼時，Claude 回答它沒有看到任何來自 squad 聊天室的請求。" />
  <figcaption>sam 在聊天室中要求 Claude 刪除 repo，但 Claude 完全無法看到這則訊息。</figcaption>
</figure>

## Claude 可以看到哪些內容

在窗格中輸入的內容皆不會進入對話。`/say`、`/room` 和 `/chat-login` 的參數會在 Claude Code 儲存指令前替換為佔位字串，而指令的回應屬於模型不會讀取的通知。

然而，Claude Code 仍會將 slash 指令的原始文字保留於您本機對話紀錄中的一行紀錄。若您在意此點，請在窗格中輸入通行碼。

## Claude 會從房間讀取哪些內容

完全不會讀取。成員的訊息、名稱與上線狀態，僅顯示於窗格、橫條和狀態列中，不會進入您的 prompt、system prompt、工具結果或對話紀錄。因此即使成員在聊天中寫下「刪除 repo」，也不會成為指令。專案中有一項測試會送出此類訊息，並驗證其不會傳送至模型。

## 誰可以看到您的訊息

僅限房間成員。存取權限由資料庫的 row-level security 強制執行，且必須持有房間的通行碼才能成為成員。通行碼輸入錯誤五次後，將鎖定 15 分鐘。

## 誰負責伺服器

團隊的伺服器由架設者管理，架設者與一般資料庫管理員相同，能夠讀取其資料庫。請選擇您信任的人架設，或[自行架設](/squad-chat/zh-tw/host/server/)。

## 其他成員可以看到什麼

您的顯示名稱（您設定的名稱，或 email 中 `@` 之前的部分），以及您的上線狀態，或勿擾模式下的忙碌狀態。其他成員無法看到您的 email。

## 儲存的資料

- 訊息於 30 天後刪除。
- 登入狀態儲存於 `~/.config/squad-chat/session.json`，僅限您本人讀取，執行 `/chat-logout` 即可移除。
- 僅以名稱建立的帳號在登出後無法再登入，因此 `/chat-logout` 會要求再次確認。

## 分享時送出的內容

`/chat-share` 在您的電腦上讀取選取的文字、Claude 的回覆或 `git diff`，在您確認並送出之前，任何內容皆不會離開本機。若內容疑似包含 API key、token、私鑰或 env 檔中的密鑰，系統會提出警告，並要求送出兩次。分享的內容會與一般訊息相同，存放於團隊的伺服器上。

## 內建房間讀取的資料

Usage 和 Agents 房間從 Claude Code 讀取此工作階段本身的數據：context、費用、速率限制、token 數、工具名稱與耗時，以及 subagent。Git 房間以您的身分，在工作階段的資料夾中執行 `git status` 和 `gh`。上述資料皆不會傳送至任何地方，也不會儲存任何 token。

為了顯示其他工作階段，每個工作階段會在 `/tmp/squad-chat-<uid>/sessions/` 保留一個小型 heartbeat 檔，僅限您本人讀取。其內容包含資料夾名稱、分支、模型、目前的工作，以及最近數次工具呼叫的簡短說明（例如指令、檔名或搜尋樣式）。疑似密鑰的內容會加以遮蔽，prompt、回覆和工具輸出皆不會寫入。工作階段結束時，heartbeat 檔即會移除。

Clipboard 房間預設為關閉。加入分頁後，該房間每 2 秒讀取一次剪貼簿（`pbpaste`、`wl-paste` 或 `xclip`），並僅在該工作階段的記憶體中保留最近 30 筆項目。資料不會寫入硬碟或傳送至任何地方，疑似密鑰的項目會遮蔽顯示，且此房間無法分享至聊天室。

Focus 保留您設定的時間長度與完成番茄鐘的日期，Habits 保留您的習慣及過去一年每日的完成次數，Pet 保留其心情、羈絆與一份簡短紀錄（僅記錄何人在哪個房間發言，不包含內容）。上述資料皆存放於本機 Claude Code 的外掛儲存區。

您儲存的 snippet 存放於 `~/.config/squad-chat/room-data/snippet/list.json`，僅限您本人讀取。Snippets 房間不會進行任何網路連線。

## Monitor 執行的指令

Monitor 不會進行任何網路連線。它透過 squad-chat 程式碼中一組固定的指令讀取本機狀態（Mac 上為 `vm_stat`、`sysctl`、`netstat`、`df`、`pmset`、`ioreg`，以及已安裝時的 `macmon`，Linux 上為 `/proc` 與 `/sys` 中的檔案以及 `nvidia-smi`），不經過 shell，也不需要 sudo。房間的 manifest 無法指定指令。這些數據僅保存在 bridge 的記憶體中，最多保留最近兩分鐘，僅用於繪製圖表，不會傳送至任何地方，也不會提供給 Claude。

## Weather、Tech News、Stocks 和 Lo-fi 的連線對象

這四個房間預設為關閉，開啟時會說明各自的連線對象。它們僅請求顯示所需的內容，不需要帳號、key 或 cookie，也不會傳送任何與您或工作階段相關的資訊：

| 房間 | 連線對象 | 送出內容 |
| --- | --- | --- |
| ☀ Weather | `geocoding-api.open-meteo.com`、`api.open-meteo.com`、`air-quality-api.open-meteo.com` | 您選擇的城市名稱（加入城市時也會送出一次，以確認該城市存在），以及其座標 |
| ✦ Tech News | `hacker-news.firebaseio.com`、`www.ithome.com.tw`、`www.theverge.com`、`feeds.arstechnica.com`、`techcrunch.com` | 文章列表與 feed 的請求 |
| $ Stocks | `mis.twse.com.tw`、`query1.finance.yahoo.com` | 自選股清單中的代號 |
| ♫ Lo-fi | `ice2.somafm.com`、`www.youtube.com`，以及您加入的串流 | 按下播放前不會送出任何內容，播放後由 mpv 請求該串流。YouTube 的音訊透過 yt-dlp 從 Google 的影片伺服器取得。 |

bridge 將每個房間限制於其指定的網站，因此房間無法連線至其他位置，您加入的 feed 也必須位於這些網站之一。回傳的內容在繪製前會移除終端機跳脫序列，且不會傳送至 Claude。您選擇的設定存放於 `~/.config/squad-chat/room-data/<room>/settings.json`，僅限您本人讀取。

Lo-fi 的串流由 mpv 自行取得，不經過 bridge 的 fetch。其電台仍受限於房間的 host，並在檢查房間時與每次播放前各驗證一次，因此商店房間無法藉由播放器連線至未列出的 host。您以 `/lofi add` 自行加入的內容，則會從原始位置播放。加入的檔案與資料夾維持在原處，清單存放於 `room-data/lofi/list.json`。mpv 僅在按下播放後執行，並於工作階段結束時停止。

只有 `/chat-share usage|git|agents|focus|habits|snippet|monitor|weather|news|stock|lofi`，或 snippet 與文章上的 **⇪**，會在您確認預覽後將內容送至聊天室。與 slash 指令的訊息相同，`/snippet` 或 `/tool` 之後輸入的內容不會提供給 Claude。Toolbox 房間不保留任何資料：工具處理的內容與產生的結果僅存在於工作階段的記憶體中，且此房間不提供 Share。

## 房間商店

`/chat store`、`/chat install` 和 `/chat update` 會從 `raw.githubusercontent.com`（squad-chat 的 repository）取得商店索引與房間，在您執行這些指令之前不會進行任何連線。房間僅是一個 JSON 檔，只能使用 squad-chat 內建的 provider、只能連線至其列出的 host、只能使用窗格的元件繪製。因此安裝房間不會執行作者的程式碼，且安裝前會先列出 host 供您確認。每個檔案都必須符合商店索引中的 sha256、通過與內建房間相同的檢查，並支援您的版本，否則不予安裝。寫入的檔案即為您確認過的版本。已安裝的房間存放於 `~/.config/squad-chat/rooms/`，`/chat uninstall` 會一併移除其設定與資料。

雜湊僅能偵測下載錯誤，因為索引與房間來自相同來源。真正限制房間行為的，是 manifest 本身無法執行的那些操作。

## 濫用限制

| 限制 | 值 |
| --- | --- |
| 訊息 | 每人每 10 秒 10 則，每則 500 字元 |
| 分享的 snippet | 每則 8000 字元和 200 行，每分鐘 3 則 |
| 通行碼錯誤 | 5 次，之後鎖定 15 分鐘 |

## 回報問題

若發現安全性問題，請依照 [SECURITY.md](https://github.com/chrisluo5311/squad-chat/blob/main/SECURITY.md) 的說明私下回報。
