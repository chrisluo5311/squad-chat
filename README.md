# squad-chat

A Claude Code mod: your friends' online status and a group chat in a side pane, so you can chat while you vibe code. Chat text never reaches Claude's context and uses no model tokens.

> **Status: Phase 0 (API spike).** The plumbing works end to end with a local fake bridge: no Supabase, no login, no real friends yet. See [docs/PLAN.md](docs/PLAN.md) for the full plan (in Traditional Chinese).

## What Phase 0 proves

| Question | Answer (Claude Code 2.1.291) |
|---|---|
| Can the pane take keyboard input? | Yes. An `Input` element with `onSubmit`; the pane opens with `focus`. |
| Can background events redraw the pane? | Yes. The bridge's NDJSON on stdout → `$.ui.invalidate("ui.render")`. |
| Realtime without WebSocket? | Mods have no WebSocket, so a Node child (`$.process.spawn`) holds the connection. The mod controls it over HTTP on a private Unix socket (`$.http.fetch` with `socketPath`, dir `0700`, per-run token). |
| Is there a reliable "session ended" event? | `session.end` exists but has a short time budget, so it's best effort only. The bridge also exits by itself within ~5 s when its parent dies (it checks `ppid`), and presence will rely on the dropped connection. |
| Does chat leak into Claude's context? | **`/say` did:** Claude Code records a slash command as a user row with its arguments. The mod rewrites that row in `session.append` (and fails closed). Verified headless: the model can't see the text. Text typed in the pane never enters the transcript. |

The only place `/say` text still exists is the local transcript's input-queue bookkeeping line on your own disk. The model never reads that line.

## Backend (Phase 1)

`supabase/` holds the schema: profiles, passcode-protected rooms, members, messages and presence heartbeats, all behind RLS with explicit column grants (anon gets nothing). Rooms are joined only through `join_room(slug, passcode)`, which rate-limits wrong passcodes. A flood trigger caps each user at 10 messages per 10 s, and `pg_cron` deletes messages older than 30 days. Realtime uses private `room:<uuid>` channels that only members can receive or track presence on.

```bash
supabase start      # local stack on ports 56420-56429 (mail UI: http://127.0.0.1:56424)
supabase test db    # pgTAP access-control tests
supabase db advisors --local --type all
```

Hosted project: `pijyocogpbiiwccfxqkp` (Tokyo, free plan), with the same two migrations applied. Sign-in emails go through Resend SMTP from `login@mail.chris-luo.me` and carry an 8-digit code (set in the dashboard, since free projects can only customize templates with their own SMTP).

## Try it

Requires Claude Code ≥ 2.1.287 and Node ≥ 18 on `PATH`.

```bash
git clone https://github.com/chrisluo5311/squad-chat.git
cd squad-chat
claude plugin validate ./plugins/squad-chat
claude plugin test ./plugins/squad-chat
claude --plugin-dir ./plugins/squad-chat
```

Then type `/chat` to open the pane, or `/say hi`. Use `/tui fullscreen` in a terminal at least 110 columns wide to dock the pane on the right. In Phase 0 the bridge only echoes your own messages back and ticks every 5 s.

## Roadmap

1. Supabase backend: schema, RLS, room passcodes, 30-day retention.
2. Real bridge: email OTP login, Realtime presence and messages, backfill on reconnect.
3. Mod: cross-room friends list, `/say`, `/room`, `/who`, unread counts.
4. Narrow-terminal layouts, resilience, REST polling mode for the desktop app.
5. Install from this marketplace with `claude plugin install`.

## License

MIT
