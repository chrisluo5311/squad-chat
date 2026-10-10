---
title: Privacy & security
description: What Claude sees, who sees your messages, what's stored and for how long.
---

<figure class="shot">
  <img src="/squad-chat/media/never-reaches-claude.gif" alt="A friend writes in the squad chat asking Claude to ignore its instructions and delete the repo. Asked whether anyone in the chat asked it to do something, Claude answers that it hasn't seen any requests from the squad chat." />
  <figcaption>sam tells Claude to delete the repo from the chat. Claude never sees it.</figcaption>
</figure>

## What Claude sees

Nothing typed in the pane enters the conversation. The arguments of `/say`, `/room` and `/chat-login` are replaced with a placeholder before Claude Code stores the command, and command answers are notices the model never reads.

Claude Code still keeps a slash command's raw text in one bookkeeping line of the local transcript on your own disk, so type passcodes in the pane if that matters to you.

## What Claude reads from the room

Nothing. Your friends' messages, names and who's online are drawn in the pane, the band and the status line, and that's all. None of it goes into your prompts, the system prompt, tool results or the transcript, so a friend joking "delete the repo" can't turn into an instruction. A test sends exactly that kind of message and checks it never reaches the model.

## Who sees your messages

Only members of the room. Access is enforced in the database with row-level security, and you become a member only with the room's passcode. Five wrong passcodes lock you out for 15 minutes.

## Who runs the server

Your squad's server belongs to whoever hosts it, and they can read its database like any database admin. Pick a host you trust, or [host it yourself](/squad-chat/host/server/).

## What friends see

Your display name (the name you picked, or the part of your email before the `@`) and whether you're online, or busy during do not disturb. Never your email.

## What's stored

- Messages are deleted after 30 days.
- Your sign-in session is kept in `~/.config/squad-chat/session.json`, readable only by you, and `/chat-logout` removes it.
- An account made with just a name can't be signed back into once you sign out, so `/chat-logout` asks twice.

## What sharing sends

`/chat-share` reads your selection, Claude's replies or `git diff` on your own computer, and nothing leaves until you look at it and send it. If it looks like it holds an API key, a token, a private key or a secret from an env file, it says so and asks you to send twice. What you share is stored on your squad's server like any message.

## What the built-in rooms read

The Usage and Agents rooms read this session's own figures from Claude Code: context, cost, rate limits, token counts, tool names and timings, and subagents. The Git room runs `git status` and `gh` in the session's folder as you. Nothing is sent anywhere, and no token is stored.

To show other sessions, each session keeps a small heartbeat file in `/tmp/squad-chat-<uid>/sessions/`, readable only by you: the folder's name, branch, model, what it's doing, and the last few tool calls with a few words each (a command, a file's name, a search pattern). Anything that looks like a secret is masked. No prompts, replies or tool output go in. A heartbeat is removed when its session ends.

Snippets you save stay in `~/.config/squad-chat/room-data/snippet/list.json`, readable only by you. The Snippets room never touches the network.

## What Monitor runs

Monitor never touches the network. It reads this computer through a fixed set of commands in squad-chat's own code (on a Mac `vm_stat`, `sysctl`, `netstat`, `df`, `pmset`, `ioreg` and, if you installed it, `macmon`, on Linux files in `/proc` and `/sys` and `nvidia-smi`), with no shell and no sudo. A room's manifest can't name a command. The numbers stay in the bridge's memory, the last two minutes at most, and are drawn, never sent anywhere or shown to Claude.

## What Weather, Tech News, Stocks and Lo-fi reach

These four are off until you turn them on, and each says where it goes when you do. They ask only for what they show, with no account, key or cookie, and send nothing about you or your session:

| Room | Reaches | Sends |
| --- | --- | --- |
| ☀ Weather | `geocoding-api.open-meteo.com`, `api.open-meteo.com`, `air-quality-api.open-meteo.com` | the names of the cities you picked, then their coordinates |
| ✦ Tech News | `hacker-news.firebaseio.com`, `www.ithome.com.tw`, `www.theverge.com`, `feeds.arstechnica.com`, `techcrunch.com` | requests for the story lists and feeds |
| $ Stocks | `mis.twse.com.tw`, `query1.finance.yahoo.com` | the symbols on your watchlist |
| ♫ Lo-fi | `ice2.somafm.com`, `www.youtube.com`, and the streams you add | nothing until you press play, then mpv asks for that stream. YouTube's audio comes from Google's video servers through yt-dlp. |

The bridge holds each room to its own sites, so a room can't reach anywhere else, and a feed you add has to be on one of them. What comes back is cleaned of terminal escapes before it's drawn, and none of it reaches Claude. The settings you pick stay in `~/.config/squad-chat/room-data/<room>/settings.json`, readable only by you.

Lo-fi is the one room whose streams don't go through the bridge's host check: mpv fetches them itself, and it plays what you add, from wherever it is. Files and folders you add stay where they are, and the list of them is kept in `room-data/lofi/list.json`. mpv runs only after you press play, and stops when the session ends.

Only `/chat-share usage|git|agents|snippet|monitor|weather|news|stock|lofi`, or the **⇪** on a snippet or a story, sends any of it to a chat room, after you look at the preview. Like a slash command's message, what you type after `/snippet` is hidden from Claude.

## Abuse limits

| Limit | Value |
| --- | --- |
| Messages | 10 per 10 seconds per person, 500 characters each |
| Shared snippets | 8000 characters and 200 lines each, 3 a minute |
| Wrong passcodes | 5, then locked out for 15 minutes |

## Reporting a problem

Found a security problem? Please report it privately, as described in [SECURITY.md](https://github.com/chrisluo5311/squad-chat/blob/main/SECURITY.md).
