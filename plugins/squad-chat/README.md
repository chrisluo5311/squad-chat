# squad-chat

See which friends are online and chat with them in a side pane while you work in Claude Code. Chat never reaches Claude: it isn't in the conversation and uses no model tokens.

![squad-chat docked beside Claude Code](https://raw.githubusercontent.com/chrisluo5311/squad-chat/main/docs/screenshots/pane.png)

## Install

In Claude Code:

```
/plugin install squad-chat --marketplace chrisluo5311/squad-chat
```

Then `/reload-plugins` (or restart Claude Code). Or from a shell:

```bash
claude plugin marketplace add chrisluo5311/squad-chat
claude plugin install squad-chat@squad-chat
```

Requires:
- Claude Code 2.1.287 or newer, in the terminal. The desktop app can't run the chat's background process yet.
- Node 22 or newer on your `PATH` (`node --version`). squad-chat tells you if it's missing or too old.

## Get started

1. `/chat` opens the pane.
2. Type your email in the pane and press Enter. You'll get an email with an 8-digit code; type it in the pane.
3. Create a room and give the passcode to your friends: type `/room our-team some-passcode` in the pane. Friends join with the same line.
4. Chat: type in the pane and press Enter. Esc goes back to the prompt.

In a terminal 110 columns wide or more (fullscreen), the pane docks on the right. In a narrower one it sits above the prompt. While the pane is closed, a line above the prompt shows the room, who's online and what's unread, with an **Open** button.

## Commands

| Command | What it does |
|---|---|
| `/chat` | Open the pane |
| `/say <message>` | Send a message to the current room from the prompt |
| `/room` | List your rooms |
| `/room <name>` | Switch to a room you're in |
| `/room <name> <passcode>` | Create a room, or join a friend's |
| `/who` | Who's online, across all your rooms |
| `/chat-login <email>`, then `/chat-login <code>` | Sign in from the prompt instead of the pane |
| `/chat-logout` | Sign out on this computer |
| `/chat notify on` / `off` | Toast when someone writes `@yourname` (off by default) |

The pane's input box takes `/room`, `/who` and `/logout` too.

## Privacy

- **What the model sees:**
  - Nothing typed in the pane enters the conversation.
  - For `/say`, `/room` and `/chat-login`, the arguments are replaced with a placeholder before Claude Code saves the command, and command answers are notices the model never reads.
  - Claude Code still keeps a slash command's raw text in one bookkeeping line of the local transcript on your own disk, so type passcodes in the pane if that matters to you.
- **Where your data lives:**
  - Messages live in a Supabase database and are deleted after 30 days.
  - Only members of a room can read it. You become a member only with the room's passcode, and access is enforced in the database.
- **On your computer:** your sign-in session is kept in `~/.config/squad-chat/session.json`, readable only by you. `/chat-logout` removes it.
- **What others see:** your display name is the part of your email before the `@` (`ann@example.com` → `ann`). Friends see it, plus whether you're online. They never see your email.

## How it works

The mod starts a small Node process (`bridge/dist/bridge.mjs`) that holds the connection to Supabase: sign-in, Realtime presence and messages, and catching up after network drops. The mod talks to it over a private Unix socket. Source and tests: [github.com/chrisluo5311/squad-chat](https://github.com/chrisluo5311/squad-chat).

## License

MIT
