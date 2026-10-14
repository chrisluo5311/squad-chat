---
title: Install
description: Requirements, and how to install, update and remove squad-chat from its marketplace.
---

## Requirements

- Claude Code 2.1.292 or newer, in the terminal or the desktop app. In the desktop app, the chat and every room are rendered with the app's native components.
- Node 22 or newer on your `PATH`. Verify this with `node --version`.
- A server: one Supabase project per group. Obtain its URL and key from the host, or [host one yourself](/squad-chat/host/server/).
- A terminal with truecolor, such as iTerm2, Ghostty, kitty or WezTerm.
- For the side-by-side layout, Claude Code's fullscreen layout (`/tui fullscreen`) and a terminal at least 110 columns wide.

:::note
Claude Code, rather than the mod, determines where the pane is placed. Below 110 columns, the pane opens above the prompt in a compact layout. While the pane is closed, a one-line summary with an **Open** button appears above the prompt. See [Layouts](/squad-chat/use/layouts/).
:::

## Install

The repository also serves as its own plugin marketplace.

1. Add the marketplace and install the plugin:

   ```sh
   claude plugin marketplace add chrisluo5311/squad-chat
   claude plugin install squad-chat@squad-chat
   ```

   Alternatively, from within Claude Code:

   ```
   /plugin install squad-chat --marketplace chrisluo5311/squad-chat
   ```

2. Restart Claude Code, or run `/reload-plugins`.
3. [Connect to a server](/squad-chat/start/connect/), then open the pane with `/chat`.

## Update

```sh
claude plugin marketplace update squad-chat && claude plugin update squad-chat@squad-chat
```

If you host your group's server, also run `supabase db push` again from an updated clone so that the server includes the changes the new version requires. For example, shared snippets require the database change introduced in 0.7.0.

## Run without installing

```sh
git clone https://github.com/chrisluo5311/squad-chat.git
claude --plugin-dir ./squad-chat/plugins/squad-chat
```

## Uninstall

```sh
claude plugin uninstall squad-chat@squad-chat && claude plugin marketplace remove squad-chat
```

Your sign-in session remains in `~/.config/squad-chat` until it is deleted. To remove it as well, run `/chat-logout` first.
