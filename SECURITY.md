# Security Policy

squad-chat handles sign-ins, private rooms and chat messages, so security reports are very welcome.

## Reporting a vulnerability

**Please don't open a public issue for a security problem.** Report it privately instead:

1. Go to the [Security tab](https://github.com/chrisluo5311/squad-chat/security) of this repository.
2. Click **Report a vulnerability**.
3. Describe the problem, how to reproduce it, and what an attacker could do with it.

Only the maintainer can see the report. You'll get a reply within 7 days. This is a one-person project, so fixes can take a little longer, but you'll hear how it's going along the way.

Once a fix is released, the advisory is published with credit to you, unless you'd rather stay anonymous.

## Supported versions

Only the latest release gets security fixes. Update with `claude plugin marketplace update squad-chat && claude plugin update squad-chat@squad-chat`.

| Version | Supported |
| --- | --- |
| 0.5.x | ✅ |
| < 0.5 | ❌ |

## What's in scope

* **Chat reaching Claude.** Any way that messages, passcodes or other chat content end up in the model's context.
* **Database access.** Reading or writing rooms, members or messages you shouldn't, getting around a room's passcode or its lockout, or posting as someone else. The rules live in `supabase/migrations/`.
* **The bridge.** Its local control socket, its session file (`~/.config/squad-chat/session.json`), or anything that lets another local user or process act as you.
* **Leaking secrets.** Anything that exposes a session token, a passcode or an email address to other users.

## What's not in scope

* Problems in Supabase, Claude Code, Node.js or supabase-js themselves. Please report those to their own projects.
* A server set up differently from the steps in the README, such as one with changed RLS policies or a secret key handed to users.
* The person hosting a server reading its database. That's expected, and the README says so.
* Spam or flooding within the built-in limits (10 messages per 10 seconds, 500 characters per message).
