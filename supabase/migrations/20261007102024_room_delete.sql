-- The person who created a room can delete it, for everyone. Its members,
-- messages and failed-join records go with it (on delete cascade).

create policy "creator deletes room" on public.rooms
  for delete to authenticated
  using (created_by = (select auth.uid()));

grant delete on public.rooms to authenticated;
