// 対局画面。ローカル2人対戦と、マッチング成立後のオンライン対戦の両方を扱う。
// 手番ごとに「動かす」「置く」を選んで操作する。

import type { Color, HandType, Move } from '../../game/types.ts';
import { DROP, other } from '../../game/types.ts';
import { GameSession, resultText } from '../../game/session.ts';
import type { GameResult } from '../../game/session.ts';
import { findKing } from '../../game/movegen.ts';
import { moveToUsi, parseUsi } from '../../game/notation.ts';
import { Clock } from '../../game/clock.ts';
import type { ClockSnapshot, TimePreset } from '../../game/clock.ts';
import { BoardView, NO_HIGHLIGHTS } from '../board.ts';
import type { Highlights } from '../board.ts';
import { h, iconButton, iconSvg, sleep } from '../dom.ts';
import { confirmDialog, openModal, toast } from '../dialogs.ts';
import { openSettings } from './settings.ts';
import { ParticleField } from '../../animation/particles.ts';
import * as fx from '../../animation/effects.ts';
import { sound } from '../../audio/sound.ts';
import { settings } from '../../state/settings.ts';
import type { NetGame, NetMsg } from '../../online/types.ts';
import type { Screen } from '../app.ts';
import { navigate } from '../app.ts';

export interface GameOptions {
  preset: TimePreset;
  /** 指定するとオンライン対戦になる */
  net?: NetGame;
}

type Mode = 'move' | 'drop';

interface Bar {
  root: HTMLElement;
  clock: HTMLElement;
  clockText: HTMLElement;
  name: HTMLElement;
}

export class GameScreen implements Screen {
  readonly root: HTMLElement;
  private session = new GameSession();
  private clock: Clock;
  private clockSnaps: ClockSnapshot[] = [];
  private view: BoardView;
  private bars!: Record<Color, Bar>;
  private movesEl = h('ol', 'moves');
  private statusEl = h('div', 'status');
  private netBanner = h('div', 'net-banner');
  private modeBar = h('div', 'mode-bar');
  private modeBtns!: Record<Mode, HTMLButtonElement>;
  private modeCounts!: Record<Mode, HTMLElement>;
  private particles: ParticleField;
  private overlayCanvas: HTMLCanvasElement;
  private btnUndo!: HTMLButtonElement;
  private btnResign!: HTMLButtonElement;
  private reviewBtns: HTMLButtonElement[] = [];
  private names: Record<Color, string>;
  private net: NetGame | undefined;
  private mySide: Color | null;
  private incoming: NetMsg[] = [];
  private netOffs: (() => void)[] = [];
  private resumed = false;

  /** 表示中の手数（session.moves.length と同じなら最新局面） */
  private cursor = 0;
  private mode: Mode = 'move';
  private selected: number | null = null;
  private selectedHand: HandType | null = null;
  private busy = true;
  private started = false;
  private disposed = false;
  private unsubSettings: () => void;
  private lowSecond = -1;
  /** 現在の局面の合法手を、操作用に集計したもの */
  private movableSqs = new Set<number>();
  private dropSqs = new Map<number, HandType[]>();

  constructor(private opts: GameOptions) {
    this.net = opts.net;
    this.mySide = opts.net ? opts.net.side : null;
    this.names = opts.net ? opts.net.names : { b: '先手', w: '後手' };
    this.clock = new Clock(opts.preset);
    this.clock.onTick = () => this.renderClocks();
    this.clock.onTimeout = (loser) => {
      if (this.net?.authoritative) {
        // 時間切れの確定はサーバーの仕事。確認を依頼して、結果が届くのを待つ
        this.net.send({ t: 'timeout' });
        return;
      }
      this.net?.send({ t: 'timeout' });
      void this.finish(this.session.timeout(loser));
    };

    // 途中参加（再接続）: すでに指された手を反映しておく
    for (const usi of opts.net?.initialMoves ?? []) {
      const m = parseUsi(this.session.position, usi, this.session.legal);
      if (!m) break;
      this.session.play(m);
    }
    this.cursor = this.session.moves.length;
    this.resumed = this.session.moves.length > 0;

    this.view = new BoardView({
      onSquare: (sq) => void this.onSquare(sq),
      onHand: (c, t) => this.onHand(c, t),
    });
    // オンラインでは自分の側が手前に来る
    if (this.mySide === 'w') this.view.setFlipped(true);
    this.overlayCanvas = h('canvas', 'particles-canvas');
    this.particles = new ParticleField(this.overlayCanvas);

    this.root = this.build();
    this.unsubSettings = settings.subscribe(() => this.refresh());
    window.addEventListener('keydown', this.onKey);
    this.bindNet();
  }

  // ---- 構築 ----------------------------------------------------------------

  /** 画面の手前（下）に出す側 */
  private get bottomColor(): Color {
    return this.view.isFlipped() ? 'w' : 'b';
  }

  private makeBar(c: Color): Bar {
    const mark = h('span', 'turn-mark', [c === 'b' ? '☗' : '☖']);
    const clockText = h('span', 'clock-text');
    const clock = h('div', 'clock', [clockText]);
    const name = h('strong', '', [this.names[c]]);
    const you = this.mySide === c ? h('em', 'you', ['あなた']) : null;
    const root = h('div', 'player-bar', [
      h('div', 'player-id', [mark, h('div', 'player-name', [name, h('small', '', [c === 'b' ? '▲先手' : '△後手']), you])]),
      this.view.handEls[c],
      clock,
    ]);
    root.dataset.color = c;
    return { root, clock, clockText, name };
  }

  private build(): HTMLElement {
    this.bars = { b: this.makeBar('b'), w: this.makeBar('w') };

    const topBtn = (name: Parameters<typeof iconButton>[0], label: string, fn: () => void): HTMLButtonElement => {
      const b = iconButton(name, label);
      b.addEventListener('click', () => {
        sound.play('click');
        fn();
      });
      return b;
    };

    const header = h('header', 'game-header', [
      topBtn('home', 'ホームへ', () => void this.leave()),
      this.statusEl,
      h('div', 'header-actions', [
        topBtn('flip', '盤を反転 (F)', () => this.flip()),
        topBtn('settings', '設定', () => openSettings()),
      ]),
    ]);

    // 動かす / 置く
    const mk = (mode: Mode, label: string, key: string): HTMLButtonElement => {
      const count = h('span', 'mode-count');
      const b = h('button', 'mode-btn', [h('span', 'mode-label', [label]), count, h('kbd', '', [key])], { type: 'button' });
      b.dataset.mode = mode;
      b.addEventListener('click', () => this.setMode(mode, true));
      this.modeCounts = { ...(this.modeCounts ?? ({} as Record<Mode, HTMLElement>)), [mode]: count };
      return b;
    };
    this.modeBtns = { move: mk('move', '動かす', 'Q'), drop: mk('drop', '置く', 'W') };
    this.modeBar.append(this.modeBtns.move, this.modeBtns.drop);

    const stage = h('section', 'stage', [this.netBanner, this.bars.w.root, this.view.root, this.bars.b.root, this.modeBar]);
    // 画面の上下は盤の向きに合わせて入れ替える（renderBars で調整）
    this.stage = stage;

    const nav = (name: Parameters<typeof iconButton>[0], label: string, fn: () => void): HTMLButtonElement => {
      const b = iconButton(name, label, 'icon-btn small');
      b.addEventListener('click', () => {
        sound.play('click');
        fn();
      });
      this.reviewBtns.push(b);
      return b;
    };
    const reviewBar = h('div', 'review-bar', [
      nav('first', '最初へ (Home)', () => void this.goto(0)),
      nav('prev', '1手戻る (←)', () => void this.goto(this.cursor - 1)),
      nav('next', '1手進む (→)', () => void this.goto(this.cursor + 1)),
      nav('last', '最新へ (End)', () => void this.goto(this.session.moves.length)),
    ]);

    this.btnUndo = h('button', 'btn ghost', [], { type: 'button' });
    this.btnUndo.innerHTML = `${iconSvg('undo')}<span>待った</span>`;
    this.btnUndo.addEventListener('click', () => void this.undo());
    this.btnResign = h('button', 'btn danger-ghost', [], { type: 'button' });
    this.btnResign.innerHTML = `${iconSvg('flag')}<span>投了</span>`;
    this.btnResign.addEventListener('click', () => void this.onResign());

    const actions = h('div', 'side-actions', this.net ? [this.btnResign] : [this.btnUndo, this.btnResign]);
    const side = h('aside', 'side', [
      h('div', 'panel moves-panel', [h('h3', 'panel-title', ['棋譜']), h('div', 'moves-scroll', [this.movesEl]), reviewBar]),
      actions,
    ]);

    return h('div', 'screen game', [h('div', 'game-layout', [header, stage, side]), this.overlayCanvas]);
  }

  private stage!: HTMLElement;

  /** 盤の向きに合わせて、手前の側のバーを下に置く */
  private placeBars(): void {
    const top = this.bars[other(this.bottomColor)].root;
    const bottom = this.bars[this.bottomColor].root;
    if (top.nextElementSibling !== this.view.root) this.stage.insertBefore(top, this.view.root);
    if (this.view.root.nextElementSibling !== bottom) this.view.root.after(bottom);
  }

  // ---- オンライン ----------------------------------------------------------

  private bindNet(): void {
    const net = this.net;
    if (!net) return;
    this.netOffs.push(
      net.onMessage((m) => {
        if (m.t === 'clock') {
          // 時計は順番を待たず、すぐ合わせる
          if (!this.session.result) this.clock.syncServer(m.leftMain, m.turn, m.elapsedMs, m.byoMs);
          return;
        }
        this.incoming.push(m);
        void this.pump();
      }),
      net.onPeer((s) => {
        if (this.session.result) return;
        if (s.online) {
          this.netBanner.classList.remove('show');
          toast('相手が戻ってきました');
        } else {
          const sec = Math.ceil(s.remainingMs / 1000);
          this.netBanner.textContent = `相手が切断中です。あと${sec}秒で戻らなければあなたの勝ちになります`;
          this.netBanner.classList.add('show');
        }
      }),
      net.onPeerGone(() => {
        if (this.session.result || !this.mySide) return;
        this.netBanner.classList.remove('show');
        void this.finish(this.session.disconnect(other(this.mySide)));
      }),
    );
  }

  /** 相手からの通知を、操作が空いているときに順番に処理する */
  private async pump(): Promise<void> {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.incoming.length && !this.disposed) {
        if (!this.started || this.busy) {
          await sleep(60);
          continue;
        }
        const m = this.incoming.shift() as NetMsg;
        if (m.t === 'result') {
          // サーバーが確定した結果（詰み・投了・時間切れ・切断・無効試合）
          this.session.setResult({ kind: m.kind, winner: m.winner });
          await this.finish({ kind: m.kind, winner: m.winner }, m.ratings);
          continue;
        }
        if (m.t === 'resync') {
          this.resync(m.moves);
          continue;
        }
        if (this.session.result) continue;
        const opp = this.mySide ? other(this.mySide) : this.session.turn;
        if (m.t === 'move') {
          if (this.session.turn !== opp) continue;
          const mv = parseUsi(this.session.position, m.usi, this.session.legal);
          if (!mv) {
            toast('不正な指し手を受信したため無視しました');
            continue;
          }
          if (!this.atLatest) this.cursor = this.session.moves.length;
          await this.commit(mv, false);
        } else if (m.t === 'resign') {
          await this.finish(this.session.resign(opp));
        } else if (m.t === 'timeout') {
          await this.finish(this.session.timeout(opp));
        }
      }
    } finally {
      this.pumping = false;
    }
  }
  private pumping = false;

  /** サーバーの手順に合わせて、盤面を作り直す */
  private resync(moves: string[]): void {
    this.session = new GameSession();
    for (const usi of moves) {
      const m = parseUsi(this.session.position, usi, this.session.legal);
      if (!m) break;
      this.session.play(m);
    }
    this.cursor = this.session.moves.length;
    this.clearSelection();
    this.beginTurn();
    this.refresh();
    // 自動復旧時は通知を出さない（不要なトーストの連続表示を防ぐ）。
  }

  // ---- 開始・終了 ----------------------------------------------------------

  async start(): Promise<void> {
    this.placeBars();
    this.refresh();
    this.renderClocks();
    if (this.resumed) {
      // 再接続: 演出なしですぐ続きから
      this.started = true;
      this.busy = false;
      this.beginTurn();
      this.refresh();
      toast('対局に復帰しました');
      void this.pump();
      return;
    }
    await this.view.animateSetup(this.session.position, NO_HIGHLIGHTS);
    if (this.disposed) return;
    await this.view.fxStart();
    if (this.disposed) return;
    this.started = true;
    this.busy = false;
    this.clockSnaps.push(this.clock.snapshot());
    this.clock.start('b');
    this.beginTurn();
    this.refresh();
    void this.pump();
  }

  destroy(): void {
    this.disposed = true;
    this.clock.stop();
    this.particles.destroy();
    this.unsubSettings();
    this.netOffs.forEach((f) => f());
    this.net?.close();
    window.removeEventListener('keydown', this.onKey);
  }

  async leave(): Promise<void> {
    if (this.session.moves.length > 0 && !this.session.result) {
      const msg = this.net ? '途中で退出すると、あなたの負けになります。' : '対局中の内容は保存されません。';
      const ok = await confirmDialog('ホームへ戻りますか？', msg, 'ホームへ戻る', true);
      if (!ok) return;
      if (this.net && this.mySide) this.net.send({ t: 'resign' });
    }
    navigate('home');
  }

  private async finish(result: GameResult, ratings?: Record<Color, { before: number; after: number }>): Promise<void> {
    this.clock.stop();
    this.busy = true;
    this.clearSelection();
    this.refresh();
    const names = this.names;
    const winner = result.winner;
    await sleep(result.kind === 'checkmate' ? 350 : 150);
    if (this.disposed) return;
    sound.play(winner ? 'win' : 'draw');
    if (winner) {
      this.particles.celebrate();
      fx.vignette(this.view.root, 'gold');
    }
    this.view.setDim(true);
    const text = resultText(result, names);
    const youWon = this.mySide ? winner === this.mySide : null;
    const title = result.kind === 'void' ? '無効試合' : !winner ? '引き分け' : youWon === null ? `${names[winner]}の勝ち` : youWon ? 'あなたの勝ち！' : 'あなたの負け';
    const mine = this.mySide && ratings ? ratings[this.mySide] : null;
    const delta = mine ? mine.after - mine.before : 0;
    const body = h('div', 'result-body', [
      h('div', `result-crest${winner ? '' : ' draw'}`, [winner ? (winner === 'b' ? '☗' : '☖') : '＝']),
      h('p', 'result-text', [text]),
      mine
        ? h('p', `result-rating ${delta > 0 ? 'up' : delta < 0 ? 'down' : ''}`, [
            `レーティング ${mine.before} → ${mine.after}`,
            h('b', '', [` (${delta >= 0 ? '+' : ''}${delta})`]),
          ])
        : null,
      h('p', 'result-meta', [`${this.session.moves.length}手`]),
    ]);
    openModal({
      title,
      body,
      actions: [
        {
          label: '棋譜をコピー',
          variant: 'ghost',
          onClick: () => {
            void this.copyKifu();
            return false;
          },
        },
        { label: '盤面を見る', variant: 'ghost', onClick: () => this.view.setDim(false) },
        this.net
          ? { label: 'マッチングへ', variant: 'primary', onClick: () => navigate('matching') }
          : { label: 'もう一局', variant: 'primary', onClick: () => navigate('game', { preset: this.opts.preset }) },
        { label: 'ホームへ', variant: 'ghost', onClick: () => navigate('home') },
      ],
      onClose: () => this.view.setDim(false),
    });
  }

  private async copyKifu(): Promise<void> {
    const text = this.session.toText(this.names);
    try {
      await navigator.clipboard.writeText(text);
      toast('棋譜をコピーしました');
    } catch {
      toast('コピーできませんでした');
    }
  }

  // ---- 手番・モード --------------------------------------------------------

  private get atLatest(): boolean {
    return this.cursor === this.session.moves.length;
  }

  /** いま自分が操作してよい手番か（ローカルは常に手番側） */
  private get myTurn(): boolean {
    return this.mySide === null || this.session.turn === this.mySide;
  }

  private canInput(): boolean {
    return this.started && !this.busy && !this.session.result && this.atLatest && this.myTurn;
  }

  /** 手番の開始時に、合法手を集計してモードを決める */
  private beginTurn(): void {
    this.movableSqs.clear();
    this.dropSqs.clear();
    for (const m of this.session.legal) {
      if (m.from === DROP) {
        const list = this.dropSqs.get(m.to) ?? [];
        if (!list.includes(m.piece as HandType)) list.push(m.piece as HandType);
        this.dropSqs.set(m.to, list);
      } else this.movableSqs.add(m.from);
    }
    this.mode = this.movableSqs.size > 0 || this.dropSqs.size === 0 ? 'move' : 'drop';
  }

  private setMode(mode: Mode, fromUser: boolean): void {
    if (fromUser && !this.canInput()) return;
    const available = mode === 'move' ? this.movableSqs.size > 0 : this.dropSqs.size > 0;
    if (!available) {
      if (fromUser) sound.play('error');
      return;
    }
    if (this.mode === mode) return;
    this.mode = mode;
    this.clearSelection();
    sound.play('select');
    this.refresh();
  }

  private clearSelection(): void {
    this.selected = null;
    this.selectedHand = null;
  }

  private targetsFor(): { sq: number; capture: boolean }[] {
    const out = new Map<number, boolean>();
    for (const m of this.session.legal) {
      const match =
        this.mode === 'drop'
          ? this.selectedHand !== null && m.from === DROP && m.piece === this.selectedHand
          : this.selected !== null && m.from === this.selected;
      if (match) out.set(m.to, m.capture !== null);
    }
    return [...out].map(([sq, capture]) => ({ sq, capture }));
  }

  private highlights(): Highlights {
    const idx = this.cursor;
    const last = idx > 0 ? this.session.moves[idx - 1] : null;
    const pos = this.session.positions[idx];
    let checkSq: number | null = null;
    if (idx > 0 && this.session.checks[idx - 1]) {
      const k = findKing(pos.board, pos.turn);
      checkSq = k >= 0 ? k : null;
    }
    const live = this.canInput();
    const types = new Set<HandType>();
    this.dropSqs.forEach((l) => l.forEach((t) => types.add(t)));
    return {
      selected: live ? this.selected : null,
      selectedHand: live && this.selectedHand ? { color: this.session.turn, type: this.selectedHand } : null,
      targets: live ? this.targetsFor() : [],
      lastMove: last ? { from: last.from, to: last.to } : null,
      checkSq,
      movable: live ? [...this.movableSqs] : [],
      droppable: live ? [...this.dropSqs.keys()] : [],
      droppableTypes: live ? [...types] : [],
      mode: live ? this.mode : null,
    };
  }

  private refresh(): void {
    this.placeBars();
    const pos = this.session.positions[this.cursor];
    const hl = this.highlights();
    this.view.render(pos, hl);
    this.view.setHoverable(this.canInput() ? this.hoverSquares() : new Set());
    this.renderSide();
    this.renderStatus();
    this.renderModeBar();
  }

  /** ホバーで枠を出すマス */
  private hoverSquares(): Set<number> {
    const s = new Set<number>();
    if (this.mode === 'move') {
      this.movableSqs.forEach((q) => s.add(q));
      for (const t of this.targetsFor()) s.add(t.sq);
    } else {
      this.dropSqs.forEach((_, q) => s.add(q));
    }
    return s;
  }

  private renderModeBar(): void {
    const live = this.canInput();
    this.modeBar.dataset.live = live ? '1' : '0';
    this.modeBar.dataset.mode = this.mode;
    this.modeBtns.move.classList.toggle('active', live && this.mode === 'move');
    this.modeBtns.drop.classList.toggle('active', live && this.mode === 'drop');
    this.modeBtns.move.disabled = !live || this.movableSqs.size === 0;
    this.modeBtns.drop.disabled = !live || this.dropSqs.size === 0;
    this.modeCounts.move.textContent = live ? `${this.movableSqs.size}駒` : '';
    this.modeCounts.drop.textContent = live ? `${this.dropSqs.size}マス` : '';
  }

  // ---- 入力 ----------------------------------------------------------------

  private async onSquare(sq: number): Promise<void> {
    if (!this.canInput()) return;
    const turn = this.session.turn;
    const piece = this.session.position.board[sq];
    const targets = this.targetsFor();

    if (this.mode === 'move') {
      if (this.selected !== null && targets.some((t) => t.sq === sq)) {
        await this.tryMove(sq);
        return;
      }
      if (piece && piece.c === turn) {
        if (this.selected === sq) {
          sound.play('deselect');
          this.clearSelection();
        } else if (this.movableSqs.has(sq)) {
          this.selected = sq;
          sound.play('select');
        } else {
          sound.play('error');
          this.view.wiggle(sq);
          return;
        }
        this.refresh();
        return;
      }
      if (this.selected !== null) {
        sound.play('deselect');
        this.clearSelection();
        this.refresh();
      }
      return;
    }

    // 置くモード
    const types = this.dropSqs.get(sq);
    if (!types) {
      if (this.selectedHand !== null) {
        sound.play('deselect');
        this.clearSelection();
        this.refresh();
      }
      return;
    }
    if (this.selectedHand !== null && types.includes(this.selectedHand)) {
      await this.tryMove(sq);
      return;
    }
    if (types.length === 1) {
      this.selectedHand = types[0];
      await this.tryMove(sq);
      return;
    }
    // 複数の駒が置ける: どれを置くか選ぶ
    this.busy = true;
    const choice = await this.view.chooseHandPiece(sq, types, turn);
    this.busy = false;
    if (choice === null) {
      this.refresh();
      return;
    }
    this.selectedHand = choice;
    await this.tryMove(sq);
  }

  private onHand(color: Color, type: HandType): void {
    if (!this.canInput() || color !== this.session.turn) return;
    if (this.mode !== 'drop') {
      sound.play('error');
      this.modeBtns.drop.classList.remove('nudge');
      void this.modeBtns.drop.offsetWidth;
      this.modeBtns.drop.classList.add('nudge');
      toast('「置く」を選ぶと持ち駒を使えます');
      return;
    }
    if (this.session.position.hands[color][type] <= 0) return;
    if (this.selectedHand === type) {
      sound.play('deselect');
      this.clearSelection();
    } else {
      const droppable = this.session.legal.some((m) => m.from === DROP && m.piece === type);
      if (!droppable) {
        sound.play('error');
        return;
      }
      sound.play('select');
      this.selectedHand = type;
    }
    this.refresh();
  }

  private async tryMove(to: number): Promise<void> {
    const from = this.mode === 'drop' ? DROP : (this.selected as number);
    const candidates = this.session.legal.filter(
      (m) => m.from === from && m.to === to && (from !== DROP || m.piece === this.selectedHand),
    );
    if (!candidates.length) return;
    let move = candidates[0];
    if (candidates.length > 1) {
      const m0 = candidates[0];
      this.busy = true;
      const choice = await this.view.choosePromotion(to, m0.piece, this.session.turn);
      this.busy = false;
      if (choice === null) return;
      move = candidates.find((m) => m.promote === choice) ?? m0;
    }
    await this.commit(move, true);
  }

  // ---- 着手 ----------------------------------------------------------------

  private async commit(move: Move, local: boolean): Promise<void> {
    this.busy = true;
    const before = this.session.position;
    const mover = before.turn;
    this.clearSelection();

    const result = this.session.play(move);
    if (local) this.net?.send({ t: 'move', usi: moveToUsi(move) });
    this.cursor = this.session.moves.length;
    const after = this.session.position;
    const check = this.session.checks[this.session.moves.length - 1];

    // 時計は着手の瞬間に切り替える（アニメーション時間は消費しない）
    if (result) this.clock.stop();
    else this.clock.switchTo(other(mover));
    this.clockSnaps.push(this.clock.snapshot());

    this.renderSide();
    this.renderStatus();
    this.renderModeBar();
    const hl = { ...this.highlights(), movable: [], droppable: [], droppableTypes: [], mode: null };
    await this.view.animateMove(before, after, move, hl);
    if (this.disposed) return;

    if (check) {
      const k = findKing(after.board, after.turn);
      if (k >= 0) await this.view.fxCheck(k, result?.kind === 'checkmate' ? '詰み' : '王手');
    }
    if (this.disposed) return;

    if (result) {
      await this.finish(result);
      return;
    }
    this.busy = false;
    this.beginTurn();
    this.refresh();
    void this.pump();
  }

  // ---- 閲覧（棋譜を行き来する） ---------------------------------------------

  private async goto(index: number): Promise<void> {
    const max = this.session.moves.length;
    index = Math.max(0, Math.min(max, index));
    if (index === this.cursor || (this.busy && this.started)) return;
    const prev = this.cursor;
    this.cursor = index;
    this.clearSelection();
    if (index === prev + 1) {
      this.busy = true;
      this.renderSide();
      this.renderStatus();
      await this.view.animateMove(
        this.session.positions[prev],
        this.session.positions[index],
        this.session.moves[prev],
        { ...this.highlights(), movable: [], droppable: [], droppableTypes: [], mode: null },
      );
      this.busy = false;
    }
    this.refresh();
    void this.pump();
  }

  private flip(): void {
    this.view.setFlipped(!this.view.isFlipped());
    this.refresh();
    sound.play('click');
  }

  // ---- 待った・投了 --------------------------------------------------------

  private async undo(): Promise<void> {
    if (this.net || !this.started || this.busy || this.session.result || !this.session.moves.length) return;
    const ok = await confirmDialog('待ったをしますか？', '直前の1手を取り消します。', '待った');
    if (!ok || this.disposed || this.session.result) return;
    this.session.undo();
    this.clockSnaps.pop();
    const snap = this.clockSnaps[this.clockSnaps.length - 1];
    this.clock.stop();
    this.clock.restore(snap);
    this.cursor = this.session.moves.length;
    this.clearSelection();
    sound.play('deselect');
    this.beginTurn();
    this.refresh();
  }

  private async onResign(): Promise<void> {
    if (!this.started || this.busy || this.session.result) return;
    const loser = this.mySide ?? this.session.turn;
    const label = this.mySide ? 'あなたが投了します。' : `${this.names[loser]}が投了します。`;
    const ok = await confirmDialog('投了しますか？', label, '投了する', true);
    if (!ok || this.disposed || this.session.result) return;
    this.net?.send({ t: 'resign' });
    if (this.net?.authoritative) {
      // 結果はサーバーから届く
      this.btnResign.disabled = true;
      return;
    }
    await this.finish(this.session.resign(loser));
  }

  // ---- 表示 ----------------------------------------------------------------

  private renderStatus(): void {
    const s = this.session;
    let text: string;
    let tone = '';
    if (s.result) {
      text = resultText(s.result, this.names);
      tone = 'done';
    } else if (!this.atLatest) {
      text = `${this.cursor}手目を表示中`;
      tone = 'review';
    } else if (this.mySide && !this.myTurn) {
      text = `${this.names[s.turn]}（相手）が考えています…`;
      tone = 'wait';
    } else if (s.inCheck) {
      text = `${this.mySide ? 'あなた' : this.names[s.turn]}の番 — 王手されています`;
      tone = 'check';
    } else {
      text = this.mySide ? 'あなたの番です' : `${this.names[s.turn]}の番です`;
    }
    this.statusEl.textContent = text;
    this.statusEl.dataset.tone = tone;
    const turn = this.session.turn;
    for (const c of ['b', 'w'] as const) {
      this.bars[c].root.classList.toggle('active', !this.session.result && c === turn);
    }
  }

  private renderSide(): void {
    const s = this.session;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < s.labels.length; i++) {
      const mark = s.labels[i].slice(0, 1);
      const li = h('li', `move${i + 1 === this.cursor ? ' current' : ''}`, [
        h('span', 'no', [String(i + 1)]),
        h('span', `mv ${mark === '▲' ? 'b' : 'w'}`, [s.labels[i].slice(1)]),
      ]);
      li.addEventListener('click', () => void this.goto(i + 1));
      frag.append(li);
    }
    if (s.result) {
      frag.append(h('li', 'move result', [h('span', 'no', ['終']), h('span', 'mv', [resultText(s.result, this.names)])]));
    }
    this.movesEl.replaceChildren(frag);
    if (!s.labels.length) {
      this.movesEl.append(h('li', 'moves-empty', ['まだ指し手がありません']));
    }
    const cur = this.movesEl.querySelector('.current');
    if (cur) (cur as HTMLElement).scrollIntoView({ block: 'nearest' });
    else this.movesEl.parentElement?.scrollTo({ top: 0 });

    const max = s.moves.length;
    this.reviewBtns[0].disabled = this.cursor === 0;
    this.reviewBtns[1].disabled = this.cursor === 0;
    this.reviewBtns[2].disabled = this.cursor >= max;
    this.reviewBtns[3].disabled = this.cursor >= max;
    this.btnUndo.disabled = !this.started || !!s.result || max === 0;
    this.btnResign.disabled = !this.started || !!s.result;
  }

  private renderClocks(): void {
    for (const c of ['b', 'w'] as const) {
      const d = this.clock.display(c);
      const bar = this.bars[c];
      bar.clockText.textContent = d.text;
      bar.clock.dataset.byo = d.byo ? '1' : '0';
      bar.clock.dataset.low = d.low ? '1' : '0';
      bar.clock.dataset.unlimited = this.clock.unlimited ? '1' : '0';
      bar.clock.dataset.running = this.clock.running === c ? '1' : '0';
    }
    const r = this.clock.running;
    if (r && !this.clock.unlimited && (!this.mySide || r === this.mySide)) {
      const d = this.clock.display(r);
      const sec = Number(d.text);
      if (d.byo && d.low && sec !== this.lowSecond) {
        this.lowSecond = sec;
        sound.play('tick');
      }
    }
  }

  // ---- キーボード ----------------------------------------------------------

  private onKey = (e: KeyboardEvent): void => {
    if (document.querySelector('.modal-backdrop')) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA') return;
    switch (e.key) {
      case 'ArrowLeft':
        void this.goto(this.cursor - 1);
        break;
      case 'ArrowRight':
        void this.goto(this.cursor + 1);
        break;
      case 'Home':
        void this.goto(0);
        break;
      case 'End':
        void this.goto(this.session.moves.length);
        break;
      case 'f':
      case 'F':
        this.flip();
        break;
      case 'q':
      case 'Q':
        this.setMode('move', true);
        break;
      case 'w':
      case 'W':
        this.setMode('drop', true);
        break;
      case 'Escape':
        if (this.selected !== null || this.selectedHand !== null) {
          this.clearSelection();
          this.refresh();
        }
        break;
      default:
        return;
    }
    e.preventDefault();
  };
}
