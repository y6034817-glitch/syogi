// マッチング（Supabase 版）。join_queue で参加し、2秒ごとに match_poll を呼ぶ。
// match_poll が生存信号（ハートビート）を兼ねる。サーバーが15秒無信号の待機者を掃除する。

import { ApiError, errorText, rpc } from './api.ts';
import { openGame } from './supabase-game.ts';
import type { MatchHandle, MatchMode, MatchPhase, MatchService } from './types.ts';

interface State {
  phase: 'none' | 'searching' | 'found' | 'playing' | 'failed';
  game_id?: string;
  elapsed_ms?: number;
  mode?: MatchMode;
  word?: string | null;
  opponent_name?: string;
  confirm_ms_left?: number;
  you_ready?: boolean;
  opponent_ready?: boolean;
  reason?: 'timeout' | 'declined';
  message?: string;
}

const POLL_MS = 2000;
const TICK_MS = 250;

export const supabaseMatchService: MatchService = {
  label: 'Supabase',

  start(opts, onPhase, onMatched): MatchHandle {
    let stopped = false;
    let handedOff = false;
    let last: State | null = null;
    let lastAt = 0;
    let pollTimer = 0;
    let tickTimer = 0;
    let inflight = false;

    const stop = (): void => {
      stopped = true;
      window.clearInterval(pollTimer);
      window.clearInterval(tickTimer);
    };

    // サーバーの値を、次の poll までの間は手元の時計で進める
    const render = (): void => {
      if (stopped || !last) return;
      const since = Date.now() - lastAt;
      if (last.phase === 'searching') {
        onPhase({ kind: 'searching', elapsedMs: (last.elapsed_ms ?? 0) + since, mode: opts.mode, word: opts.word });
      } else if (last.phase === 'found') {
        onPhase({
          kind: 'found',
          opponentName: last.opponent_name ?? '',
          confirmMsLeft: Math.max(0, (last.confirm_ms_left ?? 0) - since),
          youReady: !!last.you_ready,
          opponentReady: !!last.opponent_ready,
        });
      }
    };

    const fail = (reason: Extract<MatchPhase, { kind: 'failed' }>['reason'], message: string): void => {
      stop();
      onPhase({ kind: 'failed', reason, message });
    };

    const apply = (st: State): void => {
      if (stopped) return;
      last = st;
      lastAt = Date.now();
      switch (st.phase) {
        case 'searching':
        case 'found':
          render();
          break;
        case 'playing':
          void handoff(st.game_id as string);
          break;
        case 'failed':
          fail(st.reason ?? 'error', st.message ?? 'マッチングを終了しました');
          break;
        default:
          fail('error', '接続が切れたため、マッチングを終了しました');
      }
    };

    const handoff = async (gameId: string): Promise<void> => {
      if (handedOff) return;
      handedOff = true;
      stop();
      onPhase({ kind: 'starting', opponentName: '' });
      try {
        onMatched(await openGame(gameId));
      } catch (e) {
        onPhase({ kind: 'failed', reason: 'error', message: errorText(e) });
      }
    };

    const call = async (name: string, args: Record<string, unknown> = {}): Promise<void> => {
      try {
        apply(await rpc<State>(name, args));
      } catch (e) {
        if (stopped) return;
        // 一時的な通信エラーは次の poll で再試行。認証切れなどは終了する
        if (e instanceof ApiError) fail('error', e.message);
      }
    };

    void (async () => {
      try {
        apply(await rpc<State>('join_queue', { p_mode: opts.mode, p_word: opts.word ?? null }));
      } catch (e) {
        fail('error', errorText(e));
        return;
      }
      if (stopped) return;
      pollTimer = window.setInterval(() => {
        if (inflight) return;
        inflight = true;
        void call('match_poll').finally(() => {
          inflight = false;
        });
      }, POLL_MS);
      tickTimer = window.setInterval(render, TICK_MS);
    })();

    return {
      cancel(): void {
        if (stopped) return;
        stop();
        void rpc('cancel_match').catch(() => {});
        onPhase({ kind: 'idle' });
      },
      ready(): void {
        if (stopped || !last || last.phase !== 'found' || last.you_ready) return;
        last = { ...last, you_ready: true };
        render();
        void call('confirm_ready', { p_game: last.game_id });
      },
    };
  },
};
