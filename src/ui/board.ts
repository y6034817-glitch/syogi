// 盤面・駒台のビュー。描画とアニメーションを担当する（ルール判断は持たない）。

import type { Color, HandType, Move, PieceType } from '../game/types.ts';
import { DROP, GLYPH, HAND_TYPES, PIECE_LABEL, PROMOTE, isPromoted, toHandType } from '../game/types.ts';
import type { Position } from '../game/position.ts';
import { fullMotion, h, play, sleep } from './dom.ts';
import { sound } from '../audio/sound.ts';
import { settings } from '../state/settings.ts';
import * as fx from '../animation/effects.ts';

export interface BoardHandlers {
  onSquare(sq: number): void;
  onHand(color: Color, type: HandType): void;
}

export interface Highlights {
  selected: number | null;
  selectedHand: { color: Color; type: HandType } | null;
  targets: { sq: number; capture: boolean }[];
  lastMove: { from: number; to: number } | null;
  checkSq: number | null;
  /** 「動かす」モードで動かせる駒のマス */
  movable: number[];
  /** 「置く」モードで置けるマス（持ち駒のどれかが置ける場所） */
  droppable: number[];
  /** 「置く」モードで置ける持ち駒の種類（駒台の強調用） */
  droppableTypes: HandType[];
  /** 現在の操作モード（駒台の見た目に使う） */
  mode: 'move' | 'drop' | null;
}

export const NO_HIGHLIGHTS: Highlights = {
  selected: null,
  selectedHand: null,
  targets: [],
  lastMove: null,
  checkSq: null,
  movable: [],
  droppable: [],
  droppableTypes: [],
  mode: null,
};

const ZEN = ['１', '２', '３', '４', '５', '６', '７', '８', '９'];
const KANJI = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

export function glyphFor(t: PieceType, c: Color): string {
  return t === 'OU' && c === 'b' ? '玉' : GLYPH[t];
}

/** 駒の DOM を作る（盤上・駒台・成り選択で共通） */
export function createPiece(t: PieceType, c: Color, upright: boolean): HTMLElement {
  const el = h('div', 'piece');
  el.dataset.t = t;
  el.dataset.c = c;
  el.dataset.up = upright ? '1' : '0';
  el.dataset.p = isPromoted(t) ? '1' : '0';
  el.innerHTML = '<div class="lift"><div class="body"><span class="glyph"></span></div></div>';
  (el.querySelector('.glyph') as HTMLElement).textContent = glyphFor(t, c);
  return el;
}

interface Disp {
  x: number;
  y: number;
}

export class BoardView {
  readonly root: HTMLElement;
  readonly handEls: Record<Color, HTMLElement>;
  private boardEl: HTMLElement;
  private filesEl: HTMLElement;
  private ranksEl: HTMLElement;
  private hlLayer: HTMLElement;
  private pieceLayer: HTMLElement;
  private fxLayer: HTMLElement;
  private hoverEl: HTMLElement;
  private flipped = false;
  private pieceEls = new Map<number, HTMLElement>();
  private hoverable = new Set<number>();
  private handlers: BoardHandlers;

  constructor(handlers: BoardHandlers) {
    this.handlers = handlers;
    this.hlLayer = h('div', 'layer hl-layer');
    this.pieceLayer = h('div', 'layer pieces-layer');
    this.fxLayer = h('div', 'layer fx-layer');
    this.hoverEl = h('div', 'cell hover-cell');
    const grid = h('div', 'grid');
    grid.innerHTML = this.gridSvg();
    this.boardEl = h('div', 'board', [grid, this.pieceLayer, this.hlLayer, this.fxLayer, this.hoverEl]);
    this.filesEl = h('div', 'coords coords-files');
    this.ranksEl = h('div', 'coords coords-ranks');
    const frame = h('div', 'board-frame', [this.filesEl, this.ranksEl, this.boardEl]);
    this.root = h('div', 'board-wrap', [frame]);
    this.root.dataset.flipped = '0';
    this.handEls = { b: h('div', 'hand'), w: h('div', 'hand') };
    this.handEls.b.dataset.color = 'b';
    this.handEls.w.dataset.color = 'w';
    this.renderCoords();

    this.boardEl.addEventListener('click', (e) => {
      const sq = this.sqAt(e.clientX, e.clientY);
      if (sq !== null) this.handlers.onSquare(sq);
    });
    this.boardEl.addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      const sq = this.sqAt(e.clientX, e.clientY);
      if (sq !== null && this.hoverable.has(sq)) {
        const d = this.disp(sq);
        this.hoverEl.style.left = `${(d.x / 9) * 100}%`;
        this.hoverEl.style.top = `${(d.y / 9) * 100}%`;
        this.hoverEl.style.opacity = '1';
      } else this.hoverEl.style.opacity = '0';
    });
    this.boardEl.addEventListener('pointerleave', () => {
      this.hoverEl.style.opacity = '0';
    });
  }

  private gridSvg(): string {
    const lines: string[] = [];
    for (let i = 1; i < 9; i++) {
      lines.push(`<line x1="${i}" y1="0" x2="${i}" y2="9"/>`, `<line x1="0" y1="${i}" x2="9" y2="${i}"/>`);
    }
    const stars = [
      [3, 3],
      [6, 3],
      [3, 6],
      [6, 6],
    ]
      .map(([x, y]) => `<circle cx="${x}" cy="${y}" r="0.075"/>`)
      .join('');
    return `<svg viewBox="0 0 9 9" preserveAspectRatio="none" aria-hidden="true"><g class="inner">${lines.join('')}</g><rect class="outer" x="0" y="0" width="9" height="9"/><g class="stars">${stars}</g></svg>`;
  }

  // ---- 座標変換 ------------------------------------------------------------

  private disp(sq: number): Disp {
    const x = sq % 9;
    const y = (sq / 9) | 0;
    return this.flipped ? { x: 8 - x, y: 8 - y } : { x, y };
  }

  private upright(c: Color): boolean {
    return (c === 'b') !== this.flipped;
  }

  private sqAt(clientX: number, clientY: number): number | null {
    const r = this.boardEl.getBoundingClientRect();
    const fx = (clientX - r.left) / r.width;
    const fy = (clientY - r.top) / r.height;
    if (fx < 0 || fx >= 1 || fy < 0 || fy >= 1) return null;
    let x = Math.floor(fx * 9);
    let y = Math.floor(fy * 9);
    if (this.flipped) {
      x = 8 - x;
      y = 8 - y;
    }
    return y * 9 + x;
  }

  private place(el: HTMLElement, sq: number): void {
    const d = this.disp(sq);
    el.style.transform = `translate(${d.x * 100}%, ${d.y * 100}%)`;
  }

  private cellCenter(sq: number): { cx: number; cy: number; size: number } {
    const r = this.boardEl.getBoundingClientRect();
    const size = r.width / 9;
    const d = this.disp(sq);
    return { cx: r.left + (d.x + 0.5) * size, cy: r.top + (d.y + 0.5) * size, size };
  }

  // ---- 公開 API ------------------------------------------------------------

  isFlipped(): boolean {
    return this.flipped;
  }

  setFlipped(f: boolean): void {
    this.flipped = f;
    this.root.dataset.flipped = f ? '1' : '0';
    this.renderCoords();
  }

  setHoverable(squares: Set<number>): void {
    this.hoverable = squares;
  }

  setDim(on: boolean): void {
    this.root.classList.toggle('dim', on);
  }

  private renderCoords(): void {
    const files: string[] = [];
    const ranks: string[] = [];
    for (let i = 0; i < 9; i++) {
      files.push(ZEN[this.flipped ? i : 8 - i]);
      ranks.push(KANJI[this.flipped ? 8 - i : i]);
    }
    this.filesEl.replaceChildren(...files.map((t) => h('span', '', [t])));
    this.ranksEl.replaceChildren(...ranks.map((t) => h('span', '', [t])));
  }

  /** 局面を全描画する */
  render(pos: Position, hl: Highlights = NO_HIGHLIGHTS): void {
    this.pieceLayer.replaceChildren();
    this.pieceEls.clear();
    for (let sq = 0; sq < 81; sq++) {
      const p = pos.board[sq];
      if (!p) continue;
      const el = createPiece(p.t, p.c, this.upright(p.c));
      this.place(el, sq);
      if (hl.selected === sq) el.classList.add('selected');
      this.pieceLayer.append(el);
      this.pieceEls.set(sq, el);
    }
    this.renderHands(pos, hl);
    this.renderHighlights(hl);
  }

  private renderHands(pos: Position, hl: Highlights): void {
    for (const c of ['b', 'w'] as const) {
      const hand = this.handEls[c];
      hand.replaceChildren();
      for (const t of HAND_TYPES) {
        const n = pos.hands[c][t];
        const slot = h('button', 'hand-slot', [], {
          type: 'button',
          'aria-label': `${PIECE_LABEL[t]} ${n}枚`,
        });
        slot.dataset.type = t;
        slot.dataset.count = String(n);
        slot.append(createPiece(t, c, this.upright(c)));
        if (n > 1) slot.append(h('span', 'count', [String(n)]));
        if (hl.selectedHand && hl.selectedHand.color === c && hl.selectedHand.type === t) {
          slot.classList.add('selected');
        }
        if (hl.mode === 'drop' && n > 0 && hl.droppableTypes.includes(t)) slot.classList.add('can');
        if (hl.mode === 'move') slot.classList.add('muted');
        slot.addEventListener('click', () => this.handlers.onHand(c, t));
        hand.append(slot);
      }
    }
  }

  private renderHighlights(hl: Highlights): void {
    this.hlLayer.replaceChildren();
    const add = (cls: string, sq: number, delay?: number): HTMLElement => {
      const d = this.disp(sq);
      const el = h('div', `cell ${cls}`);
      // 位置は left/top で指定する（アニメーションが transform を使うため）
      el.style.left = `${(d.x / 9) * 100}%`;
      el.style.top = `${(d.y / 9) * 100}%`;
      if (delay !== undefined) el.style.setProperty('--d', `${delay}ms`);
      this.hlLayer.append(el);
      return el;
    };
    if (hl.lastMove) {
      if (hl.lastMove.from !== DROP) add('hl-last-from', hl.lastMove.from);
      add('hl-last-to', hl.lastMove.to);
    }
    if (hl.checkSq !== null) add('hl-check', hl.checkSq);
    if (hl.selected !== null) add('hl-selected', hl.selected);
    // 手番の操作に使えるマスは、ヒント設定に関係なく常に示す（操作の入口になるため）
    if (hl.mode === 'move' && hl.selected === null) {
      const origin = { x: 4, y: 4 };
      for (const sq of hl.movable) {
        const d = this.disp(sq);
        add('hl-movable', sq, Math.min(360, Math.hypot(d.x - origin.x, d.y - origin.y) * 30));
      }
    }
    if (hl.mode === 'drop' && hl.selectedHand === null) {
      const origin = { x: 4, y: 4 };
      for (const sq of hl.droppable) {
        const d = this.disp(sq);
        add('hl-droppable', sq, Math.min(360, Math.hypot(d.x - origin.x, d.y - origin.y) * 30)).append(h('i'));
      }
    }
    if (settings.value.hints || hl.selected !== null || hl.selectedHand !== null) {
      const origin = hl.selected !== null ? this.disp(hl.selected) : { x: 4, y: 4 };
      for (const t of hl.targets) {
        const d = this.disp(t.sq);
        const delay = Math.min(320, Math.hypot(d.x - origin.x, d.y - origin.y) * 26);
        add(t.capture ? 'hl-target capture' : 'hl-target', t.sq, delay).append(h('i'));
      }
    }
  }

  /** 動かせない駒を選んだときの「ぷるっ」 */
  wiggle(sq: number): void {
    const el = this.pieceEls.get(sq);
    if (!el) return;
    const lift = el.querySelector('.lift');
    if (!lift) return;
    void play(
      lift,
      [
        { transform: 'translateX(0)' },
        { transform: 'translateX(-7%) rotate(-3deg)' },
        { transform: 'translateX(6%) rotate(3deg)' },
        { transform: 'translateX(-3%)' },
        { transform: 'translateX(0)' },
      ],
      { duration: 280, easing: 'ease-out' },
    );
  }

  /** 成る/成らないの選択。null はキャンセル */
  choosePromotion(sq: number, t: PieceType, c: Color): Promise<boolean | null> {
    return new Promise((resolve) => {
      const d = this.disp(sq);
      const layer = h('div', 'promo-layer');
      const card = h('div', 'promo-card');
      card.style.left = `${Math.min(80, Math.max(20, ((d.x + 0.5) / 9) * 100))}%`;
      card.style.top = `${Math.min(86, Math.max(14, ((d.y + 0.5) / 9) * 100))}%`;
      let done = false;
      const finish = (v: boolean | null): void => {
        if (done) return;
        done = true;
        void Promise.all([
          play(card, [{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(0.85)', opacity: 0 }], {
            duration: 140,
            fill: 'forwards',
          }),
          play(layer, [{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' }),
        ]).then(() => layer.remove());
        sound.play(v === null ? 'deselect' : 'click');
        resolve(v);
      };
      const mk = (promote: boolean): HTMLElement => {
        const type = promote ? (PROMOTE[t] as PieceType) : t;
        const btn = h('button', `promo-btn${promote ? ' yes' : ''}`, [], { type: 'button' });
        btn.append(createPiece(type, c, true), h('span', 'promo-label', [promote ? '成る' : '成らない']));
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          finish(promote);
        });
        return btn;
      };
      card.append(mk(true), mk(false));
      layer.append(card);
      layer.addEventListener('click', () => finish(null));
      this.boardEl.append(layer);
      void play(layer, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, fill: 'backwards' });
      void play(
        card,
        [
          { transform: 'translate(-50%,-50%) scale(0.6)', opacity: 0 },
          { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
        ],
        { duration: 260, easing: 'cubic-bezier(.2,1.3,.35,1)', fill: 'backwards' },
      );
    });
  }

  /** 置くマスに複数の持ち駒が置けるとき、どれを置くか選ぶ。null はキャンセル */
  chooseHandPiece(sq: number, types: HandType[], c: Color): Promise<HandType | null> {
    return new Promise((resolve) => {
      const d = this.disp(sq);
      const layer = h('div', 'promo-layer');
      const card = h('div', 'promo-card pick');
      card.style.left = `${Math.min(86, Math.max(14, ((d.x + 0.5) / 9) * 100))}%`;
      card.style.top = `${Math.min(86, Math.max(14, ((d.y + 0.5) / 9) * 100))}%`;
      let done = false;
      const finish = (v: HandType | null): void => {
        if (done) return;
        done = true;
        void Promise.all([
          play(card, [{ transform: 'translate(-50%,-50%) scale(1)', opacity: 1 }, { transform: 'translate(-50%,-50%) scale(0.85)', opacity: 0 }], {
            duration: 140,
            fill: 'forwards',
          }),
          play(layer, [{ opacity: 1 }, { opacity: 0 }], { duration: 140, fill: 'forwards' }),
        ]).then(() => layer.remove());
        sound.play(v === null ? 'deselect' : 'click');
        resolve(v);
      };
      for (const t of types) {
        const btn = h('button', 'promo-btn', [], { type: 'button', 'aria-label': PIECE_LABEL[t] });
        btn.append(createPiece(t, c, true), h('span', 'promo-label', [PIECE_LABEL[t]]));
        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          finish(t);
        });
        card.append(btn);
      }
      layer.append(card);
      layer.addEventListener('click', () => finish(null));
      this.boardEl.append(layer);
      void play(layer, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, fill: 'backwards' });
      void play(
        card,
        [
          { transform: 'translate(-50%,-50%) scale(0.6)', opacity: 0 },
          { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
        ],
        { duration: 260, easing: 'cubic-bezier(.2,1.3,.35,1)', fill: 'backwards' },
      );
    });
  }

  // ---- アニメーション ------------------------------------------------------

  /** 駒が盤の外から降ってきて並ぶ演出 */
  async animateSetup(pos: Position, hl: Highlights): Promise<void> {
    this.render(pos, hl);
    if (!fullMotion()) {
      await play(this.pieceLayer, [{ opacity: 0 }, { opacity: 1 }], { duration: 400 });
      return;
    }
    let total = 0;
    let i = 0;
    for (const [sq, el] of [...this.pieceEls.entries()].sort((a, b) => a[0] - b[0])) {
      const d = this.disp(sq);
      const fromAbove = d.y < 4.5;
      const row = fromAbove ? d.y : 8 - d.y;
      const delay = 120 + row * 85 + Math.abs(d.x - 4) * 16;
      const dur = 420;
      const base = `translate(${d.x * 100}%, ${d.y * 100}%)`;
      const startY = (d.y + (fromAbove ? -3.2 : 3.2)) * 100;
      void play(
        el,
        [
          { transform: `translate(${d.x * 100}%, ${startY}%) scale(1.7) rotate(${fromAbove ? -12 : 12}deg)`, opacity: 0 },
          { transform: `${base} scale(1.08) rotate(0deg)`, opacity: 1, offset: 0.62 },
          { transform: `${base} scale(0.93)`, opacity: 1, offset: 0.82 },
          { transform: `${base} scale(1)`, opacity: 1 },
        ],
        { duration: dur, delay, easing: 'cubic-bezier(.3,.7,.35,1)', fill: 'backwards' },
      );
      if (i++ % 3 === 0) setTimeout(() => sound.play('tick'), delay + dur * 0.62);
      total = Math.max(total, delay + dur);
    }
    await sleep(total);
  }

  /** 1手分の移動演出。終わったら after を描画して highlights を反映する */
  async animateMove(before: Position, after: Position, m: Move, finalHl: Highlights): Promise<void> {
    const color = before.turn;
    this.hlLayer.replaceChildren();
    this.hoverEl.style.opacity = '0';
    const dest = this.disp(m.to);
    let mover: HTMLElement | null = null;
    const T = (x: number, y: number): string => `translate(${x * 100}%, ${y * 100}%)`;
    const arc = (peak: number, from = 1): Keyframe[] => [
      { transform: `scale(${from})`, offset: 0 },
      { transform: `scale(${peak})`, offset: 0.45 },
      { transform: 'scale(1.08)', offset: 0.85 },
      { transform: 'scale(0.94)', offset: 0.93 },
      { transform: 'scale(1)', offset: 1 },
    ];

    if (m.from === DROP) {
      const handPiece = this.handEls[color].querySelector<HTMLElement>(`.hand-slot[data-type="${m.piece}"] .piece`);
      const start = handPiece?.getBoundingClientRect();
      this.renderHands(after, NO_HIGHLIGHTS);
      mover = createPiece(m.piece, color, this.upright(color));
      this.place(mover, m.to);
      mover.classList.add('flying', 'no-transition');
      this.pieceLayer.append(mover);
      const lift = mover.querySelector('.lift') as HTMLElement;
      if (start) {
        const c = this.cellCenter(m.to);
        const dx = start.left + start.width / 2 - c.cx;
        const dy = start.top + start.height / 2 - c.cy;
        const s0 = Math.max(0.4, start.width / c.size);
        const dur = 480;
        await Promise.all([
          play(
            mover,
            [{ transform: `${T(dest.x, dest.y)} translate(${dx}px, ${dy}px)` }, { transform: T(dest.x, dest.y) }],
            { duration: dur, easing: 'cubic-bezier(.35,0,.2,1)', fill: 'forwards' },
          ),
          play(lift, arc(1.22, s0), { duration: dur, easing: 'linear' }),
        ]);
      }
    } else {
      mover = this.pieceEls.get(m.from) ?? null;
      if (!mover) {
        this.render(after, finalHl);
        return;
      }
      mover.classList.remove('selected');
      mover.classList.add('flying', 'no-transition');
      const f = this.disp(m.from);
      const dist = Math.hypot(dest.x - f.x, dest.y - f.y);
      const dur = Math.min(560, 250 + dist * 42);
      const lift = mover.querySelector('.lift') as HTMLElement;
      await Promise.all([
        play(mover, [{ transform: T(f.x, f.y) }, { transform: T(dest.x, dest.y) }], {
          duration: dur,
          easing: 'cubic-bezier(.4,0,.2,1)',
          fill: 'forwards',
        }),
        play(lift, arc(m.piece === 'KE' ? 1.34 : 1.2), { duration: dur, easing: 'linear' }),
      ]);
    }

    // 着地
    mover.classList.remove('flying');
    sound.play(m.capture ? 'capture' : 'place');
    fx.ring(this.fxLayer, dest.x, dest.y, m.capture ? 'red' : 'normal');
    if (m.capture) {
      fx.sparks(this.fxLayer, dest.x, dest.y, 'red', 8);
      fx.shake(this.boardEl, true);
    }

    const tasks: Promise<void>[] = [];

    // 取られた駒は駒台へ飛んでいく
    const handType = m.capture ? toHandType(m.capture) : null;
    const capEl = m.capture ? this.pieceEls.get(m.to) : undefined;
    if (capEl && handType) {
      const slotPiece = this.handEls[color].querySelector<HTMLElement>(`.hand-slot[data-type="${handType}"] .piece`);
      const target = (slotPiece ?? this.handEls[color]).getBoundingClientRect();
      const cr = capEl.getBoundingClientRect();
      const dx = target.left + target.width / 2 - (cr.left + cr.width / 2);
      const dy = target.top + target.height / 2 - (cr.top + cr.height / 2);
      const s1 = Math.max(0.3, target.width / cr.width);
      const base = T(dest.x, dest.y);
      capEl.style.zIndex = '25';
      tasks.push(
        play(
          capEl,
          [
            { transform: `${base} scale(1) rotate(0deg)`, opacity: 1 },
            { transform: `${base} translate(${dx * 0.08}px, ${dy * 0.08 - 18}px) scale(1.3) rotate(110deg)`, opacity: 1, offset: 0.25 },
            { transform: `${base} translate(${dx}px, ${dy}px) scale(${s1}) rotate(360deg)`, opacity: 0.95 },
          ],
          { duration: 580, easing: 'cubic-bezier(.4,0,.25,1)', fill: 'forwards' },
        ),
      );
    }

    // 成りの演出（駒がくるりと裏返る）
    if (m.promote) {
      const newType = PROMOTE[m.piece] as PieceType;
      const lift = mover.querySelector('.lift') as HTMLElement;
      const el = mover;
      tasks.push(
        (async () => {
          await sleep(90);
          sound.play('promote');
          fx.ring(this.fxLayer, dest.x, dest.y, 'gold');
          fx.sparks(this.fxLayer, dest.x, dest.y, 'gold', 12);
          const persp = 'perspective(500px)';
          const a1 = lift.animate(
            [{ transform: `${persp} rotateY(0deg)` }, { transform: `${persp} rotateY(90deg)` }],
            { duration: fullMotion() ? 150 : 60, easing: 'ease-in', fill: 'forwards' },
          );
          try {
            await a1.finished;
          } catch {
            /* ignore */
          }
          el.dataset.t = newType;
          el.dataset.p = '1';
          (el.querySelector('.glyph') as HTMLElement).textContent = glyphFor(newType, color);
          const a2 = lift.animate(
            [{ transform: `${persp} rotateY(-90deg)` }, { transform: `${persp} rotateY(0deg)` }],
            { duration: fullMotion() ? 220 : 80, easing: 'cubic-bezier(.2,1.2,.4,1)' },
          );
          a1.cancel();
          try {
            await a2.finished;
          } catch {
            /* ignore */
          }
        })(),
      );
    }

    await Promise.all(tasks);
    this.render(after, finalHl);
    if (handType) this.popHand(color, handType);
  }

  /** 駒台のスロットをぽんと跳ねさせる */
  popHand(color: Color, type: HandType): void {
    const slot = this.handEls[color].querySelector(`.hand-slot[data-type="${type}"]`);
    if (!slot) return;
    sound.play('select');
    void play(slot, [{ transform: 'scale(1)' }, { transform: 'scale(1.22)' }, { transform: 'scale(1)' }], {
      duration: 340,
      easing: 'cubic-bezier(.2,1.4,.4,1)',
    });
  }

  /** 王手・詰みの演出 */
  async fxCheck(kingSq: number, label = '王手'): Promise<void> {
    const d = this.disp(kingSq);
    sound.play('check');
    fx.ring(this.fxLayer, d.x, d.y, 'red');
    fx.vignette(this.root, 'red');
    fx.shake(this.boardEl, true);
    await fx.banner(this.root, label, 'check');
  }

  async fxStart(): Promise<void> {
    await fx.banner(this.root, '対局開始', 'start', 380);
  }
}
