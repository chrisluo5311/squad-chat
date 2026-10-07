<a id="readme-top"></a>

<div align="center">

[![Stars][stars-shield]][stars-url]
[![Version][version-shield]][version-url]
[![License][license-shield]][license-url]
[![Made for Claude Code][made-for-shield]][made-for-url]
[![Node][node-shield]][node-url]
[![Views][views-shield]][views-url]

<br />

<a href="https://github.com/chrisluo5311/squad-chat">
  <img src="docs/assets/logo.svg" alt="squad-chat logo" width="96" height="96">
</a>

<h1 align="center">squad-chat</h1>

<p align="center">
  See which friends are online and chat with them in a pane beside your Claude Code conversation.
  <br />
  Chat never reaches Claude and costs no tokens.
  <br />
  <a href="#usage"><strong>Explore the commands »</strong></a>
  <br />
  <br />
  <a href="#about-the-project">View Demo</a>
  ·
  <a href="https://github.com/chrisluo5311/squad-chat/issues/new?labels=bug">Report Bug</a>
  ·
  <a href="https://github.com/chrisluo5311/squad-chat/issues/new?labels=enhancement">Request Feature</a>
</p>

</div>

<details>
  <summary>Table of Contents</summary>
  <ol>
    <li>
      <a href="#about-the-project">About The Project</a>
      <ul>
        <li><a href="#built-with">Built With</a></li>
      </ul>
    </li>
    <li>
      <a href="#getting-started">Getting Started</a>
      <ul>
        <li><a href="#prerequisites">Prerequisites</a></li>
        <li><a href="#installation">Installation</a></li>
      </ul>
    </li>
    <li>
      <a href="#usage">Usage</a>
      <ul>
        <li><a href="#first-run">First run</a></li>
        <li><a href="#commands">Commands</a></li>
        <li><a href="#layouts">Layouts</a></li>
        <li><a href="#two-accounts-on-one-computer">Two accounts on one computer</a></li>
      </ul>
    </li>
    <li><a href="#privacy--security">Privacy &amp; Security</a></li>
    <li><a href="#development">Development</a></li>
    <li><a href="#self-hosting-the-backend">Self-hosting the backend</a></li>
    <li><a href="#roadmap">Roadmap</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#contact">Contact</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

## About The Project

<div align="center">
  <img src="docs/assets/demo.gif" alt="squad-chat demo: open the pane, sign in with an emailed code, join a room with its passcode, chat with a friend, and switch rooms when a new message arrives" width="100%">
  <sub>Signing in, joining a room, chatting, and switching rooms when a new message comes in.</sub>
</div>

<br />

squad-chat puts a group chat next to your Claude Code conversation. You keep working with Claude on the left while your friends' messages come in on the right.

* **Lives inside Claude Code.** One `/chat` command opens a pane: no browser tab, no extra app.
* **Never reaches Claude.** What you type in the pane never enters the conversation, and slash-command arguments are hidden from the model, so chatting costs no tokens.
* **Presence across rooms.** See who's online in every room you share, with a status line for unread messages and an optional toast when someone @mentions you.
* **Private rooms.** Rooms are joined with a passcode, and the database only shows a room's messages to its members.
* **Survives bad networks.** After a dropped connection, a closed laptop or a crashed process, it reconnects by itself and fetches exactly the messages you missed.
* **Fits any terminal.** Docked beside the transcript in a wide terminal, compact above the prompt in a narrow one, and a one-line summary when the pane is closed.

It is a Claude Code mod: a plugin of function hooks, plus a small Node process that holds the connection to Supabase. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the pieces fit.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

### Built With

[![JavaScript][js-shield]][js-url]
[![Node.js][nodejs-shield]][nodejs-url]
[![Supabase][supabase-shield]][supabase-url]
[![PostgreSQL][postgres-shield]][postgres-url]
[![esbuild][esbuild-shield]][esbuild-url]
[![Resend][resend-shield]][resend-url]

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Getting Started

### Prerequisites

* Claude Code 2.1.287 or newer, in the terminal. The desktop app can't start the chat's background process yet.
* Node 22 or newer on your `PATH`:
  ```sh
  node --version
  ```
* A terminal with truecolor, such as iTerm2, Ghostty, kitty or WezTerm.
* For the side-by-side layout: Claude Code's fullscreen layout (`/tui fullscreen`) and a terminal at least 110 columns wide.

> [!NOTE]
> Claude Code decides where the pane goes, not the mod. Below 110 columns the pane opens above the prompt in a compact layout. While it's closed, a one-line summary sits above the prompt with an **Open** button.

### Installation

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
3. Open the pane:
   ```
   /chat
   ```

To update later:

```sh
claude plugin marketplace update squad-chat && claude plugin update squad-chat@squad-chat
```

To uninstall:

```sh
claude plugin uninstall squad-chat@squad-chat && claude plugin marketplace remove squad-chat
```

To try it without installing:

```sh
git clone https://github.com/chrisluo5311/squad-chat.git
claude --plugin-dir ./squad-chat/plugins/squad-chat
```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Usage

### First run

1. `/chat` opens the pane.
2. Type your email in the pane and press Enter. You'll get an email with an 8-digit code; type it in the pane.
3. Create a room and give its name and passcode to your friends. Type this in the pane:
   ```
   /room our-team some-passcode
   ```
   Your friends join with the same line.
4. Chat: type in the pane and press Enter. Esc goes back to the prompt.

<div align="center">
  <img src="docs/screenshots/sign-in.png" alt="The sign-in card: step 1 of 2, enter your email" width="100%">
</div>

### Commands

| Command | What it does |
| --- | --- |
| `/chat` | Open the pane |
| `/say <message>` | Send a message to the current room from the prompt |
| `/room` | List your rooms |
| `/room <name>` | Switch to a room you're in (or click its tab) |
| `/room <name> <passcode>` | Create a room, or join a friend's |
| `/room leave <name>` | Leave a room; rejoin any time with its passcode |
| `/room delete <name>` | Delete a room you created, with all its messages, for everyone. Run it twice to confirm. |
| `/who` | Who's online, across all your rooms |
| `/chat-login <email>`, then `/chat-login <code>` | Sign in from the prompt instead of the pane |
| `/chat-logout` | Sign out on this computer |
| `/chat notify on` / `off` | Toast when someone writes `@yourname` (off by default) |

The pane's input box takes `/room`, `/who`, `/logout` and `/help` too. Type passcodes there: it never touches the conversation.

### Layouts

| Where | What you see |
| --- | --- |
| Docked (fullscreen, ≥ 110 columns) | Room tabs, a FRIENDS card, and the room's messages as bubbles: yours on the right, theirs on the left, grouped by sender, with date labels and a **new** line where you stopped reading |
| Above the prompt (narrower) | The room, who's online, the last five messages and the input box |
| Pane closed | One line: the room, who's online, unread count, the latest message and **Open** |
| Status line | Unread counts per room, such as `💬 #team 3` |

<div align="center">
  <img src="docs/screenshots/band.png" alt="The one-line summary above the prompt while the pane is closed" width="100%">
</div>

### Two accounts on one computer

Each account needs its own config folder. Start the second Claude Code with:

```sh
SQUAD_CONFIG_DIR=~/.config/squad-chat-b claude
```

Gmail delivers `you+b@gmail.com` to `you@gmail.com`, which makes a handy second account for trying it out.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Privacy & Security

* **What Claude sees.** Nothing typed in the pane enters the conversation. The arguments of `/say`, `/room` and `/chat-login` are replaced with a placeholder before Claude Code stores the command, and command answers are notices the model never reads. Claude Code still keeps a slash command's raw text in one bookkeeping line of the local transcript on your own disk, so type passcodes in the pane if that matters to you.
* **Who sees your messages.** Only members of the room. Access is enforced in the database with row-level security, and you become a member only with the room's passcode. Five wrong passcodes lock you out for 15 minutes.
* **What friends see.** Your display name (the part of your email before the `@`) and whether you're online. Never your email.
* **What's stored.** Messages are deleted after 30 days. Your sign-in session is kept in `~/.config/squad-chat/session.json`, readable only by you; `/chat-logout` removes it.
* **Abuse limits.** At most 10 messages per 10 seconds per person, and 500 characters per message.

Found a security problem? Please [open an issue](https://github.com/chrisluo5311/squad-chat/issues/new?labels=security) without exploit details and I'll get in touch.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Development

```sh
# The mod
claude plugin validate ./plugins/squad-chat   # check the manifest and hooks
claude plugin test ./plugins/squad-chat       # mod tests, against a fake bridge
claude --plugin-dir ./plugins/squad-chat      # run Claude Code with this checkout

# The bridge
cd plugins/squad-chat/bridge
npm install && npm run build                  # rebuild dist/bridge.mjs after editing src/
npm test                                      # two users, two bridges, local Supabase

# The database
supabase start                                # local stack on ports 56420-56429
supabase test db                              # pgTAP access-control tests
supabase db advisors --local --type all
```

To run the mod against the local stack, start Claude Code with:

```sh
SQUAD_SUPABASE_URL=http://127.0.0.1:56421 \
SQUAD_SUPABASE_KEY=<local publishable key from `supabase status`> \
SQUAD_CONFIG_DIR=$(mktemp -d) \
claude --plugin-dir ./plugins/squad-chat
```

Sign-in emails land in the local mail UI at http://127.0.0.1:56424.

| Path | Contents |
| --- | --- |
| `plugins/squad-chat/hooks/squad-chat.mjs` | Hooks: commands, pane, band, status line, the bridge client, keeping chat out of the conversation |
| `plugins/squad-chat/hooks/state.mjs` | State built from the bridge's events |
| `plugins/squad-chat/hooks/commands.mjs` | Slash commands and the pane's input box |
| `plugins/squad-chat/hooks/views.mjs` | The docked pane, the compact pane and the band |
| `plugins/squad-chat/hooks/theme.mjs` | Colors and glyphs |
| `plugins/squad-chat/bridge/src/` | The Node bridge (bundled into `bridge/dist/bridge.mjs`) |
| `plugins/squad-chat/tests/` | Mod tests |
| `bridge-tests/` | Bridge tests against a local Supabase |
| `supabase/migrations/`, `supabase/tests/` | Schema, RLS and pgTAP tests |
| `docs/ARCHITECTURE.md` | How it fits together, and why |

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Self-hosting the backend

By default squad-chat talks to the shared hosted project. To run your own:

1. Create a Supabase project and apply `supabase/migrations/` (for example with `supabase link` and `supabase db push`).
2. Under **Realtime → Settings**, turn off **Allow public access to channels**.
3. Set up custom SMTP (for example Resend), then change the **Confirm signup** and **Magic Link** email templates to show `{{ .Token }}`, the sign-in code.
4. Point the bridge at it by setting these before starting Claude Code:
   ```sh
   export SQUAD_SUPABASE_URL=https://<project-ref>.supabase.co
   export SQUAD_SUPABASE_KEY=<publishable key>
   ```

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Roadmap

- [x] Supabase backend: rooms with passcodes, RLS, rate limits, 30-day retention
- [x] Email-code sign-in and a Node bridge for Realtime presence and messages
- [x] Catch-up after network drops, and a watchdog for stuck reconnects
- [x] Docked pane, compact pane, one-line band and status line
- [x] Chat bubbles, room tabs, unread markers and @mention toasts
- [x] Leave and delete rooms
- [ ] `/chat-name` to change your display name
- [ ] A polling mode for the Claude Code desktop app, which can't start the bridge
- [ ] Typing indicators

See the [open issues](https://github.com/chrisluo5311/squad-chat/issues) for proposed features and known issues.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Contact

chrisluo5311 · [@chrisluo5311](https://github.com/chrisluo5311)

Project link: [https://github.com/chrisluo5311/squad-chat](https://github.com/chrisluo5311/squad-chat)

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Acknowledgments

* [Supabase](https://supabase.com), for auth, Postgres and Realtime
* [Resend](https://resend.com), for delivering sign-in codes
* [glowup](https://github.com/NovusEdge/glowup), whose classic pack inspired the palette and card layout
* [Shields.io](https://shields.io) and [Hits](https://hits.sh), for the badges
* [Best-README-Template](https://github.com/othneildrew/Best-README-Template), for this README's layout

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[stars-shield]: https://img.shields.io/github/stars/chrisluo5311/squad-chat?style=for-the-badge&logo=github&color=f5c542
[stars-url]: https://github.com/chrisluo5311/squad-chat/stargazers
[version-shield]: https://img.shields.io/badge/dynamic/json?style=for-the-badge&label=version&color=d97757&url=https%3A%2F%2Fraw.githubusercontent.com%2Fchrisluo5311%2Fsquad-chat%2Fmain%2Fplugins%2Fsquad-chat%2F.claude-plugin%2Fplugin.json&query=%24.version
[version-url]: plugins/squad-chat/.claude-plugin/plugin.json
[license-shield]: https://img.shields.io/badge/license-MIT-3da639?style=for-the-badge
[license-url]: LICENSE
[made-for-shield]: https://img.shields.io/badge/made%20for-Claude%20Code-d97757?style=for-the-badge&logo=claude&logoColor=white
[made-for-url]: https://claude.com/claude-code
[node-shield]: https://img.shields.io/badge/node-%E2%89%A5%2022-6cc070?style=for-the-badge&logo=nodedotjs&logoColor=white
[node-url]: https://nodejs.org
[views-shield]: https://hits.sh/github.com/chrisluo5311/squad-chat.svg?style=for-the-badge&label=views&color=e2b86b
[views-url]: https://hits.sh/github.com/chrisluo5311/squad-chat/
[js-shield]: https://img.shields.io/badge/JavaScript-F7DF1E?style=for-the-badge&logo=javascript&logoColor=black
[js-url]: https://developer.mozilla.org/docs/Web/JavaScript
[nodejs-shield]: https://img.shields.io/badge/Node.js-339933?style=for-the-badge&logo=nodedotjs&logoColor=white
[nodejs-url]: https://nodejs.org
[supabase-shield]: https://img.shields.io/badge/Supabase-3ECF8E?style=for-the-badge&logo=supabase&logoColor=white
[supabase-url]: https://supabase.com
[postgres-shield]: https://img.shields.io/badge/PostgreSQL-4169E1?style=for-the-badge&logo=postgresql&logoColor=white
[postgres-url]: https://www.postgresql.org
[esbuild-shield]: https://img.shields.io/badge/esbuild-FFCF00?style=for-the-badge&logo=esbuild&logoColor=black
[esbuild-url]: https://esbuild.github.io
[resend-shield]: https://img.shields.io/badge/Resend-000000?style=for-the-badge&logo=resend&logoColor=white
[resend-url]: https://resend.com
