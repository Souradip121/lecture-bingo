// Live room updates without opening any table to the browser.
//
// 1. Realtime Broadcast: after every change that matters (a join, a player's
//    "cells needed" going down, a BINGO, a new round) the database itself sends
//    a small summary on the public topic lb:<room id> (see lb__notify in
//    schema.sql). The summary has nicknames and counts only, no tokens or cards.
// 2. Polling as a fallback: every few seconds without Realtime, every 25 s with
//    it, and straight away when the tab comes back to the front.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../../config.js';

export function watchRoom(topic, { onSummary, onPoll, onStatus = () => {} }) {
  let stopped = false;
  let joined = false;
  let ws = null;
  let heartbeat = null;
  let poll = null;
  let ref = 0;
  let joinRef = null;
  let retries = 0;

  const schedule = () => {
    clearTimeout(poll);
    if (stopped) return;
    const ms = document.hidden ? 60000 : joined ? 25000 : 5000;
    poll = setTimeout(async () => {
      if (!document.hidden) {
        try {
          await onPoll();
        } catch {
          /* offline or paused: try again next tick */
        }
      }
      schedule();
    }, ms);
  };

  const onVisible = () => {
    if (!document.hidden) onPoll().catch(() => {});
    schedule();
  };
  document.addEventListener('visibilitychange', onVisible);
  window.addEventListener('online', onVisible);

  const send = (t, event, payload, isJoin = false) => {
    if (!ws || ws.readyState !== 1) return;
    ref += 1;
    const r = String(ref);
    if (isJoin) joinRef = r;
    ws.send(JSON.stringify({ topic: t, event, payload, ref: r, join_ref: t === 'phoenix' ? null : joinRef }));
  };

  const connect = () => {
    if (stopped || typeof WebSocket === 'undefined') return;
    const channel = `realtime:${topic}`;
    try {
      ws = new WebSocket(
        `${SUPABASE_URL.replace(/^http/, 'ws')}/realtime/v1/websocket?apikey=${encodeURIComponent(SUPABASE_ANON_KEY)}&vsn=1.0.0`
      );
    } catch {
      return;
    }
    ws.onopen = () => {
      send(
        channel,
        'phx_join',
        {
          config: { broadcast: { self: false, ack: false }, presence: { key: '' }, postgres_changes: [], private: false },
          access_token: SUPABASE_ANON_KEY,
        },
        true
      );
      clearInterval(heartbeat);
      heartbeat = setInterval(() => send('phoenix', 'heartbeat', {}), 25000);
    };
    ws.onmessage = (ev) => {
      let msg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (msg.event === 'phx_reply' && msg.ref === joinRef) {
        const was = joined;
        joined = msg.payload?.status === 'ok';
        onStatus(joined);
        if (joined) {
          retries = 0;
          // Catch up on anything that happened while we were connecting.
          if (!was) onPoll().catch(() => {});
        }
        schedule();
      } else if (msg.event === 'broadcast' && msg.payload?.event === 'room' && msg.payload.payload) {
        onSummary(msg.payload.payload);
      } else if (msg.event === 'phx_error' || msg.event === 'phx_close') {
        joined = false;
        onStatus(false);
        schedule();
      }
    };
    ws.onclose = () => {
      joined = false;
      onStatus(false);
      clearInterval(heartbeat);
      schedule();
      if (!stopped && retries < 8) setTimeout(connect, Math.min(30000, 1000 * 2 ** retries++));
    };
    ws.onerror = () => ws?.close();
  };

  schedule();
  connect();

  return {
    get live() {
      return joined;
    },
    stop() {
      stopped = true;
      clearTimeout(poll);
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('online', onVisible);
      try {
        ws?.close();
      } catch {
        /* already closed */
      }
    },
  };
}
