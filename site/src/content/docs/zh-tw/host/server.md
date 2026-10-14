---
title: 架設自己的伺服器
description: 為您的群組設定一個 Supabase 專案。只需由一位成員在免費方案上設定一次。
---

每個群組只需由一位成員設定一次，Supabase 的免費方案即已足夠。

## 1. 建立 Supabase 專案

請在 [supabase.com](https://supabase.com/dashboard) 建立專案。

## 2. 建立資料表

使用 [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started)，在本 repository 的 clone 中執行：

```sh
supabase link --project-ref <your-project-ref>
supabase db push
```

每次更新 squad-chat 後，請從更新過的 clone 再執行一次 `supabase db push`，使伺服器具備新版本所需的變更。

## 3. 鎖定 Realtime

在後台的 **Realtime → Settings** 裡，關閉 **Allow public access to channels**。

## 4. 選擇登入方式

可擇一開啟，或兩者皆開啟。

### 使用名稱

最簡便的方式，不需要 email 服務。在 **Authentication → Sign In / Providers** 裡，開啟 **Allow anonymous sign-ins**。

任何人皆可透過此方式建立帳號，但加入房間仍需通行碼，因此陌生人無法看到任何內容。Supabase 限制每個 IP 位址每小時最多 30 次匿名註冊。

:::caution
僅以名稱建立的帳號，一旦登出便無法找回。請參閱[第一次使用](/squad-chat/zh-tw/use/first-run/)。
:::

### 使用 email 驗證碼

驗證碼由 Supabase 寄出，但其內建的 email 僅能寄送給專案的團隊成員（每小時 2 封），因此需透過 SMTP 串接 email 服務。[Email 登入](/squad-chat/zh-tw/host/email-sign-in/)以 Resend 為例說明完整步驟。

## 5. 分享伺服器

將專案 URL 和 publishable key 提供給成員，兩者位於 **Project Settings → API Keys**。包括架設者在內，所有人皆[以這兩個值連線](/squad-chat/zh-tw/start/connect/)。

:::note
架設者與一般資料庫管理員相同，能夠讀取伺服器的資料庫。換言之，成員是將自己的訊息託付給架設者。
:::
