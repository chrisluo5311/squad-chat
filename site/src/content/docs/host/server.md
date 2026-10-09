---
title: Host your own server
description: Set up a Supabase project for your group. One person does this, once, on the free plan.
---

One person per group does this, once. It fits in Supabase's free plan.

## 1. Create a Supabase project

Create one at [supabase.com](https://supabase.com/dashboard).

## 2. Create the tables

With the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), from a clone of this repository:

```sh
supabase link --project-ref <your-project-ref>
supabase db push
```

Run `supabase db push` again from an updated clone whenever you update squad-chat, so the server has what the new version needs.

## 3. Lock down Realtime

In the dashboard, under **Realtime → Settings**, turn off **Allow public access to channels**.

## 4. Choose how people sign in

You can turn on either or both.

### With a name

The simplest, with no email service. Under **Authentication → Sign In / Providers**, turn on **Allow anonymous sign-ins**.

Anyone can make an account this way, but rooms still need their passcode, so strangers see nothing. Supabase limits anonymous sign-ups to 30 per hour per IP address.

:::caution
An account made with just a name can't be recovered once its owner signs out. See [First run](/squad-chat/use/first-run/).
:::

### With an email code

Supabase sends the codes, but its built-in email only reaches your project's own team members (2 an hour), so connect an email service over SMTP. [Set up email sign-in](/squad-chat/host/email-sign-in/) walks through it with Resend.

## 5. Share the server

Give your friends the project URL and the publishable key, from **Project Settings → API Keys**. Everyone, you included, [connects with them](/squad-chat/start/connect/).

:::note
As host, you can read the server's database like any database admin. Your friends are trusting you with their messages.
:::
