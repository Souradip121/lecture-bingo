// Hand-drawn sticker art and icons for Lecture Bingo, as inline SVG strings.
// One drawing grammar: flat fills, 3 px black ink outlines, round joins.
const INK = '#161616';

export const COLORS = {
  tomato: '#F24C36',
  sun: '#FCD72C',
  cobalt: '#4F9AFB',
  mint: '#87E2B1',
  green: '#35C17E',
  cream: '#FCF8EE',
  gold: '#FCD84A',
  silver: '#C9CBCB',
  bronze: '#DE8A45',
};

export const smiley = (fill = COLORS.sun, cls = '') =>
  `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><circle cx="24" cy="24" r="21.4" fill="${fill}" stroke="${INK}" stroke-width="3"/><ellipse cx="17.4" cy="19.4" rx="2.6" ry="3.6" fill="${INK}"/><ellipse cx="30.6" cy="19.4" rx="2.6" ry="3.6" fill="${INK}"/><path d="M15 28c2.4 4 5.4 6.1 9 6.1s6.6-2.1 9-6.1" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/></svg>`;

const STAR = 'M24 4.2 29.9 16.6 43.6 18.4 33.6 27.9 36.2 41.5 24 34.9 11.8 41.5 14.4 27.9 4.4 18.4 18.1 16.6Z';
export const star = (fill = COLORS.sun, cls = '') =>
  `<svg class="${cls}" viewBox="0 0 48 48" aria-hidden="true"><path d="${STAR}" fill="${fill}" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/></svg>`;

/** A sticker as it sits on the card: the drawing with its die-cut paper margin. */
export const sticker = (kind, fill = COLORS.sun) =>
  kind === 'star'
    ? `<svg viewBox="-4 -4 56 56" aria-hidden="true"><path d="${STAR}" fill="#FFFBEF" stroke="#FFFBEF" stroke-width="9" stroke-linejoin="round"/><path d="${STAR}" fill="${fill}" stroke="${INK}" stroke-width="3.2" stroke-linejoin="round"/></svg>`
    : `<svg viewBox="-4 -4 56 56" aria-hidden="true"><circle cx="24" cy="24" r="25.4" fill="#FFFBEF"/><circle cx="24" cy="24" r="21.4" fill="${fill}" stroke="${INK}" stroke-width="3"/><ellipse cx="17.4" cy="19.4" rx="2.6" ry="3.6" fill="${INK}"/><ellipse cx="30.6" cy="19.4" rx="2.6" ry="3.6" fill="${INK}"/><path d="M15 28c2.4 4 5.4 6.1 9 6.1s6.6-2.1 9-6.1" fill="none" stroke="${INK}" stroke-width="3.2" stroke-linecap="round"/></svg>`;

/** The FREE centre: a beaming smiley with little rays. */
export const beam = () =>
  `<svg class="beam" viewBox="0 0 64 48" aria-hidden="true"><g stroke="${COLORS.tomato}" stroke-width="3.2" stroke-linecap="round" opacity=".9"><path d="M6 15l5 3"/><path d="M4 26h6"/><path d="M6 37l5-3"/><path d="M58 15l-5 3"/><path d="M60 26h-6"/><path d="M58 37l-5-3"/></g><g transform="translate(13 3)"><circle cx="19" cy="21" r="18" fill="${COLORS.sun}" stroke="${INK}" stroke-width="3"/><ellipse cx="13.4" cy="17" rx="2.2" ry="3.1" fill="${INK}"/><ellipse cx="24.6" cy="17" rx="2.2" ry="3.1" fill="${INK}"/><path d="M11.4 24.4c2 3.4 4.6 5.1 7.6 5.1s5.6-1.7 7.6-5.1" fill="none" stroke="${INK}" stroke-width="2.9" stroke-linecap="round"/></g></svg>`;

/** Three stacked textbooks, the top one smiling. */
export const books = () =>
  `<svg class="books" viewBox="0 0 220 150" aria-hidden="true">
  <g stroke="${COLORS.green}" stroke-width="5" stroke-linecap="round">
    <path d="M34 22l11 12"/><path d="M14 64h17"/><path d="M24 104l13-9"/>
    <path d="M186 22l-11 12"/><path d="M206 64h-17"/><path d="M196 104l-13-9"/>
  </g>
  <g stroke="${INK}" stroke-width="4" stroke-linejoin="round" stroke-linecap="round">
    <path d="M52 112h104a10 10 0 0 1 10 10v12a10 10 0 0 1-10 10H52a10 10 0 0 1-10-10v-12a10 10 0 0 1 10-10z" fill="#1FB977"/>
    <path d="M118 117h40a5 5 0 0 1 5 5v12a5 5 0 0 1-5 5h-40z" fill="#FBF1D6"/>
    <path d="M124 124h32M124 131h32" stroke-width="2.4"/>
    <path d="M58 82h100a10 10 0 0 1 10 10v10a10 10 0 0 1-10 10H58a10 10 0 0 1-10-10V92a10 10 0 0 1 10-10z" fill="${COLORS.tomato}"/>
    <path d="M122 87h37a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5h-37z" fill="#FBF1D6"/>
    <path d="M128 94h29M128 100h29" stroke-width="2.4"/>
    <g transform="rotate(-5 110 64)">
      <path d="M62 46h86l14 12v18a8 8 0 0 1-8 8H62a8 8 0 0 1-8-8V54a8 8 0 0 1 8-8z" fill="${COLORS.cobalt}"/>
      <path d="M62 46h86l14 12H72z" fill="#9FC6FC"/>
      <path d="M126 60h34v17a5 5 0 0 1-5 5h-29z" fill="#FBF1D6"/>
      <path d="M132 67h24M132 73h24" stroke-width="2.4"/>
      <ellipse cx="88" cy="66" rx="2.3" ry="3.1" fill="${INK}" stroke="none"/>
      <ellipse cx="102" cy="66" rx="2.3" ry="3.1" fill="${INK}" stroke="none"/>
      <path d="M88 73c2.6 2.9 11.4 2.9 14 0" fill="none" stroke-width="3"/>
    </g>
  </g>
</svg>`;

/** Short confetti dashes around a title or sticker. */
export const dash = (color, x1, y1, x2, y2, w = 5) =>
  `<path d="M${x1} ${y1}L${x2} ${y2}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;

/** Three classmates (join screen). */
export const people = () =>
  `<svg class="people" viewBox="0 0 66 40" aria-hidden="true"><g stroke="${INK}" stroke-width="2.6" stroke-linejoin="round">
  <circle cx="13" cy="13" r="6.5" fill="${COLORS.green}"/><path d="M2 36c0-8 4.6-13 11-13s11 5 11 13z" fill="${COLORS.green}"/>
  <circle cx="53" cy="13" r="6.5" fill="${COLORS.cobalt}"/><path d="M42 36c0-8 4.6-13 11-13s11 5 11 13z" fill="${COLORS.cobalt}"/>
  <circle cx="33" cy="10" r="7.5" fill="${COLORS.sun}"/><path d="M20 37c0-9.5 5.5-15 13-15s13 5.5 13 15z" fill="${COLORS.sun}"/>
</g></svg>`;

/** Starburst behind BINGO!, generated once with a fixed wobble. */
export function burst() {
  const pts = [];
  const n = 26;
  const wob = [1, 0.86, 0.97, 0.9, 1, 0.84, 0.95, 0.88, 1, 0.92, 0.85, 0.98, 0.9];
  for (let i = 0; i < n; i += 1) {
    const a = (i / n) * Math.PI * 2 - Math.PI / 2;
    const outer = i % 2 === 0;
    const k = outer ? wob[(i / 2) % wob.length] : 0.72 + 0.05 * Math.sin(i * 1.7);
    pts.push(`${(200 + Math.cos(a) * 196 * k).toFixed(1)},${(150 + Math.sin(a) * 146 * k).toFixed(1)}`);
  }
  return `<svg class="burst" viewBox="0 0 400 300" aria-hidden="true"><polygon points="${pts.join(' ')}" fill="${COLORS.sun}" stroke="#FFE98A" stroke-width="6" stroke-linejoin="round"/></svg>`;
}

// Icons: one stroke grammar (2.75 px, round), solid where the comp is solid.
const icon = (body, cls = '', vb = '0 0 24 24') =>
  `<svg class="ic ${cls}" viewBox="${vb}" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.75" stroke-linecap="round" stroke-linejoin="round">${body}</svg>`;

export const icons = {
  back: () => icon('<path d="M15 4.5 7.5 12l7.5 7.5"/>'),
  close: () => icon('<path d="M6 6l12 12M18 6 6 18"/>'),
  arrow: () => icon('<path d="M4.5 12h14M13 6.5l5.5 5.5-5.5 5.5"/>'),
  pencil: () => icon('<path d="M15.6 4.4a2.3 2.3 0 0 1 3.3 3.3L8.4 18.2l-4.4 1.2 1.2-4.4z"/><path d="M13.8 6.2l3.3 3.3"/>'),
  plus: () => icon('<path d="M12 5v14M5 12h14"/>'),
  copy: () => icon('<rect x="8.5" y="8.5" width="11" height="11" rx="2.5"/><path d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>'),
  share: () =>
    `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><circle cx="18" cy="5" r="3.2"/><circle cx="6" cy="12" r="3.2"/><circle cx="18" cy="19" r="3.2"/></g><path d="M8.6 10.6 15.4 6.4M8.6 13.4l6.8 4.2" stroke="currentColor" stroke-width="2.4"/></svg>`,
  gear: () =>
    `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="M13.7 1.5h-3.4l-.6 2.9a8 8 0 0 0-2 1.2L4.9 4.6 3.2 7.5l2.2 2a8 8 0 0 0 0 2.3l-2.2 2 1.7 2.9 2.8-1a8 8 0 0 0 2 1.2l.6 3h3.4l.6-3a8 8 0 0 0 2-1.2l2.8 1 1.7-2.9-2.2-2a8 8 0 0 0 0-2.3l2.2-2-1.7-2.9-2.8 1a8 8 0 0 0-2-1.2zM12 15.6a3.6 3.6 0 1 0 0-7.2 3.6 3.6 0 0 0 0 7.2z"/></svg>`,
  door: () => icon('<path d="M14 4H6.5A1.5 1.5 0 0 0 5 5.5v13A1.5 1.5 0 0 0 6.5 20H14"/><path d="M10.5 12H20M16.5 8.5 20 12l-3.5 3.5"/>'),
  shuffle: () => icon('<path d="M3.5 7h3.2c2.2 0 3.4.9 4.6 2.8l1.4 2.4c1.2 1.9 2.4 2.8 4.6 2.8h3"/><path d="M3.5 17h3.2c1.4 0 2.4-.4 3.2-1.1M14 8.1c.8-.7 1.8-1.1 3.3-1.1h3"/><path d="m18 4.5 2.5 2.5L18 9.5M18 12.5l2.5 2.5-2.5 2.5"/>'),
  user: () => icon('<circle cx="12" cy="8.5" r="4"/><path d="M4.5 20c.8-4 3.7-6 7.5-6s6.7 2 7.5 6"/>'),
  download: () => icon('<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>'),
};
