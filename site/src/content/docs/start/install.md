---
title: Install
description: What you need, how to install squad-chat from its marketplace, update it and remove it.
---

## Requirements

- Claude Code 2.1.287 or newer, in the terminal. The desktop app can't start the chat's background process yet.
- Node 22 or newer on your `PATH`. Check with `node --version`.
- A server: one Supabase project per group of friends. Get its URL and key from whoever hosts it, or [host one yourself](/squad-chat/host/server/).
- A terminal with truecolor, such as iTerm2, Ghostty, kitty or WezTerm.
- For the side-by-side layout: Claude Code's fullscreen layout (`/tui fullscreen`) and a terminal at least 110 columns wide.

:::note
Claude Code decides where the pane goes, not the mod. Below 110 columns the pane opens above the prompt in a compact layout. While it's closed, a one-line summary sits above the prompt with an **Open** button. See [Layouts](/squad-chat/use/layouts/).
:::

## Install

The repository is its own plugin marketplace.

1. Add the marketplace and install the plugin:

   ```sh
   claude plugin marketplace add chrisluo5311/squad-chat
   claude plugin install squad-chat@squad-chat
   ```

   Or, from inside Claude Code:

   ```
   /plugin install squad-chat --marketplace chrisluo5311/squad-chat
   ```

2. Restart Claude Code, or run `/reload-plugins`.
3. [Connect to a server](/squad-chat/start/connect/), then open the pane with `/chat`.

## Update

```sh
claude plugin marketplace update squad-chat && claude plugin update squad-chat@squad-chat
```

If you host your group's server, also run `supabase db push` again from an updated clone, so the server has what the new version needs. For example, shared snippets need 0.7.0's database change.

## Try it without installing

```sh
git clone https://github.com/chrisluo5311/squad-chat.git
claude --plugin-dir ./squad-chat/plugins/squad-chat
```

## Uninstall

```sh
claude plugin uninstall squad-chat@squad-chat && claude plugin marketplace remove squad-chat
```

Your sign-in session stays in `~/.config/squad-chat` until you delete it. Run `/chat-logout` first if you want it gone.
