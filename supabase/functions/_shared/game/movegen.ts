// 指し手生成（王手・王将の安全性による移動制限は行わない）

import type { Color, Move, Piece, PieceType } from './types.ts';
import { DROP, HAND_TYPES, PROMOTE, other, toHandType } from './types.ts';
import { Position, piece } from './position.ts';

// 8方向（先手視点: dy=-1 が前進）
const DIR_X = [-1, 0, 1, -1, 1, -1, 0, 1];
const DIR_Y = [-1, -1, -1, 0, 0, 1, 1, 1];
// 上下反転した方向の添字
const FLIP = [5, 6, 7, 3, 4, 0, 1, 2];

function mask(...idx: number[]): boolean[] {
  const m = new Array<boolean>(8).fill(false);
  for (const i of idx) m[i] = true;
  return m;
}

const GOLD = mask(0, 1, 2, 3, 4, 6);
/** 1マス進める方向 */
export const STEP_DIRS: Record<PieceType, boolean[]> = {
  FU: mask(1),
  KY: mask(),
  KE: mask(),
  GI: mask(0, 1, 2, 5, 7),
  KI: GOLD,
  KA: mask(),
  HI: mask(),
  OU: mask(0, 1, 2, 3, 4, 5, 6, 7),
  TO: GOLD,
  NY: GOLD,
  NK: GOLD,
  NG: GOLD,
  UM: mask(1, 3, 4, 6),
  RY: mask(0, 2, 5, 7),
};
/** 何マスでも進める方向 */
export const SLIDE_DIRS: Record<PieceType, boolean[]> = {
  FU: mask(),
  KY: mask(1),
  KE: mask(),
  GI: mask(),
  KI: mask(),
  KA: mask(0, 2, 5, 7),
  HI: mask(1, 3, 4, 6),
  OU: mask(),
  TO: mask(),
  NY: mask(),
  NK: mask(),
  NG: mask(),
  UM: mask(0, 2, 5, 7),
  RY: mask(1, 3, 4, 6),
};
export { DIR_X, DIR_Y };

/** sq のマスに by 側の駒の利きがあるか（逆方向に走査） */
export function isAttacked(board: (Piece | null)[], sq: number, by: Color): boolean {
  const x = sq % 9;
  const y = (sq / 9) | 0;
  for (let i = 0; i < 8; i++) {
    const dx = DIR_X[i];
    const dy = DIR_Y[i];
    const ni = by === 'b' ? i : FLIP[i];
    let px = x - dx;
    let py = y - dy;
    let dist = 1;
    while (px >= 0 && px < 9 && py >= 0 && py < 9) {
      const p = board[py * 9 + px];
      if (p) {
        if (p.c === by && (SLIDE_DIRS[p.t][ni] || (dist === 1 && STEP_DIRS[p.t][ni]))) return true;
        break;
      }
      px -= dx;
      py -= dy;
      dist++;
    }
  }
  const ky = by === 'b' ? y + 2 : y - 2;
  if (ky >= 0 && ky < 9) {
    for (let k = -1; k <= 1; k += 2) {
      const kx = x + k;
      if (kx < 0 || kx > 8) continue;
      const p = board[ky * 9 + kx];
      if (p && p.c === by && p.t === 'KE') return true;
    }
  }
  return false;
}

export function findKing(board: (Piece | null)[], c: Color): number {
  for (let i = 0; i < 81; i++) {
    const p = board[i];
    if (p && p.c === c && p.t === 'OU') return i;
  }
  return -1;
}

export function isInCheck(pos: Position, c: Color = pos.turn): boolean {
  const k = findKing(pos.board, c);
  return k >= 0 && isAttacked(pos.board, k, other(c));
}

/** 盤上の駒 p が from から動ける先（自駒の上は除く）を列挙 */
function forEachTarget(board: (Piece | null)[], from: number, p: Piece, cb: (to: number) => void): void {
  const x = from % 9;
  const y = (from / 9) | 0;
  const step = STEP_DIRS[p.t];
  const slide = SLIDE_DIRS[p.t];
  for (let i = 0; i < 8; i++) {
    if (!step[i] && !slide[i]) continue;
    const dx = DIR_X[i];
    const dy = p.c === 'b' ? DIR_Y[i] : -DIR_Y[i];
    let nx = x + dx;
    let ny = y + dy;
    let first = true;
    while (nx >= 0 && nx < 9 && ny >= 0 && ny < 9) {
      const to = ny * 9 + nx;
      const t = board[to];
      if (t && t.c === p.c) break;
      if (first ? step[i] || slide[i] : slide[i]) cb(to);
      if (t) break;
      if (!slide[i]) break;
      first = false;
      nx += dx;
      ny += dy;
    }
  }
  if (p.t === 'KE') {
    const ny = y + (p.c === 'b' ? -2 : 2);
    if (ny >= 0 && ny < 9) {
      for (let k = -1; k <= 1; k += 2) {
        const nx = x + k;
        if (nx < 0 || nx > 8) continue;
        const t = board[ny * 9 + nx];
        if (!t || t.c !== p.c) cb(ny * 9 + nx);
      }
    }
  }
}

const NO_PROMO = [false];
const MUST_PROMO = [true];
const MAY_PROMO = [false, true];

function promotionOptions(t: PieceType, c: Color, from: number, to: number): boolean[] {
  if (!(t in PROMOTE)) return NO_PROMO;
  const fy = (from / 9) | 0;
  const ty = (to / 9) | 0;
  const inZone = (y: number) => (c === 'b' ? y <= 2 : y >= 6);
  if (!inZone(fy) && !inZone(ty)) return NO_PROMO;
  if ((t === 'FU' || t === 'KY') && (c === 'b' ? ty === 0 : ty === 8)) return MUST_PROMO;
  if (t === 'KE' && (c === 'b' ? ty <= 1 : ty >= 7)) return MUST_PROMO;
  return MAY_PROMO;
}

/** 合法手をすべて生成する */
export function legalMoves(pos: Position): Move[] {
  const me = pos.turn;
  const board = pos.board;
  const moves: Move[] = [];
  const pawnFile = new Array<boolean>(9).fill(false);

  for (let from = 0; from < 81; from++) {
    const p = board[from];
    if (!p || p.c !== me) continue;
    if (p.t === 'FU') pawnFile[from % 9] = true;
    forEachTarget(board, from, p, (to) => {
      const cap = board[to];
      for (const promote of promotionOptions(p.t, me, from, to)) {
        moves.push({ from, to, piece: p.t, promote, capture: cap ? cap.t : null });
      }
    });
  }

  for (const t of HAND_TYPES) {
    if (pos.hands[me][t] <= 0) continue;
    for (let to = 0; to < 81; to++) {
      if (board[to]) continue;
      const x = to % 9;
      const y = (to / 9) | 0;
      if ((t === 'FU' || t === 'KY') && (me === 'b' ? y === 0 : y === 8)) continue;
      if (t === 'KE' && (me === 'b' ? y <= 1 : y >= 7)) continue;
      if (t === 'FU' && pawnFile[x]) continue; // 二歩
      moves.push({ from: DROP, to, piece: t, promote: false, capture: null });
    }
  }
  return moves;
}

/** 指し手を適用した新しい局面を返す（合法性は検査しない） */
export function applyMove(pos: Position, m: Move): Position {
  const next = pos.clone();
  const me = pos.turn;
  if (m.from === DROP) {
    next.board[m.to] = piece(me, m.piece);
    next.hands[me][m.piece as keyof typeof next.hands.b]--;
  } else {
    const captured = pos.board[m.to];
    if (captured) {
      const h = toHandType(captured.t);
      if (h) next.hands[me][h]++;
    }
    next.board[m.from] = null;
    next.board[m.to] = piece(me, m.promote ? (PROMOTE[m.piece] as PieceType) : m.piece);
  }
  next.turn = other(me);
  return next;
}

export function perft(pos: Position, depth: number): number {
  if (depth === 0) return 1;
  const ms = legalMoves(pos);
  if (depth === 1) return ms.length;
  let n = 0;
  for (const m of ms) n += perft(applyMove(pos, m), depth - 1);
  return n;
}
