---
title: Built-in rooms
description: The Usage, Git, Agents, Focus, Clipboard, Pet, Snippets, Monitor, Weather, Tech News, Stocks and Lo-fi tabs that sit before your chat rooms.
---

Seven tabs sit before your chat rooms: **◔ Usage**, **⎇ Git**, **⟡ Agents**, **◷ Focus**, **✿ Pet**, **⌘ Snippets** and **▦ Monitor**. **⧉ Clipboard** waits until you turn it on with `/chat rooms +clipboard`, since it reads what you copy. Four more, **☀ Weather**, **✦ Tech News**, **$ Stocks** and **♫ Lo-fi**, wait until you turn them on with `/chat rooms +weather`, `+news`, `+stock` or `+lofi`, since they reach the web (each one says where when you turn it on). None of them needs a server or a sign-in, and nothing in them goes to a chat room unless you share it. Each tab has its own color and a badge when something there is worth a look, such as a red dot on Git when this branch's checks fail. When the tabs don't fit on one line, the ones you're not looking at shrink to their icon.

Open one with `/chat usage`, `/chat git`, `/chat agents`, `/chat snippet`, `/chat monitor`, `/chat weather`, `/chat news`, `/chat stock` or `/chat lofi`, or press its tab. While the pane is closed, the line above the prompt sums up the room you were last in.

## ◔ Usage

How this session is using Claude, updated as it works:

- **Context, 5-hour and 7-day.** How full the context window is (press **Context** for what fills it), and how much of each rate-limit window you've used, with when it resets.
- **Spend.** What the session has cost, the rate per hour, a sparkline of the last hour, the tokens used and how many came from the prompt cache.
- **Tools.** For each tool, the typical time (p50), the slow time (p95), how many calls and how many failed.
- **Subagents.** Each one Claude starts, what it's doing and which tool it uses most.

<figure class="shot">
  <img src="/squad-chat/media/usage.gif" alt="The Usage room docked beside the conversation. Claude starts an Explore subagent and runs Bash and Read, and the room fills in: context and the 5-hour and 7-day meters, the spend tiles, each tool's p50 and p95 with calls and failures, and the subagent as it finishes." />
  <figcaption>Claude starts a subagent and a few tools, and the Usage room fills in as they run.</figcaption>
</figure>

Above the prompt, the context reads as a forecast (☀ Clear, ☁ Cloudy, ☂ Showers, ☇ Storm, ↯ Compact soon) with a chart of the last turns and how much the last one added, then the 5-hour window and what you've spent:

```
◔ Usage │ ☀ Clear 12% 121k/1.0M ▅▆█ ▲+28k · 5-hour 18% · spent $0.88
```

## ⎇ Git

Where your branch stands on GitHub, read through the [`gh` CLI](https://cli.github.com) as you're already signed in:

- **The branch.** Commits ahead and behind its remote (`↑2 ↓1`, or `local` before its first push) and how many files you've changed.
- **This branch's pull request.** Its checks as they run, who approved, who's been asked to review, and whether it can merge.
- **Pull requests, Actions, issues and alerts.** Open pull requests with the ones waiting for your review first, the latest run of each workflow, issues assigned to you and Dependabot alerts.
- **Toasts** when checks fail or all pass, someone asks for your review, or your pull request is approved, merged or in conflict.

It refreshes every minute while you look at it, every five minutes otherwise, and shortly after a `git push`. Type `r` in the pane to refresh now, and press ⧉ to copy a link.

<figure class="shot">
  <img src="/squad-chat/media/git.gif" alt="The Git room for the squad-chat repository on a merged branch: PR #8 merged with all five checks passed, no other open pull requests, the latest Actions runs and no assigned issues, then r refreshes it." />
  <figcaption>A merged branch: PR #8 and its five checks, the latest Actions runs, and a refresh with r.</figcaption>
</figure>

## ⟡ Agents

Every Claude Code session on this computer, in one place:

- **Sessions.** Each one's folder, branch and model, and what it's doing right now: thinking, running a tool, waiting on an agent, or idle.
- **Subagents as a tree** under the session that started them. Press ▾ to fold one.
- **A live feed** of tool calls from all of them, with their times. The filter shows all sessions, only this one, or only failures.

<figure class="shot">
  <img src="/squad-chat/media/agents.gif" alt="The Agents room with two sessions: this one waits on an Explore subagent while the other, in another repository, runs Bash commands one after another. The live feed interleaves both sessions' tool calls with their times." />
  <figcaption>Two sessions at once: this one waits on a subagent while the other runs commands.</figcaption>
</figure>

## ◷ Focus

A Pomodoro timer beside your work:

* **A ring** counts the focus round down, then the break. Press **▶ Start**, **⏸ Pause**, **⏭** to end the phase now, or **↺** to start over.
* **A chime and a toast** when focus ends, and the break starts by itself. When the break ends it chimes again and waits for you.
* **Your lengths.** Press − and + in the room, or type `50 10` in its box (or `/focus 50 10` at the prompt) for 50 minutes of focus and 10 of break. They're kept, and so is the count of rounds you finished today.
* **A streak**, drawn as GitHub draws contributions: a square a day for the last few months under the months' names, darker the more rounds you finished (the legend runs from Less to More), with how many days in a row you've kept it up and your best run.

While it runs, the status line shows `🍅 18:42` (`☕` in a break), and the Focus tab shows the minutes left from any other room. With the pane closed, the band above the prompt shows the phase and its time, ten cells for how far it has gone, the streak with this week's days, and what comes next. It turns green during a break. A reload carries on where the timer was.

## ⧉ Clipboard

What you copied lately, newest first, so you can copy it again. Press **⧉** on a row, **✕** to drop one, or **Clear**. It reads the clipboard every 2 seconds while the room has a tab (`pbpaste` on a Mac, `wl-paste` or `xclip` on Linux) and keeps the last 30 items in memory only, gone when the session ends. Anything that looks like a key or a token shows masked, though ⧉ still copies it whole, and nothing in the room can be shared to a chat. The band above the prompt shows how many are kept and the newest one's first line.

## ✿ Pet

Clawd's corner. In the desktop app Clawd is a vector drawing that moves on its own, standing on a little floor:

* **Moods.** On **Auto** it follows what goes on: typing while Claude works, cheering when a focus round ends, vibing through a break, waving at a new message, puzzled when this branch's checks fail, and asleep after ten quiet minutes. Pick a mood in the room to keep it on.
* **Today together**: how long Claude worked today, the focus rounds you finished, and how Clawd feels.
* **A bond** that grows with every focus round and every ten minutes of work, a level at a time.
* **Lately**, a short log of what Clawd noticed: a round finished, a break over, someone writing in a room (who and where, never what), checks failing, a long stretch of work, dozing off.

With the pane closed, the band above the prompt has Clawd saying the latest thing it noticed, or how it feels. Clawd also keeps you company by the pane's input box in every room. **By the input box** picks how: **Stroll** back and forth in the room after the buttons, **Stop & go** (a few steps, a stop to wave, on to the end and back), just **Sit** at the end, or **Off**. The pace follows the mood: a trot while Claude types, an easy walk otherwise, and asleep in the corner after a quiet while. The terminal draws the pixel stickers in half blocks.

## ⌘ Snippets

Code you reach for again and again, kept on this computer and one click from your clipboard:

- **Save** text you type with `/snippet add <text>`, or what you selected (or else the last code block in Claude's reply) with `/snippet add`. In the Snippets room, text typed in the box and added is saved too. Snippets are numbered #1, #2, #3 and on, and a language comes along when Claude's block names one.
- **⧉** copies a snippet, and **⇪** shares it to a chat room, with the same preview as `/chat-share`.
- **Tidy up** with `/snippet rename <old> -> <new>` and `/snippet delete <name>`. `/snippet copy <name>` and `/snippet share <name> [#room]` work from the prompt too.

The list lives in `~/.config/squad-chat/room-data/snippet/list.json`, readable only by you. While the room is on show it reads the list again every 5 seconds, so a snippet saved in another Claude Code window shows up on its own. Snippets is the first *function room*: a room drawn from a small manifest that names where its data comes from, so more rooms can follow without new drawing code. [Architecture](/squad-chat/reference/architecture/#function-rooms) explains how they work.

## ▦ Monitor

This computer, as it runs, with no sudo:

- **CPU** use with a chart of the last couple of minutes, the load, and with [macmon](https://github.com/vladkens/macmon) the temperature and power.
- **Memory** used, memory pressure and swap.
- **GPU and power**: GPU use, and with macmon its temperature, the power each part draws, and the fans.
- **Network** in and out, with a chart, **disk** space, and the **battery**: charge, charging or not, time left and the watts going in or out.

Temperatures and power need macmon on a Mac (`brew install macmon`), since macOS keeps them from anything without root. Without it those parts are left out and the room says how to add them. On Linux it reads `/proc`, `/sys` and `nvidia-smi`. It samples every 2 seconds while you look at it and every 30 otherwise, for the line above the prompt.

It toasts when the CPU runs hot, memory or the disk is nearly full, or the battery is nearly flat, once each until it passes, and never during do not disturb. `/chat set monitor cpu_temp 90` and `/chat set monitor memory 90` move the thresholds, and `/chat set monitor alerts off` stops them.

## ☀ Weather

Now, the next 24 hours and the week, for the cities you pick, from [Open-Meteo](https://open-meteo.com) with no key:

- **Now.** Each city with its country code, its sky, temperature right now and the air quality (US AQI). Today's high, low and chance of rain are in This week.
- **The next 24 hours** for the city you pressed in Now (the first one to start): what it feels like, humidity, wind, and the chance of rain hour by hour.
- **This week** for that city: each day's sky, high and low, and chance of rain.
- **Sunrise & sunset** for that city: when the sun rises and sets, how much daylight that makes, how long until the next sunrise or sunset, and today's UV with its level (low, moderate, high, very high, extreme).

On the desktop app, Now shows each city as a tile (press its name to show it below), the next 24 hours as a temperature line over the chance of rain, the week as a column per day, and the sun as an arc across the card with the sun where it is now (a moon at night).

Add a city by typing its name in the room's box and pressing add (or several, `Osaka, Seoul`), or from anywhere with `/chat set weather cities Tokyo`. It goes below the ones you have. ✕ at the end of a city's row drops it, as does `-Tokyo`, and once one city is left the ✕ goes, so there's always one. A name the place search can't find is refused, and the country code after each name shows when a slip landed on another real place. Units are `/chat set weather units imperial`, and `/chat set weather city Tokyo` picks the city shown below, as pressing it does. Inside the room, `/set cities …` does the same. It refreshes every 10 minutes while you look at it and every 30 otherwise.

## ✦ Tech News

[Hacker News](https://news.ycombinator.com) and tech feeds (iThome, The Verge, Ars Technica and TechCrunch to start), newest first. **⧉** copies a story's link and **⇪** shares it to a chat room. `/chat set news hn best` picks the Hacker News list (`top`, `best`, `new` or `off`), and `/chat set news feeds -https://techcrunch.com/feed/` drops a feed. A feed has to come from one of the room's sites. It refreshes every 15 minutes while you look at it and every 30 otherwise.

## $ Stocks

Your watchlist of Taiwan and US stocks and indices, each with today's line, its change and whether its market is open. Taiwan prices come from TWSE's own service and everything else from Yahoo Finance, with no key. Prices may be delayed, and none of it is investment advice.

- **Watch** with `/chat set stock watchlist TAIEX, 2330, 0050, AAPL, ^GSPC` (up to 12, or `+2454` and `-NVDA`). A Taiwan code works for listed and OTC stocks alike, `TAIEX` is the index, and anything else is a Yahoo symbol, such as `BRK-B`, `7203.T` or `0700.HK`.
- **Colors** follow each market by default, red for up in Taiwan and green for up in the US. `/chat set stock colors red-up` or `green-up` makes them all one way.
- **Alerts** toast when a stock moves 5% or more in a day, once each way. `/chat set stock move 3` changes it, and `0` stops them.

A market counts as open only when its quotes are from today and the clock is inside its session, so a holiday reads as closed. It refreshes every minute while you look at it and every 5 otherwise, and asks for nothing more than every 15 minutes while every market is closed.

## ♫ Lo-fi

Music in the background while you work, played the way [Pixel Play](https://github.com/chrisluo5311/Pixel-Play) plays it: through [mpv](https://mpv.io), with YouTube through [yt-dlp](https://github.com/yt-dlp/yt-dlp) (`brew install mpv yt-dlp`).

- **Stations** to start: Lofi Girl's YouTube live streams (looked up each time, as their links change) and SomaFM's Groove Salad, Fluid, Lush and Drone Zone.
- **Your own**: paste a stream or YouTube link, or a path like `~/Music/focus` (a file or a whole folder), into the room's box and press add. `/lofi add <url or path>` does the same from anywhere. `/lofi import` brings in Pixel Play's playlist. `/lofi remove <name>` (or ✕ on its row) takes one off. A built-in station taken off is only hidden: `/lofi restore` brings them back.
- **Play** with ▶ on a row, the ⏮ ⏯ ⏹ ⏭ − + buttons, or single keys typed in the room: `p` plays or pauses, `n` next, `b` back, `s` stop, `u` and `d` volume. `/lofi play <name>`, `pause`, `next` and `vol 40` work from the prompt.

Nothing plays or reaches the network until you press play. mpv stops when the session ends, however it ends. If Pixel Play is playing too, the room says so. `/chat-share lofi` tells a chat room what you're listening to.

## The room store

More rooms, written by anyone, live in the [room store](/squad-chat/rooms/store/): `/chat store` lists them, and `/chat install dev-blogs` shows one, with the hosts it reaches, then installs it on a second run. Crypto prices, exchange rates, dev blogs and security news are there to start. `/chat update` brings installed rooms up to date (asking again if a new version reaches new hosts), and `/chat uninstall <id>` removes one with its settings. A room is one JSON file that can only use squad-chat's own providers and reach the hosts it names, so installing one never runs anyone's code. [Write a room](/squad-chat/rooms/write-a-room/) shows how to add yours.

## Share a snapshot or hide tabs

To show the team, press **⇪ Share** under a built-in room, or type `/chat-share usage` (or `git`, `agents`), and a snapshot of the room goes to a chat room as a card, for "here's where my PR stands" or "this refactor cost $4". The preview lists your rooms, so pick the one it should go to before you press **Send**, or name it with `/chat-share usage #room`.

`/chat rooms usage,git` picks which tabs you want, `/chat rooms -snippet` or `+snippet` drops or brings back one, and `/chat rooms none` hides them all.

What these rooms read, and what they keep on disk, is listed under [Privacy & security](/squad-chat/reference/privacy/#what-the-built-in-rooms-read).
