---
title: First run
description: Open the pane, sign in, create or join a room and send your first message.
---

1. `/chat` opens the pane.
2. Sign in, depending on how your server is set up:
   - **With a name:** type the name you want to use and press Enter.
   - **With your email:** type your email and press Enter, then enter the code from the email.
3. Create a room and share its name and passcode with the other members. Type the following in the pane:

   ```
   /room our-team some-passcode
   ```

   Other members join with the same command.
4. Chat: type a message in the pane and press Enter. Esc returns to the prompt.

<figure class="shot small">
  <img src="/squad-chat/media/sign-in.png" alt="The sign-in card: step 1 of 2, enter your email" />
  <figcaption>The sign-in card, when your server uses email codes.</figcaption>
</figure>

:::danger[An account created with only a name cannot be recovered]
Such an account has no email address, so after you sign out, delete `~/.config/squad-chat` or change computers, it can no longer be accessed. Signing in again creates a new account. Rejoining your rooms with their passcodes restores access to their history. Messages from the previous account remain in the rooms until they expire after 30 days. Accounts that sign in by email are not affected.
:::

## Sign in from the prompt

You can also sign in without opening the pane:

```
/chat-login you@example.com     sends the code
/chat-login 12345678            the code from the email
/chat-login captain             with only a name, where the server allows it
```

## Next

- [Commands](/squad-chat/use/commands/) for every available command
- [Built-in rooms](/squad-chat/use/built-in-rooms/) for the Usage, Git and Agents tabs
