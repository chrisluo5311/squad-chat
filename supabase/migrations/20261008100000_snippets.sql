-- Shared snippets: a piece of code or a diff from someone's Claude Code
-- session, posted to a room as one message.
--
--   * `kind` is 'text' (a chat message, as before), 'code' or 'diff'.
--   * `lang` is an optional tag for code ("ts", "py"), shown, never run.
--   * Text stays at 500 characters. A snippet may be up to 8000 characters
--     and 200 lines.
--   * At most 3 snippets per person per minute, on top of the flood guard.
--
-- Older clients don't select the new columns and show a snippet as text.

alter table public.messages
  add column kind text not null default 'text' check (kind in ('text', 'code', 'diff')),
  add column lang text check (lang is null or lang ~ '^[a-z0-9+#._-]{1,20}$');

alter table public.messages drop constraint messages_body_check;
alter table public.messages add constraint messages_body_check check (
  btrim(body) <> ''
  and char_length(body) between 1 and (case when kind = 'text' then 500 else 8000 end)
  and (kind = 'text' or array_length(string_to_array(body, E'\n'), 1) <= 200)
);

grant insert (kind, lang) on public.messages to authenticated;

-- The flood guard, plus the snippet limit.
create or replace function private.check_message_rate() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if (select count(*) from public.messages
      where user_id = new.user_id and created_at > now() - interval '10 seconds') >= 10 then
    raise exception 'slow down: too many messages' using errcode = '54000';
  end if;
  if new.kind <> 'text' and (select count(*) from public.messages
      where user_id = new.user_id and kind <> 'text' and created_at > now() - interval '1 minute') >= 3 then
    raise exception 'slow down: at most 3 snippets a minute' using errcode = '54000';
  end if;
  return new;
end;
$$;
