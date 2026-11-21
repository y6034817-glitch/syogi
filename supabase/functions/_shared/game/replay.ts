// 棋譜（USI の手順）を再生して、次の1手を検証する。
// クライアントと Edge Function（サーバー）で同じルールエンジンを共有するための入口。

import type { Color } from './types.ts';
import { GameSession } from './session.ts';
import type { ResultKind } from './session.ts';
import { fromSfen } from './position.ts';
import { parseUsi } from './notation.ts';

export type ValidateResult =
  | { ok: true; result: { kind: ResultKind; winner: Color | null } | null }
  | { ok: false; reason: 'bad_history' | 'illegal' };

/**
 * @param history これまでの手（USI）。初期局面から順に再生する
 * @param usi 検証したい次の手（USI）
 * @param initialSfen 初期局面（省略すると平手）。テスト用
 */
export function validateMove(history: string[], usi: string, initialSfen?: string): ValidateResult {
  const session = new GameSession(initialSfen ? fromSfen(initialSfen) : undefined);
  for (const h of history) {
    const m = parseUsi(session.position, h, session.legal);
    if (!m) return { ok: false, reason: 'bad_history' };
    session.play(m);
    // 終局後に手が続いている履歴は不正
    if (session.result) return { ok: false, reason: 'bad_history' };
  }
  const move = parseUsi(session.position, usi, session.legal);
  if (!move) return { ok: false, reason: 'illegal' };
  const r = session.play(move);
  return { ok: true, result: r ? { kind: r.kind, winner: r.winner } : null };
}
