---
title: 第一次使用
description: 開啟窗格、登入、建立或加入房間，送出第一則訊息。
---

1. `/chat` 開啟窗格。
2. 登入，方式取決於伺服器的設定：
   - **使用名稱：** 輸入想使用的名稱並按 Enter 即可。
   - **使用 email：** 輸入 email 並按 Enter，再輸入信件中的驗證碼。
3. 建立房間，並將房間名稱和通行碼告知成員。在窗格中輸入：

   ```
   /room our-team some-passcode
   ```

   成員輸入相同的指令即可加入。
4. 聊天：在窗格中輸入訊息並按 Enter。Esc 回到提示列。

<figure class="shot small">
  <img src="/squad-chat/media/sign-in.png" alt="登入卡片：步驟 1／2，輸入您的 email" />
  <figcaption>伺服器使用 email 驗證碼時的登入卡片。</figcaption>
</figure>

:::danger[僅以名稱建立的帳號無法找回]
此類帳號未綁定 email，因此一旦登出、刪除 `~/.config/squad-chat` 或更換電腦，便無法再登入。重新登入會建立新帳號：以通行碼重新加入房間後，即可再次檢視房間的歷史訊息。舊帳號的訊息會保留在房間中，並於 30 天後過期。使用 email 登入則無此問題。
:::

## 從提示列登入

不開啟窗格也能登入：

```
/chat-login you@example.com     寄送驗證碼
/chat-login 12345678            信件中的驗證碼
/chat-login captain             僅以名稱登入（需伺服器允許）
```

## 下一步

- [指令](/squad-chat/zh-tw/use/commands/)：所有可用的指令
- [內建房間](/squad-chat/zh-tw/use/built-in-rooms/)：Usage、Git 和 Agents 等分頁
