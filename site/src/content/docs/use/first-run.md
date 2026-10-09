---
title: First run
description: Open the pane, sign in, create or join a room and send your first message.
---

1. `/chat` opens the pane.
2. Sign in, depending on how your server is set up:
   - **With a name:** type the name you want and press Enter. That's it.
   - **With your email:** type your email and press Enter, then type the code from the email.
3. Create a room and give its name and passcode to your friends. Type this in the pane:

   ```
   /room our-team some-passcode
   ```

   Your friends join with the same line.
4. Chat: type in the pane and press Enter. Esc goes back to the prompt.

<figure class="shot">
  <img src="/squad-chat/media/sign-in.png" alt="The sign-in card: step 1 of 2, enter your email" />
  <figcaption>The sign-in card, when your server uses email codes.</figcaption>
</figure>

:::danger[An account made with just a name can't be recovered]
It has no email, so once you sign out, delete `~/.config/squad-chat` or switch computers, you can't sign back into it. Signing in again makes a new account: rejoin your rooms with their passcodes and you'll see their history again. Messages from the old account stay in the rooms until they expire after 30 days. Signing in by email doesn't have this problem.
:::

## Sign in from the prompt

You can also sign in without opening the pane:

```
/chat-login you@example.com     sends the code
/chat-login 12345678            the code from the email
/chat-login captain             with just a name, where the server allows it
```

## Next

- [Commands](/squad-chat/use/commands/) for everything you can type
- [Built-in rooms](/squad-chat/use/built-in-rooms/) for the Usage, Git and Agents tabs
