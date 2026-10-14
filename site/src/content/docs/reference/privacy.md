---
title: Privacy & security
description: What Claude can access, who can see your messages, and what is stored and for how long.
---

<figure class="shot">
  <img src="/squad-chat/media/never-reaches-claude.gif" alt="A member writes in the squad chat asking Claude to ignore its instructions and delete the repo. Asked whether anyone in the chat asked it to do something, Claude answers that it has not seen any requests from the squad chat." />
  <figcaption>sam asks Claude in the chat to delete the repo. Claude never sees the message.</figcaption>
</figure>

## What Claude sees

Nothing typed in the pane enters the conversation. The arguments of `/say`, `/room` and `/chat-login` are replaced with a placeholder before Claude Code stores the command, and command answers are notices the model never reads.

Claude Code still keeps a slash command's raw text in one bookkeeping line of the local transcript on your own disk. If this is a concern, enter passcodes in the pane.

## What Claude reads from the room

Nothing. Other members' messages, names and online status are displayed only in the pane, the band and the status line. None of it goes into your prompts, the system prompt, tool results or the transcript, so a message such as "delete the repo" cannot become an instruction. A test sends this kind of message and verifies that it never reaches the model.

## Who sees your messages

Only members of the room. Access is enforced in the database with row-level security, and you become a member only with the room's passcode. After five incorrect passcodes, you are locked out for 15 minutes.

## Who runs the server

Your group's server belongs to its host, who can read its database like any database administrator. Choose a host you trust, or [host it yourself](/squad-chat/host/server/).

## What other members see

Your display name (the name you chose, or the part of your email before the `@`) and whether you are online, or busy during do not disturb. Your email is never shown.

## What is stored

- Messages are deleted after 30 days.
- Your sign-in session is kept in `~/.config/squad-chat/session.json`, readable only by you, and `/chat-logout` removes it.
- An account created with only a name cannot be signed into again after you sign out, so `/chat-logout` asks for confirmation.

## What sharing sends

`/chat-share` reads your selection, Claude's replies or `git diff` on your own computer, and nothing leaves your computer until you review and send it. If the content appears to contain an API key, a token, a private key or a secret from an env file, a warning is shown and you must send it twice. Shared content is stored on your group's server like any other message.

## What the built-in rooms read

The Usage and Agents rooms read this session's own figures from Claude Code: context, cost, rate limits, token counts, tool names and timings, and subagents. The Git room runs `git status` and `gh` in the session's folder as you, and `gh` talks to GitHub with your own sign-in. Nothing else is sent anywhere, and no token is stored.

To show other sessions, each session keeps a small heartbeat file in `/tmp/squad-chat-<uid>/sessions/`, readable only by you: the folder's name, branch, model, what it is doing, and the last few tool calls each with a brief description (a command, a file's name, a search pattern). Anything that resembles a secret is masked. No prompts, replies or tool output are included. A heartbeat is removed when its session ends.

The Clipboard room is off until you add it. With a tab, it reads the clipboard every 2 seconds (`pbpaste`, `wl-paste` or `xclip`) and keeps the last 30 items in that session's memory only. Nothing is written to disk or sent anywhere, items that resemble a secret are masked, and the room cannot be shared to a chat.

Focus keeps its lengths and the days you finished a round, Habits your habits and how many times you did each a day for the last year, and Pet its mood, bond and a short log (who wrote in which room, never the content), in Claude Code's plugin store on this computer.

Snippets you save stay in `~/.config/squad-chat/room-data/snippet/list.json`, readable only by you. The Snippets room never touches the network.

## What Monitor runs

Monitor never touches the network. It reads this computer through a fixed set of commands in squad-chat's own code (on a Mac `vm_stat`, `sysctl`, `netstat`, `df`, `pmset`, `ioreg` and, if you installed it, `macmon`, on Linux files in `/proc` and `/sys` and `nvidia-smi`), with no shell and no sudo. A room's manifest cannot name a command. The numbers stay in the bridge's memory, the last two minutes at most, and are drawn, never sent anywhere or shown to Claude.

## What Weather, Tech News, Stocks and Lo-fi reach

These four rooms are off until you enable them, and each one states which hosts it contacts when you do. They request only the data they display, with no account, key or cookie, and send nothing about you or your session:

| Room | Reaches | Sends |
| --- | --- | --- |
| ☀ Weather | `geocoding-api.open-meteo.com`, `api.open-meteo.com`, `air-quality-api.open-meteo.com` | the names of the cities you picked (each one also as you add it, to check it exists), then their coordinates |
| ✦ Tech News | `hacker-news.firebaseio.com`, `www.ithome.com.tw`, `www.theverge.com`, `feeds.arstechnica.com`, `techcrunch.com` | requests for the story lists and feeds |
| $ Stocks | `mis.twse.com.tw`, `query1.finance.yahoo.com` | the symbols on your watchlist |
| ♫ Lo-fi | `ice2.somafm.com`, `www.youtube.com`, and the streams you add | nothing until you press play, then mpv asks for that stream. YouTube's audio comes from Google's video servers through yt-dlp. |

The bridge holds each room to its own sites, so a room cannot reach any other host, and a feed you add has to be on one of them. Responses are stripped of terminal escape sequences before it is drawn, and none of it reaches Claude. The settings you pick stay in `~/.config/squad-chat/room-data/<room>/settings.json`, readable only by you.

Lo-fi's streams do not go through the bridge's fetch, since mpv fetches them directly. Its stations are still held to the room's hosts, both when a room is checked and again before one plays, so a store room cannot use the player to reach a host it does not name. Items you add with `/lofi add` play from their original location. Files and folders you add stay where they are, and the list of them is kept in `room-data/lofi/list.json`. mpv runs only after you press play, and stops when the session ends.

Only `/chat-share usage|git|agents|focus|habits|snippet|monitor|weather|news|stock|lofi`, or the **⇪** on a snippet or a story, sends any of it to a chat room, after you look at the preview. Like a slash command's message, what you type after `/snippet` or `/tool` is hidden from Claude. The Toolbox room keeps nothing: what you run its tools on, and what they give back, stay in the session's memory, and it has no Share.

## The room store

`/chat store`, `/chat install` and `/chat update` fetch the store's index and rooms from `raw.githubusercontent.com` (squad-chat's own repository), and no request is made until you run one of these commands. A room is one JSON file that can use only the providers squad-chat ships, reach only the hosts it names, and draw only with the pane's widgets. So installing one never runs its author's code, and the install shows the hosts before you confirm. Each file must match the sha256 in the store's index, check out as the rooms squad-chat ships do, and work with your version, otherwise it is not installed. The file written to disk is the copy you reviewed. Installed rooms live in `~/.config/squad-chat/rooms/`, and `/chat uninstall` removes one with its settings and data.

The hash only detects a corrupted download, since the index and the rooms come from the same source. What constrains a room is what a manifest is unable to do.

## Abuse limits

| Limit | Value |
| --- | --- |
| Messages | 10 per 10 seconds per person, 500 characters each |
| Shared snippets | 8000 characters and 200 lines each, 3 a minute |
| Wrong passcodes | 5, then locked out for 15 minutes |

## Reporting a problem

If you find a security problem, please report it privately, as described in [SECURITY.md](https://github.com/chrisluo5311/squad-chat/blob/main/SECURITY.md).
