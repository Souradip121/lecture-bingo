import test from 'node:test';
import assert from 'node:assert/strict';
import { LINES, LINE_MASKS, need, toggle, isMarked, FREE } from '../assets/js/lines.js';
import { DEFAULT_PHRASES } from '../assets/js/phrases.js';

// Same constants as lb__lines() in schema.sql.
const SQL_LINES = [31, 992, 31744, 1015808, 32505856, 1082401, 2164802, 4329604, 8659208, 17318416, 17043521, 1118480];

test('line masks match the SQL constants', () => {
  assert.deepEqual(LINE_MASKS, SQL_LINES);
  assert.equal(LINES.length, 12);
});

test('a fresh card needs 4 (the FREE centre counts)', () => {
  assert.equal(need(1 << FREE).need, 4);
});

test('every line completes', () => {
  for (const [i, cells] of LINES.entries()) {
    const mask = cells.reduce((m, c) => toggle(m, c, true), 1 << FREE);
    assert.deepEqual(need(mask), { need: 0, line: i });
  }
});

test('scattered marks do not win', () => {
  let mask = 1 << FREE;
  for (const c of [0, 6, 14, 22, 3, 9]) mask = toggle(mask, c, true);
  assert.ok(need(mask).need > 0);
});

test('untapping keeps FREE marked', () => {
  const m = toggle(1 << FREE, FREE, false);
  assert.ok(isMarked(m, FREE));
});

test('default pack: 30+ unique phrases that fit a cell', () => {
  assert.ok(DEFAULT_PHRASES.length >= 30 && DEFAULT_PHRASES.length <= 60);
  assert.equal(new Set(DEFAULT_PHRASES.map((p) => p.toLowerCase())).size, DEFAULT_PHRASES.length);
  for (const p of DEFAULT_PHRASES) assert.ok(p.length <= 32, p);
});
