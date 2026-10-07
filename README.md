# squad-chat

A Claude Code mod: your friends' online status and a group chat in a side pane, so you can chat while you vibe code. Chat text never reaches Claude's context and uses no model tokens.

> **Status: Phase 3 done.** The mod runs the real bridge against the hosted Supabase project: sign in, rooms, presence and chat work. Narrow-terminal layouts, unread markers and resilience polish come in Phase 4. See [docs/PLAN.md](docs/PLAN.md) for the full plan (in Traditional Chinese).

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

## Bridge (Phase 2)

`plugins/squad-chat/bridge/` is the Node process that holds the Supabase connection: email-code sign-in, rooms, a private Realtime channel per room for presence and new messages, catch-up after reconnects, heartbeats and the friends list. The mod talks to it over HTTP on a private Unix socket and reads its NDJSON events from stdout. `dist/bridge.mjs` is a single bundled file, committed so installing the plugin needs no `npm install`.

```bash
cd plugins/squad-chat/bridge
npm install && npm run build      # rebuild dist/bridge.mjs after editing src/
npm test                          # two users, two bridges, against `supabase start`
```

The tests cover sign-in, passcodes, presence, messages both ways, a simulated network drop (exactly the missed messages arrive, once), session reuse across restarts, unread counts, `kill -9` showing as offline, leaving and signing out. realtime-js stops retrying if its first reconnect fails while the network is still down, so the bridge runs a watchdog that forces a reconnect after 10 s.

## Try it

Requires Claude Code ≥ 2.1.287 and Node ≥ 22 on `PATH` (supabase-js needs Node 22).

```bash
git clone https://github.com/chrisluo5311/squad-chat.git
cd squad-chat
claude plugin validate ./plugins/squad-chat
claude plugin test ./plugins/squad-chat
claude --plugin-dir ./plugins/squad-chat
```

Then type `/chat` to open the pane. In a terminal at least 110 columns wide (fullscreen) it docks on the right; narrower, it sits above the prompt.

| | |
|---|---|
| Sign in | Type your email in the pane, then the code from the email. Or `/chat-login you@example.com`, then `/chat-login <code>`. |
| Rooms | `/room <name> <passcode>` creates a room or joins a friend's. `/room <name>` switches to one you're in; `/room` lists them. |
| Chat | Type in the pane and press Enter, or `/say <message>` from the prompt. |
| Friends | The pane shows who's online. `/who` lists everyone you share a room with. |
| Sign out | `/chat-logout`. |

The pane's input box also takes `/room`, `/who` and `/logout`. Anything typed there never enters the conversation. For slash commands, the arguments of `/say`, `/room` and `/chat-login` are replaced with a placeholder before Claude Code stores the row, and the commands' answers are notices the model never reads. A copy of a slash command's raw text stays only in the local transcript's input-queue line on your own disk, so type passcodes in the pane if that matters to you.

To develop against the local stack instead of the hosted project, start Claude Code with `SQUAD_SUPABASE_URL=http://127.0.0.1:56421 SQUAD_SUPABASE_KEY=<local publishable key> SQUAD_CONFIG_DIR=<a temp dir>`.

## Roadmap

1. Supabase backend: schema, RLS, room passcodes, 30-day retention.
2. Real bridge: email OTP login, Realtime presence and messages, backfill on reconnect.
3. Mod: cross-room friends list, `/say`, `/room`, `/who`, unread counts.
4. Narrow-terminal layouts, resilience, REST polling mode for the desktop app.
5. Install from this marketplace with `claude plugin install`.

## License

MIT
