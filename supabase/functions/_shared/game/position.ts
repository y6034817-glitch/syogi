import type { BaseType, Color, HandType, Hands, Piece, PieceType } from './types.ts';
import { HAND_TYPES, PROMOTE, UNPROMOTE } from './types.ts';

const cache = new Map<string, Piece>();

/** 駒オブジェクトはキャッシュして共有する（不変） */
export function piece(c: Color, t: PieceType): Piece {
  const key = c + t;
  let p = cache.get(key);
  if (!p) {
    p = Object.freeze({ c, t });
    cache.set(key, p);
  }
  return p;
}

export function emptyHands(): Hands {
  return { FU: 0, KY: 0, KE: 0, GI: 0, KI: 0, KA: 0, HI: 0 };
}

export class Position {
  board: (Piece | null)[];
  hands: { b: Hands; w: Hands };
  turn: Color;

  constructor() {
    this.board = new Array(81).fill(null);
    this.hands = { b: emptyHands(), w: emptyHands() };
    this.turn = 'b';
  }

  clone(): Position {
    const p = new Position();
    p.board = this.board.slice();
    p.hands = { b: { ...this.hands.b }, w: { ...this.hands.w } };
    p.turn = this.turn;
    return p;
  }

  /** 千日手判定などに使う局面キー（盤・持ち駒・手番） */
  key(): string {
    let s = '';
    for (let i = 0; i < 81; i++) {
      const p = this.board[i];
      s += p ? (p.c === 'b' ? p.t : p.t.toLowerCase()) : '.';
    }
    for (const c of ['b', 'w'] as const) {
      for (const t of HAND_TYPES) s += this.hands[c][t];
    }
    return s + this.turn;
  }

  static initial(): Position {
    return fromSfen('lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1');
  }
}

const LETTER_TO_BASE: Record<string, BaseType> = {
  p: 'FU',
  l: 'KY',
  n: 'KE',
  s: 'GI',
  g: 'KI',
  b: 'KA',
  r: 'HI',
  k: 'OU',
};
const BASE_TO_LETTER: Record<BaseType, string> = {
  FU: 'p',
  KY: 'l',
  KE: 'n',
  GI: 's',
  KI: 'g',
  KA: 'b',
  HI: 'r',
  OU: 'k',
};

/** SFEN 文字列から局面を作る（手数は無視） */
export function fromSfen(sfen: string): Position {
  const [boardPart, turnPart, handPart] = sfen.trim().split(/\s+/);
  const pos = new Position();
  boardPart.split('/').forEach((row, y) => {
    let x = 0;
    for (let i = 0; i < row.length; i++) {
      const ch = row[i];
      if (ch >= '1' && ch <= '9') {
        x += Number(ch);
        continue;
      }
      let promoted = false;
      let letter = ch;
      if (ch === '+') {
        promoted = true;
        letter = row[++i];
      }
      const lower = letter.toLowerCase();
      const base = LETTER_TO_BASE[lower];
      if (!base) throw new Error(`SFEN: 不明な駒 "${letter}"`);
      const color: Color = letter === lower ? 'w' : 'b';
      const t: PieceType = promoted ? (PROMOTE[base] as PieceType) : base;
      pos.board[y * 9 + x] = piece(color, t);
      x++;
    }
  });
  pos.turn = turnPart === 'w' ? 'w' : 'b';
  if (handPart && handPart !== '-') {
    let n = '';
    for (const ch of handPart) {
      if (ch >= '0' && ch <= '9') {
        n += ch;
        continue;
      }
      const lower = ch.toLowerCase();
      const base = LETTER_TO_BASE[lower];
      const color: Color = ch === lower ? 'w' : 'b';
      pos.hands[color][base as HandType] += n ? Number(n) : 1;
      n = '';
    }
  }
  return pos;
}

export function toSfen(pos: Position, moveNumber = 1): string {
  const rows: string[] = [];
  for (let y = 0; y < 9; y++) {
    let row = '';
    let empty = 0;
    for (let x = 0; x < 9; x++) {
      const p = pos.board[y * 9 + x];
      if (!p) {
        empty++;
        continue;
      }
      if (empty) {
        row += empty;
        empty = 0;
      }
      const base = (UNPROMOTE[p.t] ?? p.t) as BaseType;
      let s = BASE_TO_LETTER[base];
      if (p.c === 'b') s = s.toUpperCase();
      row += (p.t in UNPROMOTE ? '+' : '') + s;
    }
    if (empty) row += empty;
    rows.push(row);
  }
  let hand = '';
  for (const c of ['b', 'w'] as const) {
    for (const t of HAND_TYPES) {
      const n = pos.hands[c][t];
      if (!n) continue;
      const l = BASE_TO_LETTER[t];
      hand += (n > 1 ? n : '') + (c === 'b' ? l.toUpperCase() : l);
    }
  }
  return `${rows.join('/')} ${pos.turn} ${hand || '-'} ${moveNumber}`;
}
