// Thin client for the lb_* Postgres functions (PostgREST RPC). No SDK needed.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../config.js';

export class ApiError extends Error {
  constructor(code, status, detail) {
    super(code);
    this.code = code;
    this.status = status;
    this.detail = detail;
  }
}

const MESSAGES = {
  room_not_found: "There's no room with that code right now. Check it with your class, or start it yourself.",
  bad_code: 'Room codes are letters and numbers, like DBMS-8AM (3 to 16 characters).',
  code_taken: 'Someone already made a room with that code today. Join it, or pick another code.',
  name_taken: 'Someone in this room already has that name. Add an initial?',
  name_required: 'Type a nickname first.',
  name_too_long: 'Keep it under 16 letters.',
  not_in_room: "You're not in this room yet.",
  room_full: 'This room is full (150 players).',
  round_over: 'New cards were just dealt. Here is yours.',
  round_in_progress: 'Nobody has won this lecture yet. Keep playing!',
  not_creator: 'Only the person who made this room can change its phrases.',
  need_24_phrases: 'A card needs at least 24 different lines.',
  too_many_phrases: 'Keep it to 60 lines or fewer.',
  phrase_too_long: 'Each line can be 32 characters at most.',
  bad_cell: "That cell isn't on your card.",
  bad_token: 'Your browser storage looks blocked. Try Chrome or Safari outside Instagram.',
  network: "Couldn't reach the server. Check your connection and try again.",
  paused: 'The server is waking up. Try again in a minute.',
};

export function messageFor(err) {
  if (err instanceof ApiError) return MESSAGES[err.code] || 'Something went wrong. Try again.';
  return MESSAGES.network;
}

export async function rpc(name, args = {}, { signal } = {}) {
  let res;
  try {
    res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
      signal,
    });
  } catch (e) {
    if (e?.name === 'AbortError') throw e;
    throw new ApiError('network', 0, String(e));
  }
  const text = await res.text();
  let body = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  if (!res.ok) {
    const code = typeof body?.message === 'string' && MESSAGES[body.message] ? body.message : res.status >= 500 ? 'paused' : 'unknown';
    throw new ApiError(code, res.status, body);
  }
  return body;
}

export const api = {
  peek: (code, opts) => rpc('lb_peek', { p_code: code || null }, opts),
  create: (token, code, nickname, phrases) =>
    rpc('lb_create_room', { p_token: token, p_code: code, p_nickname: nickname, p_phrases: phrases }),
  join: (token, code, nickname) => rpc('lb_join', { p_token: token, p_code: code, p_nickname: nickname }),
  state: (token, code, opts) => rpc('lb_state', { p_token: token, p_code: code }, opts),
  mark: (token, code, round, cell, on) =>
    rpc('lb_mark', { p_token: token, p_code: code, p_round: round, p_cell: cell, p_on: on }),
  nextRound: (token, code, from) => rpc('lb_next_round', { p_token: token, p_code: code, p_from: from }),
  setPhrases: (token, code, phrases) => rpc('lb_set_phrases', { p_token: token, p_code: code, p_phrases: phrases }),
  leave: (token, code) => rpc('lb_leave', { p_token: token, p_code: code }),
};
