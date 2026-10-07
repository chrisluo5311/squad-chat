-- squad-chat access-control tests. Run with: supabase test db
--
-- Cast: alice and bob share "lobby"; carol owns "secret" alone; dave joins
-- lobby only to hit the flood limit. Everything rolls back at the end.

begin;
create extension if not exists pgtap with schema extensions;
select no_plan();

-- ---------------------------------------------------------------- helpers

create schema tests;
grant usage on schema tests to authenticated, anon;

create function tests.uid(name text) returns uuid language sql immutable as $$
  select case name
    when 'alice'  then '11111111-1111-1111-1111-111111111111'
    when 'bob'    then '22222222-2222-2222-2222-222222222222'
    when 'carol'  then '33333333-3333-3333-3333-333333333333'
    when 'dave'   then '44444444-4444-4444-4444-444444444444'
    when 'alice2' then '55555555-5555-5555-5555-555555555555'
    when 'john'   then '66666666-6666-6666-6666-666666666666'
  end::uuid;
$$;

-- Become a signed-in user for the rest of the transaction (or until the next call).
create function tests.act_as(name text) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', tests.uid(name), 'role', 'authenticated')::text, true);
  perform set_config('role', 'authenticated', true);
end;
$$;

-- Room ids regardless of who is asking.
create function tests.room(slug text) returns uuid language sql stable security definer
set search_path = '' as $$ select id from public.rooms where rooms.slug = room.slug $$;

grant execute on all functions in schema tests to authenticated, anon;

insert into auth.users (id, email, aud, role) values
  (tests.uid('alice'),  'alice@example.com',     'authenticated', 'authenticated'),
  (tests.uid('bob'),    'bob@example.com',       'authenticated', 'authenticated'),
  (tests.uid('carol'),  'carol@example.com',     'authenticated', 'authenticated'),
  (tests.uid('dave'),   'dave@example.com',      'authenticated', 'authenticated'),
  (tests.uid('alice2'), 'alice@elsewhere.org',   'authenticated', 'authenticated'),
  (tests.uid('john'),   'Jo.hn+chat@example.com','authenticated', 'authenticated');

-- ---------------------------------------------------------------- profiles

select is((select display_name from public.profiles where id = tests.uid('alice')), 'alice',
  'new user gets the email local part as display name');
select is((select display_name from public.profiles where id = tests.uid('alice2')), 'alice-2',
  'display name collision gets a -2 suffix');
select is((select display_name from public.profiles where id = tests.uid('john')), 'Jo-hn-chat',
  'display name is normalized to [A-Za-z0-9_-]');

-- ---------------------------------------------------------------- anon

set local role anon;
select throws_ok($$ select * from public.messages $$, '42501', null, 'anon cannot read messages');
select throws_ok($$ select * from public.profiles $$, '42501', null, 'anon cannot read profiles');
select throws_ok($$ select public.join_room('lobby', 'hunter22') $$, '42501', null, 'anon cannot call join_room');
reset role;

-- ---------------------------------------------------------------- join_room

select tests.act_as('alice');
select isnt(public.join_room('lobby', 'hunter22'), null, 'creating a room returns its id');
select throws_ok($$ select public.join_room('Bad Slug!', 'hunter22') $$, '22023', null,
  'invalid room name is rejected');
select throws_ok($$ select public.join_room('fresh-room', 'abc') $$, '22023', null,
  'a new room needs a passcode of at least 4 characters');
select lives_ok($$ insert into public.messages (room_id, body) values (tests.room('lobby'), 'hello bob') $$,
  'member can post');

select tests.act_as('bob');
select is(public.join_room('lobby', 'wrong-pass'), null, 'wrong passcode returns null');

-- ---------------------------------------------------------------- non-member sees nothing

select is((select count(*)::int from public.messages), 0, 'non-member sees no messages');
select is((select count(*)::int from public.rooms), 0, 'non-member sees no rooms');
select is((select count(*)::int from public.room_members), 0, 'non-member sees no members');
select is((select count(*)::int from public.profiles), 1, 'non-member sees only own profile');
select throws_ok($$ insert into public.messages (room_id, body) values (tests.room('lobby'), 'let me in') $$,
  '42501', null, 'non-member cannot post');

-- ---------------------------------------------------------------- member

select is(public.join_room('lobby', 'hunter22'), tests.room('lobby'), 'right passcode joins');
select is(public.join_room('lobby'), tests.room('lobby'), 'existing member needs no passcode');
select is((select count(*)::int from public.messages), 1, 'member sees room messages');
select is((select count(*)::int from public.room_members), 2, 'member sees other members');
select is((select count(*)::int from public.profiles), 2, 'member sees roommate profiles');
select throws_ok($$ select passcode_hash from public.rooms $$, '42501', null,
  'passcode hash is not readable');

-- forging
select throws_ok(
  format($$ insert into public.messages (room_id, body, user_id) values (%L, 'fake', %L) $$,
         tests.room('lobby'), tests.uid('alice')),
  '42501', null, 'cannot post as someone else');
select throws_ok($$ insert into public.messages (room_id, body, created_at)
                    values (tests.room('lobby'), 'old', now() - interval '1 year') $$,
  '42501', null, 'cannot backdate a message');
select throws_ok($$ insert into public.messages (room_id, body) values (tests.room('lobby'), '   ') $$,
  '23514', null, 'blank message is rejected');
select throws_ok(format($$ insert into public.room_members (room_id, user_id) values (%L, %L) $$,
                        tests.room('lobby'), tests.uid('carol')),
  '42501', null, 'cannot add members directly');
select throws_ok($$ update public.room_members set room_id = gen_random_uuid() $$, '42501', null,
  'cannot move a membership to another room');

-- read markers: own row only
update public.room_members set last_read_id = 7 where user_id = tests.uid('bob');
update public.room_members set last_read_id = 99 where user_id = tests.uid('alice');
delete from public.room_members where user_id = tests.uid('alice');
reset role;
select is((select last_read_id from public.room_members where user_id = tests.uid('bob')), 7::bigint,
  'member can update own last_read_id');
select is((select last_read_id from public.room_members where user_id = tests.uid('alice')), 0::bigint,
  'member cannot update someone else''s last_read_id');
select is((select count(*)::int from public.room_members where user_id = tests.uid('alice')), 1,
  'member cannot remove someone else');

-- ---------------------------------------------------------------- passcode lockout

select tests.act_as('carol');
select isnt(public.join_room('secret', 'carols-pass'), null, 'carol creates secret');
select tests.act_as('bob');
-- bob already has 1 failure (lobby); 4 more makes 5.
select is(public.join_room('secret', 'guess-' || g), null, 'wrong guess ' || g) from generate_series(1, 4) g;
select throws_ok($$ select public.join_room('secret', 'carols-pass') $$, '54000', null,
  'after 5 wrong passcodes even the right one is refused for a while');

-- ---------------------------------------------------------------- flood guard

select tests.act_as('dave');
select isnt(public.join_room('lobby', 'hunter22'), null, 'dave joins lobby');
do $$ begin
  for i in 1..10 loop
    insert into public.messages (room_id, body) values (tests.room('lobby'), 'spam ' || i);
  end loop;
end $$;
select throws_ok($$ insert into public.messages (room_id, body) values (tests.room('lobby'), 'one too many') $$,
  '54000', null, '11th message within 10 seconds is refused');

-- ---------------------------------------------------------------- heartbeats & friends

select tests.act_as('alice');
select isnt(public.heartbeat(), null, 'heartbeat returns the server time');
update public.presence_heartbeats set last_seen = now() + interval '1 day';
select ok((select last_seen <= now() from public.presence_heartbeats where user_id = tests.uid('alice')),
  'last_seen cannot be set into the future');
select throws_ok(format($$ insert into public.presence_heartbeats (user_id) values (%L) $$, tests.uid('carol')),
  '42501', null, 'cannot write someone else''s heartbeat');

select tests.act_as('bob');
select is((select count(*)::int from public.presence_heartbeats where user_id = tests.uid('alice')), 1,
  'roommate sees heartbeat');
select results_eq(
  $$ select display_name, rooms, last_seen is not null from public.my_friends() order by display_name $$,
  $$ values ('alice'::text, array['lobby']::text[], true), ('dave', array['lobby'], false) $$,
  'my_friends lists roommates with shared rooms and last_seen');

select tests.act_as('carol');
select is((select count(*)::int from public.presence_heartbeats), 0, 'stranger sees no heartbeats');
select is((select count(*)::int from public.my_friends()), 0, 'stranger has no friends yet');

-- ---------------------------------------------------------------- realtime authorization

reset role;
insert into realtime.messages (topic, extension, event, payload, private)
values ('room:' || tests.room('lobby'), 'broadcast', 'test', '{}', true);

select tests.act_as('alice');
select set_config('realtime.topic', 'room:' || tests.room('lobby'), true);
select is((select count(*)::int from realtime.messages where topic = 'room:' || tests.room('lobby')), 1,
  'member can receive the room channel');
select lives_ok($$ insert into realtime.messages (topic, extension, event, payload, private)
                   values ('room:' || tests.room('lobby'), 'presence', 'track', '{}', true) $$,
  'member can track presence');

select tests.act_as('carol');
select is((select count(*)::int from realtime.messages where topic = 'room:' || tests.room('lobby')), 0,
  'non-member cannot receive the room channel');
select throws_ok($$ insert into realtime.messages (topic, extension, event, payload, private)
                    values ('room:' || tests.room('lobby'), 'presence', 'track', '{}', true) $$,
  '42501', null, 'non-member cannot track presence');

select tests.act_as('alice');
select throws_ok($$ insert into realtime.messages (topic, extension, event, payload, private)
                    values ('room:' || tests.room('lobby'), 'broadcast', 'x', '{}', true) $$,
  '42501', null, 'member cannot broadcast (presence only)');
select set_config('realtime.topic', 'room:not-a-uuid', true);
select is(private.is_room_topic_member((select realtime.topic())), false,
  'malformed topic is denied, not an error');

-- ---------------------------------------------------------------- deleting rooms

select tests.act_as('bob');
delete from public.rooms where id = tests.room('lobby');
reset role;
select isnt(tests.room('lobby'), null, 'a member who did not create the room cannot delete it');

select tests.act_as('alice');
select isnt(public.join_room('doomed', 'pass1234'), null, 'alice creates a room to delete');
insert into public.messages (room_id, body) values (tests.room('doomed'), 'soon gone');
select lives_ok(format($$ delete from public.rooms where id = %L $$, tests.room('doomed')),
  'the creator can delete the room');
reset role;
select is(tests.room('doomed'), null, 'the room is gone');
select is((select count(*)::int from public.messages m where not exists (select 1 from public.rooms r where r.id = m.room_id)), 0,
  'its messages went with it');

-- ---------------------------------------------------------------- leaving

select tests.act_as('bob');
delete from public.room_members where room_id = tests.room('lobby') and user_id = tests.uid('bob');
select is((select count(*)::int from public.messages), 0, 'after leaving, messages are hidden');

reset role;
select * from finish();
rollback;
