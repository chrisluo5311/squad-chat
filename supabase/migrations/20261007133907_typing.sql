-- Typing indicators: members may broadcast on their room's channel.
--
-- Realtime checks this once, when a client joins, so it can't look at the
-- event name. The bridge only sends "typing", and receivers take the name
-- from their own records, not from the broadcast.

create policy "room members broadcast" on realtime.messages
  for insert to authenticated
  with check (
    realtime.messages.extension = 'broadcast'
    and private.is_room_topic_member((select realtime.topic()))
  );
