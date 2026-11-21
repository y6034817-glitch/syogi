// マッチング画面（ランダム / ワード）。部屋はなく、条件が合った人同士が自動でつながる。

import { h } from '../dom.ts';
import { PRESETS } from '../../game/clock.ts';
import { CONFIRM_TIMEOUT_MS, MATCH_TIMEOUT_MS, validateWord } from '../../online/types.ts';
import type { MatchHandle, MatchMode, MatchPhase } from '../../online/types.ts';
import { supabaseMatchService } from '../../online/supabase-match.ts';
import { auth } from '../../online/api.ts';
import { openAuth } from './auth.ts';
import { enterGame } from '../resume.ts';
import { sound } from '../../audio/sound.ts';
import { toast } from '../dialogs.ts';
import { navigate } from '../app.ts';
import type { Screen } from '../app.ts';

const PRESET = PRESETS[1]; // 10分 + 秒読み30秒（オンラインは固定）

export class MatchingScreen implements Screen {
  readonly root: HTMLElement;
  private mode: MatchMode = 'random';
  private handle: MatchHandle | null = null;
  private body = h('div', 'mt-body');
  private unsub: () => void;
  private wordInput: HTMLInputElement;
  private wordError = h('p', 'field-error');
  private tabEls = new Map<MatchMode, HTMLButtonElement>();
  private tabIndicator = h('span', 'seg-indicator');
  private lastKind = '';
  private disposed = false;

  constructor() {
    this.wordInput = h('input', 'input', [], {
      type: 'text',
      maxlength: '20',
      placeholder: '例: さくら',
      'aria-label': '合わせるワード',
      autocomplete: 'off',
    }) as HTMLInputElement;
    this.wordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') this.begin();
    });

    const seg = h('div', 'mt-tabs', [this.tabIndicator], { role: 'tablist' });
    for (const [m, label, sub] of [
      ['random', 'ランダム', 'だれとでも'],
      ['word', 'ワード', '同じワードの人と'],
    ] as const) {
      const b = h('button', 'mt-tab', [h('strong', '', [label]), h('small', '', [sub])], { type: 'button', role: 'tab' });
      b.addEventListener('click', () => this.setMode(m));
      this.tabEls.set(m, b);
      seg.append(b);
    }

    this.root = h('div', 'screen matching', [
      h('div', 'page', [
        h('header', 'page-head', [h('h1', '', ['マッチング']), h('p', '', ['部屋はありません。条件が合う相手と自動でつながります。'])]),
        h('div', 'panel mt-panel', [seg, this.body]),
      ]),
    ]);
    this.unsub = auth.subscribe(() => {
      if (!this.handle && !this.disposed) this.renderIdle();
    });
    this.renderIdle();
    queueMicrotask(() => this.moveIndicator(false));
    window.addEventListener('resize', this.onResize);
  }

  private onResize = (): void => this.moveIndicator(false);

  private moveIndicator(animate: boolean): void {
    const el = this.tabEls.get(this.mode);
    if (!el) return;
    this.tabIndicator.style.transition = animate ? '' : 'none';
    this.tabIndicator.style.width = `${el.offsetWidth}px`;
    this.tabIndicator.style.transform = `translateX(${el.offsetLeft}px)`;
    for (const [m, b] of this.tabEls) {
      b.classList.toggle('on', m === this.mode);
      b.setAttribute('aria-selected', String(m === this.mode));
    }
  }

  private setMode(m: MatchMode): void {
    if (this.handle || m === this.mode) return;
    this.mode = m;
    sound.play('select');
    this.moveIndicator(true);
    this.renderIdle();
  }

  // ---- 状態ごとの表示 --------------------------------------------------------

  private renderIdle(): void {
    this.lastKind = 'idle';
    const me = auth.profile;
    if (!me) {
      const login = h('button', 'btn primary big', ['ログイン / 新規登録'], { type: 'button' });
      login.addEventListener('click', () => {
        sound.play('click');
        void openAuth('login');
      });
      this.body.replaceChildren(
        h('div', 'mt-center', [
          h('p', 'mt-lead', ['対戦するにはログインが必要です']),
          h('p', 'mt-sub', ['ユーザー名とパスワードだけで登録できます（メール不要）。']),
          login,
        ]),
      );
      return;
    }
    const timeInfo = h('div', 'mt-info', [
      h('span', '', ['持ち時間']),
      h('strong', '', [PRESET.label]),
      h('span', '', ['切断の猶予']),
      h('strong', '', ['60秒']),
    ]);
    const field = (label: string, input: HTMLElement, extra?: HTMLElement): HTMLElement =>
      h('label', 'field', [h('span', 'field-label', [label]), input, extra]);

    const start = h('button', 'btn primary big', [this.mode === 'random' ? 'ランダムで探す' : 'このワードで探す'], { type: 'button' });
    start.addEventListener('click', () => this.begin());

    const desc =
      this.mode === 'random'
        ? '待っている人の中から、すぐに対戦相手を探します。'
        : '同じワードを入力した人同士がつながります。友だちと同じワードを決めておくと、確実に対戦できます。';

    const parts: HTMLElement[] = [h('p', 'mt-desc', [desc]), h('p', 'mt-me', [`${me.display_name}（レート ${me.rating}）として参加`])];
    if (this.mode === 'word') parts.push(field('ワード', this.wordInput, this.wordError));
    parts.push(timeInfo, start);
    this.body.replaceChildren(...parts);
    this.wordError.textContent = '';
  }

  private begin(): void {
    if (this.handle) return;
    const me = auth.profile;
    if (!me) return;
    const name = me.display_name;
    let word: string | undefined;
    if (this.mode === 'word') {
      const err = validateWord(this.wordInput.value);
      if (err) {
        this.wordError.textContent = err;
        sound.play('error');
        this.wordInput.focus();
        return;
      }
      word = this.wordInput.value;
    }
    sound.play('click');
    this.handle = supabaseMatchService.start(
      { mode: this.mode, word, name },
      (p: MatchPhase) => this.onPhase(p),
      (game) => {
        this.handle = null;
        sound.play('win');
        navigate('game', { preset: PRESET, net: game });
      },
    );
  }

  private onPhase(p: MatchPhase): void {
    if (this.disposed) return;
    switch (p.kind) {
      case 'idle':
        this.handle = null;
        this.renderIdle();
        break;
      case 'searching':
        this.renderSearching(p);
        break;
      case 'found':
        this.renderFound(p);
        break;
      case 'starting':
        this.lastKind = 'starting';
        this.body.replaceChildren(h('div', 'mt-center', [h('div', 'spinner'), h('p', 'mt-lead', ['対局を始めます…'])]));
        break;
      case 'failed':
        this.handle = null;
        this.renderFailed(p.message);
        break;
    }
  }

  private renderSearching(p: Extract<MatchPhase, { kind: 'searching' }>): void {
    const left = Math.max(0, Math.ceil((MATCH_TIMEOUT_MS - p.elapsedMs) / 1000));
    if (this.lastKind !== 'searching') {
      this.lastKind = 'searching';
      const cancel = h('button', 'btn ghost', ['キャンセル'], { type: 'button' });
      cancel.addEventListener('click', () => {
        sound.play('deselect');
        this.handle?.cancel();
      });
      this.body.replaceChildren(
        h('div', 'mt-center', [
          h('div', 'radar', [h('i'), h('i'), h('i'), h('span', 'radar-core', ['☗'])]),
          h('p', 'mt-lead', [p.mode === 'word' ? `ワード「${p.word}」の相手を探しています` : '対戦相手を探しています']),
          h('p', 'mt-sub', [h('b', 'mt-left', [String(left)]), '秒以内に見つからなければ終了します']),
          h('div', 'bar', [h('i', 'bar-fill')]),
          cancel,
        ]),
      );
    }
    const l = this.body.querySelector('.mt-left');
    if (l) l.textContent = String(left);
    const fill = this.body.querySelector<HTMLElement>('.bar-fill');
    if (fill) fill.style.transform = `scaleX(${Math.max(0, 1 - p.elapsedMs / MATCH_TIMEOUT_MS)})`;
  }

  private renderFound(p: Extract<MatchPhase, { kind: 'found' }>): void {
    const left = Math.max(0, Math.ceil(p.confirmMsLeft / 1000));
    if (this.lastKind !== 'found') {
      this.lastKind = 'found';
      sound.play('promote');
      const ok = h('button', 'btn primary big', ['準備OK'], { type: 'button' });
      ok.addEventListener('click', () => {
        sound.play('click');
        this.handle?.ready();
      });
      const leave = h('button', 'btn ghost', ['やめる'], { type: 'button' });
      leave.addEventListener('click', () => {
        sound.play('deselect');
        this.handle?.cancel();
      });
      this.body.replaceChildren(
        h('div', 'mt-center found', [
          h('p', 'found-title', ['対戦相手が見つかりました']),
          h('div', 'versus', [
            h('div', 'vs-side', [h('span', 'vs-crest', ['☗']), h('strong', '', [auth.profile?.display_name ?? 'あなた']), h('small', 'vs-you', ['あなた'])]),
            h('span', 'vs-x', ['VS']),
            h('div', 'vs-side', [h('span', 'vs-crest w', ['☖']), h('strong', '', [p.opponentName]), h('small', 'vs-opp', ['待機中…'])]),
          ]),
          h('p', 'mt-sub', [h('b', 'mt-left', [String(left)]), '秒以内に準備OKを押してください']),
          h('div', 'bar', [h('i', 'bar-fill')]),
          h('div', 'row', [leave, ok]),
        ]),
      );
    }
    const l = this.body.querySelector('.mt-left');
    if (l) l.textContent = String(left);
    const fill = this.body.querySelector<HTMLElement>('.bar-fill');
    if (fill) fill.style.transform = `scaleX(${Math.max(0, p.confirmMsLeft / CONFIRM_TIMEOUT_MS)})`;
    const opp = this.body.querySelector<HTMLElement>('.vs-opp');
    if (opp) {
      opp.textContent = p.opponentReady ? '準備OK' : '待機中…';
      opp.classList.toggle('ready', p.opponentReady);
    }
    const okBtn = this.body.querySelector<HTMLButtonElement>('.btn.primary');
    if (okBtn && p.youReady) {
      okBtn.disabled = true;
      okBtn.textContent = '相手を待っています…';
    }
  }

  private renderFailed(message: string): void {
    this.lastKind = 'failed';
    sound.play('error');
    const retry = h('button', 'btn primary', ['もう一度探す'], { type: 'button' });
    retry.addEventListener('click', () => {
      sound.play('click');
      this.renderIdle();
    });
    const actions: HTMLElement[] = [retry];
    if (message.includes('進行中の対局')) {
      const back = h('button', 'btn primary', ['対局に戻る'], { type: 'button' });
      back.addEventListener('click', () => {
        void import('../../online/supabase-game.ts').then(async (m) => {
          const id = await m.findActiveGame();
          if (id) await enterGame(id);
          else toast('進行中の対局は見つかりませんでした');
        });
      });
      actions.unshift(back);
    }
    this.body.replaceChildren(h('div', 'mt-center', [h('div', 'fail-mark', ['！']), h('p', 'mt-lead', [message]), h('div', 'row', actions)]));
    toast(message);
  }

  start(): void {
    /* 何もしない */
  }

  destroy(): void {
    this.disposed = true;
    this.unsub();
    window.removeEventListener('resize', this.onResize);
    this.handle?.cancel();
    this.handle = null;
  }
}
