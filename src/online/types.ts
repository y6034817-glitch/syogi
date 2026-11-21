// オンライン対戦の共通インターフェース。
// 今はブラウザ内デモ実装（demo.ts）が入っていて、Supabase 版（ステップ3）に差し替える。

import type { Color } from '../game/types.ts';
import type { ResultKind } from '../game/session.ts';

export type MatchMode = 'random' | 'word';

/** 時間設定（マッチング・確認・再接続猶予）。サーバー側の設定と揃える */
export const MATCH_TIMEOUT_MS = 60_000;
export const CONFIRM_TIMEOUT_MS = 10_000;
export const RECONNECT_GRACE_MS = 60_000;
/** 無信号とみなすまでの時間 */
export const PEER_LOST_MS = 15_000;

export interface RatingChange {
  before: number;
  after: number;
}

export type NetMsg =
  | { t: 'move'; usi: string }
  | { t: 'resign' }
  | { t: 'timeout' }
  /** サーバーが確定した結果（authoritative な対局で届く） */
  | { t: 'result'; kind: ResultKind; winner: Color | null; ratings?: Record<Color, RatingChange> }
  /** サーバーの持ち時間。受け取るたびに時計を合わせる */
  | { t: 'clock'; leftMain: Record<Color, number>; turn: Color; elapsedMs: number; byoMs: number }
  /** 手が受理されなかったときなど、サーバーの手順に合わせ直す */
  | { t: 'resync'; moves: string[] };

export interface PeerStatus {
  /** 相手から信号が届いているか */
  online: boolean;
  /** 切断中の場合、猶予の残りミリ秒 */
  remainingMs: number;
}

/** 成立した対局への接続 */
export interface NetGame {
  /** true: 結果と時間の判定はサーバーが行う（画面は result / clock を受け取って従う） */
  authoritative?: boolean;
  /** 途中参加（再接続）のとき、すでに指された手 */
  initialMoves?: string[];
  /** 自分の側 */
  side: Color;
  names: Record<Color, string>;
  opponentName: string;
  send(msg: NetMsg): void;
  onMessage(cb: (m: NetMsg) => void): () => void;
  /** 相手の接続状態が変わるたびに呼ばれる（切断中は毎秒） */
  onPeer(cb: (s: PeerStatus) => void): () => void;
  /** 猶予を過ぎても戻らなかったとき */
  onPeerGone(cb: () => void): () => void;
  close(): void;
}

export type MatchPhase =
  | { kind: 'idle' }
  | { kind: 'searching'; elapsedMs: number; mode: MatchMode; word?: string }
  | { kind: 'found'; opponentName: string; confirmMsLeft: number; youReady: boolean; opponentReady: boolean }
  | { kind: 'starting'; opponentName: string }
  | { kind: 'failed'; reason: 'timeout' | 'declined' | 'opponent-left' | 'error'; message: string };

export interface MatchHandle {
  cancel(): void;
  /** 「準備OK」を押す */
  ready(): void;
}

export interface MatchService {
  readonly label: string;
  start(
    opts: { mode: MatchMode; word?: string; name: string },
    onPhase: (p: MatchPhase) => void,
    onMatched: (game: NetGame) => void,
  ): MatchHandle;
}

/** ワードの正規化（全角半角・大文字小文字・前後空白の差を無視） */
export function normalizeWord(w: string): string {
  return w.normalize('NFKC').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function validateWord(w: string): string | null {
  const n = normalizeWord(w);
  if (!n) return 'ワードを入力してください';
  if (n.length < 2) return 'ワードは2文字以上にしてください';
  if (n.length > 20) return 'ワードは20文字以内にしてください';
  return null;
}
