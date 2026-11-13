// The result card: a 1080x1350 PNG drawn on a canvas, then shared with the
// Web Share API (files) or offered as a download.
import { LINES, FREE } from './lines.js';
import { COLORS } from './art.js';

const INK = '#161616';
const CREAM = '#F9F4E7';
const CELL = { r: COLORS.tomato, y: COLORS.sun, b: COLORS.cobalt, m: COLORS.mint, w: '#FCF8EE' };
const COLOR_GRID = 'rybmwmwrbybmywrwybmwrbmyr';

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};

function rr(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function starPath(ctx, cx, cy, R, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const r = i % 2 ? R * 0.48 : R;
    const a = rot + (i * Math.PI) / 5 - Math.PI / 2;
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
  }
  ctx.closePath();
}

function drawStar(ctx, cx, cy, R, fill, rot = 0) {
  starPath(ctx, cx, cy, R, rot);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineJoin = 'round';
  ctx.lineWidth = R * 0.15;
  ctx.strokeStyle = INK;
  ctx.stroke();
}

function drawSmiley(ctx, cx, cy, R, fill) {
  ctx.beginPath();
  ctx.arc(cx, cy, R, 0, Math.PI * 2);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = R * 0.14;
  ctx.strokeStyle = INK;
  ctx.stroke();
  ctx.fillStyle = INK;
  for (const dx of [-0.31, 0.31]) {
    ctx.beginPath();
    ctx.ellipse(cx + dx * R, cy - 0.22 * R, R * 0.12, R * 0.17, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.beginPath();
  ctx.arc(cx, cy + 0.02 * R, R * 0.5, 0.18 * Math.PI, 0.82 * Math.PI);
  ctx.lineWidth = R * 0.15;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function dashLine(ctx, x1, y1, x2, y2, color, w = 10) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function wrap(ctx, text, maxW) {
  const words = text.split(' ');
  const lines = [];
  let cur = '';
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (ctx.measureText(t).width <= maxW || !cur) cur = t;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines;
}

export async function drawResult(data) {
  try {
    await Promise.all([
      document.fonts.load('900 64px Nunito'),
      document.fonts.load('800 32px Nunito'),
      document.fonts.load('200px "Lilita One"'),
    ]);
  } catch {
    /* fall back to whatever is loaded */
  }
  const W = 1080;
  const H = 1350;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');

  // Sunflower page, cream card.
  ctx.fillStyle = '#FCE96A';
  ctx.fillRect(0, 0, W, H);
  rr(ctx, 40, 40, W - 80, H - 80, 64);
  ctx.fillStyle = CREAM;
  ctx.fill();

  // Burst + BINGO!
  const bx = W / 2;
  const by = 330;
  ctx.beginPath();
  const n = 26;
  const wob = [1, 0.86, 0.97, 0.9, 1, 0.84, 0.95, 0.88, 1, 0.92, 0.85, 0.98, 0.9];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const k = i % 2 === 0 ? wob[(i / 2) % wob.length] : 0.72 + 0.05 * Math.sin(i * 1.7);
    ctx.lineTo(bx + Math.cos(a) * 430 * k, by + Math.sin(a) * 250 * k);
  }
  ctx.closePath();
  ctx.fillStyle = COLORS.sun;
  ctx.fill();

  dashLine(ctx, 150, 120, 182, 160, COLORS.cobalt);
  dashLine(ctx, 920, 110, 892, 150, COLORS.tomato);
  dashLine(ctx, 110, 520, 148, 498, COLORS.green);
  dashLine(ctx, 960, 500, 930, 470, COLORS.cobalt);
  drawSmiley(ctx, bx, 128, 66, COLORS.sun);

  ctx.save();
  ctx.translate(bx, by + 40);
  ctx.rotate((-9 * Math.PI) / 180);
  ctx.font = '230px "Lilita One", Nunito, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 50;
  ctx.strokeStyle = '#FFE98A';
  ctx.strokeText('BINGO!', 6, 6);
  ctx.lineWidth = 24;
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  for (let k = 14; k >= 1; k -= 1) {
    ctx.strokeText('BINGO!', k, k);
    ctx.fillText('BINGO!', k, k);
  }
  ctx.strokeText('BINGO!', 0, 0);
  ctx.fillStyle = COLORS.tomato;
  ctx.fillText('BINGO!', 0, 0);
  ctx.restore();

  // Headline.
  const me = data.me;
  const secs = me.secs ?? 0;
  const time = secs < 60 ? `${secs} seconds` : `${Math.floor(secs / 60)} minute${Math.floor(secs / 60) === 1 ? '' : 's'}`;
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.font = '900 62px Nunito, sans-serif';
  ctx.fillText(me.place === 1 ? 'Won the lecture in' : `${ordinal(me.place)} place in`, W / 2, 650);
  ctx.font = '1000 104px Nunito, sans-serif';
  ctx.fillText(time, W / 2, 752);

  // The winning line, as five stickered squares.
  const line = LINES[me.line] || LINES[0];
  const cw = 168;
  const ch = 214;
  const gap = 18;
  const x0 = (W - (cw * 5 + gap * 4)) / 2;
  const y0 = 812;
  line.forEach((pos, i) => {
    const x = x0 + i * (cw + gap);
    const tilt = [-3, 2, -1.5, 3, -2][i];
    ctx.save();
    ctx.translate(x + cw / 2, y0 + ch / 2);
    ctx.rotate((tilt * Math.PI) / 180);
    rr(ctx, -cw / 2, -ch / 2, cw, ch, 24);
    ctx.fillStyle = pos === FREE ? COLORS.sun : CELL[COLOR_GRID[pos]];
    ctx.fill();
    ctx.lineWidth = 7;
    ctx.strokeStyle = INK;
    ctx.stroke();
    if (pos === FREE) {
      drawSmiley(ctx, 0, -26, 40, COLORS.sun);
      ctx.fillStyle = INK;
      ctx.font = '1000 40px Nunito, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('FREE', 0, 62);
    } else {
      const yellow = COLOR_GRID[pos] === 'y';
      drawStar(ctx, 0, -ch / 2 + 50, 34, yellow ? COLORS.tomato : COLORS.sun, -0.15);
      const text = data.round.deck[me.cells[pos]] || '';
      ctx.fillStyle = INK;
      ctx.textAlign = 'center';
      let fs = 32;
      let lines;
      do {
        ctx.font = `850 ${fs}px Nunito, sans-serif`;
        lines = wrap(ctx, text, cw - 22);
        fs -= 2;
      } while ((lines.length > 3 || lines.some((l) => ctx.measureText(l).width > cw - 16)) && fs > 18);
      const lh = fs * 1.18;
      const top = 22 - ((lines.length - 1) * lh) / 2;
      lines.forEach((l, k) => ctx.fillText(l, 0, top + k * lh + 10));
    }
    ctx.restore();
  });

  // Room + where to play.
  ctx.fillStyle = INK;
  ctx.textAlign = 'center';
  ctx.font = '850 40px Nunito, sans-serif';
  const players = data.summary.count;
  ctx.fillText(`Room ${data.room.code} · ${players} ${players === 1 ? 'player' : 'players'}`, W / 2, 1110);
  ctx.font = '1000 50px Nunito, sans-serif';
  ctx.fillText('Lecture Bingo', W / 2, 1196);
  ctx.font = '800 32px Nunito, sans-serif';
  ctx.fillStyle = '#3B3833';
  ctx.fillText('souradip121.github.io/lecture-bingo', W / 2, 1246);

  drawStar(ctx, 118, 1218, 46, COLORS.green, -0.25);
  drawSmiley(ctx, 962, 1214, 46, COLORS.green);

  return c;
}

/** Share the PNG if the browser can, otherwise hand back a URL for a save sheet. */
export async function shareResult(data, url) {
  const canvas = await drawResult(data);
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const file = new File([blob], 'lecture-bingo.png', { type: 'image/png' });
  const text = `${data.me.place === 1 ? 'Won' : `Got ${ordinal(data.me.place)} in`} Lecture Bingo in ${data.room.code}. Play along: ${url}`;
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], text });
      return { mode: 'shared' };
    } catch (e) {
      if (e?.name === 'AbortError') return { mode: 'cancelled' };
    }
  }
  return { mode: 'sheet', url: URL.createObjectURL(blob) };
}
