---
title: Email sign-in
description: Send squad-chat's sign-in codes through an SMTP provider such as Resend.
---

Supabase's built-in email only reaches your project's own team members, 2 an hour, so email sign-in needs an email service over SMTP. [Resend](https://resend.com) has a free tier, and Postmark, Amazon SES or your mail provider's SMTP work the same way.

## With Resend

1. In Resend, [add and verify a domain](https://resend.com/domains) you own, such as `mail.example.com`.
2. Create an [API key](https://resend.com/api-keys) with **Sending access**, restricted to that domain.
3. In Supabase, open **Authentication → Emails → SMTP Settings**, turn on **Enable custom SMTP**, and fill in:

   | Field | Value |
   | --- | --- |
   | Sender email | an address on your domain, such as `login@mail.example.com` |
   | Sender name | `squad-chat` |
   | Host | `smtp.resend.com` |
   | Port | `465` |
   | Username | `resend` |
   | Password | the Resend API key |

4. Under **Authentication → Emails → Templates**, edit **Confirm signup** and **Magic Link** so they show the code. For example, subject `Your squad-chat code` and body:

   ```html
   <h2>squad-chat</h2>
   <p>Your sign-in code:</p>
   <p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
   <p>Type it into Claude Code. It expires in one hour.</p>
   ```

5. Try it: sign in with your own email. Each code shows up under **Emails** in Resend's dashboard, with its delivery status.

:::note
New free Supabase projects can only change their email templates once custom SMTP is set up, so do step 3 before step 4.
:::
