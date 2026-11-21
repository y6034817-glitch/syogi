import { h } from '../dom.ts';
import { openModal } from '../dialogs.ts';
import { PRESETS } from '../../game/clock.ts';
import type { TimePreset } from '../../game/clock.ts';
import { ParticleField } from '../../animation/particles.ts';
import { settings } from '../../state/settings.ts';
import { sound } from '../../audio/sound.ts';
import { openHowTo } from './howto.ts';
import { navigate } from '../app.ts';
import type { Screen } from '../app.ts';

const FLOATERS: { g: string; x: number; y: number; r: number; s: number; d: number }[] = [
  { g: '王', x: 8, y: 22, r: -14, s: 1.25, d: 0 },
  { g: '飛', x: 86, y: 18, r: 12, s: 1.05, d: 1.2 },
  { g: '角', x: 15, y: 70, r: 9, s: 1, d: 2.1 },
  { g: '金', x: 82, y: 66, r: -10, s: 1.2, d: 0.6 },
  { g: '歩', x: 50, y: 88, r: 6, s: 0.85, d: 1.7 },
  { g: '桂', x: 93, y: 42, r: -6, s: 0.8, d: 2.6 },
];

function card(
  idx: number,
  cls: string,
  glyph: string,
  title: string,
  desc: string,
  onClick: () => void,
  badge?: string,
): HTMLButtonElement {
  const b = h(
    'button',
    `home-card ${cls}`,
    [
      h('span', 'hc-glyph', [glyph]),
      h('span', 'hc-text', [h('strong', '', [title]), h('small', '', [desc])]),
      badge ? h('span', 'hc-badge', [badge]) : null,
      h('span', 'hc-arrow', ['→']),
    ],
    { type: 'button' },
  );
  b.style.setProperty('--i', String(idx));
  b.addEventListener('click', () => {
    sound.play('click');
    onClick();
  });
  return b;
}

function openLocalSetup(): void {
  let chosen: TimePreset = PRESETS[1];
  const list = h('div', 'preset-list', [], { role: 'radiogroup', 'aria-label': '持ち時間' });
  const items: HTMLButtonElement[] = [];
  for (const p of PRESETS) {
    const b = h('button', `preset${p === chosen ? ' on' : ''}`, [h('strong', '', [p.label]), h('small', '', [p.desc])], {
      type: 'button',
      role: 'radio',
      'aria-checked': String(p === chosen),
    });
    b.addEventListener('click', () => {
      chosen = p;
      sound.play('select');
      items.forEach((e) => {
        e.classList.toggle('on', e === b);
        e.setAttribute('aria-checked', String(e === b));
      });
    });
    items.push(b);
    list.append(b);
  }
  openModal({
    title: 'ローカル対局（ふたりで）',
    body: h('div', '', [h('p', 'modal-text', ['1台の画面で、交互に指します。持ち時間を選んでください。']), list]),
    actions: [
      { label: 'キャンセル', variant: 'ghost' },
      { label: '対局開始', variant: 'primary', onClick: () => navigate('game', { preset: chosen }) },
    ],
  });
}

export class HomeScreen implements Screen {
  readonly root: HTMLElement;
  private particles: ParticleField;

  constructor() {
    const canvas = h('canvas', 'particles-canvas ambient');
    this.particles = new ParticleField(canvas);

    const floaters = FLOATERS.map((f) => {
      const e = h('div', 'floater', [h('span', '', [f.g])]);
      e.style.cssText = `left:${f.x}%;top:${f.y}%;--r:${f.r}deg;--s:${f.s};--d:${f.d}s`;
      return e;
    });

    const hero = h('div', 'hero', [
      h('p', 'hero-eyebrow', ['ONLINE SHOGI']),
      h('h1', 'hero-title', [h('span', '', ['将']), h('span', '', ['棋'])]),
      h('p', 'hero-sub', ['美しい盤と、なめらかな駒さばき。']),
    ]);

    const cards = h('div', 'home-cards', [
      card(0, 'primary', '戦', 'オンライン対戦', 'ランダム / ワードで相手を探す', () => navigate('matching')),
      card(1, '', '二', 'ローカル対局', '1台でふたりで指す', openLocalSetup),
      card(2, '', '位', 'ランキング', 'レーティング順の一覧', () => navigate('ranking')),
    ]);

    const links = h('div', 'home-links');
    const how = h('button', 'link-btn', ['遊び方'], { type: 'button' });
    how.addEventListener('click', () => {
      sound.play('click');
      openHowTo();
    });
    links.append(how);

    this.root = h('div', 'screen home', [canvas, ...floaters, h('div', 'home-inner', [hero, cards, links])]);
  }

  start(): void {
    if (settings.value.motion === 'full') this.particles.startAmbient(26);
  }

  destroy(): void {
    this.particles.destroy();
  }
}
