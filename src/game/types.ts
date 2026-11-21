// 将棋の基本型と定数
// 座標系: 盤は 9x9。x = 0..8 が画面の左→右（= 9筋→1筋）、y = 0..8 が上→下（= 一段→九段）。
// マス番号 sq = y * 9 + x。先手(b)は y が減る方向（上）へ進む。

export type Color = 'b' | 'w';

export type BaseType = 'FU' | 'KY' | 'KE' | 'GI' | 'KI' | 'KA' | 'HI' | 'OU';
export type PromotedType = 'TO' | 'NY' | 'NK' | 'NG' | 'UM' | 'RY';
export type PieceType = BaseType | PromotedType;
/** 持ち駒にできる駒（玉は除く） */
export type HandType = 'FU' | 'KY' | 'KE' | 'GI' | 'KI' | 'KA' | 'HI';

export interface Piece {
  readonly t: PieceType;
  readonly c: Color;
}

export type Hands = Record<HandType, number>;

/** 駒打ちの from 値 */
export const DROP = -1;

export interface Move {
  /** 移動元のマス番号。駒打ちは DROP(-1) */
  from: number;
  to: number;
  /** 動かす駒（成る前）。駒打ちなら打つ駒の種類 */
  piece: PieceType;
  promote: boolean;
  /** 取った駒（盤上の状態のまま。成駒もありうる） */
  capture: PieceType | null;
}

export const HAND_TYPES: readonly HandType[] = ['HI', 'KA', 'KI', 'GI', 'KE', 'KY', 'FU'];

export const PROMOTE: Partial<Record<PieceType, PieceType>> = {
  FU: 'TO',
  KY: 'NY',
  KE: 'NK',
  GI: 'NG',
  KA: 'UM',
  HI: 'RY',
};

export const UNPROMOTE: Partial<Record<PieceType, BaseType>> = {
  TO: 'FU',
  NY: 'KY',
  NK: 'KE',
  NG: 'GI',
  UM: 'KA',
  RY: 'HI',
};

/** 取った駒を持ち駒にするときの種類（成駒は元に戻る） */
export function toHandType(t: PieceType): HandType | null {
  if (t === 'OU') return null;
  const base = UNPROMOTE[t] ?? t;
  return base as HandType;
}

export function other(c: Color): Color {
  return c === 'b' ? 'w' : 'b';
}

export function sqX(sq: number): number {
  return sq % 9;
}
export function sqY(sq: number): number {
  return (sq / 9) | 0;
}
export function sq(x: number, y: number): number {
  return y * 9 + x;
}

/** 駒の表示用文字（盤上の駒面） */
export const GLYPH: Record<PieceType, string> = {
  FU: '歩',
  KY: '香',
  KE: '桂',
  GI: '銀',
  KI: '金',
  KA: '角',
  HI: '飛',
  OU: '王',
  TO: 'と',
  NY: '杏',
  NK: '圭',
  NG: '全',
  UM: '馬',
  RY: '龍',
};

/** 棋譜表記用の駒名 */
export const NAME: Record<PieceType, string> = {
  FU: '歩',
  KY: '香',
  KE: '桂',
  GI: '銀',
  KI: '金',
  KA: '角',
  HI: '飛',
  OU: '玉',
  TO: 'と',
  NY: '成香',
  NK: '成桂',
  NG: '成銀',
  UM: '馬',
  RY: '龍',
};

export const PIECE_LABEL: Record<PieceType, string> = {
  FU: '歩兵',
  KY: '香車',
  KE: '桂馬',
  GI: '銀将',
  KI: '金将',
  KA: '角行',
  HI: '飛車',
  OU: '玉将',
  TO: 'と金',
  NY: '成香',
  NK: '成桂',
  NG: '成銀',
  UM: '竜馬',
  RY: '竜王',
};

export function isPromoted(t: PieceType): boolean {
  return t in UNPROMOTE;
}
