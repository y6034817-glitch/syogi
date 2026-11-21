// 対局中の通信（Supabase 版 NetGame）。
// 1秒ごとに game_snapshot を呼ぶ。これが生存信号（ハートビート）も兼ねる。
// 結果・持ち時間・切断の判定はすべてサーバーが行い、ここは受け取って画面に伝えるだけ。

import type { Color } from '../game/types.ts';
import { other } from '../game/types.ts';
import type { ResultKind } from '../game/session.ts';
import { rpc, submitMove } from './api.ts';
import type { NetGame, NetMsg, PeerStatus, RatingChange } from './types.ts';
import { PEER_LOST_MS, RECONNECT_GRACE_MS } from './types.ts';

export interface GameSnapshot {
  id: string;
  status: 'confirming' | 'playing' | 'finished' | 'void';
  my_side: Color;
  names: Record<Color, string>;
  turn: Color;
  moves_count: number;
  moves: string[];
  main_ms: number;
  byo_ms: number;
  left_main: Record<Color, number>;
  elapsed_ms: number;
  opp_silent_ms: number;
  result: { kind: ResultKind; winner: Color | null } | null;
  ratings: Record<Color, RatingChange> | null;
}

const POLL_MS = 1000;

export async function openGame(gameId: string): Promise<NetGame> {
  const snap = await rpc<GameSnapshot>('game_snapshot', { p_game: gameId });
  return createNetGame(snap);
}

/** 進行中の対局があれば、そのIDを返す */
export async function findActiveGame(): Promise<string | null> {
  return rpc<string | null>('my_active_game');
}

function createNetGame(initial: GameSnapshot): NetGame {
  const id = initial.id;
  const side = initial.my_side;
  const msgCbs = new Set<(m: NetMsg) => void>();
  const peerCbs = new Set<(s: PeerStatus) => void>();
  let known = initial.moves.length; // 画面に反映済みの手数
  let pending = 0; // 送信中の自分の手
  let closed = false;
  let finished = false;
  let polling = false;
  let wasOnline = true;
  let timer = 0;

  const emit = (m: NetMsg): void => msgCbs.forEach((f) => f(m));

  function handle(s: GameSnapshot): void {
    if (closed) return;

    if (pending === 0) {
      if (s.moves.length > known) {
        for (const usi of s.moves.slice(known)) {
          known++;
          emit({ t: 'move', usi });
        }
      } else if (s.moves.length < known) {
        // 送った手が受理されていない
        known = s.moves.length;
        emit({ t: 'resync', moves: s.moves });
      }
    }

    if (s.status === 'playing') {
      emit({ t: 'clock', leftMain: s.left_main, turn: s.turn, elapsedMs: s.elapsed_ms, byoMs: s.byo_ms });
      const offline = s.opp_silent_ms >= PEER_LOST_MS;
      if (offline) {
        const remaining = Math.max(0, PEER_LOST_MS + RECONNECT_GRACE_MS - s.opp_silent_ms);
        peerCbs.forEach((f) => f({ online: false, remainingMs: remaining }));
        wasOnline = false;
      } else if (!wasOnline) {
        wasOnline = true;
        peerCbs.forEach((f) => f({ online: true, remainingMs: RECONNECT_GRACE_MS }));
      }
    }

    if (s.result && !finished) {
      finished = true;
      window.clearInterval(timer);
      emit({ t: 'result', kind: s.result.kind, winner: s.result.winner, ratings: s.ratings ?? undefined });
    }
  }

  async function poll(): Promise<void> {
    if (polling || closed || finished) return;
    polling = true;
    try {
      handle(await rpc<GameSnapshot>('game_snapshot', { p_game: id }));
    } catch {
      /* 一時的な通信エラーは無視（サーバー側が切断を判定する） */
    } finally {
      polling = false;
    }
  }

  async function resyncFromServer(): Promise<void> {
    try {
      const s = await rpc<GameSnapshot>('game_snapshot', { p_game: id });
      known = s.moves.length;
      emit({ t: 'resync', moves: s.moves });
      handle(s);
    } catch {
      /* 無視 */
    }
  }

  async function sendMove(usi: string): Promise<void> {
    const ply = ++known;
    pending++;
    try {
      const r = await submitMove(id, ply, usi);
      if (!r.ok) await resyncFromServer();
    } catch {
      await resyncFromServer();
    } finally {
      pending--;
    }
    void poll();
  }

  timer = window.setInterval(() => void poll(), POLL_MS);
  window.setTimeout(() => void poll(), 250);

  return {
    authoritative: true,
    initialMoves: initial.moves,
    side,
    names: initial.names,
    opponentName: initial.names[other(side)],
    send(msg) {
      if (closed) return;
      if (msg.t === 'move') void sendMove(msg.usi);
      else if (msg.t === 'resign') {
        void rpc<GameSnapshot>('resign_game', { p_game: id })
          .then(handle)
          .catch(() => void poll());
      } else if (msg.t === 'timeout') void poll();
    },
    onMessage(cb) {
      msgCbs.add(cb);
      return () => msgCbs.delete(cb);
    },
    onPeer(cb) {
      peerCbs.add(cb);
      return () => peerCbs.delete(cb);
    },
    onPeerGone() {
      // 切断負けはサーバーが確定し、result として届く
      return () => {};
    },
    close() {
      closed = true;
      window.clearInterval(timer);
    },
  };
}
