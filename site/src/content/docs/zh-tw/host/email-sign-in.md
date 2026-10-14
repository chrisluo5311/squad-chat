---
title: Email 登入
description: 透過 Resend 這類 SMTP 服務寄送 squad-chat 的登入驗證碼。
---

Supabase 內建的 email 僅能寄送給專案的團隊成員，且每小時上限 2 封，因此 email 登入需要一個透過 SMTP 寄信的 email 服務。[Resend](https://resend.com) 有免費方案，Postmark、Amazon SES 或您的郵件服務商的 SMTP 亦同樣適用。

## 使用 Resend

1. 在 Resend [加入並驗證](https://resend.com/domains)一個您擁有的網域，例如 `mail.example.com`。
2. 建立一組具備 **Sending access** 權限的 [API key](https://resend.com/api-keys)，並限制僅能用於該網域。
3. 在 Supabase 開啟 **Authentication → Emails → SMTP Settings**，開啟 **Enable custom SMTP**，然後填入：

   | 欄位 | 值 |
   | --- | --- |
   | Sender email | 您網域上的一個地址，例如 `login@mail.example.com` |
   | Sender name | `squad-chat` |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | Resend 的 API key |

4. 在 **Authentication → Emails → Templates** 編輯 **Confirm signup** 和 **Magic Link**，使信件內容顯示驗證碼。例如主旨 `Your squad-chat code`，內容：

   ```html
   <h2>squad-chat</h2>
   <p>Your sign-in code:</p>
   <p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
   <p>Type it into Claude Code. It expires in one hour.</p>
   ```

5. 測試：以您自己的 email 登入。每個驗證碼都會出現在 Resend 後台的 **Emails** 裡，並附有寄送狀態。

:::note
新建立的免費 Supabase 專案必須先設定自訂 SMTP，才能修改 email 範本，因此請先完成步驟 3 再進行步驟 4。
:::
