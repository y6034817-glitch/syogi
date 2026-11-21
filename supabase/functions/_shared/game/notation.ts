// 棋譜表記（日本語表記 ▲７六歩 / USI形式 7g7f）

import type { Color, HandType, Move, PieceType } from './types.ts';
import { DROP, NAME, PROMOTE } from './types.ts';
import type { Position } from './position.ts';
import { legalMoves } from './movegen.ts';

const ZEN = ['１', '２', '３', '４', '５', '６', '７', '８', '９'];
const KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 筋(1-9)を全角数字、段(1-9)を漢数字にする */
export function squareLabel(sq: number): string {
  const x = sq % 9;
  const y = (sq / 9) | 0;
  return ZEN[8 - x] + KANJI[y];
}

export function colorMark(c: Color): string {
  return c === 'b' ? '▲' : '△';
}

const FIXED_STRAIGHT: PieceType[] = ['GI', 'KI', 'TO', 'NY', 'NK', 'NG'];

/**
 * 日本語の棋譜表記を作る。
 * @param pos 指す前の局面
 * @param prev 直前の指し手（「同」判定用）
 */
export function formatMove(pos: Position, m: Move, prev: Move | null, legal?: Move[]): string {
  const me = pos.turn;
  const mark = colorMark(me);
  const target = prev && prev.to === m.to ? '同' : squareLabel(m.to);
  const name = NAME[m.piece];
  const moves = legal ?? legalMoves(pos);

  if (m.from === DROP) {
    const ambiguous = moves.some((o) => o.from !== DROP && o.to === m.to && o.piece === m.piece);
    return `${mark}${target}${name}${ambiguous ? '打' : ''}`;
  }

  const fromSqs = new Set<number>();
  for (const o of moves) {
    if (o.from !== DROP && o.to === m.to && o.piece === m.piece && o.from !== m.from) fromSqs.add(o.from);
  }

  let suffix = '';
  if (fromSqs.size > 0) suffix = disambiguate(me, m, [...fromSqs]);

  let promo = '';
  if (m.promote) promo = '成';
  else if (m.piece in PROMOTE) {
    const zone = (y: number) => (me === 'b' ? y <= 2 : y >= 6);
    if (zone((m.from / 9) | 0) || zone((m.to / 9) | 0)) promo = '不成';
  }
  return `${mark}${target}${name}${suffix}${promo}`;
}

function disambiguate(me: Color, m: Move, others: number[]): string {
  const sign = me === 'b' ? 1 : -1;
  const info = (from: number) => {
    const fx = from % 9;
    const fy = (from / 9) | 0;
    const tx = m.to % 9;
    const ty = (m.to / 9) | 0;
    const forward = (fy - ty) * sign; // 正: 前進 / 負: 後退 / 0: 横
    return {
      rx: fx * sign, // 大きいほど指し手から見て右
      straight: fx === tx && forward > 0 && FIXED_STRAIGHT.includes(m.piece),
      dir: forward > 0 ? '上' : forward < 0 ? '引' : '寄',
    };
  };
  const mine = info(m.from);
  const rest = others.map(info);
  const all = [mine, ...rest];
  const maxRx = Math.max(...all.map((a) => a.rx));
  const minRx = Math.min(...all.map((a) => a.rx));
  const labelsOf = (a: ReturnType<typeof info>, isMine: boolean): string[] => {
    const l: string[] = [];
    if (a.straight) l.push('直');
    if (a.dir === '寄') l.push('寄');
    if (a.dir === '引') l.push('引');
    const uniqueMax = a.rx === maxRx && all.filter((b) => b.rx === maxRx).length === 1;
    const uniqueMin = a.rx === minRx && all.filter((b) => b.rx === minRx).length === 1;
    if (uniqueMax) l.push('右');
    if (uniqueMin) l.push('左');
    if (a.dir === '上') l.push('上');
    void isMine;
    return l;
  };
  const myLabels = labelsOf(mine, true);
  const otherLabels = rest.map((a) => labelsOf(a, false));
  for (const l of myLabels) {
    if (!otherLabels.some((o) => o.includes(l))) return l;
  }
  // 単独の語で区別できない場合は「右上」などの組み合わせにする
  const side = mine.rx > (maxRx + minRx) / 2 ? '右' : mine.rx < (maxRx + minRx) / 2 ? '左' : '';
  return side + mine.dir;
}

// ---- USI 形式 -------------------------------------------------------------

const USI_DROP: Record<HandType, string> = { FU: 'P', KY: 'L', KE: 'N', GI: 'S', KI: 'G', KA: 'B', HI: 'R' };
const USI_DROP_REV: Record<string, HandType> = { P: 'FU', L: 'KY', N: 'KE', S: 'GI', G: 'KI', B: 'KA', R: 'HI' };

function usiSq(sq: number): string {
  const x = sq % 9;
  const y = (sq / 9) | 0;
  return `${9 - x}${String.fromCharCode(97 + y)}`;
}

export function moveToUsi(m: Move): string {
  if (m.from === DROP) return `${USI_DROP[m.piece as HandType]}*${usiSq(m.to)}`;
  return usiSq(m.from) + usiSq(m.to) + (m.promote ? '+' : '');
}

function parseUsiSq(s: string): number {
  return (s.charCodeAt(1) - 97) * 9 + (9 - Number(s[0]));
}

/** USI 文字列に一致する合法手を返す（なければ null） */
export function parseUsi(pos: Position, text: string, legal?: Move[]): Move | null {
  const moves = legal ?? legalMoves(pos);
  if (text[1] === '*') {
    const t = USI_DROP_REV[text[0]];
    const to = parseUsiSq(text.slice(2, 4));
    return moves.find((m) => m.from === DROP && m.piece === t && m.to === to) ?? null;
  }
  const from = parseUsiSq(text.slice(0, 2));
  const to = parseUsiSq(text.slice(2, 4));
  const promote = text[4] === '+';
  return moves.find((m) => m.from === from && m.to === to && m.promote === promote) ?? null;
}
