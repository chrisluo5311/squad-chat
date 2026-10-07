# squad-chat：Claude Code 聊天室 Mod 規劃

## Context
想邊 vibe coding 邊跟朋友聊天：在 Claude Code 側邊面板顯示好友在線狀態與群組聊天，訊息不進 Claude context、不耗模型用量。以 plugin marketplace 發佈給朋友安裝。

已決定：**即時傳輸用 Node 橋接程序**（mod 環境沒有 WebSocket），**登入用 Email OTP 驗證碼**。

## API 查證結果（來源：本機 Claude Code 2.1.291 產生的 `.claude-plugin/types/claude-code/index.d.ts` ＋ 官方範例 mod `replay-theater`）
| 問題 | 結論 |
|---|---|
| 執行環境 | 「no DOM, no Node」，只有 web API（URL、TextEncoder、AbortController、crypto.subtle）。**沒有 WebSocket、沒有 fetch 全域、不能 `import()` npm 套件** → supabase-js 不能在 mod 內跑 |
| 網路 | `$.http.fetch(url, {method, headers, body, socketPath})`，等 body 讀完才回傳（不能做 SSE/串流）。支援 **`socketPath`**（走 Unix socket），官方文件範例就是 bridge 模式 |
| 外部程序 | `$.process.spawn({argv, env})` 串流 stdout，**module unload 時會砍掉子程序**；「CLI only」→ 桌面版無法 spawn |
| 面板鍵盤輸入 | **可以**。`Input` 元件有 `onSubmit(value)`、`autoFocus`、`submitLabel`；面板用 `$.ui.open({focus:true})` 或使用者焦點快捷鍵取得鍵盤。所以 `/say` 與面板內輸入框兩者都做 |
| 背景事件重繪 | 在任何 callback 裡呼叫 `$.ui.invalidate("ui.render")` 即重繪 |
| Session 結束 | `session.end` 存在，但整條鏈共用「一個很短的 wall-clock 上限」（`next.budget`），只能 best-effort。`reason: "clear"` 時程序繼續、不會再觸發 `session.start` |
| 面板放置 | `$.ui.open` 回傳 `{isPlaced}`；未主動要求的面板 ≥144 欄才放，使用者開過的 ≥110；`Pane` render props 有 `placement: 'dock' \| 'inline'`、`bodyColumns`、`maxRows` |
| 面板標題 | **只有同時開 >1 個面板才畫標題** → 未讀數不能只靠標題 |
| 其他可用 | `$.command.register({name, description, argumentHint, immediate})`、`$.ui.status(text)`（提示框下方一行）、`$.ui.toast`、`$.ui.log`（transcript 但不送模型）、`$.store`（跨 session KV，≤4MiB）、`$.clock.every/after`、`$.plugin.root`（plugin 絕對路徑）|
| 測試 | `claude plugin test <dir>` 跑 `*.test.mjs`，無網路/程序；`$.ui.mount` 可渲染、`ui.input` 打字、`ui.press` 按鈕；`mock.clock/store/env` |

## 1. 架構圖
```
┌──────────── Claude Code 程序 ─────────────┐
│ squad-chat mod (hooks/*.mjs)              │
│  ├ ui.render Pane / AbovePrompt / status  │
│  ├ command.run /say /room /who /chat ...  │
│  ├ state (訊息環形緩衝、presence、未讀)     │
│  └ bridge-client                          │
│      │ ①$.process.spawn("node bridge.mjs")│
│      │ ②stdout NDJSON 事件 ◄──────────┐    │
│      │ ③$.http.fetch(socketPath) 控制 ─┼─┐  │
└──────┼────────────────────────────────┼─┼──┘
       ▼                                │ ▼
┌────── bridge 子程序 (Node ≥22, 打包好的 supabase-js) ──────┐
│ Unix socket HTTP 控制 API: /login/start /login/verify     │
│   /room /send /read /who /shutdown   (0700 目錄 + token)  │
│ 事件輸出: ready / auth / message / presence / status / err │
│ session 檔 ~/.config/squad-chat/session.json (0600)       │
└──────┬───────────────────────────────▲────────────────────┘
       │ HTTPS (Auth/REST/RPC)          │ WSS (Realtime)
       ▼                                │
┌──────────────────── Supabase ─────────┴──────────────────┐
│ Auth: email OTP（8 位數碼）                                │
│ Postgres: profiles / rooms / room_members / messages + RLS│
│ RPC: join_room(slug, passcode)                            │
│ Realtime: private channel "room:<uuid>"                   │
│   ├ Presence（key=user_id）→ 在線/離線                     │
│   └ postgres_changes INSERT messages（受 RLS 過濾）         │
└───────────────────────────────────────────────────────────┘
```
重點設計：
- **Presence 靠 Realtime Presence，不靠 session.end**：bridge 程序結束 → WebSocket 斷 → 伺服器自動送 leave。session.end 只做 best-effort `POST /shutdown`（untrack 後退出）以加快離線顯示。
- **孤兒保護**：stdin 從一開始就是關閉的不能當訊號 → bridge 每 5 秒檢查 `process.ppid` 變成 1 就自行退出；mod unload 時 spawn 迴圈結束也會砍掉它。
- **寫入也走 bridge**：bridge 獨佔 Supabase session 與 token refresh，mod 從不碰 token。
- **聊天內容不進 context**：mod 不掛任何 `prompt.*`/`session.send` 改寫 hook；`/say` 的 `command.run` 回傳 `{}`（無 text、無 context）；回饋用 `$.ui.log`/面板。Phase 0 驗證這點。

## 2. 資料表 schema 與 RLS（`supabase/migrations/`）
```sql
-- 0001_init.sql
create extension if not exists pgcrypto;
create schema if not exists private;          -- 不暴露給 PostgREST

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null unique check (display_name ~ '^[\w\-]{1,24}$'),
  created_at timestamptz not null default now()
);
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,32}$'),
  passcode_hash text not null,                 -- crypt(passcode, gen_salt('bf'))
  created_by uuid not null references auth.users,
  created_at timestamptz not null default now()
);
create table public.room_members (
  room_id uuid references public.rooms on delete cascade,
  user_id uuid references auth.users on delete cascade,
  last_read_id bigint not null default 0,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
create table public.messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms on delete cascade,
  user_id uuid not null default auth.uid() references auth.users,
  body text not null check (char_length(body) between 1 and 500),
  created_at timestamptz not null default now()
);
create index on public.messages (room_id, id desc);

create function private.is_member(rid uuid) returns boolean
  language sql stable security definer set search_path = '' as
  $$ select exists (select 1 from public.room_members
                    where room_id = rid and user_id = (select auth.uid())) $$;

-- 加入/建立房間：不存在→建立並設定通關碼；存在→驗證通關碼
create function public.join_room(p_slug text, p_passcode text) returns uuid
  language plpgsql security definer set search_path = '' as $$ ... $$;
-- 洗版限制：BEFORE INSERT trigger，同一 user 10 秒內 >10 則就 raise
```
RLS（全部 `enable row level security`，只授權 `authenticated`，anon 無任何權限）：
| 表 | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| profiles | 自己，或與我同房的人（`exists` 共同 room_members） | `id = auth.uid()` | 自己 | — |
| rooms | `private.is_member(id)`；`passcode_hash` 用 column grant 排除 | 只能經 `join_room` | — | — |
| room_members | `private.is_member(room_id)` | 只能經 `join_room` | 自己那列，column grant 只開 `last_read_id` | 自己（離開房間） |
| messages | `private.is_member(room_id)` | `user_id = auth.uid() and private.is_member(room_id)` | — | — |

```sql
-- 0002_realtime.sql：private channel 授權（presence 與 postgres_changes 都受限）
create policy "members read room topic" on realtime.messages for select to authenticated
  using (realtime.topic() like 'room:%'
         and private.is_member(split_part(realtime.topic(), ':', 2)::uuid));
create policy "members track presence" on realtime.messages for insert to authenticated
  with check (extension = 'presence' and realtime.topic() like 'room:%'
              and private.is_member(split_part(realtime.topic(), ':', 2)::uuid));
alter publication supabase_realtime add table public.messages;
```
保留策略：DB 保留全部（或之後用 pg_cron 刪 30 天前）；面板只顯示最近 N=50，記憶體環形緩衝 100。

## 3. 檔案結構（GitHub repo 即 marketplace）
```
squad-chat/
├─ .claude-plugin/marketplace.json        marketplace 定義，列出 squad-chat plugin
├─ plugins/squad-chat/
│  ├─ .claude-plugin/plugin.json          名稱、版本、描述、keywords: ["mods","chat"]
│  ├─ hooks/hooks.json                    {"modules": ["./squad-chat.mjs"]}
│  ├─ hooks/squad-chat.mjs                register()：只負責接線 session.start/end、ui.render、command.run、ui.close
│  ├─ hooks/config.mjs                    SUPABASE_URL + publishable(anon) key（公開值，無 secret）
│  ├─ hooks/state.mjs                     單一狀態物件：連線狀態、目前房間、訊息環形緩衝(去重 by id)、presence、未讀、lastSeenId
│  ├─ hooks/bridge-client.mjs             檢查 node 版本、spawn、NDJSON 行切分/解析、指數退避重啟、socket 控制呼叫 call(path, body)
│  ├─ hooks/commands.mjs                  /say /room /who /chat(開關面板) /chat-login /chat-logout /chat-name
│  ├─ hooks/views.mjs                     wideView(dock)、compactView(inline)、bandLine(AbovePrompt)、statusText()
│  ├─ bridge/src/*.mjs                    Node：supabase-js client、OTP、session 檔、channel 訂閱、backfill、Unix socket server、NDJSON 輸出、ppid 監看
│  ├─ bridge/dist/bridge.mjs              esbuild 單檔打包（commit 進 repo，朋友不用 npm install）
│  ├─ bridge/package.json                 esbuild/supabase-js devDeps + build script
│  ├─ tests/views.test.mjs                claude plugin test：三種版面渲染、Input 送出、未讀數
│  ├─ tests/commands.test.mjs             指令解析與錯誤訊息（bridge-client 以注入的 fake 取代）
│  └─ README.md                           安裝、登入、需求（Node ≥22、CLI）、隱私說明
├─ bridge-tests/                          node:test：兩個 bridge 對本地 Supabase 互傳
└─ supabase/
   ├─ config.toml                         本地 stack（含 inbucket 收 OTP 信）
   ├─ migrations/0001_init.sql, 0002_realtime.sql
   └─ tests/rls.test.sql                  pgTAP：RLS 行為測試
```

## 4. UI 行為
- **寬（dock，≥110 欄 fullscreen）**：上方 `#room · 3 在線 · 連線中●`；好友列表（●綠 在線 / ○灰 離線，成員=目前房間成員）；訊息區 `HH:MM name: body`（最近可放的行數）；底部 `Input`（placeholder「Enter 送出，Esc 回提示框」，submitLabel「send」）。
- **窄（inline 面板）**：`rows: 8`，省略好友列表，改一行「在線: alice, bob」；訊息只顯示最後 4–5 則，名字截 8 字。
- **放不下（`isPlaced:false`）**：AbovePrompt band 單行 `💬 #room 3在線 · 2未讀 │ alice: 最後一則…`＋[Open] 按鈕；用 `/say` 發言。band 是共用的，其他 mod 佔用時退回 status line。
- **未讀提醒（不干擾主對話）**：`$.ui.status("💬 #room 2")` 一行；面板顯示且有焦點時清零並 `POST /read` 更新 `last_read_id`；預設**不**用 toast，`/chat notify on` 才在被 @提到時 toast。
- **斷線/重連**：supabase-js 自動重連；channel 每次回到 `SUBSCRIBED` 時 bridge 查 `id > lastSeenId order by id limit 200` 補洞，mod 依 id 去重。啟動時拉最近 50 則，`id > last_read_id` 計未讀。bridge 掛掉 → mod 以 1,2,4…30 秒退避重啟，狀態列顯示「重連中」。
- **/clear**：`session.end reason=clear` 不下線；只有 `prompt_input_exit / logout / other` 才 `/shutdown`。

## 5. 分階段實作與完成條件
**Phase 0 — API spike（降風險，1 天）**：最小 mod：面板+`Input`+`/say` 回顯；spawn 一個假 node 腳本每秒輸出 NDJSON；用 `socketPath` fetch 它。
✅ `claude plugin validate` 通過；面板輸入 Enter 後出現在面板；假事件能觸發重繪；**用 debug hook 記錄 `session.send` 送出的請求，確認 /say 與面板文字完全不在其中**；問 Claude「我剛說了什麼」它不知道。確認 bridge/ 下的檔案不會被 mod loader 誤載。

**Phase 1 — Supabase 後端**：建專案（或先 `supabase start` 本地）、套 migration、寫 pgTAP。
✅ `supabase test db` 通過：非成員讀不到 messages/rooms/presence channel、不能偽造 user_id、錯通關碼加入失敗、洗版 trigger 生效；Supabase `get_advisors`(security) 無警告。

**Phase 2 — Bridge**：OTP 登入、session 檔（0600）、join_room、private channel presence + postgres_changes、socket 控制 API、NDJSON、ppid 監看、backfill。
✅ `bridge-tests` 對本地 Supabase：兩個使用者兩個 bridge 互看在線、互傳訊息；`kill -9` 一方後另一方 ≤60 秒收到 leave；斷網重連後補到漏掉的訊息且無重複。

**Phase 3 — Mod 整合**：views/commands/state/bridge-client 全部接起來。
✅ `claude plugin validate` + `claude plugin test` 通過；兩個帳號各開一個 `claude --plugin-dir` 終端：互相顯示綠點、面板與 `/say` 皆能收發、`/who` 正確、`/room` 切換後訊息與成員更新。

**Phase 4 — 窄螢幕與韌性**：inline/band 版面、未讀、退避重啟、/clear 行為。
✅ 80 欄與 120 欄 fullscreen 各截圖確認版面；關 Wi-Fi 1 分鐘期間對方發 3 則，恢復後恰好出現 3 則、未讀=3；`kill -9` bridge 後自動恢復；`/exit` 後對方在數秒內看到離線。

**Phase 5 — 發佈**：marketplace.json、README、版本 tag。
✅ 乾淨機器上 `claude plugin marketplace add <you>/squad-chat` → `claude plugin install squad-chat@squad-chat` → `/chat-login` → 能聊天。

## 6. 主要風險
1. **Mods API 標示 EARLY ACCESS**，型別檔寫明可能無預警變動 → 鎖定測試過的最低版本、README 註明。
2. **桌面版 Code 分頁不能 `process.spawn`** → MVP 只支援 CLI；桌面版面板顯示「需在 CLI 使用」。（日後可加 REST 輪詢備援）
3. **朋友需要 Node ≥22 在 PATH**（supabase-js 2.117 起要求 Node 22），啟動時以 `$.process.run(["node","--version"])` 檢查並提示。
4. **`/say` 的指令輸出是否被當成 local-command 輸出送給模型**未有文件保證 → Phase 0 實測；若會進 context，改為只用面板 Input 發言、`/say` 回傳空結果。
5. **Supabase 內建 SMTP 有很低的寄信額度**（每小時數封）→ 朋友一多就收不到 OTP，需要設定自訂 SMTP（如 Resend）。
6. **anon key 公開 → 任何人都能註冊**；靠房間通關碼 + RLS + 洗版 trigger 擋，資料安全取決於 RLS 正確（pgTAP 測）。
7. **refresh token 存在本機檔案**（0600），與 gh/supabase CLI 同等級風險；`/chat-logout` 刪檔。
8. Supabase 免費專案閒置 7 天會暫停；Realtime 免費 200 同時連線（夠用）。
9. presence leave 在程序被 `kill -9` 時有延遲（伺服器心跳逾時，約 30–60 秒）。

## 7. 已決定（使用者回覆）與對計畫的影響
- **專案位置**：`/Users/luojidong/程式/squad-chat/`（新建，git init）。
- **房間通關碼**：`/room <name> <passcode>`，首位建立者設定；之後再進同房間只要 `/room <name>`（已是成員）。
- **顯示名稱**：自動取 email `@` 前綴（正規化成 `[\w-]`），撞名時自動加 `-2`、`-3`（在 `handle_new_user` trigger 內處理）。
- **跨房間總好友列表**：好友 = 我所有房間成員的聯集（`my_friends()` RPC）。bridge 對每個房間的 channel 都 track presence；在線 = 任一房間 presence 有他 **或** `presence_heartbeats.last_seen` < 60 秒。面板分兩區：上方「好友（全部房間）」、下方目前房間訊息。
- **Supabase**：用 MCP 新建專用免費專案（Phase 1 執行前會先確認費用為 $0）。
- **30 天自動清除**：`pg_cron` 每天 `delete from messages where created_at < now() - interval '30 days'`。
- **桌面版 REST 輪詢模式**：mod 內加 `hooks/transport/`：`bridge.mjs`（CLI，Realtime）與 `poll.mjs`（`$.process` 不可用或 Node 不存在時自動切換）。輪詢模式：mod 直接用 `$.http.fetch` 打 GoTrue OTP 與 PostgREST，refresh token 存 `$.store`；每 3 秒（面板顯示時）/15 秒（隱藏）拉 `id > lastSeenId`，每 30 秒 upsert `presence_heartbeats`。bridge 端也同樣寫心跳，所以兩種客戶端互相看得到在線。新增資料表 `presence_heartbeats(user_id pk, last_seen timestamptz)`，RLS：自己可 upsert、好友可讀。
- **授權**：MIT。
- **執行方式**：auto mode；**完成 Phase 0 後 commit 並 push 到使用者 GitHub 的新公開 repo `squad-chat`**（`gh repo create`），之後繼續後續 Phase。
- 尚待確認（遇到時再問）：SMTP 提供者（免費 SMTP 額度不足時）。

## Phase 6 — 聊天 UI 重新設計（v0.2.0）
參考 glowup 的「圓角卡片＋分頁＋右對齊 meta」質感與業界聊天 UI 慣例（同發送者訊息分組、日期分隔、未讀「new」分隔線、在線點），但用自己的配色與結構：
- **配色**：單一品牌色紫羅蘭 `#A78BFA`（標題、目前房間分頁、自己的名字、聚焦輸入框、new 線），其餘用使用者主題的 theme key（`success`/`subtle`/`warning`/`inactive`）跟隨深淺主題；每個人的名字依 user id 固定配一個顏色（8 色）。
- **Dock**：標題列（◆ squad-chat · 你的名字 · ● live）→ 房間分頁（目前房間實心高亮，其他可點擊、未讀數以品牌色顯示）→ FRIENDS 卡片（n/m online）→ 房間卡片（填滿剩餘高度、訊息貼底；同人 5 分鐘內合併成一組、日期分隔、`new ───` 標出上次讀到的位置）→ 圓角輸入框 → 淡色快捷鍵提示。
- **Inline**：一行標頭（房間 · 在線的人 · 狀態），最後 5 則訊息以名字欄對齊、同人只顯示一次。
- **Band**：單行，只有訊息內容會縮短；`N new` 用品牌色底標示，右側 [ Open ]。
- **登入/建房引導**：SIGN IN 卡片（step 1 of 2 / 2 of 2）、JOIN A ROOM 卡片。
- 版面細節：文字列不得用 Text 的 flex 屬性（engine 會拒絕整棵樹），改包在 Box；訊息內文 Box 用 column 方向才會正確換行；行數估算以 word-wrap 與寬字元計算，dock 預留一列給關閉鈕。
✅ 15 個 mod 測試通過（含 new 分隔線、分頁切換）；80/150 欄實機截圖確認（docs/screenshots/）。

