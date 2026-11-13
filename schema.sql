-- ============================================================================
-- Lecture Bingo: Supabase / Postgres schema.
--
-- Safe to run more than once (idempotent). Every object it creates is prefixed
-- lb_ so it can share a project with other apps.
--
-- Security model
--   * No accounts. Each browser makes a random player token (32+ url-safe
--     characters) and keeps it in localStorage. The database stores only its
--     SHA-256 hash.
--   * Row level security is ON for every lb_ table, there are NO policies, and
--     anon/authenticated have no table privileges. The browser cannot read or
--     write a table directly.
--   * The browser calls the lb_* functions below. They are SECURITY DEFINER, pin
--     search_path to '', and check the room code and the player token.
--   * Marks are stored here, not trusted from the browser. lb_mark checks the
--     cell against that player's own card and decides the BINGO itself, so a
--     client cannot claim a win it doesn't have.
--   * Live updates: after a change the functions broadcast a small summary
--     (nicknames, how many cells each player still needs, winners) on the public
--     Realtime topic lb:<room id>. No tokens or ids of players are ever sent.
--   * Internal helpers (lb__*) are not executable by anon/authenticated.
--   * Rooms expire 24 hours after they are made.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table if not exists public.lb_rooms (
  id          uuid primary key default gen_random_uuid(),
  code        text not null check (code ~ '^[A-Z0-9]{1,12}(-[A-Z0-9]{1,12}){0,3}$' and char_length(code) between 3 and 16),
  phrases     text[] not null check (cardinality(phrases) between 24 and 60),
  creator     text not null check (char_length(creator) = 64),   -- sha256 hex of the creator's token
  round       integer not null default 1 check (round >= 1),
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null default now() + interval '24 hours'
);
create unique index if not exists lb_rooms_code_key on public.lb_rooms (code);
create index if not exists lb_rooms_expires_idx on public.lb_rooms (expires_at);

create table if not exists public.lb_players (
  id          uuid primary key default gen_random_uuid(),
  room_id     uuid not null references public.lb_rooms (id) on delete cascade,
  token_hash  text not null check (char_length(token_hash) = 64),
  nickname    text not null check (char_length(nickname) between 1 and 16),
  joined_at   timestamptz not null default now(),
  unique (room_id, token_hash)
);
create unique index if not exists lb_players_room_nick_key on public.lb_players (room_id, lower(nickname));

-- One row per lecture. deck = the 24 phrases everyone in the room gets this round.
create table if not exists public.lb_rounds (
  room_id        uuid not null references public.lb_rooms (id) on delete cascade,
  n              integer not null check (n >= 1),
  deck           text[] not null check (cardinality(deck) = 24),
  started_at     timestamptz not null default now(),
  first_mark_at  timestamptz,           -- the clock starts at the room's first tap
  winners        integer not null default 0,
  primary key (room_id, n)
);

-- A player's card for one round. cells[pos] = index into the round's deck
-- (0..23) for the 25 positions, row by row; the centre (pos 12) is -1 = FREE.
-- mask = marked positions as bits (bit 12, the FREE centre, is always set).
create table if not exists public.lb_cards (
  room_id    uuid not null,
  n          integer not null,
  player_id  uuid not null references public.lb_players (id) on delete cascade,
  cells      smallint[] not null check (cardinality(cells) = 25),
  mask       integer not null default 4096 check (mask >= 0 and mask < 33554432),
  need       smallint not null default 4 check (need between 0 and 5),
  marked_at  timestamptz,
  won_at     timestamptz,
  place      integer,
  win_line   smallint,
  primary key (room_id, n, player_id),
  foreign key (room_id, n) references public.lb_rounds (room_id, n) on delete cascade
);
create index if not exists lb_cards_player_idx on public.lb_cards (player_id);
create unique index if not exists lb_cards_place_key on public.lb_cards (room_id, n, place) where place is not null;

alter table public.lb_rooms   enable row level security;
alter table public.lb_players enable row level security;
alter table public.lb_rounds  enable row level security;
alter table public.lb_cards   enable row level security;

revoke all on table public.lb_rooms, public.lb_players, public.lb_rounds, public.lb_cards
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable from the browser)
-- ---------------------------------------------------------------------------

-- Player token -> sha256 hex. Rejects anything that isn't a long random token.
create or replace function public.lb__hash(p_token text)
returns text
language plpgsql immutable set search_path = ''
as $$
begin
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{32,64}$' then
    raise exception 'bad_token' using errcode = 'PT400';
  end if;
  return encode(sha256(convert_to(p_token, 'UTF8')), 'hex');
end $$;

-- "dbms 8am" -> "DBMS-8AM". Letters, digits and single dashes, 3 to 16 characters.
create or replace function public.lb__code(p_code text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare v text := upper(coalesce(p_code, ''));
begin
  v := regexp_replace(v, '[\s_./]+', '-', 'g');
  v := regexp_replace(v, '-{2,}', '-', 'g');
  v := btrim(v, '-');
  if char_length(v) not between 3 and 16 or v !~ '^[A-Z0-9]{1,12}(-[A-Z0-9]{1,12}){0,3}$' then
    raise exception 'bad_code' using errcode = 'PT400';
  end if;
  return v;
end $$;

create or replace function public.lb__nick(p_name text)
returns text
language plpgsql immutable set search_path = ''
as $$
declare v text := btrim(regexp_replace(coalesce(p_name, ''), '[\s[:cntrl:]]+', ' ', 'g'));
begin
  if char_length(v) = 0 then
    raise exception 'name_required' using errcode = 'PT400';
  end if;
  if char_length(v) > 16 then
    raise exception 'name_too_long' using errcode = 'PT400';
  end if;
  return v;
end $$;

-- Clean a phrase list: trim, collapse spaces, drop blanks and repeats (any case).
create or replace function public.lb__phrases(p_phrases text[])
returns text[]
language plpgsql immutable set search_path = ''
as $$
declare
  v_out  text[] := '{}';
  v_seen text[] := '{}';
  v_raw  text;
  v      text;
begin
  foreach v_raw in array coalesce(p_phrases, '{}'::text[]) loop
    v := btrim(regexp_replace(coalesce(v_raw, ''), '[\s[:cntrl:]]+', ' ', 'g'));
    continue when v = '';
    if char_length(v) > 32 then
      raise exception 'phrase_too_long' using errcode = 'PT400';
    end if;
    continue when lower(v) = any (v_seen);
    v_seen := v_seen || lower(v);
    v_out := v_out || v;
  end loop;
  if cardinality(v_out) < 24 then
    raise exception 'need_24_phrases' using errcode = 'PT400';
  end if;
  if cardinality(v_out) > 60 then
    raise exception 'too_many_phrases' using errcode = 'PT400';
  end if;
  return v_out;
end $$;

-- The 12 winning lines as bitmasks over positions 0..24 (row by row):
-- 5 rows, 5 columns, 2 diagonals.
create or replace function public.lb__lines()
returns integer[]
language sql immutable set search_path = ''
as $$
  select array[31, 992, 31744, 1015808, 32505856,
               1082401, 2164802, 4329604, 8659208, 17318416,
               17043521, 1118480]::integer[];
$$;

-- Fewest cells still needed to finish any line, and the first line that is closest.
create or replace function public.lb__need(p_mask integer, out need integer, out line integer)
language plpgsql immutable set search_path = ''
as $$
declare
  v_lines integer[] := public.lb__lines();
  v_left  integer;
begin
  need := 5;
  line := null;
  for i in 1 .. 12 loop
    v_left := 5 - bit_count(((p_mask & v_lines[i])::bigint)::bit(32));
    if v_left < need then
      need := v_left;
      line := i - 1;
    end if;
  end loop;
end $$;

-- A live room by code (expired rooms don't exist).
create or replace function public.lb__room(p_code text, p_lock boolean default false)
returns public.lb_rooms
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_code text := public.lb__code(p_code);
  r public.lb_rooms;
begin
  if p_lock then
    select * into r from public.lb_rooms where code = v_code and expires_at > now() for update;
  else
    select * into r from public.lb_rooms where code = v_code and expires_at > now();
  end if;
  if r.id is null then
    raise exception 'room_not_found' using errcode = 'PT404';
  end if;
  return r;
end $$;

create or replace function public.lb__player(p_room uuid, p_token text)
returns public.lb_players
language plpgsql stable security definer set search_path = ''
as $$
declare p public.lb_players;
begin
  select * into p from public.lb_players where room_id = p_room and token_hash = public.lb__hash(p_token);
  if p.id is null then
    raise exception 'not_in_room' using errcode = 'PT403';
  end if;
  return p;
end $$;

-- Deal one card: a fresh shuffle of the round's 24 phrases around the FREE centre.
create or replace function public.lb__deal(p_room uuid, p_n integer, p_player uuid)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_perm smallint[];
begin
  v_perm := array(select i::smallint from generate_series(0, 23) as i order by random());
  insert into public.lb_cards (room_id, n, player_id, cells)
  values (p_room, p_n, p_player, v_perm[1:12] || (-1)::smallint || v_perm[13:24])
  on conflict do nothing;
end $$;

-- Start round n for a room: pick 24 of its phrases, deal everyone a card.
create or replace function public.lb__start_round(p_room uuid, p_n integer)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare v_deck text[];
begin
  select array(select p from unnest(r.phrases) as p order by random() limit 24) into v_deck
  from public.lb_rooms r where r.id = p_room;
  insert into public.lb_rounds (room_id, n, deck) values (p_room, p_n, v_deck);
  update public.lb_rooms set round = p_n where id = p_room;
  perform public.lb__deal(p_room, p_n, pl.id) from public.lb_players pl where pl.room_id = p_room;
end $$;

-- What everyone in the room may see: nicknames, cells needed, winners.
create or replace function public.lb__summary(p_room uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'n', r.round,
    'count', (select count(*) from public.lb_players pl where pl.room_id = r.id),
    'winners', coalesce(rd.winners, 0),
    'clock', rd.first_mark_at,
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
               'nick', pl.nickname,
               'need', coalesce(c.need, 4),
               'place', c.place,
               'secs', case when c.won_at is not null
                            then floor(extract(epoch from c.won_at - coalesce(rd.first_mark_at, rd.started_at)))::int end)
             order by c.place nulls last, coalesce(c.need, 4), pl.joined_at)
      from public.lb_players pl
      left join public.lb_cards c on c.room_id = r.id and c.n = r.round and c.player_id = pl.id
      where pl.room_id = r.id), '[]'::jsonb)
  )
  from public.lb_rooms r
  left join public.lb_rounds rd on rd.room_id = r.id and rd.n = r.round
  where r.id = p_room;
$$;

-- Push the summary to everyone watching the room. Never fails the caller.
create or replace function public.lb__notify(p_room uuid, p_kind text, p_who text default null)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
begin
  perform realtime.send(
    public.lb__summary(p_room) || jsonb_build_object('kind', p_kind, 'who', p_who),
    'room', 'lb:' || p_room::text, false);
exception when others then
  null;
end $$;

-- Everything one player's screen needs.
create or replace function public.lb__state(p_room uuid, p_player uuid)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  r  public.lb_rooms;
  pl public.lb_players;
  rd public.lb_rounds;
  c  public.lb_cards;
begin
  select * into r from public.lb_rooms where id = p_room;
  select * into pl from public.lb_players where id = p_player;
  select * into rd from public.lb_rounds where room_id = p_room and n = r.round;
  select * into c from public.lb_cards where room_id = p_room and n = r.round and player_id = p_player;
  if c.player_id is null then
    perform public.lb__deal(p_room, r.round, p_player);
    select * into c from public.lb_cards where room_id = p_room and n = r.round and player_id = p_player;
  end if;
  return jsonb_build_object(
    'room', jsonb_build_object(
      'code', r.code,
      'topic', 'lb:' || r.id::text,
      'expires_at', r.expires_at,
      'is_creator', r.creator = pl.token_hash,
      'phrases', case when r.creator = pl.token_hash then to_jsonb(r.phrases) end),
    'round', jsonb_build_object(
      'n', rd.n, 'deck', to_jsonb(rd.deck), 'started_at', rd.started_at,
      'clock', rd.first_mark_at, 'winners', rd.winners),
    'me', jsonb_build_object(
      'nick', pl.nickname, 'cells', to_jsonb(c.cells), 'mask', c.mask, 'need', c.need,
      'place', c.place, 'line', c.win_line, 'won_at', c.won_at,
      'secs', case when c.won_at is not null
                   then floor(extract(epoch from c.won_at - coalesce(rd.first_mark_at, rd.started_at)))::int end),
    'summary', public.lb__summary(p_room)
  );
end $$;

-- ---------------------------------------------------------------------------
-- API (callable by anon through PostgREST: POST /rest/v1/rpc/<name>)
-- ---------------------------------------------------------------------------

-- Join screen: does this room exist, and how many are in it? Never errors.
create or replace function public.lb_peek(p_code text default null)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_code text;
  r public.lb_rooms;
begin
  begin
    v_code := public.lb__code(p_code);
  exception when others then
    v_code := null;
  end;
  if v_code is not null then
    select * into r from public.lb_rooms where code = v_code and expires_at > now();
  end if;
  return jsonb_build_object(
    'code', v_code,
    'exists', r.id is not null,
    'players', case when r.id is not null
                    then (select count(*) from public.lb_players pl where pl.room_id = r.id) end,
    'playing_now', (select count(*) from public.lb_players pl join public.lb_rooms rr on rr.id = pl.room_id
                    where rr.expires_at > now() and pl.joined_at > now() - interval '3 hours')
  );
end $$;

-- Make a room with your own phrases (or the default pack the app sends).
create or replace function public.lb_create_room(p_token text, p_code text, p_nickname text, p_phrases text[])
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_hash    text := public.lb__hash(p_token);
  v_code    text := public.lb__code(p_code);
  v_nick    text := public.lb__nick(p_nickname);
  v_phrases text[] := public.lb__phrases(p_phrases);
  v_room    uuid;
  v_player  uuid;
begin
  -- Housekeeping without pg_cron: drop a few expired rooms, and this code if it expired.
  delete from public.lb_rooms where id in (
    select id from public.lb_rooms where expires_at <= now() order by expires_at limit 50);
  delete from public.lb_rooms where code = v_code and expires_at <= now();

  insert into public.lb_rooms (code, phrases, creator)
  values (v_code, v_phrases, v_hash)
  on conflict (code) do nothing
  returning id into v_room;
  if v_room is null then
    raise exception 'code_taken' using errcode = 'PT409';
  end if;

  insert into public.lb_players (room_id, token_hash, nickname) values (v_room, v_hash, v_nick)
  returning id into v_player;
  perform public.lb__start_round(v_room, 1);
  return public.lb__state(v_room, v_player);
end $$;

-- Join a room (or change your nickname if you're already in it).
create or replace function public.lb_join(p_token text, p_code text, p_nickname text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_hash text := public.lb__hash(p_token);
  v_nick text := public.lb__nick(p_nickname);
  r  public.lb_rooms := public.lb__room(p_code);
  pl public.lb_players;
begin
  select * into pl from public.lb_players where room_id = r.id and token_hash = v_hash;
  begin
    if pl.id is null then
      if (select count(*) from public.lb_players where room_id = r.id) >= 150 then
        raise exception 'room_full' using errcode = 'PT409';
      end if;
      insert into public.lb_players (room_id, token_hash, nickname) values (r.id, v_hash, v_nick)
      returning * into pl;
      perform public.lb__deal(r.id, r.round, pl.id);
      perform public.lb__notify(r.id, 'join', v_nick);
    elsif pl.nickname is distinct from v_nick then
      update public.lb_players set nickname = v_nick where id = pl.id;
      perform public.lb__notify(r.id, 'rename', v_nick);
    end if;
  exception when unique_violation then
    raise exception 'name_taken' using errcode = 'PT409';
  end;
  return public.lb__state(r.id, pl.id);
end $$;

-- Your card and the room, for a player who is already in it.
create or replace function public.lb_state(p_token text, p_code text)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  r  public.lb_rooms := public.lb__room(p_code);
  pl public.lb_players := public.lb__player(r.id, p_token);
begin
  return public.lb__state(r.id, pl.id);
end $$;

-- Tap (p_on = true) or untap a cell. The server keeps the marks and decides BINGO.
create or replace function public.lb_mark(p_token text, p_code text, p_round integer, p_cell integer, p_on boolean)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  r      public.lb_rooms := public.lb__room(p_code);
  pl     public.lb_players := public.lb__player(r.id, p_token);
  c      public.lb_cards;
  v_mask integer;
  v_need integer;
  v_line integer;
  v_place integer;
begin
  if p_round is distinct from r.round then
    raise exception 'round_over' using errcode = 'PT409';
  end if;
  if p_cell is null or p_cell < 0 or p_cell > 24 or p_cell = 12 then
    raise exception 'bad_cell' using errcode = 'PT400';
  end if;

  select * into c from public.lb_cards
  where room_id = r.id and n = r.round and player_id = pl.id
  for update;
  if c.player_id is null then
    raise exception 'not_in_room' using errcode = 'PT403';
  end if;
  if c.won_at is not null then
    -- A finished card is frozen, so the winning line stays on it.
    return public.lb__state(r.id, pl.id);
  end if;

  if coalesce(p_on, true) then
    v_mask := c.mask | (1 << p_cell);
  else
    v_mask := c.mask & ~(1 << p_cell);
  end if;
  v_mask := v_mask | 4096;  -- FREE centre
  if v_mask = c.mask then
    return public.lb__state(r.id, pl.id);
  end if;

  if coalesce(p_on, true) then
    update public.lb_rounds set first_mark_at = now()
    where room_id = r.id and n = r.round and first_mark_at is null;
  end if;

  select x.need, x.line into v_need, v_line from public.lb__need(v_mask) as x;

  if v_need = 0 then
    update public.lb_rounds set winners = winners + 1
    where room_id = r.id and n = r.round
    returning winners into v_place;
    update public.lb_cards
    set mask = v_mask, need = 0, marked_at = now(), won_at = now(), place = v_place, win_line = v_line
    where room_id = r.id and n = r.round and player_id = pl.id;
    perform public.lb__notify(r.id, 'bingo', pl.nickname);
  else
    update public.lb_cards set mask = v_mask, need = v_need, marked_at = now()
    where room_id = r.id and n = r.round and player_id = pl.id;
    if v_need <> c.need then
      perform public.lb__notify(r.id, 'progress', pl.nickname);
    end if;
  end if;

  return public.lb__state(r.id, pl.id);
end $$;

-- "Next lecture": a fresh shuffle for everyone, same room and phrases. Allowed
-- once the current round has a winner (the room's creator can deal any time).
-- p_from = the round the caller is looking at, so two people pressing it at
-- once start only one new round.
create or replace function public.lb_next_round(p_token text, p_code text, p_from integer)
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  r  public.lb_rooms := public.lb__room(p_code, true);
  pl public.lb_players := public.lb__player(r.id, p_token);
  v_winners integer;
begin
  if p_from is not null and p_from < r.round then
    return public.lb__state(r.id, pl.id);  -- someone already dealt it
  end if;
  select winners into v_winners from public.lb_rounds where room_id = r.id and n = r.round;
  if coalesce(v_winners, 0) = 0 and r.creator <> pl.token_hash then
    raise exception 'round_in_progress' using errcode = 'PT409';
  end if;
  perform public.lb__start_round(r.id, r.round + 1);
  perform public.lb__notify(r.id, 'round', pl.nickname);
  return public.lb__state(r.id, pl.id);
end $$;

-- The room's creator edits the phrases; everyone is dealt a new card.
create or replace function public.lb_set_phrases(p_token text, p_code text, p_phrases text[])
returns jsonb
language plpgsql volatile security definer set search_path = ''
as $$
declare
  r  public.lb_rooms := public.lb__room(p_code, true);
  pl public.lb_players := public.lb__player(r.id, p_token);
  v_phrases text[] := public.lb__phrases(p_phrases);
begin
  if r.creator <> pl.token_hash then
    raise exception 'not_creator' using errcode = 'PT403';
  end if;
  update public.lb_rooms set phrases = v_phrases where id = r.id;
  perform public.lb__start_round(r.id, r.round + 1);
  perform public.lb__notify(r.id, 'round', pl.nickname);
  return public.lb__state(r.id, pl.id);
end $$;

-- Leave the room (your cards go with you).
create or replace function public.lb_leave(p_token text, p_code text)
returns void
language plpgsql volatile security definer set search_path = ''
as $$
declare
  r  public.lb_rooms := public.lb__room(p_code);
  pl public.lb_players := public.lb__player(r.id, p_token);
begin
  delete from public.lb_players where id = pl.id;
  perform public.lb__notify(r.id, 'leave', pl.nickname);
end $$;

-- ---------------------------------------------------------------------------
-- Privileges: helpers are private, the API is open to the anon key.
-- ---------------------------------------------------------------------------

revoke execute on function
  public.lb__hash(text), public.lb__code(text), public.lb__nick(text), public.lb__phrases(text[]),
  public.lb__lines(), public.lb__need(integer), public.lb__room(text, boolean), public.lb__player(uuid, text),
  public.lb__deal(uuid, integer, uuid), public.lb__start_round(uuid, integer), public.lb__summary(uuid),
  public.lb__notify(uuid, text, text), public.lb__state(uuid, uuid),
  public.lb_peek(text), public.lb_create_room(text, text, text, text[]), public.lb_join(text, text, text),
  public.lb_state(text, text), public.lb_mark(text, text, integer, integer, boolean),
  public.lb_next_round(text, text, integer), public.lb_set_phrases(text, text, text[]), public.lb_leave(text, text)
  from public, anon, authenticated;

grant execute on function
  public.lb_peek(text), public.lb_create_room(text, text, text, text[]), public.lb_join(text, text, text),
  public.lb_state(text, text), public.lb_mark(text, text, integer, integer, boolean),
  public.lb_next_round(text, text, integer), public.lb_set_phrases(text, text, text[]), public.lb_leave(text, text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Expiry: delete rooms 24 hours after they were made. Uses pg_cron when the
-- project has it (Supabase: Database -> Extensions -> pg_cron); without it,
-- expired rooms are already invisible and lb_create_room clears them out.
-- ---------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('lb_purge_expired_rooms', '41 * * * *',
                          'delete from public.lb_rooms where expires_at < now()');
  end if;
end $$;

notify pgrst, 'reload schema';
