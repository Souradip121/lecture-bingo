// End-to-end check against your real Supabase project, using only the anon key
// from config.js (exactly what a browser has):
//   * every lb_ table is unreadable and unwritable directly,
//   * private helpers can't be called,
//   * the lb_* functions validate input, keep players' cards apart, decide BINGO
//     on the server, and push live updates over Realtime without leaking tokens.
// It makes rooms whose codes start with "LC-". Delete them afterwards from the
// SQL editor:  delete from public.lb_rooms where code like 'LC-%';
//
//   node scripts/live-check.mjs        (Node 22+, for the built-in WebSocket)
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { LINES, FREE } from '../assets/js/lines.js';
import { DEFAULT_PHRASES } from '../assets/js/phrases.js';

const H = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}`, 'Content-Type': 'application/json' };
let passed = 0;
const ok = (msg) => {
  passed += 1;
  console.log(`  ok  ${msg}`);
};
const token = () => randomBytes(32).toString('base64url');
const sha = (t) => createHash('sha256').update(t).digest('hex');

async function call(name, args) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: H, body: JSON.stringify(args) });
  const body = await res.json().catch(() => null);
  return { status: res.status, body };
}
async function rpc(name, args) {
  const r = await call(name, args);
  if (r.status >= 300) throw new Error(`${name} failed: ${r.status} ${JSON.stringify(r.body)}`);
  return r.body;
}
async function expectError(name, args, code, status) {
  const r = await call(name, args);
  assert.equal(r.status, status, `${name} should fail with HTTP ${status}, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.body?.message, code);
  ok(`${name} refuses: ${code} (${status})`);
}

console.log('Direct table access with the anon key');
for (const table of ['lb_rooms', 'lb_players', 'lb_rounds', 'lb_cards']) {
  const read = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=*&limit=1`, { headers: H });
  const readBody = await read.json().catch(() => null);
  assert.ok([401, 403, 404].includes(read.status), `${table} read gave ${read.status}`);
  assert.ok(!Array.isArray(readBody), `${table} returned rows`);
  const write = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, { method: 'POST', headers: H, body: '{}' });
  assert.ok(write.status >= 400, `${table} insert gave ${write.status}`);
  const del = await fetch(`${SUPABASE_URL}/rest/v1/${table}?room_id=not.is.null`, { method: 'DELETE', headers: H });
  assert.ok(del.status >= 400, `${table} delete gave ${del.status}`);
  ok(`${table}: read ${read.status}, insert ${write.status}, delete ${del.status}`);
}

console.log('Private helpers');
const Z = '00000000-0000-0000-0000-000000000000';
const helpers = {
  lb__hash: { p_token: 'x'.repeat(40) },
  lb__need: { p_mask: 4096 },
  lb__summary: { p_room: Z },
  lb__state: { p_room: Z, p_player: Z },
  lb__notify: { p_room: Z, p_kind: 'x' },
  lb__start_round: { p_room: Z, p_n: 9 },
  lb__deal: { p_room: Z, p_n: 1, p_player: Z },
};
for (const [fn, args] of Object.entries(helpers)) {
  const r = await call(fn, args);
  assert.ok([401, 403, 404].includes(r.status), `${fn} gave ${r.status}`);
  ok(`${fn} not callable (${r.status})`);
}

console.log('Input checks');
const code = `LC-${randomBytes(3).toString('hex').toUpperCase()}`;
const typed = code.toLowerCase().replace('-', ' ');
const ta = token();
const tb = token();
const tc = token();
const phrases = DEFAULT_PHRASES.slice(0, 30);
const base = { p_token: ta, p_code: code, p_nickname: 'Asha', p_phrases: phrases };
await expectError('lb_create_room', { ...base, p_token: 'short' }, 'bad_token', 400);
await expectError('lb_create_room', { ...base, p_code: 'x!' }, 'bad_code', 400);
await expectError('lb_create_room', { ...base, p_nickname: '  ' }, 'name_required', 400);
await expectError('lb_create_room', { ...base, p_nickname: 'A'.repeat(17) }, 'name_too_long', 400);
await expectError('lb_create_room', { ...base, p_phrases: phrases.slice(0, 23) }, 'need_24_phrases', 400);
await expectError('lb_create_room', { ...base, p_phrases: [...phrases.slice(0, 23), 'any DOUBTS?'] }, 'need_24_phrases', 400);
await expectError('lb_create_room', { ...base, p_phrases: [...phrases, 'x'.repeat(33)] }, 'phrase_too_long', 400);
await expectError('lb_create_room', { ...base, p_phrases: Array.from({ length: 61 }, (_, i) => `Line ${i}`) }, 'too_many_phrases', 400);

console.log('Room flow');
const a0 = await rpc('lb_create_room', { ...base, p_code: typed });
assert.equal(a0.room.code, code);
ok(`"${typed}" becomes room ${a0.room.code}`);
assert.equal(a0.room.is_creator, true);
assert.equal(a0.room.phrases.length, 30);
assert.equal(a0.round.n, 1);
assert.equal(a0.round.deck.length, 24);
assert.ok(a0.round.deck.every((p) => phrases.includes(p)));
ok("round 1 deals 24 of the room's 30 phrases");
assert.equal(a0.me.cells.length, 25);
assert.equal(a0.me.cells[FREE], -1);
assert.deepEqual(a0.me.cells.filter((c) => c >= 0).sort((x, y) => x - y), [...Array(24).keys()]);
assert.equal(a0.me.mask, 1 << FREE);
assert.equal(a0.me.need, 4);
ok('card: FREE centre + a shuffle of all 24 phrases, needs 4');
await expectError('lb_create_room', { ...base, p_token: tb, p_nickname: 'Bilal' }, 'code_taken', 409);

const peek0 = await rpc('lb_peek', { p_code: code });
assert.equal(peek0.exists, true);
assert.equal(peek0.players, 1);
const peekNone = await rpc('lb_peek', { p_code: 'LC-NOPE-NOPE' });
assert.equal(peekNone.exists, false);
const peekBad = await rpc('lb_peek', { p_code: '!!' });
assert.equal(peekBad.exists, false);
ok(`lb_peek: room has 1 player; unknown and bad codes say exists=false (${peekNone.playing_now} playing overall)`);

// Realtime: watch the room's public topic like a browser does.
const events = [];
const ws = new WebSocket(
  `${SUPABASE_URL.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(SUPABASE_ANON_KEY)}&vsn=1.0.0`
);
await new Promise((resolve, reject) => {
  const t = setTimeout(() => reject(new Error('realtime join timed out')), 10000);
  ws.onopen = () =>
    ws.send(
      JSON.stringify({
        topic: `realtime:${a0.room.topic}`,
        event: 'phx_join',
        ref: '1',
        join_ref: '1',
        payload: {
          config: { broadcast: { self: false }, presence: { key: '' }, postgres_changes: [], private: false },
          access_token: SUPABASE_ANON_KEY,
        },
      })
    );
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.event === 'phx_reply' && msg.ref === '1') {
      clearTimeout(t);
      if (msg.payload?.status === 'ok') resolve();
      else reject(new Error(JSON.stringify(msg.payload)));
    } else if (msg.event === 'broadcast') {
      events.push(msg.payload);
    }
  };
});
ok('joined the room topic on Realtime with the anon key');

const b0 = await rpc('lb_join', { p_token: tb, p_code: code, p_nickname: 'Bilal' });
assert.equal(b0.room.is_creator, false);
assert.equal(b0.room.phrases, null);
assert.deepEqual(b0.round.deck, a0.round.deck);
assert.notDeepEqual(b0.me.cells, a0.me.cells);
ok('Bilal joins: same 24 phrases, a different shuffle, no phrase list (not the creator)');
await expectError('lb_join', { p_token: tc, p_code: code, p_nickname: 'asha' }, 'name_taken', 409);
await expectError('lb_join', { p_token: tc, p_code: 'LC-NOPE-NOPE', p_nickname: 'Cara' }, 'room_not_found', 404);
await expectError('lb_state', { p_token: tc, p_code: code }, 'not_in_room', 403);
const b1 = await rpc('lb_join', { p_token: tb, p_code: code, p_nickname: 'Bilal K' });
assert.equal(b1.me.nick, 'Bilal K');
assert.equal(b1.summary.count, 2);
ok('joining again with the same token renames instead of adding a player');

const all = JSON.stringify([a0, b0, b1]);
for (const t of [ta, tb]) assert.ok(!all.includes(t) && !all.includes(sha(t)), 'a token or its hash leaked');
ok('no token or token hash in any response');

console.log('Marks and the server-side BINGO');
const mark = (t, cell, on = true, round = 1) => ({ p_token: t, p_code: code, p_round: round, p_cell: cell, p_on: on });
await expectError('lb_mark', mark(ta, FREE), 'bad_cell', 400);
await expectError('lb_mark', mark(ta, 25), 'bad_cell', 400);
await expectError('lb_mark', mark(ta, -1), 'bad_cell', 400);
await expectError('lb_mark', mark(ta, 0, true, 2), 'round_over', 409);
await expectError('lb_mark', mark(tc, 0), 'not_in_room', 403);

// Scattered marks never win, whatever the client thinks.
let s = a0;
for (const cell of [0, 6, 14, 22]) s = await rpc('lb_mark', mark(ta, cell));
assert.equal(s.me.place, null);
assert.ok(s.me.need > 0);
ok(`4 scattered marks: no BINGO, still needs ${s.me.need}`);
s = await rpc('lb_mark', mark(ta, 0, false));
assert.equal(s.me.mask & 1, 0);
ok('untap clears the mark');

// Bilal's marks don't touch Asha's card.
const bm = await rpc('lb_mark', mark(tb, 1));
assert.equal(bm.me.mask & 2, 2);
const as = await rpc('lb_state', { p_token: ta, p_code: code });
assert.equal(as.me.mask & 2, 0);
ok("marks are per card: Bilal's tap isn't on Asha's card");

// Asha completes the bottom row (positions 20..24).
for (const cell of [20, 21, 23]) s = await rpc('lb_mark', mark(ta, cell));
assert.equal(s.me.need, 1);
assert.equal(s.me.place, null);
s = await rpc('lb_mark', mark(ta, 24));
assert.equal(s.me.need, 0);
assert.equal(s.me.place, 1);
assert.equal(s.me.line, 4);
assert.ok(Number.isInteger(s.me.secs) && s.me.secs >= 0);
assert.equal(s.round.winners, 1);
ok(`bottom row complete: BINGO decided by the server, 1st place, line 4, ${s.me.secs}s on the clock`);
const frozen = await rpc('lb_mark', mark(ta, 24, false));
assert.equal(frozen.me.mask, s.me.mask);
ok('a winning card is frozen (untap ignored)');

// Bilal finishes column 2 (positions 1, 6, 11, 16, 21) for 2nd.
for (const cell of [6, 11, 16, 21]) s = await rpc('lb_mark', mark(tb, cell));
assert.equal(s.me.place, 2);
assert.equal(s.me.line, LINES.findIndex((l) => l.join() === '1,6,11,16,21'));
assert.deepEqual(
  s.summary.players.map((p) => [p.nick, p.place]),
  [['Asha', 1], ['Bilal K', 2]]
);
ok('the game keeps going: Bilal gets 2nd, the leaderboard shows both');

await new Promise((r) => setTimeout(r, 1500));
const kinds = events.map((e) => e.payload?.kind);
assert.ok(kinds.includes('join'), `no join event, got ${kinds}`);
assert.ok(kinds.includes('bingo'), `no bingo event, got ${kinds}`);
const bingo = events.find((e) => e.payload?.kind === 'bingo').payload;
assert.equal(bingo.who, 'Asha');
assert.ok(Array.isArray(bingo.players));
const evText = JSON.stringify(events);
for (const t of [ta, tb]) assert.ok(!evText.includes(t) && !evText.includes(sha(t)));
assert.ok(!/token|player_id|room_id|mask|cells/.test(evText));
// realtime.send adds its own message id; everything else is the summary.
for (const e of events) {
  const { id, ...rest } = e.payload;
  assert.deepEqual(Object.keys(rest).sort(), ['clock', 'count', 'kind', 'n', 'players', 'who', 'winners']);
  for (const p of rest.players) assert.deepEqual(Object.keys(p).sort(), ['need', 'nick', 'place', 'secs']);
}
ok(`Realtime pushed ${events.length} updates (${[...new Set(kinds)].join(', ')}); no tokens, ids or cards in them`);

console.log('Next lecture');
const bNext = await rpc('lb_next_round', { p_token: tb, p_code: code, p_from: 1 });
assert.equal(bNext.round.n, 2);
assert.equal(bNext.me.mask, 1 << FREE);
assert.equal(bNext.me.place, null);
ok('anyone can deal the next lecture once someone has won: fresh card, round 2');
const aNext = await rpc('lb_next_round', { p_token: ta, p_code: code, p_from: 1 });
assert.equal(aNext.round.n, 2);
ok('pressing it again from round 1 joins round 2 instead of skipping ahead');
await expectError('lb_mark', mark(ta, 0, true, 1), 'round_over', 409);
await expectError('lb_next_round', { p_token: tb, p_code: code, p_from: 2 }, 'round_in_progress', 409);
const aDeal = await rpc('lb_next_round', { p_token: ta, p_code: code, p_from: 2 });
assert.equal(aDeal.round.n, 3);
ok('the creator can deal new cards mid-lecture; others cannot');

console.log('Editing phrases');
const custom = [...DEFAULT_PHRASES.slice(10, 34), 'Hello students'];
await expectError('lb_set_phrases', { p_token: tb, p_code: code, p_phrases: custom }, 'not_creator', 403);
const edited = await rpc('lb_set_phrases', { p_token: ta, p_code: code, p_phrases: custom });
assert.equal(edited.round.n, 4);
assert.deepEqual(edited.room.phrases, custom);
assert.ok(edited.round.deck.every((p) => custom.includes(p)));
const bAfter = await rpc('lb_state', { p_token: tb, p_code: code });
assert.equal(bAfter.round.n, 4);
assert.deepEqual(bAfter.round.deck, edited.round.deck);
ok('creator saves new phrases: everyone gets round 4 from the new list');

console.log('Leaving');
await rpc('lb_leave', { p_token: tb, p_code: code });
await expectError('lb_state', { p_token: tb, p_code: code }, 'not_in_room', 403);
assert.equal((await rpc('lb_peek', { p_code: code })).players, 1);
ok('Bilal leaves; the room has 1 player');

ws.close();
console.log(`\n${passed} checks passed. Clean up: delete from public.lb_rooms where code like 'LC-%';`);
console.log(`ROOM ${code}`);
