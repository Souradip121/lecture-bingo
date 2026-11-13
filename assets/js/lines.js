// Bingo line maths, shared by the app and the tests. Positions run 0..24 row by
// row; 12 is the FREE centre. Must match lb__lines() / lb__need() in schema.sql.
export const FREE = 12;

export const LINES = [
  [0, 1, 2, 3, 4], [5, 6, 7, 8, 9], [10, 11, 12, 13, 14], [15, 16, 17, 18, 19], [20, 21, 22, 23, 24],
  [0, 5, 10, 15, 20], [1, 6, 11, 16, 21], [2, 7, 12, 17, 22], [3, 8, 13, 18, 23], [4, 9, 14, 19, 24],
  [0, 6, 12, 18, 24], [4, 8, 12, 16, 20],
];

export const LINE_MASKS = LINES.map((cells) => cells.reduce((m, c) => m | (1 << c), 0));

const bits = (n) => {
  let c = 0;
  for (let x = n >>> 0; x; x &= x - 1) c += 1;
  return c;
};

/** Fewest cells still needed to finish any line, and the first closest line. */
export function need(mask) {
  let best = 5;
  let line = null;
  LINE_MASKS.forEach((m, i) => {
    const left = 5 - bits(mask & m);
    if (left < best) {
      best = left;
      line = i;
    }
  });
  return { need: best, line };
}

export const isMarked = (mask, pos) => pos === FREE || ((mask >>> pos) & 1) === 1;
export const toggle = (mask, pos, on) => ((on ? mask | (1 << pos) : mask & ~(1 << pos)) | (1 << FREE)) >>> 0;
