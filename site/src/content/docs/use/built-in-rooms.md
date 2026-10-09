---
title: Built-in rooms
description: The Usage, Git, Agents and Snippets tabs that sit before your chat rooms.
---

Four tabs sit before your chat rooms: **◔ Usage**, **⎇ Git**, **⟡ Agents** and **⌘ Snippets**. They need no server and no sign-in, and nothing in them leaves your computer unless you share it. Each tab has its own color and a badge when something there is worth a look, such as a red dot on Git when this branch's checks fail. When the tabs don't fit on one line, the ones you're not looking at shrink to their icon.

Open one with `/chat usage`, `/chat git`, `/chat agents` or `/chat snippet`, or press its tab. While the pane is closed, the line above the prompt sums up the room you were last in.

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

## ⌘ Snippets

Code you reach for again and again, kept on this computer and one click from your clipboard:

- **Save** what you selected, or else the last code block in Claude's reply, with `/snippet add <name>`. Its language comes along when Claude's block names one.
- **⧉** copies a snippet, and **⇪** shares it to a chat room, with the same preview as `/chat-share`.
- **Tidy up** with `/snippet rename <old> -> <new>` and `/snippet delete <name>`. `/snippet copy <name>` and `/snippet share <name> [#room]` work from the prompt too.

The list lives in `~/.config/squad-chat/room-data/snippet/list.json`, readable only by you. Snippets is the first *function room*: a room drawn from a small manifest that names where its data comes from, so more rooms can follow without new drawing code. [Architecture](/squad-chat/reference/architecture/#function-rooms) explains how they work.

## Share a snapshot or hide tabs

To show the team, press **⇪ Share** under a built-in room, or type `/chat-share usage` (or `git`, `agents`), and a snapshot of the room goes to a chat room as a card, for "here's where my PR stands" or "this refactor cost $4". The preview lists your rooms, so pick the one it should go to before you press **Send**, or name it with `/chat-share usage #room`.

`/chat rooms usage,git` picks which tabs you want, `/chat rooms -snippet` or `+snippet` drops or brings back one, and `/chat rooms none` hides them all.

What these rooms read, and what they keep on disk, is listed under [Privacy & security](/squad-chat/reference/privacy/#what-the-built-in-rooms-read).
