---
title: Commands
description: Every squad-chat slash command, what it does, and examples.
---

## From the prompt

### Chat and rooms

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

### Account

| Command | What it does |
| --- | --- |
| `/chat-login <email>`, then `/chat-login <code>` | Sign in by email from the prompt instead of the pane |
| `/chat-login <name>` | Sign in with just a name, where the server allows it |
| `/chat-name <new name>` | Change your display name. Your friends see the new one right away. |
| `/chat-logout` | Sign out on this computer |

### Sharing

| Command | What it does |
| --- | --- |
| `/chat-share [#room]` | Share the text you selected, or else the last code block in Claude's reply, to the current room or the one you name. You see it first, then `/chat-share send` posts it (or `/chat-share cancel`). |
| `/chat-share diff [path] [#room]` | Share your uncommitted changes (`git diff HEAD`), all of them or one file's |
| `/chat-share usage` / `git` / `agents` `[#room]` | Share a snapshot of a built-in room |

### Notifications and built-in rooms

| Command | What it does |
| --- | --- |
| `/chat notify on` / `off` | Toast when someone writes `@yourname` (off by default) |
| `/chat dnd on` / `off` / `auto` | Do not disturb: no toasts, a quiet band and status line, and friends see you as busy. `auto` turns it on while Claude works on something longer than 30 seconds, then sums up what you missed. |
| `/chat usage` / `git` / `agents` | Open the pane on a [built-in room](/squad-chat/use/built-in-rooms/). `/chat chat` goes back to the chat. |
| `/chat rooms <list>` | Which built-in rooms have tabs: any of `usage`, `git`, `agents`, or `all`, or `none` |

## In the pane

The pane's input box takes `/room`, `/who`, `/name`, `/dnd`, `/share`, `/usage`, `/git`, `/agents`, `/chat`, `/logout` and `/help` too, where the share preview has **Send** and **Cancel** buttons. In the Git room, `r` refreshes.

:::tip
Type passcodes in the pane. It never touches the conversation, while a slash command's raw text stays in one bookkeeping line of the local transcript. See [Privacy & security](/squad-chat/reference/privacy/).
:::

## Examples

### Start a room and bring your friends in

```
/room design pixels42        create #design (or join it, if a friend made it) with passcode pixels42
/room squad                  switch to #squad, a room you're already in
/room                        list your rooms and their unread counts
/say standup in 5?           post to the current room without opening the pane
/who                         who's online, and in which rooms
/chat-name captain           show up as captain from now on
```

<figure class="shot">
  <img src="/squad-chat/media/rooms.gif" alt="From the prompt: /room design pixels42 joins a friend's room, /room lists the rooms with an unread count, /room squad switches back, /say posts a message, /who shows who's online, and /chat-name captain changes the name." />
  <figcaption>Rooms from the prompt: join with a passcode, list, switch, post with /say, see who's online and pick a new name.</figcaption>
</figure>

### Share code and diffs

```
/chat-share                  the text you selected, or Claude's last code block, to the current room
/chat-share #design          the same, to #design
/chat-share diff             all your uncommitted changes
/chat-share diff src/a.ts    only src/a.ts
/chat-share diff src/a.ts #design
/chat-share send             post what the preview showed
/chat-share cancel           drop it
```

If what you share looks like it holds an API key, a token, a private key or a secret from an env file, the preview says so and asks you to send twice.

<figure class="shot">
  <img src="/squad-chat/media/share.gif" alt="Claude writes a debounce helper. /chat-share shows a preview of its code block and /chat-share send posts it. /chat-share diff does the same for an uncommitted change. In the pane both appear as cards, the diff colored, and a friend replies." />
  <figcaption>Sharing Claude's code block and an uncommitted diff: a preview first, then a card in the room.</figcaption>
</figure>

### Stay focused

```
/chat dnd on                 no toasts, and friends see you as busy
/chat dnd auto               the same, but only while Claude works on something longer than 30 seconds
/chat dnd off                back to normal, with one summary of what you missed
/chat notify on              a toast when someone writes @yourname
```

<figure class="shot">
  <img src="/squad-chat/media/dnd.gif" alt="With /chat dnd on, the band above the prompt turns grey and shows a muted count while a friend writes, with no toast. After /chat dnd off, one toast sums up the missed messages and the pane shows them." />
  <figcaption>Do not disturb: the band stays grey while sam writes, and one toast sums it up after.</figcaption>
</figure>
