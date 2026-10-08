# squad-chat

See which friends are online and chat with them in a side pane while you work in Claude Code. Chat never reaches Claude: it isn't in the conversation and uses no model tokens.

![squad-chat demo: sign in, join a room, chat, switch rooms](https://raw.githubusercontent.com/chrisluo5311/squad-chat/main/docs/assets/demo.gif)

## Install

In Claude Code:

```
/plugin install squad-chat --marketplace chrisluo5311/squad-chat
```

Then `/reload-plugins` (or restart Claude Code), and connect to your squad's server (below). Or from a shell:

```bash
claude plugin marketplace add chrisluo5311/squad-chat
claude plugin install squad-chat@squad-chat
```

Requires:
- Claude Code 2.1.287 or newer, in the terminal. The desktop app can't run the chat's background process yet.
- Node 22 or newer on your `PATH` (`node --version`). squad-chat tells you if it's missing or too old.

## Connect to a server

Each group of friends shares its own free Supabase project. Get its URL and publishable key from whoever hosts it, or host one yourself ([instructions](https://github.com/chrisluo5311/squad-chat#host-your-own-server)). Then set them in `/config` under squad-chat, or:

```bash
echo '{"supabase_url":"https://abcd1234.supabase.co","supabase_key":"sb_publishable_..."}' \
  | claude plugin configure squad-chat@squad-chat --values-stdin
```

## Get started

1. `/chat` opens the pane.
2. Sign in: type a name and press Enter (where the server allows it), or type your email, then the code from the email.
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
| `/room leave <name>` | Leave a room (rejoin any time with its passcode) |
| `/room delete <name>` | Delete a room you created, with all its messages, for everyone. Asks you to run it twice. |
| `/who` | Who's online, across all your rooms |
| `/chat-login <email>`, then `/chat-login <code>` | Sign in by email from the prompt instead of the pane |
| `/chat-login <name>` | Sign in with just a name, where the server allows it |
| `/chat-logout` | Sign out on this computer |
| `/chat notify on` / `off` | Toast when someone writes `@yourname` (off by default) |
| `/chat dnd on` / `off` / `auto` | Do not disturb: no toasts, a quiet band and status line, and friends see you as busy. `auto` turns it on while Claude works on something longer than 30 seconds, then sums up what you missed. |

The pane's input box takes `/room`, `/who`, `/dnd` and `/logout` too.

## Privacy

- **What the model sees:**
  - Nothing typed in the pane enters the conversation.
  - For `/say`, `/room` and `/chat-login`, the arguments are replaced with a placeholder before Claude Code saves the command, and command answers are notices the model never reads.
  - Claude Code still keeps a slash command's raw text in one bookkeeping line of the local transcript on your own disk, so type passcodes in the pane if that matters to you.
- **Where your data lives:**
  - Messages live in your squad's own Supabase database and are deleted after 30 days. Whoever hosts it can read it, like any database admin.
  - Only members of a room can read it. You become a member only with the room's passcode, and access is enforced in the database.
- **On your computer:** your sign-in session is kept in `~/.config/squad-chat/session.json`, readable only by you. `/chat-logout` removes it.
- **What others see:** your display name: the name you picked, or the part of your email before the `@` (`ann@example.com` → `ann`). Friends see it, plus whether you're online. They never see your email.

## How it works

The mod starts a small Node process (`bridge/dist/bridge.mjs`) that holds the connection to Supabase: sign-in, Realtime presence and messages, and catching up after network drops. The mod talks to it over a private Unix socket. Source and tests: [github.com/chrisluo5311/squad-chat](https://github.com/chrisluo5311/squad-chat).

## License

MIT
