---
title: Roadmap
description: What's done and what's next.
---

- [x] Supabase backend: rooms with passcodes, RLS, rate limits, 30-day retention
- [x] Email-code sign-in and a Node bridge for Realtime presence and messages
- [x] Catch-up after network drops, and a watchdog for stuck reconnects
- [x] Docked pane, compact pane, one-line band and status line
- [x] Chat bubbles, room tabs, unread markers and @mention toasts
- [x] Leave and delete rooms
- [x] Bring your own server, with sign-in by name or by email code
- [x] `/chat-name` to change your display name
- [x] Typing indicators
- [x] Do not disturb, by hand or while Claude works
- [x] Share code and diffs from your session
- [x] Built-in Usage, Git and Agents rooms
- [ ] A polling mode for the Claude Code desktop app, which can't start the bridge

See the [open issues](https://github.com/chrisluo5311/squad-chat/issues) for proposed features and known issues, or [request a feature](https://github.com/chrisluo5311/squad-chat/issues/new?labels=enhancement).

## Acknowledgments

- [Supabase](https://supabase.com), for auth, Postgres and Realtime
- [Resend](https://resend.com) (optional), for delivering sign-in codes on servers that use email sign-in
- [glowup](https://github.com/NovusEdge/glowup), whose classic pack inspired the palette and card layout, and whose docs inspired this site
- [token-weather](https://github.com/anthropics/claude-code-playground/tree/main/claude-code/mods/token-weather), whose context forecast the Usage band draws
- [awesome-claude-code-mods](https://github.com/karanb192/awesome-claude-code-mods) and the mods listed there, which gave the built-in rooms their ideas
- [Starlight](https://starlight.astro.build), which builds this site
