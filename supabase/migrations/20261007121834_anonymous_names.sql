-- Sign-in without email: an anonymous account (Supabase anonymous sign-ins)
-- names itself. The name the person typed arrives as user metadata
-- (display_name); with an email, the email's local part still wins.
--
-- Metadata is user-editable, which is fine here: it only seeds the display
-- name once, at sign-up. Nothing authorizes on it.

create or replace function private.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  source text;
  base text;
  candidate text;
  n int := 1;
begin
  source := coalesce(
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    new.raw_user_meta_data ->> 'display_name',
    ''
  );
  base := regexp_replace(source, '[^A-Za-z0-9_-]+', '-', 'g');
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

revoke execute on function private.handle_new_user() from public, anon, authenticated;
