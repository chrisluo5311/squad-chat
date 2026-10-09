---
title: Connect to a server
description: Point squad-chat at your squad's Supabase project with its URL and publishable key.
---

squad-chat has no central server. Each group of friends shares one Supabase project, its *server*. One person [hosts it](/squad-chat/host/server/) on Supabase's free plan, and everyone else connects with two values from them:

- the project URL, such as `https://abcd1234.supabase.co`
- the project's **publishable** key, `sb_publishable_…`

:::caution
The publishable key is safe to share. The secret key is not: never share it, and never put it in squad-chat.
:::

## When you install

```sh
claude plugin install squad-chat@squad-chat \
  --config supabase_url=https://abcd1234.supabase.co \
  --config supabase_key=sb_publishable_...
```

## Later

From `/config` in Claude Code (squad-chat's options), or from a shell:

```sh
echo '{"supabase_url":"https://abcd1234.supabase.co","supabase_key":"sb_publishable_..."}' \
  | claude plugin configure squad-chat@squad-chat --values-stdin
```

Until a server is set, the pane says so and shows these steps.

## Next

Open the pane with `/chat` and follow [First run](/squad-chat/use/first-run/).
