<a id="readme-top"></a>

<div align="center">

[![Stars][stars-shield]][stars-url]
[![Version][version-shield]][version-url]
[![CI][ci-shield]][ci-url]
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
  <strong>Claude's cooking. Chat with your squad.</strong>
  <br />
  Friends online, right beside your Claude Code session. Zero tokens, zero leaks to Claude.
  <br />
  <a href="https://chrisluo5311.github.io/squad-chat/"><strong>Read the docs »</strong></a>
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
        <li><a href="#connect-to-a-server">Connect to a server</a></li>
      </ul>
    </li>
    <li>
      <a href="#usage">Usage</a>
      <ul>
        <li><a href="#first-run">First run</a></li>
        <li><a href="#built-in-rooms">Built-in rooms</a></li>
        <li><a href="#commands">Commands</a></li>
        <li><a href="#layouts">Layouts</a></li>
        <li><a href="#two-accounts-on-one-computer">Two accounts on one computer</a></li>
      </ul>
    </li>
    <li><a href="#host-your-own-server">Host your own server</a></li>
    <li><a href="#license">License</a></li>
    <li><a href="#acknowledgments">Acknowledgments</a></li>
  </ol>
</details>

## About The Project

https://github.com/user-attachments/assets/b83d9a2c-673a-40d0-90a3-a2c717b6c79a

<div align="center">
  <sub>Chatting with the squad while Claude runs a subagent, then the Agents, Usage and Git rooms, and a Usage snapshot shared to the room.</sub>
</div>

<br />

squad-chat puts a group chat next to your Claude Code conversation. You keep working with Claude on the left while your friends' messages come in on the right.

* **Lives inside Claude Code.** One `/chat` command opens a pane: no browser tab, no extra app.
* **Never reaches Claude.** What you type in the pane never enters the conversation, and slash-command arguments are hidden from the model, so chatting costs no tokens.
* **Share code and diffs.** Post the code you selected, Claude's last code block or your `git diff` to the room as a card your friends can copy, without copying and pasting.
* **Presence across rooms.** See who's online in every room you share and who's typing, with a status line for unread messages, an optional toast when someone @mentions you, and a do-not-disturb mode for when Claude is busy.
* **Your own server.** Each group of friends runs its own free Supabase project. There is no central service and no account with us.
* **Private rooms.** Rooms are joined with a passcode, and the database only shows a room's messages to its members.
* **Survives bad networks.** After a dropped connection, a closed laptop or a crashed process, it reconnects by itself and fetches exactly the messages you missed.
* **Built-in rooms for your session.** Next to the chat rooms, the Usage, Git and Agents tabs show context fill, cost, rate limits and tool timings, your pull requests and CI, and every Claude Code session's subagents as they work. Focus is a Pomodoro timer with a chime, Clipboard keeps what you copied lately, and Pet is Clawd, moving along with your session. They need no server and no sign-in.
* **Fits any terminal.** Docked beside the transcript in a wide terminal, compact above the prompt in a narrow one, and a one-line summary when the pane is closed.

It is a Claude Code mod: a plugin of function hooks, plus a small Node process that holds the connection to Supabase. [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the pieces fit.

The full guide, with search, lives at **[chrisluo5311.github.io/squad-chat](https://chrisluo5311.github.io/squad-chat/)**. [Privacy & security](https://chrisluo5311.github.io/squad-chat/reference/privacy/), [development](https://chrisluo5311.github.io/squad-chat/reference/development/) and the [roadmap](https://chrisluo5311.github.io/squad-chat/reference/roadmap/) are there too. Found a security problem? Please report it privately, as described in [SECURITY.md](SECURITY.md).

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

* Claude Code 2.1.292 or newer, in the terminal or the desktop app. On the desktop app the chat and every room are drawn with the app's own pieces.
* Node 22 or newer on your `PATH`:
  ```sh
  node --version
  ```
* A server: one Supabase project per group of friends. Get its URL and key from whoever hosts it, or [host one yourself](#host-your-own-server).
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
3. [Connect to a server](#connect-to-a-server), then open the pane with `/chat`.

To update later:

```sh
claude plugin marketplace update squad-chat && claude plugin update squad-chat@squad-chat
```

If you host your group's server, also run `supabase db push` again from an updated clone, so the server has what the new version needs. For example, shared snippets need 0.7.0's database change.

To uninstall:

```sh
claude plugin uninstall squad-chat@squad-chat && claude plugin marketplace remove squad-chat
```

To try it without installing:

```sh
git clone https://github.com/chrisluo5311/squad-chat.git
claude --plugin-dir ./squad-chat/plugins/squad-chat
```

### Connect to a server

squad-chat has no central server. Each group of friends shares one Supabase project, its *server*: one person [hosts it](#host-your-own-server) on Supabase's free plan, and everyone else connects with two values from them:

* the project URL, such as `https://abcd1234.supabase.co`
* the project's **publishable** key, `sb_publishable_…` (safe to share, unlike the secret key, which you never share)

Set them when you install:

```sh
claude plugin install squad-chat@squad-chat \
  --config supabase_url=https://abcd1234.supabase.co \
  --config supabase_key=sb_publishable_...
```

or later, from `/config` in Claude Code (squad-chat's options), or from a shell:

```sh
echo '{"supabase_url":"https://abcd1234.supabase.co","supabase_key":"sb_publishable_..."}' \
  | claude plugin configure squad-chat@squad-chat --values-stdin
```

Until a server is set, the pane says so and shows these steps.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Usage

### First run

1. `/chat` opens the pane.
2. Sign in, depending on how your server is set up:
   * **With a name:** type the name you want and press Enter. That's it.
   * **With your email:** type your email and press Enter, then type the code from the email.
3. Create a room and give its name and passcode to your friends. Type this in the pane:
   ```
   /room our-team some-passcode
   ```
   Your friends join with the same line.
4. Chat: type in the pane and press Enter. Esc goes back to the prompt.

> [!IMPORTANT]
> **An account made with just a name can't be recovered.** It has no email, so once you sign out, delete `~/.config/squad-chat` or switch computers, you can't sign back into it. Signing in again makes a new account: rejoin your rooms with their passcodes and you'll see their history again. Messages from the old account stay in the rooms until they expire after 30 days. Signing in by email doesn't have this problem.

<div align="center">
  <img src="docs/screenshots/sign-in.png" alt="The sign-in card: step 1 of 2, enter your email" width="100%">
</div>

<br />

### Built-in rooms

Five tabs sit before your chat rooms: **◔ Usage**, **⎇ Git**, **⟡ Agents**, **⌘ Snippets** and **▦ Monitor**. Four more, **☀ Weather**, **✦ Tech News**, **$ Stocks** and **♫ Lo-fi**, wait until you turn them on with `/chat rooms +weather`, `+news`, `+stock` or `+lofi`, since they reach the web (each one says where when you turn it on). None of them needs a server or a sign-in, and nothing in them goes to a chat room unless you share it. Each tab has its own color and a badge when something there is worth a look, such as a red dot on Git when this branch's checks fail. When the tabs don't fit on one line, the ones you're not looking at shrink to their icon.

Open one with `/chat usage`, `/chat git`, `/chat agents`, `/chat snippet`, `/chat monitor`, `/chat weather`, `/chat news`, `/chat stock` or `/chat lofi`, or press its tab. While the pane is closed, the line above the prompt sums up the room you were last in.

#### ◔ Usage

How this session is using Claude, updated as it works:

* **Context, 5-hour and 7-day.** How full the context window is (press **Context** for what fills it), and how much of each rate-limit window you've used, with when it resets.
* **Spend.** What the session has cost, the rate per hour, a sparkline of the last hour, the tokens used and how many came from the prompt cache.
* **Tools.** For each tool, the typical time (p50), the slow time (p95), how many calls and how many failed.
* **Subagents.** Each one Claude starts, what it's doing and which tool it uses most.

<div align="center">
  <img src="docs/assets/usage.gif" alt="The Usage room docked beside the conversation. Claude starts an Explore subagent and runs Bash and Read, and the room fills in: context and the 5-hour and 7-day meters, the spend tiles, each tool's p50 and p95 with calls and failures, and the subagent as it finishes." width="100%">
  <sub>Claude starts a subagent and a few tools, and the Usage room fills in as they run.</sub>
</div>

<br />

Above the prompt, the context reads as a forecast (☀ Clear, ☁ Cloudy, ☂ Showers, ☇ Storm, ↯ Compact soon) with a chart of the last turns and how much the last one added, then the 5-hour window and what you've spent:

```
◔ Usage │ ☀ Clear 12% 121k/1.0M ▅▆█ ▲+28k · 5-hour 18% · spent $0.88
```

#### ⎇ Git

Where your branch stands on GitHub, read through the [`gh` CLI](https://cli.github.com) as you're already signed in:

* **The branch.** Commits ahead and behind its remote (`↑2 ↓1`, or `local` before its first push) and how many files you've changed.
* **This branch's pull request.** Its checks as they run, who approved, who's been asked to review, and whether it can merge.
* **Pull requests, Actions, issues and alerts.** Open pull requests with the ones waiting for your review first, the latest run of each workflow, issues assigned to you and Dependabot alerts.
* **Toasts** when checks fail or all pass, someone asks for your review, or your pull request is approved, merged or in conflict.

It refreshes every minute while you look at it, every five minutes otherwise, and shortly after a `git push`. Type `r` in the pane to refresh now, and press ⧉ to copy a link.

<div align="center">
  <img src="docs/assets/git.gif" alt="The Git room for the squad-chat repository on a merged branch: PR #8 merged with all five checks passed, no other open pull requests, the latest Actions runs and no assigned issues, then r refreshes it." width="100%">
  <sub>A merged branch: PR #8 and its five checks, the latest Actions runs, and a refresh with r.</sub>
</div>

<br />

#### ⟡ Agents

Every Claude Code session on this computer, in one place:

* **Sessions.** Each one's folder, branch and model, and what it's doing right now: thinking, running a tool, waiting on an agent, or idle.
* **Subagents as a tree** under the session that started them. Press ▾ to fold one.
* **A live feed** of tool calls from all of them, with their times. The filter shows all sessions, only this one, or only failures.

<div align="center">
  <img src="docs/assets/agents.gif" alt="The Agents room with two sessions: this one waits on an Explore subagent while the other, in another repository, runs Bash commands one after another. The live feed interleaves both sessions' tool calls with their times." width="100%">
  <sub>Two sessions at once: this one waits on a subagent while the other runs commands.</sub>
</div>

<br />

#### ◷ Focus

A Pomodoro timer beside your work:

* **A ring** counts the focus round down, then the break. Press **▶ Start**, **⏸ Pause**, **⏭** to end the phase now, or **↺** to start over.
* **A chime and a toast** when focus ends, and the break starts by itself. When the break ends it chimes again and waits for you.
* **Your lengths.** Press − and + in the room, or type `50 10` in its box (or `/focus 50 10` at the prompt) for 50 minutes of focus and 10 of break. They're kept, and so is the count of rounds you finished today.
* **A streak**, drawn as GitHub draws contributions: a square a day for the last few months under the months' names, darker the more rounds you finished (the legend runs from Less to More), with how many days in a row you've kept it up and your best run.

While it runs, the status line shows `🍅 18:42` (`☕` in a break), and the Focus tab shows the minutes left from any other room. With the pane closed, the band above the prompt shows the phase and its time, ten cells for how far it has gone, the streak with this week's days, and what comes next. It turns green during a break. A reload carries on where the timer was.

#### ⧉ Clipboard

What you copied lately, newest first, so you can copy it again. Press **⧉** on a row, **✕** to drop one, or **Clear**. It reads the clipboard every 2 seconds while the room has a tab (`pbpaste` on a Mac, `wl-paste` or `xclip` on Linux) and keeps the last 30 items in memory only, gone when the session ends. Anything that looks like a key or a token shows masked, though ⧉ still copies it whole, and nothing in the room can be shared to a chat. The band above the prompt shows how many are kept and the newest one's first line. It's off until you add it with `/chat rooms +clipboard` or the desktop's **+**.

#### ✿ Pet

Clawd's corner. In the desktop app Clawd is a vector drawing that moves on its own, standing on a little floor:

* **Moods.** On **Auto** it follows what goes on: typing while Claude works, cheering when a focus round ends, vibing through a break, waving at a new message, puzzled when this branch's checks fail, and asleep after ten quiet minutes. Pick a mood in the room to keep it on.
* **Today together**: how long Claude worked today, the focus rounds you finished, and how Clawd feels.
* **A bond** that grows with every focus round and every ten minutes of work, a level at a time.
* **Lately**, a short log of what Clawd noticed: a round finished, a break over, someone writing in a room (who and where, never what), checks failing, a long stretch of work, dozing off.

With the pane closed, the band above the prompt has Clawd saying the latest thing it noticed, or how it feels. Clawd also keeps you company by the pane's input box in every room. **By the input box** picks how: **Stroll** back and forth in the room after the buttons, **Stop & go** (a few steps, a stop to wave, on to the end and back), just **Sit** at the end, or **Off**. The pace follows the mood: a trot while Claude types, an easy walk otherwise, and asleep in the corner after a quiet while. The terminal draws the pixel stickers in half blocks.

#### ⌘ Snippets

Code you reach for again and again, kept on this computer and one click from your clipboard:

* **Save** text you type with `/snippet add <text>`, or what you selected (or else the last code block in Claude's reply) with `/snippet add`. In the Snippets room, text typed in the box and added is saved too. Snippets are numbered #1, #2, #3 and on, and a language comes along when Claude's block names one.
* **⧉** copies a snippet, and **⇪** shares it to a chat room, with the same preview as `/chat-share`.
* **Tidy up** with `/snippet rename <old> -> <new>` and `/snippet delete <name>`. `/snippet copy <name>` and `/snippet share <name> [#room]` work from the prompt too.

The list lives in `~/.config/squad-chat/room-data/snippet/list.json`, readable only by you. Snippets is the first *function room*: a room drawn from a small manifest that names where its data comes from, so more rooms can follow without new drawing code. [ARCHITECTURE.md](docs/ARCHITECTURE.md#function-rooms) explains how they work.

#### ▦ Monitor

This computer, as it runs, with no sudo:

* **CPU** use with a chart of the last couple of minutes, the load, and with [macmon](https://github.com/vladkens/macmon) the temperature and power.
* **Memory** used, memory pressure and swap.
* **GPU and power**: GPU use, and with macmon its temperature, the power each part draws, and the fans.
* **Network** in and out, with a chart, **disk** space, and the **battery**: charge, charging or not, time left and the watts going in or out.

Temperatures and power need macmon on a Mac (`brew install macmon`), since macOS keeps them from anything without root. Without it those parts are left out and the room says how to add them. On Linux it reads `/proc`, `/sys` and `nvidia-smi`. It samples every 2 seconds while you look at it and every 30 otherwise, for the line above the prompt.

It toasts when the CPU runs hot, memory or the disk is nearly full, or the battery is nearly flat, once each until it passes, and never during do not disturb. `/chat set monitor cpu_temp 90` and `/chat set monitor memory 90` move the thresholds, and `/chat set monitor alerts off` stops them.

#### ☀ Weather

Now, the next 24 hours and the week, for the cities you pick, from [Open-Meteo](https://open-meteo.com) with no key:

* **Now.** Each city with its country code, its sky, temperature right now and the air quality (US AQI). Today's high, low and chance of rain are in This week.
* **The next 24 hours** for the city you pressed in Now (the first one to start): what it feels like, humidity, wind, and the chance of rain hour by hour.
* **This week** for that city: each day's sky, high and low, and chance of rain.
* **Sunrise & sunset** for that city: when the sun rises and sets, how much daylight that makes, how long until the next sunrise or sunset, and today's UV with its level (low, moderate, high, very high, extreme).

On the desktop app, Now shows each city as a tile (press its name to show it below), the next 24 hours as a temperature line over the chance of rain, the week as a column per day, and the sun as an arc across the card with the sun where it is now (a moon at night).

Add a city by typing its name in the room's box and pressing add (or several, `Osaka, Seoul`), or from anywhere with `/chat set weather cities Tokyo`. It goes below the ones you have. ✕ at the end of a city's row drops it, as does `-Tokyo`, and once one city is left the ✕ goes, so there's always one. A name the place search can't find is refused, and the country code after each name shows when a slip landed on another real place. Units are `/chat set weather units imperial`, and `/chat set weather city Tokyo` picks the city shown below, as pressing it does. Inside the room, `/set cities …` does the same. It refreshes every 10 minutes while you look at it and every 30 otherwise.

#### ✦ Tech News

[Hacker News](https://news.ycombinator.com) and tech feeds (iThome, The Verge, Ars Technica and TechCrunch to start), newest first. **⧉** copies a story's link and **⇪** shares it to a chat room. `/chat set news hn best` picks the Hacker News list (`top`, `best`, `new` or `off`), and `/chat set news feeds -https://techcrunch.com/feed/` drops a feed. A feed has to come from one of the room's sites. It refreshes every 15 minutes while you look at it and every 30 otherwise.

#### $ Stocks

Your watchlist of Taiwan and US stocks and indices, each with today's line, its change and whether its market is open. Taiwan prices come from TWSE's own service and everything else from Yahoo Finance, with no key. Prices may be delayed, and none of it is investment advice.

* **Watch** with `/chat set stock watchlist TAIEX, 2330, 0050, AAPL, ^GSPC` (up to 12, or `+2454` and `-NVDA`). A Taiwan code works for listed and OTC stocks alike, `TAIEX` is the index, and anything else is a Yahoo symbol, such as `BRK-B`, `7203.T` or `0700.HK`.
* **Colors** follow each market by default, red for up in Taiwan and green for up in the US. `/chat set stock colors red-up` or `green-up` makes them all one way.
* **Alerts** toast when a stock moves 5% or more in a day, once each way. `/chat set stock move 3` changes it, and `0` stops them.

A market counts as open only when its quotes are from today and the clock is inside its session, so a holiday reads as closed. It refreshes every minute while you look at it and every 5 otherwise, and asks for nothing more than every 15 minutes while every market is closed.

#### ♫ Lo-fi

Music in the background while you work, played the way [Pixel Play](https://github.com/chrisluo5311/Pixel-Play) plays it: through [mpv](https://mpv.io), with YouTube through [yt-dlp](https://github.com/yt-dlp/yt-dlp) (`brew install mpv yt-dlp`).

* **Stations** to start: Lofi Girl's YouTube live streams (looked up each time, as their links change) and SomaFM's Groove Salad, Fluid, Lush and Drone Zone.
* **Your own**: paste a stream or YouTube link, or a path like `~/Music/focus` (a file or a whole folder), into the room's box and press add. `/lofi add <url or path>` does the same from anywhere. `/lofi import` brings in Pixel Play's playlist. `/lofi remove <name>` (or ✕ on its row) takes one off. A built-in station taken off is only hidden: `/lofi restore` brings them back.
* **Play** with ▶ on a row, the ⏮ ⏯ ⏹ ⏭ − + buttons, or single keys typed in the room: `p` plays or pauses, `n` next, `b` back, `s` stop, `u` and `d` volume. `/lofi play <name>`, `pause`, `next` and `vol 40` work from the prompt.

Nothing plays or reaches the network until you press play. mpv stops when the session ends, however it ends. If Pixel Play is playing too, the room says so. `/chat-share lofi` tells a chat room what you're listening to.

#### The room store

More rooms, written by anyone, live in the [room store](https://chrisluo5311.github.io/squad-chat/rooms/store/): `/chat store` lists them, and `/chat install dev-blogs` shows one, with the hosts it reaches, then installs it on a second run. Crypto prices, exchange rates, dev blogs and security news are there to start. `/chat update` brings installed rooms up to date (asking again if a new version reaches new hosts), and `/chat uninstall <id>` removes one with its settings. A room is one JSON file that can only use squad-chat's own providers and reach the hosts it names, so installing one never runs anyone's code. [Write a room](https://chrisluo5311.github.io/squad-chat/rooms/write-a-room/) shows how to add yours.

To show the team, press **⇪ Share** under a built-in room, or type `/chat-share usage` (or `git`, `agents`), and a snapshot of the room goes to a chat room as a card, for "here's where my PR stands" or "this refactor cost $4". The preview lists your rooms, so pick the one it should go to before you press **Send**, or name it with `/chat-share usage #room`. `/chat rooms usage,git` picks which tabs you want, `/chat rooms -snippet` or `+snippet` drops or brings back one, and `/chat rooms none` hides them all.

### Commands

| Command | What it does |
| --- | --- |
| `/chat` | Open the pane |
| `/say <message>` | Send a message to the current room from the prompt |
| `/room` | List your rooms |
| `/room <name>` | Switch to a room you're in (or click its tab) |
| `/room <name> <passcode>` | Create a room, or join a friend's |
| `/room leave <name>` | Leave a room. Rejoin any time with its passcode. |
| `/room delete <name>` | Delete a room you created, with all its messages, for everyone. Run it twice to confirm. |
| `/who` | Who's online, across all your rooms |
| `/chat-login <email>`, then `/chat-login <code>` | Sign in by email from the prompt instead of the pane |
| `/chat-login <name>` | Sign in with just a name, where the server allows it |
| `/chat-name <new name>` | Change your display name. Your friends see the new one right away. |
| `/chat-share [#room]` | Share the text you selected, or else the last code block in Claude's reply, to the current room or the one you name. You see it first, then `/chat-share send` posts it (or `/chat-share cancel`). |
| `/chat-share diff [path] [#room]` | Share your uncommitted changes (`git diff HEAD`), all of them or one file's |
| `/chat-share to #room` | Send what's waiting in the preview to another of your rooms instead. `/chat-share send #room` picks the room and posts in one go. |
| `/chat-logout` | Sign out on this computer |
| `/chat notify on` / `off` | Toast when someone writes `@yourname` (off by default) |
| `/chat dnd on` / `off` / `auto` | Do not disturb: no toasts, a quiet band and status line, and friends see you as busy. `auto` turns it on while Claude works on something longer than 30 seconds, then sums up what you missed. |
| `/chat usage` / `git` / `agents` / `focus` / `clipboard` / `pet` / `snippet` / `monitor` / `weather` / `news` / `stock` / `lofi` | Open the pane on a [built-in room](#built-in-rooms). `/chat chat` goes back to the chat. |
| `/chat band [room]` | Show another room in the band above the prompt without opening the pane. **‹** and **›** on the band do the same, one room at a time. |
| `/chat rooms <list>` | Which built-in rooms have tabs: any of `usage`, `git`, `agents`, `focus`, `clipboard`, `pet`, `snippet`, `monitor`, `weather`, `news`, `stock`, `lofi`, or `all`, or `none`. `+name` and `-name` add or drop one. |
| `/focus start` / `pause` / `skip` / `reset` / `<focus min> [break min]` | Drive the Focus room's timer from the prompt. `/focus` alone opens the room. |
| `/chat-share usage` / `git` / `agents` / `snippet` `[#room]` | Share a snapshot of a built-in room to the current room or the one you name |
| `/chat store [words]` | The rooms in the [room store](https://chrisluo5311.github.io/squad-chat/rooms/store/), and which you have |
| `/chat install <id>` / `update [id]` / `uninstall <id>` | Install a room from the store (a look first, then again to install), bring installed ones up to date, or remove one |
| `/chat set <room> [<setting> <value>]` | Show or change a room's settings, such as `/chat set weather cities Tokyo`. A list also takes `+one` and `-one`, and `default` puts a setting back. Some lists, as Weather's cities, add what's typed instead of replacing the list. |
| `/snippet add <text>` | Save the text as a snippet. Snippets are numbered 1, 2, 3 and on |
| `/snippet add` | Save the text you selected, or else the last code block in Claude's reply, to the Snippets room |
| `/snippet rename <old> -> <new>` / `delete <name>` | Rename or delete a saved snippet |
| `/snippet copy <name>` / `share <name> [#room]` | Copy a saved snippet, or share it to a chat room after a look |
| `/lofi play [name]` / `pause` / `next` / `prev` / `stop` / `vol <0-100>` | Drive the Lo-fi room's player from the prompt |
| `/lofi add <url, file or folder> [# name]` / `remove <name>` / `import` | Add to the Lo-fi room's list, take one off, or bring in Pixel Play's playlist |

The pane's input box takes `/room`, `/who`, `/name`, `/dnd`, `/share`, `/snippet`, `/lofi`, `/set`, `/usage`, `/git`, `/agents`, `/focus`, `/clipboard`, `/pet`, `/chat` (with `rooms`, `set`, `store`, `install`, `update` and `uninstall`), `/logout` and `/help` too, where the preview lets you pick the room and has **Send** and **Cancel** buttons. In the Git room and the function rooms, `r` refreshes, and in Lo-fi single keys drive the player. In Focus, `start`, `pause`, `skip`, `reset` or `50 10` drive the timer, and in Pet a mood's name (`wave`, `sleepy`, `auto`) picks it. Type passcodes there: it never touches the conversation.

#### Examples

Start a room and bring your friends in:

```
/room design pixels42        create #design (or join it, if a friend made it) with passcode pixels42
/room squad                  switch to #squad, a room you're already in
/room                        list your rooms and their unread counts
/say standup in 5?           post to the current room without opening the pane
/who                         who's online, and in which rooms
/chat-name captain           show up as captain from now on
```

<div align="center">
  <img src="docs/assets/rooms.gif" alt="From the prompt: /room design pixels42 joins a friend's room, /room lists the rooms with an unread count, /room squad switches back, /say posts a message, /who shows who's online, and /chat-name captain changes the name. The pane then shows the conversation." width="100%">
  <sub>Rooms from the prompt: join with a passcode, list, switch, post with /say, see who's online and pick a new name.</sub>
</div>

<br />

Share code and diffs:

```
/chat-share                  the text you selected, or Claude's last code block, to the current room
/chat-share #design          the same, to #design
/chat-share diff             all your uncommitted changes
/chat-share diff src/a.ts    only src/a.ts
/chat-share diff src/a.ts #design
/chat-share send             post what the preview showed
/chat-share cancel           drop it
```

<div align="center">
  <img src="docs/assets/share.gif" alt="Claude writes a debounce helper. /chat-share shows a preview of its code block and /chat-share send posts it. /chat-share diff does the same for an uncommitted change. In the pane both appear as cards, the diff colored, and a friend replies." width="100%">
  <sub>Sharing Claude's code block and an uncommitted diff: a preview first, then a card in the room.</sub>
</div>

<br />

Stay focused:

```
/chat dnd on                 no toasts, and friends see you as busy
/chat dnd auto               the same, but only while Claude works on something longer than 30 seconds
/chat dnd off                back to normal, with one summary of what you missed
/chat notify on              a toast when someone writes @yourname
```

<div align="center">
  <img src="docs/assets/dnd.gif" alt="With /chat dnd on, the band above the prompt turns grey and shows a muted count while a friend writes, with no toast. After /chat dnd off, one toast sums up the missed messages and the pane shows them." width="100%">
  <sub>Do not disturb: the band stays grey while sam writes, and one toast sums it up after.</sub>
</div>

<br />

### Layouts

| Where | What you see |
| --- | --- |
| Docked (fullscreen, ≥ 110 columns) | Room tabs, a FRIENDS card, and the room's messages as bubbles: yours on the right, theirs on the left, grouped by sender, with date labels and a **new** line where you stopped reading |
| Above the prompt (narrower) | The room, who's online, the last five messages and the input box |
| Pane closed | One line: the room, who's online, unread count, the latest message and **Open** |
| Status line | Unread counts per room, such as `💬 #team 3`, or `🔕 #team 3` during do not disturb. The built-in rooms add `◔ 85%` when the context is nearly full, `✗ CI` when this branch's checks fail and `🍅 18:42` while a focus timer runs, and nothing otherwise. |

<div align="center">
  <img src="docs/screenshots/band.png" alt="The one-line summary above the prompt while the pane is closed" width="100%">
</div>

<br />

### Two accounts on one computer

Each account needs its own config folder. Start the second Claude Code with:

```sh
SQUAD_CONFIG_DIR=~/.config/squad-chat-b claude
```

Gmail delivers `you+b@gmail.com` to `you@gmail.com`, which makes a handy second account for trying it out.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Host your own server

One person per group does this, once. It fits in Supabase's free plan.

1. **Create a Supabase project** at [supabase.com](https://supabase.com/dashboard).
2. **Create the tables.** With the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), from a clone of this repository:
   ```sh
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```
3. **Lock down Realtime.** In the dashboard, under **Realtime → Settings**, turn off **Allow public access to channels**.
4. **Choose how people sign in.** You can turn on either or both.
   * **With a name (simplest, no email service).** Under **Authentication → Sign In / Providers**, turn on **Allow anonymous sign-ins**. Anyone can make an account this way, but rooms still need their passcode, so strangers see nothing. Supabase limits anonymous sign-ups to 30 per hour per IP address.
   * **With an email code.** Supabase sends the codes, but its built-in email only reaches your project's own team members (2 an hour), so connect an email service over SMTP. [Resend](https://resend.com) has a free tier, and Postmark, Amazon SES or your mail provider's SMTP work the same way. With Resend:
     1. In Resend, [add and verify a domain](https://resend.com/domains) you own, such as `mail.example.com`.
     2. Create an [API key](https://resend.com/api-keys) with **Sending access**, restricted to that domain.
     3. In Supabase, open **Authentication → Emails → SMTP Settings**, turn on **Enable custom SMTP**, and fill in:

        | Field | Value |
        | --- | --- |
        | Sender email | an address on your domain, such as `login@mail.example.com` |
        | Sender name | `squad-chat` |
        | Host | `smtp.resend.com` |
        | Port | `465` |
        | Username | `resend` |
        | Password | the Resend API key |

     4. Under **Authentication → Emails → Templates**, edit **Confirm signup** and **Magic Link** so they show the code. For example, subject `Your squad-chat code` and body:
        ```html
        <h2>squad-chat</h2>
        <p>Your sign-in code:</p>
        <p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
        <p>Type it into Claude Code. It expires in one hour.</p>
        ```
     5. Try it: sign in with your own email. Each code shows up under **Emails** in Resend's dashboard, with its delivery status.
5. **Share the server** with your friends: the project URL and the publishable key, from **Project Settings → API Keys**. Everyone, you included, [connects with them](#connect-to-a-server).

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## License

Distributed under the MIT License. See [`LICENSE`](LICENSE) for more information.

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Acknowledgments

* [Supabase](https://supabase.com), for auth, Postgres and Realtime
* [Resend](https://resend.com) (optional), for delivering sign-in codes on servers that use email sign-in
* [glowup](https://github.com/NovusEdge/glowup), whose classic pack inspired the palette and card layout
* [token-weather](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/token-weather), whose context forecast the Usage band draws
* [awesome-claude-code-mods](https://github.com/karanb192/awesome-claude-code-mods) and the mods listed there, which gave the built-in rooms their ideas: token-weather-usage, claude-flightdeck, hud and clawd-dash for Usage, cc-pr-tracker, github-issues and pr-pulse for Git, and agent-shell-watch, claude-agentpane and gsd-status for Agents
* [Shields.io](https://shields.io) and [Hits](https://hits.sh), for the badges
* [Best-README-Template](https://github.com/othneildrew/Best-README-Template), for this README's layout

<p align="right">(<a href="#readme-top">back to top</a>)</p>

<!-- MARKDOWN LINKS & IMAGES -->
[stars-shield]: https://img.shields.io/github/stars/chrisluo5311/squad-chat?style=for-the-badge&logo=github&color=f5c542
[stars-url]: https://github.com/chrisluo5311/squad-chat/stargazers
[version-shield]: https://img.shields.io/badge/dynamic/json?style=for-the-badge&label=version&color=d97757&url=https%3A%2F%2Fraw.githubusercontent.com%2Fchrisluo5311%2Fsquad-chat%2Fmain%2Fplugins%2Fsquad-chat%2F.claude-plugin%2Fplugin.json&query=%24.version
[version-url]: plugins/squad-chat/.claude-plugin/plugin.json
[ci-shield]: https://img.shields.io/github/actions/workflow/status/chrisluo5311/squad-chat/ci.yml?branch=main&style=for-the-badge&label=CI&logo=githubactions&logoColor=white
[ci-url]: https://github.com/chrisluo5311/squad-chat/actions/workflows/ci.yml
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
[resend-shield]: https://img.shields.io/badge/Resend-optional-000000?style=for-the-badge&logo=resend&logoColor=white
[resend-url]: https://resend.com
