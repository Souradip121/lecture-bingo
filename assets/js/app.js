// Lecture Bingo: join a room, tap what the prof says, the server calls BINGO.
import { api, messageFor } from './api.js';
import { watchRoom } from './live.js';
import { need as needOf, toggle, isMarked, LINES, FREE } from './lines.js';
import { DEFAULT_PHRASES } from './phrases.js';
import { smiley, star, beam, books, dash, people, burst, icons, COLORS } from './art.js';
import { shareResult } from './share.js';

const $app = document.getElementById('app');
const $sheet = document.getElementById('sheet');
const $toast = document.getElementById('toast');
const $banner = document.getElementById('banner');

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const memory = {};
const store = {
  get(k) {
    try {
      return localStorage.getItem(`lb.${k}`) ?? memory[k] ?? null;
    } catch {
      return memory[k] ?? null;
    }
  },
  set(k, v) {
    memory[k] = v;
    try {
      localStorage.setItem(`lb.${k}`, v);
    } catch {
      /* private mode: keep it for this visit */
    }
  },
};

function playerToken() {
  let t = store.get('token');
  if (!t || !/^[A-Za-z0-9_-]{43}$/.test(t)) {
    const b = crypto.getRandomValues(new Uint8Array(32));
    t = btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    store.set('token', t);
  }
  return t;
}
const TOKEN = playerToken();

export function normalizeCode(s) {
  return String(s || '')
    .toUpperCase()
    .replace(/[\s_./]+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-+/, '')
    .slice(0, 16);
}
const validCode = (c) => /^[A-Z0-9]{1,12}(-[A-Z0-9]{1,12}){0,3}$/.test(c) && c.length >= 3 && c.length <= 16;

const ordinal = (n) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
};
const minsShort = (secs) => (secs < 60 ? `${secs}s` : `${Math.floor(secs / 60)} min`);
const minsLong = (secs) => {
  if (secs < 60) return `${secs} second${secs === 1 ? '' : 's'}`;
  const m = Math.floor(secs / 60);
  return `${m} minute${m === 1 ? '' : 's'}`;
};
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const buzz = (p) => {
  try {
    navigator.vibrate?.(p);
  } catch {
    /* not supported */
  }
};

let toastTimer;
function toast(msg, ms = 2600) {
  $toast.textContent = msg;
  $toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => $toast.classList.remove('show'), ms);
}

let bannerTimer;
function banner(title, sub, onTap) {
  $banner.innerHTML = `${smiley()}<div><b>${esc(title)}</b><span>${esc(sub)}</span></div>`;
  $banner.onclick = () => {
    $banner.classList.remove('show');
    onTap?.();
  };
  requestAnimationFrame(() => $banner.classList.add('show'));
  clearTimeout(bannerTimer);
  bannerTimer = setTimeout(() => $banner.classList.remove('show'), 6000);
}

function openSheet(html, bind) {
  $sheet.innerHTML = `<div class="sheet-in">${html}</div>`;
  $sheet.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => $sheet.close()));
  bind?.($sheet);
  if (!$sheet.open) $sheet.showModal();
}
$sheet.addEventListener('click', (e) => {
  if (e.target === $sheet) $sheet.close();
});

const closeBtn = `<button class="iconbtn" type="button" data-close aria-label="Close">${icons.close()}</button>`;

// Decorations from the sticker sheet: placed per screen.
const deco = (cls, style, svg) => `<div class="deco ${cls}" style="${style}">${svg}</div>`;
const dashSvg = (paths, vb = '0 0 40 40') => `<svg viewBox="${vb}" aria-hidden="true" fill="none">${paths}</svg>`;

// ---------------------------------------------------------------------------
// App state
// ---------------------------------------------------------------------------

const S = {
  code: null, // room on screen
  data: null, // last lb_state for it
  live: null, // Realtime watcher
  view: null, // 'card' | 'win'
  showCard: false, // a winner chose "See my card"
  inflight: 0,
  queue: Promise.resolve(),
  peekTimer: null,
  dealtByMe: false,
};

function stopLive() {
  S.live?.stop();
  S.live = null;
}

function roomUrl(code) {
  return `${location.origin}${location.pathname}#/r/${code}`;
}

// ---------------------------------------------------------------------------
// Router
// ---------------------------------------------------------------------------

function route() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  if ($sheet.open) $sheet.close();
  if (h.startsWith('r/')) {
    const [, raw, sub] = h.split('/');
    const code = normalizeCode(raw);
    if (sub === 'edit') return editorScreen(code);
    return roomScreen(code);
  }
  stopLive();
  S.code = null;
  S.data = null;
  if (h === 'new') return editorScreen(null);
  // Old-style share link: #DBMS-8AM
  const legacy = normalizeCode(h);
  return joinScreen(validCode(legacy) ? legacy : store.get('last') || '');
}
window.addEventListener('hashchange', route);

function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

// ---------------------------------------------------------------------------
// Join screen
// ---------------------------------------------------------------------------

function joinScreen(prefill = '', { error = '', sheet = null } = {}) {
  document.title = 'Lecture Bingo · play the 8 AM lecture';
  $app.innerHTML = `
  <section class="screen join">
    <div class="logo">
      ${smiley(COLORS.sun, 'smile')}
      ${star(COLORS.tomato, 'star-r')}
      <h1><span>Lecture</span> <span>Bingo</span></h1>
      <svg class="dashes" viewBox="0 0 320 130" preserveAspectRatio="none" aria-hidden="true" fill="none">
        ${dash(COLORS.cobalt, 6, 76, 22, 86)}${dash(COLORS.green, -6, 100, 16, 99)}${dash(COLORS.cobalt, 8, 122, 22, 110)}
        ${dash(COLORS.green, 300, 94, 318, 88)}${dash(COLORS.green, 300, 118, 318, 124)}
      </svg>
    </div>
    ${books()}
    <h2>Join a room</h2>
    <form class="join-form" novalidate>
      <label class="label" for="code">Room code</label>
      <input class="field code" id="code" name="code" value="${esc(prefill)}" placeholder="e.g. DBMS-8AM"
        autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" maxlength="20" enterkeyhint="go">
      <button class="btn red" type="submit">Join</button>
      <p class="form-error" role="alert">${esc(error)}</p>
    </form>
    <a class="make-link" href="#/new">${icons.pencil()}<span>Make a card for your prof</span>${icons.arrow()}</a>
    <p class="playing" aria-live="polite">${people()}<span class="pl-text">&nbsp;</span></p>
    ${deco('', 'left:14px;bottom:30px;width:56px;transform:rotate(-14deg)', star(COLORS.green))}
    ${deco('', 'left:66px;bottom:26px;width:28px;height:28px', dashSvg(dash(COLORS.cobalt, 6, 34, 24, 14, 4.5), '0 0 30 40'))}
    ${deco('', 'left:18px;bottom:96px;width:24px;height:24px', dashSvg(dash(COLORS.green, 6, 6, 18, 22, 4.5), '0 0 24 28'))}
    ${deco('', 'right:16px;bottom:24px;width:66px', smiley())}
    ${deco('', 'right:84px;bottom:38px;width:28px;height:44px', dashSvg(dash(COLORS.green, 6, 8, 22, 16, 4.5) + dash(COLORS.cobalt, 6, 34, 22, 26, 4.5), '0 0 28 44'))}
  </section>`;

  const form = $app.querySelector('form');
  const input = form.code;
  const err = form.querySelector('.form-error');
  const plText = $app.querySelector('.pl-text');

  const peek = async () => {
    const code = normalizeCode(input.value);
    try {
      const r = await api.peek(validCode(code) ? code : null);
      if (normalizeCode(input.value) !== code) return;
      if (validCode(code) && r.exists) {
        plText.innerHTML = `<b>${r.players}</b> ${r.players === 1 ? 'classmate' : 'classmates'} playing`;
      } else if (validCode(code)) {
        plText.textContent = 'No room yet. Join starts it.';
      } else if (r.playing_now > 1) {
        plText.innerHTML = `<b>${r.playing_now}</b> students playing right now`;
      } else {
        plText.textContent = 'No sign-up. Just a code.';
      }
    } catch {
      plText.textContent = 'No sign-up. Just a code.';
    }
  };
  input.addEventListener('input', () => {
    const pos = input.selectionStart;
    const before = input.value;
    const norm = before.toUpperCase().replace(/[^A-Z0-9 _./-]/g, '');
    if (norm !== before) {
      input.value = norm;
      input.setSelectionRange(pos, pos);
    }
    err.textContent = '';
    clearTimeout(S.peekTimer);
    S.peekTimer = setTimeout(peek, 350);
  });
  peek();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = normalizeCode(input.value);
    input.value = code;
    if (!validCode(code)) {
      err.textContent = 'Type the code your class is using, like DBMS-8AM.';
      input.focus();
      return;
    }
    const btn = form.querySelector('button');
    btn.disabled = true;
    try {
      const st = await api.state(TOKEN, code);
      S.data = st;
      S.code = code;
      go(`#/r/${code}`);
    } catch (ex) {
      if (ex.code === 'not_in_room') nicknameSheet({ code, mode: 'join' });
      else if (ex.code === 'room_not_found') nicknameSheet({ code, mode: 'start' });
      else err.textContent = messageFor(ex);
    } finally {
      btn.disabled = false;
    }
  });

  if (sheet) nicknameSheet(sheet);
}

// "What should the class call you?" for joining, starting or making a room.
function nicknameSheet({ code, mode, phrases = null, onDone = null }) {
  const titles = {
    join: [`Joining ${code}`, 'Pick a nickname your class will see on the leaderboard.'],
    start: [`Start ${code}?`, "There's no room with this code yet. Start it with the classic card and send the code to your class. Rooms last 24 hours."],
    make: [`Make ${code}`, 'Last step: the nickname your class will see.'],
    rename: ['Change your name', 'Your class sees this on the leaderboard.'],
  };
  const [title, sub] = titles[mode];
  const cta = { join: "Let's play", start: 'Start the room', make: 'Make the room', rename: 'Save' }[mode];
  openSheet(
    `<div class="sheet-head"><div><h2>${esc(title)}</h2><p class="sub">${esc(sub)}</p></div>${closeBtn}</div>
     <form novalidate>
       <label class="label" for="nick">Nickname</label>
       <input class="field small" id="nick" name="nick" maxlength="16" autocomplete="nickname" enterkeyhint="go"
         placeholder="e.g. Riya" value="${esc(mode === 'rename' ? S.data?.me.nick : store.get('nick') || '')}">
       <button class="btn red pill mid" type="submit">${cta}</button>
       <p class="form-error" role="alert"></p>
     </form>`,
    (root) => {
      const form = root.querySelector('form');
      const nick = form.nick;
      const err = form.querySelector('.form-error');
      setTimeout(() => nick.focus(), 60);
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const name = nick.value.trim().replace(/\s+/g, ' ');
        if (!name) {
          err.textContent = 'Type a nickname first.';
          return;
        }
        const btn = form.querySelector('button');
        btn.disabled = true;
        err.textContent = '';
        try {
          let st;
          if (mode === 'join' || mode === 'rename') st = await api.join(TOKEN, code, name);
          else {
            try {
              st = await api.create(TOKEN, code, name, phrases || DEFAULT_PHRASES);
            } catch (ex) {
              // Someone made the same room a moment ago: just join it.
              if (ex.code === 'code_taken' && mode === 'start') st = await api.join(TOKEN, code, name);
              else throw ex;
            }
          }
          store.set('nick', name);
          $sheet.close();
          if (onDone) return onDone(st);
          S.data = st;
          S.code = code;
          go(`#/r/${code}`);
        } catch (ex) {
          err.textContent = messageFor(ex);
          btn.disabled = false;
        }
      });
    }
  );
}

// ---------------------------------------------------------------------------
// Room: card + win
// ---------------------------------------------------------------------------

// The cell colours follow the approved sticker card, the same on every card.
const COLOR_GRID = 'rybmw' + 'mwrby' + 'bmywr' + 'wybmw' + 'rbmyr';
const TILTS = [-9, 7, -5, 10, -12, 6, -8, 4, -6, 9, 11, -7, 0, 5, -10, -4, 8, -11, 6, -6, 9, -8, 5, -9, 12];

function stickerFor(pos) {
  const c = COLOR_GRID[pos];
  if (c === 'y') return star(COLORS.tomato);
  if (c === 'w' || pos % 7 === 3) return smiley(c === 'w' ? COLORS.sun : COLORS.sun);
  return star(COLORS.sun);
}

async function roomScreen(code) {
  if (!validCode(code)) return go('#/');
  if (S.code !== code) {
    stopLive();
    S.data = S.code === code ? S.data : S.data?.room?.code === code ? S.data : null;
    S.code = code;
    S.showCard = false;
  }
  store.set('last', code);
  S.dealtByMe = false;
  if (!S.data) {
    $app.innerHTML = `<section class="screen"><div class="loading">${smiley()}<span>Finding ${esc(code)}…</span></div></section>`;
    try {
      S.data = await api.state(TOKEN, code);
    } catch (ex) {
      S.code = null;
      if (ex.code === 'not_in_room') return joinScreen(code, { sheet: { code, mode: 'join' } });
      if (ex.code === 'room_not_found')
        return joinScreen(code, { error: `${code} has closed or never existed. Rooms last 24 hours. Press Join to start it again.` });
      return joinScreen(code, { error: messageFor(ex) });
    }
  }
  if (!S.live) {
    S.live = watchRoom(S.data.room.topic, {
      onSummary,
      onStatus: () => paintLive(),
      onPoll: async () => {
        if (S.inflight) return;
        const st = await api.state(TOKEN, code);
        if (S.code === code && !S.inflight) applyState(st);
      },
    });
  }
  render();
}

function render() {
  const d = S.data;
  if (d.me.place && !S.showCard) renderWin();
  else renderCard();
}

function myName() {
  return S.data?.me.nick;
}

function renderCard() {
  S.view = 'card';
  const d = S.data;
  document.title = `${d.room.code} · Lecture Bingo`;
  const locked = !!d.me.place;
  const cells = d.me.cells
    .map((idx, pos) => {
      if (pos === FREE) return `<div class="cell free" role="img" aria-label="Free square">${beam()}<b>FREE</b></div>`;
      const text = d.round.deck[idx];
      const hit = isMarked(d.me.mask, pos);
      return `<button class="cell c-${COLOR_GRID[pos]}${hit ? ' hit' : ''}" type="button" data-pos="${pos}" aria-pressed="${hit}"
        style="--tilt:${TILTS[pos]}deg"><span class="sticker">${stickerFor(pos)}</span><span class="t">${esc(text)}</span><span class="pop"><i></i><i></i><i></i><i></i></span></button>`;
    })
    .join('');
  $app.innerHTML = `
  <section class="screen card${locked ? ' locked' : ''}">
    <header class="topbar">
      <button class="iconbtn" type="button" data-act="home" aria-label="Back to rooms">${icons.back()}</button>
      <h1>Lecture Bingo</h1>
      <button class="iconbtn" type="button" data-act="menu" aria-label="Room menu">${icons.gear()}</button>
    </header>
    <p class="roomline"><span class="live-dot off" title="Live"></span><button type="button" data-act="invite" aria-label="Invite classmates to ${esc(d.room.code)}">${esc(d.room.code)}</button> · <span class="rl-count"></span></p>
    <div class="grid${locked ? ' locked' : ''}" aria-label="Your card. Tap a square when your professor says it.">${cells}</div>
    <button class="strip" type="button" data-act="strip" aria-live="polite"></button>
    <p class="card-foot"></p>
  </section>`;
  if (locked && d.me.line != null) {
    LINES[d.me.line].forEach((p) => $app.querySelector(`[data-pos="${p}"]`)?.classList.add('won-line'));
    $app.querySelector('.cell.free')?.classList.toggle('won-line', LINES[d.me.line].includes(FREE));
  }
  $app.querySelector('.grid').addEventListener('click', (e) => {
    const b = e.target.closest('button.cell');
    if (b) tap(Number(b.dataset.pos));
  });
  $app.querySelector('.screen').addEventListener('click', onAction);
  updateRoomBits();
  paintLive();
  fitCells();
}

function paintLive() {
  const dot = $app.querySelector('.live-dot');
  if (dot) dot.classList.toggle('off', !S.live?.live);
}

// One text size for the whole card (like the printed sheet), shrunk only for
// the squares that need it. Sticker space is reserved so taps never reflow.
function fitCells() {
  const run = () => {
    const cells = [...$app.querySelectorAll('.cell[data-pos]')];
    if (!cells.length) return;
    const w = cells[0].clientWidth;
    const base = Math.max(12, Math.min(16, w * 0.2));
    const MIN = 11;
    const overflows = (cell, t) => t.scrollWidth > t.clientWidth + 0.5 || cell.scrollHeight > cell.clientHeight + 0.5;
    const fitted = cells.map((cell) => {
      const t = cell.querySelector('.t');
      const had = cell.classList.contains('hit');
      cell.classList.add('hit');
      t.style.hyphens = 'manual';
      t.style.overflowWrap = 'normal';
      let fs = base;
      cell.style.setProperty('--fs', `${fs}px`);
      while (fs > MIN && overflows(cell, t)) {
        fs -= 0.5;
        cell.style.setProperty('--fs', `${fs}px`);
      }
      const stuck = overflows(cell, t);
      if (!had) cell.classList.remove('hit');
      return { cell, t, fs, stuck };
    });
    // The card's size: what most squares can take (30th percentile of fits).
    const sorted = fitted.map((f) => f.fs).sort((a, b) => a - b);
    const card = sorted[Math.floor(sorted.length * 0.3)];
    for (const f of fitted) {
      f.cell.style.setProperty('--fs', `${Math.min(card, f.fs)}px`);
      if (f.stuck) {
        // Even the smallest size can't fit a long word: offer a syllable break
        // (browsers won't auto-hyphenate capitalised words), then any break.
        f.t.textContent = softHyphens(f.t.textContent);
        const had = f.cell.classList.contains('hit');
        f.cell.classList.add('hit');
        if (overflows(f.cell, f.t)) f.t.style.overflowWrap = 'anywhere';
        if (!had) f.cell.classList.remove('hit');
      }
    }
  };
  if (document.fonts?.status !== 'loaded') document.fonts.ready.then(run);
  run();
}
// "Attendance" -> "Atten­dance": a soft hyphen at the consonant pair nearest
// the middle of each long word (VC|CV), else before a consonant-vowel pair.
function softHyphens(text) {
  const V = /[aeiouy]/i;
  return text.replace(/[A-Za-z]{8,}/g, (w) => {
    if (w.includes('­')) return w;
    const mid = w.length / 2;
    let best = -1;
    for (let i = 3; i <= w.length - 3; i += 1) {
      const a = w[i - 1];
      const b = w[i];
      const ok = (!V.test(a) && !V.test(b) && V.test(w[i - 2]) && V.test(w[i + 1])) || (V.test(a) && !V.test(b) && V.test(w[i + 1]));
      if (ok && (best < 0 || Math.abs(i - mid) < Math.abs(best - mid))) best = i;
    }
    return best > 0 ? `${w.slice(0, best)}­${w.slice(best)}` : w;
  });
}

let fitTimer;
window.addEventListener('resize', () => {
  clearTimeout(fitTimer);
  fitTimer = setTimeout(() => S.view === 'card' && fitCells(), 120);
});

function paintCell(pos, on, animate) {
  const b = $app.querySelector(`.cell[data-pos="${pos}"]`);
  if (!b) return;
  b.classList.toggle('hit', on);
  b.setAttribute('aria-pressed', String(on));
  b.classList.remove('slap');
  if (on && animate && !reduceMotion()) {
    void b.offsetWidth;
    b.classList.add('slap');
  }
}

function paintMask(mask) {
  for (let pos = 0; pos < 25; pos += 1) {
    if (pos === FREE) continue;
    const b = $app.querySelector(`.cell[data-pos="${pos}"]`);
    if (b && b.classList.contains('hit') !== isMarked(mask, pos)) paintCell(pos, isMarked(mask, pos), false);
  }
}

function stripContent() {
  const d = S.data;
  const me = d.me;
  const sum = d.summary;
  const others = sum.players.filter((p) => p.nick !== me.nick);
  const winners = sum.players.filter((p) => p.place).sort((a, b) => a.place - b.place);
  if (me.place) return { text: `You got ${ordinal(me.place)}!`, sub: 'See the leaderboard', cls: 'done' };
  if (!others.length) return { text: `Send ${d.room.code} to your class`, sub: "You're the only one here so far" };
  if (winners.length) {
    const next = ordinal(winners.length + 1);
    return {
      text: `${winners[0].nick} got BINGO!`,
      sub: `You need ${me.need} more for ${next}`,
      cls: me.need === 1 ? 'hot' : '',
    };
  }
  const best = Math.min(...others.map((p) => p.need));
  const leaders = others.filter((p) => p.need === best);
  const name = leaders.length > 1 ? `${leaders[0].nick} +${leaders.length - 1}` : leaders[0].nick;
  const verb = leaders.length > 1 ? 'need' : 'needs';
  return {
    text: `${name} ${verb} ${best} more`,
    sub: me.need <= best ? `You need ${me.need} too` : '',
    cls: best === 1 || me.need === 1 ? 'hot' : '',
  };
}

const stripDashes = (flip) =>
  `<svg class="dz" viewBox="0 0 16 22" aria-hidden="true" fill="none" ${flip ? 'style="transform:scaleX(-1)"' : ''}>${dash(COLORS.green, 4, 3, 12, 7, 3.4)}${dash(COLORS.cobalt, 3, 11, 12, 11, 3.4)}${dash(COLORS.green, 4, 19, 12, 15, 3.4)}</svg>`;

function updateRoomBits() {
  const d = S.data;
  const strip = $app.querySelector('.strip');
  if (strip) {
    const s = stripContent();
    strip.className = `strip ${s.cls || ''}`;
    strip.innerHTML = `${stripDashes(false)}${smiley()}<span>${esc(s.text)}${s.sub ? `<small>${esc(s.sub)}</small>` : ''}</span>${stripDashes(true)}`;
  }
  const count = $app.querySelector('.rl-count');
  if (count) count.textContent = d.summary.count === 1 ? 'just you' : `${d.summary.count} playing`;
  const foot = $app.querySelector('.card-foot');
  if (foot) {
    const fresh = d.me.mask === 1 << FREE && !d.me.place;
    foot.textContent = fresh ? 'Tap a square when your prof says it. Five in a row, column or diagonal wins.' : '';
  }
}

function onAction(e) {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'home') go('#/');
  else if (act === 'menu') menuSheet();
  else if (act === 'invite') invite();
  else if (act === 'strip') {
    if (S.data.me.place) {
      S.showCard = false;
      render();
    } else if (S.data.summary.count <= 1) invite();
    else menuSheet();
  } else if (act === 'next') nextLecture(e.target.closest('button'));
  else if (act === 'share') shareMine(e.target.closest('button'));
  else if (act === 'card') {
    S.showCard = true;
    render();
  }
}

// Tap = optimistic sticker, then the server's answer is the truth.
function tap(pos) {
  const d = S.data;
  if (!d) return;
  if (d.me.place) {
    toast('Your card is finished. Wait for the next lecture!');
    return;
  }
  const on = !isMarked(d.me.mask, pos);
  d.me.mask = toggle(d.me.mask, pos, on);
  paintCell(pos, on, true);
  buzz(on ? 14 : 6);
  const local = needOf(d.me.mask);
  if (local.need === 0) {
    LINES[local.line].forEach((p, i) => {
      const c = $app.querySelector(`.cell[data-pos="${p}"]`) || (p === FREE ? $app.querySelector('.cell.free') : null);
      c?.style.setProperty('--i', i);
      c?.classList.add('on-line');
    });
  }
  const n = d.round.n;
  const code = S.code;
  S.inflight += 1;
  S.queue = S.queue
    .then(() => api.mark(TOKEN, code, n, pos, on))
    .then((st) => {
      S.inflight -= 1;
      if (S.code !== code) return;
      if (S.inflight === 0 || st.me.place) applyState(st);
    })
    .catch((err) => {
      S.inflight -= 1;
      if (S.code !== code) return;
      if (err.code === 'round_over') {
        toast(messageFor(err));
        refresh();
        return;
      }
      d.me.mask = toggle(d.me.mask, pos, !on);
      paintCell(pos, !on, false);
      $app.querySelectorAll('.on-line').forEach((c) => c.classList.remove('on-line'));
      toast(messageFor(err));
    });
}

async function refresh() {
  if (!S.code) return;
  try {
    applyState(await api.state(TOKEN, S.code));
  } catch (ex) {
    if (ex.code === 'room_not_found' || ex.code === 'not_in_room') go('#/');
  }
}

function applyState(st) {
  const prev = S.data;
  S.data = st;
  if (S.view === 'editor') return;
  if (!prev || prev.round.n !== st.round.n) {
    S.showCard = false;
    if (prev && !S.dealtByMe) toast('New lecture! Fresh cards for everyone.');
    S.dealtByMe = false;
    return render();
  }
  if (st.me.place && !prev.me.place) return celebrate();
  if (S.view === 'card') {
    if (!S.inflight) paintMask(st.me.mask);
    if (!S.inflight && needOf(st.me.mask).need > 0) $app.querySelectorAll('.on-line').forEach((c) => c.classList.remove('on-line'));
    updateRoomBits();
  } else if (S.view === 'win') {
    updateBoard();
  }
}

function celebrate() {
  buzz([30, 40, 70]);
  const line = LINES[S.data.me.line] || [];
  line.forEach((p, i) => {
    const c = p === FREE ? $app.querySelector('.cell.free') : $app.querySelector(`.cell[data-pos="${p}"]`);
    c?.style.setProperty('--i', i);
    c?.classList.add('on-line');
  });
  S.showCard = false;
  setTimeout(() => S.data?.me.place && S.view === 'card' && renderWin(), reduceMotion() ? 200 : 950);
}

function onSummary(p) {
  const d = S.data;
  if (!d) return;
  if (p.n !== d.round.n) {
    if (p.n > d.round.n) refresh();
    return;
  }
  const before = new Set(d.summary.players.filter((x) => x.place).map((x) => x.nick));
  d.summary = { n: p.n, count: p.count, winners: p.winners, clock: p.clock, players: p.players };
  paintLive();
  if (p.kind === 'bingo' && p.who && p.who !== myName() && !before.has(p.who)) {
    const w = p.players.find((x) => x.nick === p.who);
    const nextPlace = ordinal((p.winners || 1) + 1);
    banner(
      `${p.who} got BINGO!`,
      d.me.place
        ? `${ordinal(w?.place || p.winners)} place in ${minsShort(w?.secs ?? 0)}`
        : `${w?.place === 1 ? 'Won' : `${ordinal(w?.place || p.winners)} place`} in ${minsShort(w?.secs ?? 0)}. Keep going for ${nextPlace}!`,
      () => leaderboardSheet()
    );
    buzz(40);
  }
  if (S.view === 'card') updateRoomBits();
  else if (S.view === 'win') updateBoard(before);
}

// ---------------------------------------------------------------------------
// Win
// ---------------------------------------------------------------------------

function boardRows() {
  const d = S.data;
  const me = d.me.nick;
  const players = d.summary.players;
  const winners = players.filter((p) => p.place).sort((a, b) => a.place - b.place);
  let rows = winners.slice(0, 3);
  const mine = winners.find((p) => p.nick === me);
  if (mine && !rows.includes(mine)) rows = [...winners.slice(0, 2), mine];
  const rest = players.filter((p) => !p.place).sort((a, b) => a.need - b.need);
  while (rows.length < 3 && rest.length) rows.push(rest.shift());
  return rows;
}

function boardHtml(fresh = new Set()) {
  const me = S.data.me.nick;
  const rows = boardRows();
  const shown = rows.length;
  const total = S.data.summary.count;
  return `<ol class="board" aria-label="Leaderboard">${rows
    .map((p) => {
      const isMe = p.nick === me;
      const rank = p.place
        ? `<span class="rank r${Math.min(p.place, 4)}">${p.place}</span>`
        : `<span class="rank r-none" aria-hidden="true">·</span>`;
      const t = p.place ? `<span class="t">${minsShort(p.secs ?? 0)}</span>` : `<span class="t waiting">needs ${p.need}</span>`;
      return `<li class="${isMe ? 'me' : ''}${fresh.has(p.nick) ? ' arrive' : ''}">${rank}<span class="who">${isMe ? 'You' : esc(p.nick)}</span>${t}</li>`;
    })
    .join('')}</ol>${total > shown ? `<p class="board-more">+ ${total - shown} more in ${esc(S.data.room.code)}</p>` : ''}`;
}

function renderWin() {
  S.view = 'win';
  const d = S.data;
  document.title = `BINGO! · ${d.room.code} · Lecture Bingo`;
  const headline = d.me.place === 1 ? 'You won in' : `${ordinal(d.me.place)} place in`;
  $app.innerHTML = `
  <section class="screen win${reduceMotion() ? '' : ' enter'}">
    <button class="iconbtn" type="button" data-act="card" aria-label="See my card" style="position:absolute;left:8px;top:max(10px,env(safe-area-inset-top));z-index:3">${icons.back()}</button>
    <div class="win-art">
      ${burst()}
      <svg class="dashes" viewBox="0 0 400 330" aria-hidden="true" fill="none">
        ${dash(COLORS.green, 96, 30, 112, 52, 7)}${dash(COLORS.cobalt, 290, 22, 280, 46, 7)}${dash(COLORS.tomato, 360, 70, 344, 92, 7)}
        ${dash(COLORS.cobalt, 18, 96, 46, 116, 7)}${dash(COLORS.tomato, 356, 248, 380, 270, 7)}${dash(COLORS.green, 300, 300, 314, 318, 7)}
        ${dash(COLORS.cobalt, 46, 300, 32, 322, 7)}
      </svg>
      ${smiley(COLORS.sun, 'smile')}
      <p class="bingo-word" aria-hidden="true">BINGO!</p>
    </div>
    <h1 class="sr-only">BINGO! ${esc(headline)} ${minsLong(d.me.secs ?? 0)}</h1>
    <h2 aria-hidden="true">${esc(headline)}<span>${minsLong(d.me.secs ?? 0)}</span></h2>
    <div class="board-wrap">${boardHtml()}</div>
    <div class="actions">
      <button class="btn red" type="button" data-act="next">Next lecture</button>
      <button class="btn ghost" type="button" data-act="share">${icons.share()}Share</button>
    </div>
    ${deco('', 'left:12px;bottom:18px;width:50px;transform:rotate(-12deg)', star(COLORS.sun))}
    ${deco('', 'left:30px;bottom:76px;width:22px;height:22px', dashSvg(dash(COLORS.green, 4, 18, 18, 6, 4.5), '0 0 22 22'))}
    ${deco('', 'left:62px;bottom:16px;width:22px;height:22px', dashSvg(dash(COLORS.cobalt, 4, 18, 16, 6, 4.5), '0 0 22 22'))}
    ${deco('', 'right:12px;bottom:16px;width:56px', smiley(COLORS.green))}
    ${deco('', 'right:30px;bottom:80px;width:22px;height:22px', dashSvg(dash(COLORS.cobalt, 8, 2, 14, 20, 4.5), '0 0 22 22'))}
  </section>`;
  $app.querySelector('.screen').addEventListener('click', onAction);
}

function updateBoard(beforeWinners) {
  const wrap = $app.querySelector('.board-wrap');
  if (!wrap) return;
  const fresh = new Set(
    S.data.summary.players.filter((p) => p.place && beforeWinners && !beforeWinners.has(p.nick)).map((p) => p.nick)
  );
  wrap.innerHTML = boardHtml(fresh);
}

async function nextLecture(btn) {
  btn.disabled = true;
  try {
    S.dealtByMe = true;
    const st = await api.nextRound(TOKEN, S.code, S.data.round.n);
    applyState(st);
    toast('Fresh card. Good luck!');
  } catch (ex) {
    S.dealtByMe = false;
    toast(messageFor(ex));
    btn.disabled = false;
  }
}

async function shareMine(btn) {
  btn.disabled = true;
  try {
    const r = await shareResult(S.data, roomUrl(S.data.room.code));
    if (r.mode === 'sheet') {
      openSheet(
        `<div class="sheet-head"><div><h2>Your result card</h2><p class="sub">Press and hold the picture to save it, or download it.</p></div>${closeBtn}</div>
         <img class="share-img" src="${r.url}" alt="Lecture Bingo result card">
         <a class="btn red pill mid" href="${r.url}" download="lecture-bingo.png">${icons.download()}Download</a>`
      );
    }
  } catch {
    toast("Couldn't make the picture. Take a screenshot instead!");
  } finally {
    btn.disabled = false;
  }
}

// ---------------------------------------------------------------------------
// Sheets: menu, leaderboard, invite
// ---------------------------------------------------------------------------

function playersList() {
  const me = S.data.me.nick;
  return `<ul class="plist">${S.data.summary.players
    .map(
      (p) =>
        `<li class="${p.place ? 'won' : ''}"><span>${esc(p.nick)}${p.nick === me ? ' (you)' : ''}</span><span>${
          p.place ? `${ordinal(p.place)} · ${minsShort(p.secs ?? 0)}` : `needs ${p.need}`
        }</span></li>`
    )
    .join('')}</ul>`;
}

function leaderboardSheet() {
  if (!S.data) return;
  openSheet(`<div class="sheet-head"><div><h2>${esc(S.data.room.code)}</h2><p class="sub">Lecture ${S.data.round.n} · ${plural(S.data.summary.count, 'player', 'players')}</p></div>${closeBtn}</div>${playersList()}`);
}

async function invite() {
  const code = S.data.room.code;
  const url = roomUrl(code);
  const text = `Join my Lecture Bingo room ${code} and play along with the lecture:`;
  if (navigator.share) {
    try {
      await navigator.share({ title: 'Lecture Bingo', text, url });
      return;
    } catch (e) {
      if (e?.name === 'AbortError') return;
    }
  }
  try {
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast('Invite link copied. Paste it in your class group!');
  } catch {
    menuSheet();
  }
}

function menuSheet() {
  const d = S.data;
  const canDeal = d.room.is_creator || d.round.winners > 0;
  const closes = new Date(d.room.expires_at).toLocaleString('en-IN', { weekday: 'short', hour: 'numeric', minute: '2-digit' });
  openSheet(
    `<div class="sheet-head"><div><h2>Room</h2><p class="sub">Lecture ${d.round.n} · closes ${esc(closes)}</p></div>${closeBtn}</div>
     <div class="bigcode"><b>${esc(d.room.code)}</b><span class="bc-btns"><button class="btn" type="button" data-m="copy">${icons.copy()}Copy link</button>${
       navigator.share ? `<button class="btn" type="button" data-m="invite">${icons.share()}Invite</button>` : ''
     }</span></div>
     ${playersList()}
     <div class="menu">
       ${d.room.is_creator ? `<button type="button" data-m="edit">${icons.pencil()}<span>Edit the phrases<small>Saving deals everyone a new card</small></span></button>` : ''}
       ${canDeal ? `<button type="button" data-m="deal">${icons.shuffle()}<span>${d.round.winners > 0 ? 'Next lecture' : 'Deal new cards'}<small>A fresh shuffle for everyone in the room</small></span></button>` : ''}
       <button type="button" data-m="rename">${icons.user()}<span>Change my name<small>You're ${esc(d.me.nick)}</small></span></button>
       <button type="button" data-m="leave" class="danger">${icons.door()}<span>Leave room</span></button>
     </div>`,
    (root) => {
      root.querySelector('.menu').addEventListener('click', async (e) => {
        const m = e.target.closest('[data-m]')?.dataset.m;
        if (!m) return;
        if (m === 'edit') {
          $sheet.close();
          go(`#/r/${d.room.code}/edit`);
        } else if (m === 'deal') {
          $sheet.close();
          try {
            S.dealtByMe = true;
            applyState(await api.nextRound(TOKEN, S.code, d.round.n));
            toast('Fresh cards dealt to everyone.');
          } catch (ex) {
            S.dealtByMe = false;
            toast(messageFor(ex));
          }
        } else if (m === 'rename') {
          nicknameSheet({
            code: d.room.code,
            mode: 'rename',
            onDone: (st) => {
              applyState(st);
              toast(`You're ${st.me.nick} now.`);
            },
          });
        } else if (m === 'leave') {
          const b = e.target.closest('button');
          if (!b.dataset.sure) {
            b.dataset.sure = '1';
            b.querySelector('span').textContent = 'Tap again to leave (your card goes too)';
            return;
          }
          try {
            await api.leave(TOKEN, d.room.code);
          } catch {
            /* already gone */
          }
          $sheet.close();
          stopLive();
          S.code = null;
          S.data = null;
          go('#/');
          toast(`You left ${d.room.code}.`);
        }
      });
      root.querySelector('[data-m="invite"]')?.addEventListener('click', () => invite());
      root.querySelector('[data-m="copy"]').addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(roomUrl(d.room.code));
          toast('Link copied.');
        } catch {
          toast(roomUrl(d.room.code), 5000);
        }
      });
    }
  );
}

// ---------------------------------------------------------------------------
// Card editor: "Make a card for your prof"
// ---------------------------------------------------------------------------

async function editorScreen(code) {
  const editing = !!code;
  let phrases = [...DEFAULT_PHRASES];
  if (editing) {
    if (S.code !== code || !S.data) {
      try {
        S.data = await api.state(TOKEN, code);
        S.code = code;
      } catch {
        return go(`#/r/${code}`);
      }
    }
    if (!S.data.room.is_creator) {
      toast('Only the person who made this room can edit it.');
      return go(`#/r/${code}`);
    }
    phrases = [...S.data.room.phrases];
  } else {
    stopLive();
    try {
      const saved = JSON.parse(store.get('draft') || 'null');
      if (Array.isArray(saved) && saved.length) phrases = saved.filter((p) => typeof p === 'string').slice(0, 60);
    } catch {
      /* no draft */
    }
  }
  S.view = 'editor';
  document.title = editing ? `Edit ${code} · Lecture Bingo` : 'Make a card · Lecture Bingo';
  const chipColors = ['var(--sun)', 'var(--mint)', 'var(--paper)', 'var(--cobalt)', 'var(--tomato)'];

  $app.innerHTML = `
  <section class="screen editor">
    <header class="topbar">
      <button class="iconbtn" type="button" data-e="back" aria-label="Back">${icons.back()}</button>
      <h1>${editing ? 'Edit the card' : 'Make a card'}</h1>
      <span></span>
    </header>
    <form novalidate>
      ${
        editing
          ? `<div class="ed-sec"><p>Room <b>${esc(code)}</b>. Saving deals everyone in the room a new card with these lines.</p></div>`
          : `<div class="ed-sec">
              <label class="label" for="ecode">Room code</label>
              <input class="field code small" id="ecode" name="code" placeholder="e.g. DBMS-8AM" maxlength="20"
                autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" value="${esc(store.get('draftCode') || '')}">
              <p>Subject and time works well. Your class types this to join. It's yours for 24 hours.</p>
            </div>`
      }
      <div class="ed-sec">
        <h2>What does your prof always say?</h2>
        <p>Add their lines. Each lecture deals 24 of them to everyone, in a different order on every card.</p>
        <div class="addrow">
          <input class="field small" name="line" maxlength="32" placeholder="e.g. Any doubts?" autocomplete="off" enterkeyhint="done" aria-label="New line">
          <button class="btn" type="button" data-e="add">${icons.plus()}Add</button>
        </div>
        <div class="count"><span class="n"></span><button type="button" data-e="reset">Use the classic card</button></div>
        <ul class="chips" aria-label="Lines on the card"></ul>
      </div>
      <p class="form-error" role="alert"></p>
      <div class="ed-bar"><button class="btn red" type="submit">${editing ? 'Save and deal new cards' : 'Make the room'}</button></div>
    </form>
  </section>`;

  const form = $app.querySelector('form');
  const chips = $app.querySelector('.chips');
  const countEl = $app.querySelector('.count .n');
  const err = form.querySelector('.form-error');
  const line = form.line;

  const save = () => {
    if (!editing) {
      store.set('draft', JSON.stringify(phrases));
      if (form.code) store.set('draftCode', normalizeCode(form.code.value));
    }
  };
  const paint = (fresh = -1) => {
    chips.innerHTML = phrases
      .map(
        (p, i) =>
          `<li class="chip${i === fresh ? ' new' : ''}" style="--bg:${chipColors[i % chipColors.length]}"><span>${esc(p)}</span><button type="button" data-rm="${i}" aria-label="Remove ${esc(p)}">${icons.close()}</button></li>`
      )
      .join('');
    const n = phrases.length;
    countEl.innerHTML =
      n < 24
        ? `<b class="bad">${n}</b> lines · <span class="bad">add ${24 - n} more</span>`
        : `<b>${n}</b> lines · ${n > 24 ? `24 per card` : 'exactly one card'}${n >= 60 ? ' · max 60' : ''}`;
  };
  paint();

  const add = () => {
    const v = line.value.trim().replace(/\s+/g, ' ');
    if (!v) return line.focus();
    if (v.length > 32) return (err.textContent = 'Keep each line to 32 characters so it fits a square.');
    if (phrases.some((p) => p.toLowerCase() === v.toLowerCase())) return (err.textContent = "That one's already on the card.");
    if (phrases.length >= 60) return (err.textContent = '60 lines is the most a card can hold.');
    err.textContent = '';
    phrases.unshift(v);
    line.value = '';
    paint(0);
    save();
    line.focus();
  };
  line.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  });
  if (form.code)
    form.code.addEventListener('input', () => {
      form.code.value = form.code.value.toUpperCase().replace(/[^A-Z0-9 _./-]/g, '');
      save();
    });

  $app.querySelector('.screen').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-rm]');
    if (rm) {
      phrases.splice(Number(rm.dataset.rm), 1);
      paint();
      save();
      return;
    }
    const act = e.target.closest('[data-e]')?.dataset.e;
    if (act === 'add') add();
    else if (act === 'back') go(editing ? `#/r/${code}` : '#/');
    else if (act === 'reset') {
      phrases = [...DEFAULT_PHRASES];
      paint();
      save();
      toast('Back to the classic card.');
    }
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.textContent = '';
    if (phrases.length < 24) {
      err.textContent = `A card needs at least 24 lines. Add ${24 - phrases.length} more.`;
      return line.focus();
    }
    if (editing) {
      const btn = form.querySelector('[type="submit"]');
      btn.disabled = true;
      try {
        S.dealtByMe = true;
        const st = await api.setPhrases(TOKEN, code, phrases);
        S.data = st;
        go(`#/r/${code}`);
        toast('Saved. Everyone got a new card.');
      } catch (ex) {
        S.dealtByMe = false;
        err.textContent = messageFor(ex);
        btn.disabled = false;
      }
      return;
    }
    const c = normalizeCode(form.code.value);
    form.code.value = c;
    if (!validCode(c)) {
      err.textContent = 'Pick a room code: letters and numbers, like DBMS-8AM.';
      return form.code.focus();
    }
    try {
      const peek = await api.peek(c);
      if (peek.exists) {
        err.textContent = `${c} is already being played today. Pick another code, or join it from the home screen.`;
        return form.code.focus();
      }
    } catch {
      /* the create call will say */
    }
    nicknameSheet({
      code: c,
      mode: 'make',
      phrases,
      onDone: (st) => {
        try {
          localStorage.removeItem('lb.draft');
          localStorage.removeItem('lb.draftCode');
        } catch {
          /* fine */
        }
        S.data = st;
        S.code = c;
        go(`#/r/${c}`);
      },
    });
  });
}

route();
