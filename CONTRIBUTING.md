# Contributing to squad-chat

Thanks for wanting to help! Bug reports, ideas and pull requests are all welcome.

* **Found a bug?** [Open an issue](https://github.com/chrisluo5311/squad-chat/issues/new) with your Claude Code version (`claude --version`), Node version (`node --version`), what you did, what you expected and what happened instead.
* **Have an idea?** Open an issue first, so we can agree on the shape before you write the code.
* **Found a security problem?** Please don't open an issue. Follow [SECURITY.md](SECURITY.md) instead.

## Setting up

You'll need:

* [Claude Code](https://claude.com/claude-code) 2.1.287 or newer
* Node.js 22 or newer
* [Docker](https://www.docker.com) and the [Supabase CLI](https://supabase.com/docs/guides/local-development), for the local server

```sh
git clone https://github.com/chrisluo5311/squad-chat.git
cd squad-chat
cd plugins/squad-chat/bridge && npm install && cd -
supabase start          # local server on ports 56420-56429
```

Then run Claude Code with your checkout, pointed at the local server:

```sh
SQUAD_SUPABASE_URL=http://127.0.0.1:56421 \
SQUAD_SUPABASE_KEY=<publishable key from `supabase status`> \
SQUAD_CONFIG_DIR=$(mktemp -d) \
claude --plugin-dir ./plugins/squad-chat
```

Sign-in emails land in the local mail UI at http://127.0.0.1:56424. To chat with yourself, open a second terminal with a different `SQUAD_CONFIG_DIR`.

[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) explains how the mod, the bridge and the database fit together. It's worth a read before a bigger change.

## Running the tests

CI runs all of these on every pull request, and they need to pass before a merge.

```sh
# The mod
claude plugin validate ./plugins/squad-chat
claude plugin test ./plugins/squad-chat

# The bridge (needs `supabase start`)
cd plugins/squad-chat/bridge && npm test

# The database (needs `supabase start`)
supabase test db
```

The bridge tests skip themselves when the local server isn't running. Locally that's a skip, but in CI it counts as a failure.

## Things that are easy to miss

* **Rebuild the bridge.** After editing `bridge/src/`, run `npm run build` and commit `bridge/dist/bridge.mjs` too. The bundle is committed so installing needs no `npm install`, and CI fails if it doesn't match the source.
* **Keep `$` in one file.** Claude Code never follows `$` across an import, so everything that touches the engine lives in `hooks/squad-chat.mjs`. The other modules in `hooks/` are plain functions that get what they need passed in.
* **Hooks are function literals.** Write `on("ui.render", async ($, e) => …)`, not `on("ui.render", someFunction)`.
* **No flex props on `Text`.** A `Text` with `flexShrink` or `flexGrow` gets the whole tree refused. Wrap it in a `Box` instead.
* **Chat never reaches Claude.** Nothing typed in the pane, no passcode and no message may end up in the conversation. If you add a command with private arguments, add it to `PRIVATE_ARGS` in `hooks/commands.mjs` so its arguments are hidden.
* **Database changes go in a new migration.** Create one with `supabase migration new <name>`, never edit an old one, and add pgTAP tests for any new access rule in `supabase/tests/`.
* **Pin dependencies exactly.** Use `2.117.2`, not `^2.117.2`.

## Adding a room to the store

A room is one `room.json`. Put it in `rooms/<id>/`, run `node rooms/build-index.mjs` to check it and add it to the index, and open a pull request. [Write a room](https://chrisluo5311.github.io/squad-chat/rooms/write-a-room/) has the fields, the providers and the widgets. A new provider is a code change to `plugins/squad-chat/bridge/src/rooms/providers/`, with its own tests.

## Pull requests

1. Fork the repository and create a branch from `main`.
2. Make your change, with tests for new behavior.
3. Run the tests above.
4. If users will notice the change, update the README.
5. Open the pull request and describe what changed and why. Screenshots help for anything in the pane.

Keep commit messages short and in the imperative, like `Add /room rename` or `Fix unread count after a reconnect`.

By contributing, you agree that your work is released under the project's [MIT License](LICENSE).
