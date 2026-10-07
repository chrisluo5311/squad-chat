-- Realtime for squad-chat.
--
-- Each room is a private channel "room:<room uuid>". Realtime Authorization
-- checks these policies on realtime.messages when a client joins:
--   * SELECT: receive the channel (presence state, broadcasts)
--   * INSERT: track presence on it
-- Only room members pass either check.
--
-- New messages reach clients through postgres_changes on public.messages,
-- which Realtime filters with that table's own RLS (members only).

create policy "room members receive" on realtime.messages
  for select to authenticated
  using (private.is_room_topic_member((select realtime.topic())));

create policy "room members track presence" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'presence'
    and private.is_room_topic_member((select realtime.topic()))
  );

alter publication supabase_realtime add table public.messages;
