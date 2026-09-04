-- Echo Chamber initial schema
-- Run this in the Supabase SQL editor (or `supabase db push`).

-- ============================================================ tables

create table public.provider_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  provider text not null check (provider in ('anthropic', 'openai')),
  key_ciphertext text not null,
  key_hint text not null default '',
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table public.bots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 60),
  avatar_emoji text not null default '🤖',
  avatar_color text not null default '#00a884',
  persona text not null default '',
  provider text not null check (provider in ('anthropic', 'openai')),
  model text not null,
  temperature numeric null check (temperature is null or (temperature >= 0 and temperature <= 2)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.chats (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('dm', 'group')),
  title text null,
  round jsonb not null default '{"status":"idle","version":0}',
  last_message_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create table public.chat_participants (
  chat_id uuid not null references public.chats (id) on delete cascade,
  bot_id uuid not null references public.bots (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  joined_at timestamptz not null default now(),
  left_at timestamptz null,
  primary key (chat_id, bot_id)
);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  chat_id uuid not null references public.chats (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  sender_type text not null check (sender_type in ('user', 'bot', 'system')),
  bot_id uuid null references public.bots (id) on delete set null,
  kind text not null default 'text' check (kind in ('text', 'event', 'call_summary')),
  content text not null,
  metadata jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index messages_chat_created_idx on public.messages (chat_id, created_at);

create table public.calls (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  chat_id uuid null references public.chats (id) on delete set null,
  bot_a uuid not null references public.bots (id) on delete cascade,
  bot_b uuid not null references public.bots (id) on delete cascade,
  status text not null default 'active' check (status in ('active', 'ended')),
  round_limit int not null default 8 check (round_limit between 1 and 16),
  rounds_used int not null default 0,
  locked_until timestamptz null,
  started_by text not null default 'user' check (started_by in ('user', 'bot')),
  summary text null,
  created_at timestamptz not null default now(),
  ended_at timestamptz null
);

create table public.call_messages (
  id uuid primary key default gen_random_uuid(),
  call_id uuid not null references public.calls (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  sender_type text not null check (sender_type in ('user', 'bot')),
  bot_id uuid null references public.bots (id) on delete set null,
  content text not null,
  created_at timestamptz not null default now()
);
create index call_messages_call_created_idx on public.call_messages (call_id, created_at);

-- ============================================================ group size cap

-- Fires on insert and on rejoin (left_at flipping back to null).
create or replace function public.enforce_group_size()
returns trigger
language plpgsql
security definer
as $$
begin
  if new.left_at is not null then
    return new; -- leaving is always allowed
  end if;
  if (select count(*) from public.chat_participants
      where chat_id = new.chat_id and left_at is null and bot_id <> new.bot_id) >= 6 then
    raise exception 'group chats support at most 6 bots';
  end if;
  return new;
end;
$$;

create trigger chat_participants_size_cap
  before insert or update of left_at on public.chat_participants
  for each row execute function public.enforce_group_size();

-- ============================================================ RLS

alter table public.provider_keys enable row level security;
alter table public.bots enable row level security;
alter table public.chats enable row level security;
alter table public.chat_participants enable row level security;
alter table public.messages enable row level security;
alter table public.calls enable row level security;
alter table public.call_messages enable row level security;

-- Owner-only access everywhere.
create policy bots_owner on public.bots
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy chats_select on public.chats
  for select using (user_id = auth.uid());
create policy chats_insert on public.chats
  for insert with check (user_id = auth.uid());
create policy chats_update on public.chats
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy chats_delete on public.chats
  for delete using (user_id = auth.uid());

create policy participants_select on public.chat_participants
  for select using (user_id = auth.uid());
create policy participants_insert on public.chat_participants
  for insert with check (user_id = auth.uid());
create policy participants_update on public.chat_participants
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy participants_delete on public.chat_participants
  for delete using (user_id = auth.uid());

-- Clients may read all their messages but insert only their own user messages;
-- bot/system rows are written server-side with the service role.
create policy messages_select on public.messages
  for select using (user_id = auth.uid());
create policy messages_insert_user_only on public.messages
  for insert with check (user_id = auth.uid() and sender_type = 'user' and kind = 'text');

create policy calls_select on public.calls
  for select using (user_id = auth.uid());

create policy call_messages_select on public.call_messages
  for select using (user_id = auth.uid());
create policy call_messages_insert_user_only on public.call_messages
  for insert with check (user_id = auth.uid() and sender_type = 'user');

-- provider_keys: no direct client policies at all; even select goes through
-- column-level grants so the ciphertext never leaves the server.
create policy provider_keys_select on public.provider_keys
  for select using (user_id = auth.uid());

-- ============================================================ column-level grants

-- Client sessions must never read ciphertext or write keys directly.
revoke all on public.provider_keys from anon, authenticated;
grant select (id, user_id, provider, key_hint, created_at) on public.provider_keys to authenticated;

-- Orchestration state is server-owned: clients can create chats but never
-- touch round state; call status/progress is server-owned too.
revoke update on public.chats from anon, authenticated;
grant update (title, last_message_at) on public.chats to authenticated;
revoke insert, update, delete on public.calls from anon, authenticated;

-- ============================================================ realtime

alter publication supabase_realtime add table public.messages;
alter publication supabase_realtime add table public.call_messages;
alter publication supabase_realtime add table public.chats;
alter publication supabase_realtime add table public.calls;
alter publication supabase_realtime add table public.chat_participants;
alter publication supabase_realtime add table public.bots;
