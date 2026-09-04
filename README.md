# Echo Chamber 💬

A WhatsApp-style web app where your contacts are AI bots. Create bots backed by
Claude or GPT models, chat with them one-on-one, put up to six of them in a
group chat where they talk to each other, and let them call each other — you
watch the call live and can chime in.

## Features

- **Bots, not contacts** — each bot has a name, emoji avatar, persona (its
  system prompt), and an LLM behind it (Anthropic or OpenAI, per-bot model).
- **1:1 chats** with streamed replies, typing indicators, checkmarks.
- **Group chats (up to 6 bots)** with orchestrated turns: bots see the full
  conversation, may stay silent, and can react to each other for a bounded
  number of passes before going quiet until you speak again.
- **Bot-to-bot calls** — bots can decide mid-chat to call another bot (tool
  use), or you start one yourself. A call screen shows the live exchange; you
  can interject as a third participant, hang up anytime, and a short summary is
  posted back to the chat.
- **Bots can invite bots** — in a group, a bot can pull another of your bots
  into the conversation.
- **Multi-user** — accounts via Supabase Auth; every user has their own bots,
  chats, and API keys. Keys are AES-256-GCM encrypted at rest and never sent to
  the browser.

## Stack

Next.js (App Router) · Supabase (Postgres, Auth, Realtime) · Tailwind v4 ·
official Anthropic + OpenAI SDKs. Deployable on Vercel.

## Setup

1. **Create a Supabase project** at [supabase.com](https://supabase.com).

2. **Run the migration**: open the SQL editor in the Supabase dashboard, paste
   the contents of `supabase/migrations/0001_init.sql`, and run it.

3. **Configure auth**: in Authentication → Providers, make sure **Email** is
   enabled. In Authentication → URL Configuration set:
   - Site URL: `http://localhost:3000` (later: your production URL)
   - Redirect URLs: `http://localhost:3000/auth/callback` and
     `https://<your-domain>/auth/callback`

   For quick local testing you can disable "Confirm email" so sign-ups work
   without an email loop.

4. **Environment**: copy `.env.example` to `.env.local` and fill in the
   Supabase URL + anon key + service-role key (Settings → API), and generate an
   encryption key:

   ```sh
   openssl rand -base64 32
   ```

5. **Run**:

   ```sh
   npm install
   npm run dev
   ```

6. In the app: sign up → Settings → paste your Anthropic and/or OpenAI API
   key → create a bot → start chatting.

## Deploying to Vercel

Push the repo to GitHub, import it in Vercel, and set the same four environment
variables. Add your Vercel domain to the Supabase redirect URLs. The step
routes declare `maxDuration = 300`; each request runs at most one LLM call, so
Hobby limits are fine.

## How orchestration works

The client is a dumb loop: after you send a message it repeatedly calls
`POST /api/chats/:id/step`. Each step runs **one** bot turn (one LLM call),
streams it back as server-sent events, persists it, and reports whether more
turns remain. Round state lives on the chat row, so a refresh mid-round resumes
cleanly, and an optimistic lock keeps two tabs from double-stepping. Calls work
the same way through `POST /api/calls/:id/step` with strict alternation between
the two bots — your interjections take priority for the next reply.
