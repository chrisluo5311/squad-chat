---
title: Connect to a server
description: Connect squad-chat to your group's Supabase project with its URL and publishable key.
---

squad-chat has no central server. Each group shares one Supabase project, referred to as its *server*. One member [hosts it](/squad-chat/host/server/) on Supabase's free plan, and the other members connect with two values provided by the host:

- the project URL, such as `https://abcd1234.supabase.co`
- the project's **publishable** key, `sb_publishable_…`

:::caution
The publishable key may be shared publicly. The secret key must not be shared with anyone, and must not be configured in squad-chat.
:::

## During installation

```sh
claude plugin install squad-chat@squad-chat \
  --config supabase_url=https://abcd1234.supabase.co \
  --config supabase_key=sb_publishable_...
```

## After installation

Use `/config` in Claude Code (under squad-chat's options), or run the following from a shell:

```sh
echo '{"supabase_url":"https://abcd1234.supabase.co","supabase_key":"sb_publishable_..."}' \
  | claude plugin configure squad-chat@squad-chat --values-stdin
```

Until a server is configured, the pane displays a notice with these steps.

## Next

Open the pane with `/chat`, then continue with [First run](/squad-chat/use/first-run/).
