---
title: 連線到伺服器
description: 用專案 URL 和 publishable key，將 squad-chat 連線至團隊的 Supabase 專案。
---

squad-chat 沒有中央伺服器。每個群組共用一個 Supabase 專案，即該群組的*伺服器*。由一位成員在 Supabase 的免費方案上[架設](/squad-chat/zh-tw/host/server/)，其他成員向其取得以下兩個值即可連線：

- 專案 URL，例如 `https://abcd1234.supabase.co`
- 專案的 **publishable** key，`sb_publishable_…`

:::caution
publishable key 可以公開分享，secret key 則不可。請勿將 secret key 提供給他人，也不要將其設定於 squad-chat 中。
:::

## 安裝時設定

```sh
claude plugin install squad-chat@squad-chat \
  --config supabase_url=https://abcd1234.supabase.co \
  --config supabase_key=sb_publishable_...
```

## 之後再設定

在 Claude Code 的 `/config`（squad-chat 的選項）裡，或從 shell：

```sh
echo '{"supabase_url":"https://abcd1234.supabase.co","supabase_key":"sb_publishable_..."}' \
  | claude plugin configure squad-chat@squad-chat --values-stdin
```

尚未設定伺服器時，窗格會顯示提示並列出上述步驟。

## 下一步

使用 `/chat` 開啟窗格，接著依照[第一次使用](/squad-chat/zh-tw/use/first-run/)的說明操作。
