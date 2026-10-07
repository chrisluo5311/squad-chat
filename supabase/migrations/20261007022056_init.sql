-- squad-chat schema: profiles, rooms with passcodes, members, messages,
-- presence heartbeats.
--
-- Access model:
--   * anon gets nothing. Every table has RLS on and only `authenticated`
--     receives (column-level) grants.
--   * You can see a room, its members and its messages only while you are a
--     member. You become a member only through join_room(slug, passcode).
--   * "Friends" = everyone who shares at least one room with you.
--   * Privileged helpers live in the unexposed `private` schema; the API
--     surface in `public` is security invoker.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_cron;

create schema if not exists private;
revoke all on schema private from public;
-- RLS policies call private.* helpers as the signed-in user, so that role
-- needs USAGE. PostgREST does not expose this schema.
grant usage on schema private to authenticated;

-- ---------------------------------------------------------------- tables

create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text not null unique check (display_name ~ '^[A-Za-z0-9_-]{1,24}$'),
  created_at timestamptz not null default now()
);

create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,32}$'),
  passcode_hash text not null,                 -- bcrypt, never readable by clients
  created_by uuid not null references auth.users on delete cascade,
  created_at timestamptz not null default now()
);
create index rooms_created_by_idx on public.rooms (created_by);

create table public.room_members (
  room_id uuid not null references public.rooms on delete cascade,
  user_id uuid not null references auth.users on delete cascade,
  last_read_id bigint not null default 0,
  joined_at timestamptz not null default now(),
  primary key (room_id, user_id)
);
-- "which rooms am I in" / "who shares a room with me" start from user_id.
create index room_members_user_id_idx on public.room_members (user_id);

create table public.messages (
  id bigint generated always as identity primary key,
  room_id uuid not null references public.rooms on delete cascade,
  user_id uuid not null default auth.uid() references auth.users on delete cascade,
  body text not null check (char_length(body) between 1 and 500 and btrim(body) <> ''),
  created_at timestamptz not null default now()
);
create index messages_room_id_id_idx on public.messages (room_id, id desc);   -- backfill, history
create index messages_user_id_created_at_idx on public.messages (user_id, created_at);  -- flood check
create index messages_created_at_idx on public.messages (created_at);        -- retention

-- Last time a client said "I'm here". Realtime presence is the main signal;
-- this covers clients without a socket (desktop polling mode).
create table public.presence_heartbeats (
  user_id uuid primary key default auth.uid() references auth.users on delete cascade,
  last_seen timestamptz not null default now()
);

-- Wrong-passcode attempts, for rate limiting join_room. Server-side only.
create table private.join_failures (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users on delete cascade,
  room_id uuid not null references public.rooms on delete cascade,
  at timestamptz not null default now()
);
create index join_failures_user_id_at_idx on private.join_failures (user_id, at);
create index join_failures_room_id_idx on private.join_failures (room_id);

alter table public.profiles enable row level security;
alter table public.rooms enable row level security;
alter table public.room_members enable row level security;
alter table public.messages enable row level security;
alter table public.presence_heartbeats enable row level security;
alter table private.join_failures enable row level security;

-- ---------------------------------------------------------------- helpers

-- Security definer so policies on room_members can use it without recursing
-- into room_members' own RLS.
create function private.is_member(rid uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.room_members
    where room_id = rid and user_id = (select auth.uid())
  );
$$;

create function private.shares_room(other uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select other = (select auth.uid()) or exists (
    select 1
    from public.room_members mine
    join public.room_members theirs on theirs.room_id = mine.room_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = other
  );
$$;

-- Realtime topics are "room:<uuid>". Anything else, including a malformed
-- uuid, is simply "not a member" rather than an error.
create function private.is_room_topic_member(topic text) returns boolean
language plpgsql stable set search_path = '' as $$
begin
  if topic is null or topic !~ '^room:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return false;
  end if;
  return private.is_member(substr(topic, 6)::uuid);
end;
$$;

-- New user → profile named after the email's local part, normalized to
-- [A-Za-z0-9_-] and made unique with -2, -3, ...
create function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  base text;
  candidate text;
  n int := 1;
begin
  base := regexp_replace(split_part(coalesce(new.email, ''), '@', 1), '[^A-Za-z0-9_-]+', '-', 'g');
  base := btrim(left(base, 20), '-');           -- 20 + "-999" fits the 24-char limit
  if base = '' then base := 'user'; end if;
  candidate := base;
  loop
    begin
      insert into public.profiles (id, display_name) values (new.id, candidate);
      return new;
    exception when unique_violation then
      if exists (select 1 from public.profiles where id = new.id) then return new; end if;
      n := n + 1;
      if n > 999 then raise exception 'no free display name for %', base; end if;
      candidate := base || '-' || n;
    end;
  end loop;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function private.handle_new_user();

-- Join or create a room.
--   * room doesn't exist → create it with this passcode, you are its first member
--   * you're already a member → passcode not needed
--   * otherwise the passcode must match
-- Returns the room id, or NULL when the passcode is wrong. (Wrong passcodes
-- return instead of raising so the failure record survives; five failures
-- in 15 minutes lock the caller out of joining for a while.)
create function private.join_room(p_slug text, p_passcode text) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  room public.rooms%rowtype;
  failures int;
begin
  if uid is null then
    raise exception 'not signed in' using errcode = '28000';
  end if;
  p_slug := lower(btrim(coalesce(p_slug, '')));
  if p_slug !~ '^[a-z0-9-]{2,32}$' then
    raise exception 'room name must be 2-32 lowercase letters, digits or dashes' using errcode = '22023';
  end if;

  select * into room from public.rooms where slug = p_slug;
  if not found then
    if p_passcode is null or char_length(p_passcode) not between 4 and 64 then
      raise exception 'a new room needs a passcode of 4-64 characters' using errcode = '22023';
    end if;
    insert into public.rooms (slug, passcode_hash, created_by)
    values (p_slug, extensions.crypt(p_passcode, extensions.gen_salt('bf')), uid)
    on conflict (slug) do nothing
    returning * into room;
    if found then
      insert into public.room_members (room_id, user_id) values (room.id, uid);
      return room.id;
    end if;
    -- Someone created it a moment ago: join it like any existing room.
    select * into room from public.rooms where slug = p_slug;
  end if;

  if exists (select 1 from public.room_members where room_id = room.id and user_id = uid) then
    return room.id;
  end if;

  select count(*) into failures from private.join_failures
  where user_id = uid and at > now() - interval '15 minutes';
  if failures >= 5 then
    raise exception 'too many wrong passcodes, try again in 15 minutes' using errcode = '54000';
  end if;

  if p_passcode is null or extensions.crypt(p_passcode, room.passcode_hash) <> room.passcode_hash then
    insert into private.join_failures (user_id, room_id) values (uid, room.id);
    return null;
  end if;

  insert into public.room_members (room_id, user_id) values (room.id, uid)
  on conflict do nothing;
  return room.id;
end;
$$;

-- Flood guard: at most 10 messages per user per 10 seconds.
create function private.check_message_rate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.messages
      where user_id = new.user_id and created_at > now() - interval '10 seconds') >= 10 then
    raise exception 'slow down: too many messages' using errcode = '54000';
  end if;
  return new;
end;
$$;

create trigger messages_rate_limit
  before insert on public.messages
  for each row execute function private.check_message_rate();

-- The server clock decides last_seen, so a client can't claim a future one.
create function private.stamp_heartbeat() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.last_seen := now();
  return new;
end;
$$;

create trigger presence_heartbeats_stamp
  before insert or update on public.presence_heartbeats
  for each row execute function private.stamp_heartbeat();

-- ---------------------------------------------------------------- API (RPC)

create function public.join_room(p_slug text, p_passcode text default null) returns uuid
language sql security invoker set search_path = '' as $$
  select private.join_room(p_slug, p_passcode);
$$;

-- Everyone who shares a room with me, with the rooms we share.
create function public.my_friends()
returns table (user_id uuid, display_name text, last_seen timestamptz, rooms text[])
language sql stable security invoker set search_path = '' as $$
  select theirs.user_id, p.display_name, h.last_seen, array_agg(r.slug order by r.slug)
  from public.room_members mine
  join public.room_members theirs on theirs.room_id = mine.room_id and theirs.user_id <> mine.user_id
  join public.rooms r on r.id = mine.room_id
  join public.profiles p on p.id = theirs.user_id
  left join public.presence_heartbeats h on h.user_id = theirs.user_id
  where mine.user_id = (select auth.uid())
  group by theirs.user_id, p.display_name, h.last_seen;
$$;

-- Insert-or-touch my heartbeat.
create function public.heartbeat() returns timestamptz
language sql security invoker set search_path = '' as $$
  insert into public.presence_heartbeats (user_id) values ((select auth.uid()))
  on conflict (user_id) do update set last_seen = now()
  returning last_seen;
$$;

-- ---------------------------------------------------------------- policies

create policy "see own profile and roommates" on public.profiles
  for select to authenticated using (private.shares_room(id));
create policy "rename self" on public.profiles
  for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

create policy "members see room" on public.rooms
  for select to authenticated using (private.is_member(id));

create policy "members see members" on public.room_members
  for select to authenticated using (private.is_member(room_id));
create policy "mark own reads" on public.room_members
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy "leave room" on public.room_members
  for delete to authenticated using (user_id = (select auth.uid()));

create policy "members read messages" on public.messages
  for select to authenticated using (private.is_member(room_id));
create policy "members post as self" on public.messages
  for insert to authenticated
  with check (user_id = (select auth.uid()) and private.is_member(room_id));

create policy "see own and roommates heartbeats" on public.presence_heartbeats
  for select to authenticated using (private.shares_room(user_id));
create policy "write own heartbeat" on public.presence_heartbeats
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy "touch own heartbeat" on public.presence_heartbeats
  for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------- grants
-- Nothing is exposed by default; spell out exactly what clients may touch.

revoke all on public.profiles, public.rooms, public.room_members, public.messages,
  public.presence_heartbeats from anon, authenticated;
revoke all on private.join_failures from anon, authenticated;

grant select on public.profiles to authenticated;
grant update (display_name) on public.profiles to authenticated;

grant select (id, slug, created_by, created_at) on public.rooms to authenticated;  -- not passcode_hash

grant select, delete on public.room_members to authenticated;
grant update (last_read_id) on public.room_members to authenticated;

grant select on public.messages to authenticated;
grant insert (room_id, body) on public.messages to authenticated;   -- user_id/created_at are server-set

grant select on public.presence_heartbeats to authenticated;
grant insert (user_id), update (last_seen) on public.presence_heartbeats to authenticated;

revoke execute on all functions in schema private from public, anon, authenticated;
grant execute on function private.is_member(uuid), private.shares_room(uuid),
  private.is_room_topic_member(text), private.join_room(text, text) to authenticated;

revoke execute on function public.join_room(text, text), public.my_friends(), public.heartbeat()
  from public, anon;
grant execute on function public.join_room(text, text), public.my_friends(), public.heartbeat()
  to authenticated;

-- ---------------------------------------------------------------- retention

select cron.schedule('squad-chat-retention', '17 3 * * *', $$
  delete from public.messages where created_at < now() - interval '30 days';
  delete from public.presence_heartbeats where last_seen < now() - interval '30 days';
  delete from private.join_failures where at < now() - interval '1 day';
$$);
