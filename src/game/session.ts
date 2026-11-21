// 1局分の進行管理（手順・結果・千日手・待った）

import type { Color, Move } from './types.ts';
import { other } from './types.ts';
import { Position } from './position.ts';
import { applyMove, legalMoves } from './movegen.ts';
import { formatMove } from './notation.ts';

export type ResultKind = 'king_capture' | 'resign' | 'timeout' | 'repetition' | 'disconnect' | 'void';

export interface GameResult {
  kind: ResultKind;
  /** 勝者。引き分け（千日手）は null */
  winner: Color | null;
}

export class GameSession {
  readonly positions: Position[];
  readonly moves: Move[] = [];
  /** 各手の日本語表記（▲７六歩 など） */
  readonly labels: string[] = [];
  result: GameResult | null = null;
  private legalCache = new Map<number, Move[]>();

  constructor(initial: Position = Position.initial()) {
    this.positions = [initial];
  }

  get position(): Position {
    return this.positions[this.positions.length - 1];
  }
  get turn(): Color {
    return this.position.turn;
  }
  get lastMove(): Move | null {
    return this.moves.length ? this.moves[this.moves.length - 1] : null;
  }

  /** 現局面の合法手 */
  get legal(): Move[] {
    return this.legalAt(this.positions.length - 1);
  }

  legalAt(index: number): Move[] {
    let l = this.legalCache.get(index);
    if (!l) {
      l = legalMoves(this.positions[index]);
      this.legalCache.set(index, l);
    }
    return l;
  }

  findMove(from: number, to: number, promote: boolean): Move | null {
    return this.legal.find((m) => m.from === from && m.to === to && m.promote === promote) ?? null;
  }

  /** from→to で指せる手（成/不成の両方を含む） */
  movesFor(from: number, to: number): Move[] {
    return this.legal.filter((m) => m.from === from && m.to === to);
  }

  play(move: Move): GameResult | null {
    if (this.result) throw new Error('対局は終了しています');
    const legal = this.legal;
    const m = legal.find(
      (o) => o.from === move.from && o.to === move.to && o.piece === move.piece && o.promote === move.promote,
    );
    if (!m) throw new Error('不正な指し手です');

    const before = this.position;
    const label = formatMove(before, m, this.lastMove, legal);
    const after = applyMove(before, m);
    this.positions.push(after);
    this.moves.push(m);
    this.labels.push(label);

    // 王手・詰みの判定はない（実際の盤と同じ）。相手の王将を取ったら勝ち。
    if (m.capture === 'OU') {
      this.result = { kind: 'king_capture', winner: before.turn };
    } else {
      this.result = this.detectRepetition();
    }
    return this.result;
  }

  /** 同一局面4回（千日手・引き分け） */
  private detectRepetition(): GameResult | null {
    const n = this.positions.length - 1;
    const key = this.positions[n].key();
    const same: number[] = [];
    for (let i = 0; i <= n; i++) if (this.positions[i].key() === key) same.push(i);
    if (same.length < 4) return null;
    return { kind: 'repetition', winner: null };
  }

  /** サーバーが確定した結果を反映する（オンライン対戦） */
  setResult(r: GameResult): void {
    this.result = r;
  }

  resign(loser: Color): GameResult {
    this.result = { kind: 'resign', winner: other(loser) };
    return this.result;
  }

  timeout(loser: Color): GameResult {
    this.result = { kind: 'timeout', winner: other(loser) };
    return this.result;
  }

  /** 切断負け */
  disconnect(loser: Color): GameResult {
    this.result = { kind: 'disconnect', winner: other(loser) };
    return this.result;
  }

  /** 1手戻す（待った） */
  undo(): boolean {
    if (!this.moves.length) return false;
    this.positions.pop();
    this.moves.pop();
    this.labels.pop();
    this.legalCache.delete(this.positions.length);
    this.result = null;
    return true;
  }

  /** 棋譜テキスト（コピー用） */
  toText(names: { b: string; w: string }): string {
    const lines = [`先手：${names.b}`, `後手：${names.w}`, ''];
    this.labels.forEach((l, i) => lines.push(`${String(i + 1).padStart(3, ' ')} ${l}`));
    if (this.result) lines.push('', resultText(this.result, names));
    return lines.join('\n');
  }
}

export function resultText(r: GameResult, names: { b: string; w: string }): string {
  const w = r.winner ? names[r.winner] : '';
  switch (r.kind) {
    case 'king_capture':
      return `王将を取ったため${w}の勝ち`;
    case 'resign':
      return `投了により${w}の勝ち`;
    case 'timeout':
      return `時間切れにより${w}の勝ち`;
    case 'disconnect':
      return `相手の切断により${w}の勝ち`;
    case 'void':
      return '無効試合になりました（レーティングの変動はありません）';
    default:
      return '千日手により引き分け';
  }
}
