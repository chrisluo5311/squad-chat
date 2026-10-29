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
- Claude Code 2.1.292 or newer, in the terminal or the desktop app. On the desktop app the chat and every room are drawn with the app's own pieces.
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

Before your chat rooms, built-in tabs need no server or sign-in: **Usage** (context, rate limits, cost, tool timings), **Git** (your branch, its PR and checks, through the `gh` CLI), **Agents** (every Claude Code session and its subagents), **Focus** (a Pomodoro timer), **Habits** (daily habits, each with its streak), **Toolbox** (Base64, JWT, UUID, hashes, Unix times, cron and more), **Pet** (Clawd), **Snippets** and **Monitor**. Clipboard, Weather, Tech News, Stocks, Ping, Lo-fi and Docker wait until you add them with `/chat rooms +clipboard` and the like. [The docs](https://chrisluo5311.github.io/squad-chat/use/built-in-rooms/) show each one.

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
| `/chat-share [#room]` | Share the text you selected, or else the last code block in Claude's reply, to the current room or the one you name. You see it first, then `/chat-share send` posts it (or `/chat-share cancel`). |
| `/chat-share diff [path] [#room]` | Share your uncommitted changes (`git diff HEAD`), all of them or one file's |
| `/chat-share to #room` | Send what's waiting in the preview to another of your rooms instead. `/chat-share send #room` picks the room and posts in one go. In the pane, the preview's ‹ › arrows step through your rooms. |
| `/chat-logout` | Sign out on this computer |
| `/chat notify on` / `off` | Toast when someone writes `@yourname` (off by default) |
| `/chat dnd on` / `off` / `auto` | Do not disturb: no toasts, a quiet band and status line, and friends see you as busy. `auto` turns it on while Claude works on something longer than 30 seconds, then sums up what you missed. |
| `/chat usage` / `git` / `agents` / `focus` / `habits` / `toolbox` / `clipboard` / `pet` / `snippet` / `monitor` / `weather` / `news` / `stock` / `ping` / `lofi` / `docker` | Open the pane on a built-in room |
| `/chat band [room]` | Show another room in the band above the prompt without opening the pane. **‹** and **›** on the band do the same, one room at a time. |
| `/chat rooms <list>` | Which built-in rooms have tabs (`usage`, `git`, `agents`, `focus`, `habits`, `toolbox`, `clipboard`, `pet`, `snippet`, `monitor`, `weather`, `news`, `stock`, `ping`, `lofi`, `docker`, `all` or `none`, or `+name` / `-name`). Clipboard, Weather, Tech News, Stocks, Ping, Lo-fi and Docker are off until you add them. |
| `/focus start` / `pause` / `skip` / `reset` / `<focus min> [break min]` | The Focus room's Pomodoro timer, with a chime when focus or a break ends |
| `/habit add <name> [x<times>]` / `done` / `undo` / `remove` / `rename <old> -> <new>` | The Habits room's goals, each checked off once a day (or a number of times) with its streak |
| `/tool <name> [input]` | One of the Toolbox room's tools: `/tool uuid 5`, `/tool hash hello`, `/tool time 1739000000` |
| `/chat store` / `install <id>` / `update [id]` / `uninstall <id>` | Rooms from the room store: list, install (a look first), update, remove |
| `/chat set <room> [<setting> <value>]` | Show or change a room's settings, such as `/chat set weather cities Taipei, Tokyo` |
| `/chat-share usage` / `git` / `agents` / `habits` / `snippet` `[#room]` | Share a snapshot of a built-in room to a chat room |
| `/snippet add <text>` | Save the text as a snippet. Snippets are numbered 1, 2, 3 and on |
| `/snippet add` | Save the selection, or else Claude's last code block, to the Snippets room |
| `/snippet rename <old> -> <new>` / `delete <name>` | Rename or delete a saved snippet |
| `/snippet copy <name>` / `share <name> [#room]` | Copy a saved snippet, or share it to a chat room after a look |
| `/lofi play [name]` / `pause` / `next` / `vol <0-100>` / `add <url or path>` / `import` | The Lo-fi room's player and list, from the prompt |

The pane's input box takes `/room`, `/who`, `/dnd`, `/share`, `/snippet`, `/lofi`, `/set`, `/usage`, `/git`, `/agents`, `/chat` (the store commands included) and `/logout` too.

## Privacy

- **What the model sees:**
  - Nothing typed in the pane enters the conversation.
  - For `/say`, `/room` and `/chat-login`, the arguments are replaced with a placeholder before Claude Code saves the command, and command answers are notices the model never reads.
  - Claude Code still keeps a slash command's raw text in one bookkeeping line of the local transcript on your own disk, so type passcodes in the pane if that matters to you.
- **Where your data lives:**
  - Messages live in your squad's own Supabase database and are deleted after 30 days. Whoever hosts it can read it, like any database admin.
  - Only members of a room can read it. You become a member only with the room's passcode, and access is enforced in the database.
- **The built-in rooms** read this session's figures from Claude Code, and `git` and `gh` in its folder as you (`gh` talks to GitHub with your own sign-in). They send nothing of yours anywhere. Each session keeps a small heartbeat in `/tmp/squad-chat-<uid>/sessions/`, readable only by you (folder name, branch, model, recent tool names with a few words each, secrets masked, never prompts or output), so the Agents room can show every session. The Clipboard room, once you add it, reads the clipboard every 2 seconds and keeps the last 30 items in this session's memory only, masks anything that looks like a secret, and never shares them.
- **On your computer:** your sign-in session is kept in `~/.config/squad-chat/session.json`, readable only by you. `/chat-logout` removes it.
- **What others see:** your display name: the name you picked, or the part of your email before the `@` (`ann@example.com` → `ann`). Friends see it, plus whether you're online. They never see your email.

## Network

squad-chat connects only to the places below. Each room's `room.json` lists its hosts under `permissions.hosts`, and the bridge refuses any other host for that room, settings included. The Ping room is the one exception: it checks only the servers you type into it, and a room can't start with any.

| What | Where it connects | What it sends |
|---|---|---|
| Chat | Your squad's Supabase project, the URL you set in `supabase_url` | Your sign-in, messages, presence and what you share |
| Git room | GitHub, through your own `gh` CLI | Read-only requests about this repository: its pull requests and checks, workflow runs, your issues and its open Dependabot alerts |
| Weather (off until added) | `api.open-meteo.com`, `geocoding-api.open-meteo.com`, `air-quality-api.open-meteo.com` | The city names you set |
| Tech News (off until added) | `hacker-news.firebaseio.com` and the feeds `www.ithome.com.tw`, `www.theverge.com`, `feeds.arstechnica.com`, `techcrunch.com` | Nothing beyond the request |
| Stocks (off until added) | `mis.twse.com.tw`, `query1.finance.yahoo.com` | The symbols on your watchlist |
| Lo-fi (off until added) | `ice2.somafm.com` and `www.youtube.com`, played by your own `mpv` (and `yt-dlp` for YouTube), started only when you press play | Nothing beyond the stream request. Tracks you add play from wherever you point them |
| Ping (off until added) | Only the servers you add: a ping, a TCP connection or one HTTP(S) `GET` each, every 30 seconds while the room is shown and every minute otherwise | Nothing beyond the check. The results stay in `~/.config/squad-chat/room-data/ping/` |
| Room store | `raw.githubusercontent.com/chrisluo5311/squad-chat/main/rooms` | Nothing beyond the request. A room installs only after you see its hosts and confirm |

Nothing goes to Claude, to Anthropic or to the author of squad-chat.

## What the mod runs

Every program is named in the code, with fixed arguments, and none comes from a room or from the network.

| Program | When | Why |
|---|---|---|
| `node --version`, then `node bridge/dist/bridge.mjs` | When Claude Code starts | Checks for Node 22 or newer, then starts the bridge, the one process that talks to Supabase and the room hosts above |
| `git`, `gh` | Git room, `/chat-share diff` | Reads this folder's branch, diff, pull requests and checks |
| `pbpaste`, `wl-paste` or `xclip`; on Windows, `powershell` | Clipboard room, only once you add it; on Windows also the Toolbox's paste, once each time you press it | Reads the clipboard every 2 seconds (on Windows, one PowerShell that stays up looks once a second) |
| `vm_stat`, `sysctl`, `netstat`, `df`, `pmset`, `ioreg`, `macmon` (Mac), `nvidia-smi` (Linux, Windows), `netstat -e` and `powershell` (Windows) | Monitor room | Reads CPU, memory, disk, network, battery and GPU figures. On Windows, PowerShell reads the battery and page file every 30 seconds. No shell, no sudo |
| `docker` (`ps`, `images`, `volume ls`, `network ls`, `stats`, `logs`) | Docker room, only once you add it | Reads what Docker has, every 5 seconds while the room is on show. Read only. `logs` goes through `/bin/sh` only to keep the container's stderr |
| `ping` (`/sbin/ping` on a Mac) | Ping room, only for the hosts you add | Sends 3 packets to each, the host passed as one argument after `--` (Windows' ping takes no `--`; a host never starts with `-`). No shell, no sudo |
| `mpv`, and `yt-dlp` for YouTube | Lo-fi room, only when you press play | Plays the stream. A short `/bin/sh` loop around `mpv` (on Windows, a `node -e` watchdog) stops it when the bridge exits, and downloads nothing to run. On Windows, stopping runs `taskkill` on that watchdog and its `mpv` |

## What the mod hooks

The mod watches Claude Code events to draw its rooms. It never asks for permissions, never changes a permission decision, and never adds to the conversation.

| Event | What it does |
|---|---|
| `turn.start`, `turn.step`, `turn.complete`, `tool.call`, `agent.spawn`, `session.measure` | Measures timings, tokens and tool names for the Usage and Agents rooms, then passes each event on unchanged |
| `session.append` | For `/say`, `/room` and `/chat-login` only, replaces the arguments with a placeholder before the transcript stores them, so messages and passcodes stay out of it |
| `command.run` | Answers squad-chat's own slash commands |
| `ui.*`, `clock`, `branch`, `pr`, `session.start`, `session.end` | Draws the pane and band, registers the commands, and stops the bridge when the session ends |

`/chat-share` reads your mouse selection, Claude's last code block or `git diff`. It shows you the preview, and sends to your room only when you confirm.

## How it works

The mod starts a small Node process (`bridge/dist/bridge.mjs`) that holds the connection to Supabase: sign-in, Realtime presence and messages, and catching up after network drops. The mod talks to it over a private Unix socket. Source and tests: [github.com/chrisluo5311/squad-chat](https://github.com/chrisluo5311/squad-chat).

## License

MIT
