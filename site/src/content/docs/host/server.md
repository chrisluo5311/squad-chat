---
title: Host your own server
description: Set up a Supabase project for your group. One member does this once, on the free plan.
---

One member of each group does this once. Supabase's free plan is sufficient.

## 1. Create a Supabase project

Create a project at [supabase.com](https://supabase.com/dashboard).

## 2. Create the tables

With the [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started), from a clone of this repository:

```sh
supabase link --project-ref <your-project-ref>
supabase db push
```

Run `supabase db push` again from an updated clone whenever you update squad-chat, so that the server includes the changes the new version requires.

## 3. Lock down Realtime

In the dashboard, under **Realtime → Settings**, turn off **Allow public access to channels**.

## 4. Choose how people sign in

Either method, or both, can be enabled.

### With a name

The simplest option, requiring no email service. Under **Authentication → Sign In / Providers**, turn on **Allow anonymous sign-ins**.

Anyone can create an account this way, but rooms still require their passcode, so outsiders cannot see any content. Supabase limits anonymous sign-ups to 30 per hour per IP address.

:::caution
An account created with only a name cannot be recovered once its owner signs out. See [First run](/squad-chat/use/first-run/).
:::

### With an email code

Supabase sends the codes, but its built-in email only reaches your project's own team members (2 per hour), so an email service must be connected over SMTP. [Email sign-in](/squad-chat/host/email-sign-in/) describes the setup with Resend.

## 5. Share the server

Provide the other members with the project URL and the publishable key, found under **Project Settings → API Keys**. Every member, including the host, [connects with these values](/squad-chat/start/connect/).

:::note
As the host, you can read the server's database like any database administrator. The other members are entrusting you with their messages.
:::
