---
title: Development
description: Run squad-chat from a checkout, against a local Supabase, and run the tests.
---

Want to help? [CONTRIBUTING.md](https://github.com/chrisluo5311/squad-chat/blob/main/CONTRIBUTING.md) covers setting up, the tests and how to send a pull request. [Architecture](/squad-chat/reference/architecture/) explains how the pieces fit, and is worth a read before a bigger change.

## You'll need

- [Claude Code](https://claude.com/claude-code) 2.1.287 or newer
- Node.js 22 or newer
- [Docker](https://www.docker.com) and the [Supabase CLI](https://supabase.com/docs/guides/local-development), for the local server

## Commands

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

## Run against the local stack

```sh
SQUAD_SUPABASE_URL=http://127.0.0.1:56421 \
SQUAD_SUPABASE_KEY=<local publishable key from `supabase status`> \
SQUAD_CONFIG_DIR=$(mktemp -d) \
claude --plugin-dir ./plugins/squad-chat
```

Sign-in emails land in the local mail UI at http://127.0.0.1:56424. To chat with yourself, open a second terminal with a different `SQUAD_CONFIG_DIR`.

## Where things are

| Path | Contents |
| --- | --- |
| `plugins/squad-chat/hooks/squad-chat.mjs` | Hooks: commands, pane, band, status line, the bridge client, keeping chat out of the conversation |
| `plugins/squad-chat/hooks/state.mjs` | State built from the bridge's events |
| `plugins/squad-chat/hooks/commands.mjs` | Slash commands and the pane's input box |
| `plugins/squad-chat/hooks/views.mjs` | The docked pane, the compact pane and the band |
| `plugins/squad-chat/hooks/sysviews.mjs` | The built-in rooms: Usage, Git and Agents |
| `plugins/squad-chat/hooks/widgets.mjs` | Meters, sparklines, stat tiles, rows and the card stack the built-in rooms share |
| `plugins/squad-chat/hooks/metrics.mjs` | This session's usage, tool timings and subagents |
| `plugins/squad-chat/hooks/github.mjs` | The Git room's data, read through `git` and `gh` |
| `plugins/squad-chat/hooks/sessions.mjs` | Heartbeats shared with the other sessions on this computer |
| `plugins/squad-chat/hooks/theme.mjs` | Colors and glyphs |
| `plugins/squad-chat/bridge/src/` | The Node bridge (bundled into `bridge/dist/bridge.mjs`) |
| `plugins/squad-chat/tests/` | Mod tests |
| `bridge-tests/` | Bridge tests against a local Supabase |
| `supabase/migrations/`, `supabase/tests/` | Schema, RLS and pgTAP tests |
| `site/` | This documentation site (Astro Starlight) |

## This site

The docs live in `site/src/content/docs/` as Markdown. To preview them:

```sh
cd site
npm install
npm run dev
```

The GIFs and screenshots come from `docs/assets/` and `docs/screenshots/`, and the Architecture page from `docs/ARCHITECTURE.md`, so edit those in place. Pushing to `main` publishes the site to GitHub Pages.
