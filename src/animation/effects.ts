// 盤上の演出（衝撃波・火花・画面揺れ・バナー・ビネット）

import { fullMotion, play } from '../ui/dom.ts';
import { h } from '../ui/dom.ts';

/** マス(display座標)を中心に、層の何%の位置かを返す */
function cellStyle(x: number, y: number): string {
  return `left:${(x / 9) * 100}%;top:${(y / 9) * 100}%;`;
}

/** 着地の衝撃波 */
export function ring(layer: HTMLElement, x: number, y: number, kind: 'normal' | 'gold' | 'red' = 'normal'): void {
  if (!fullMotion()) return;
  const el = h('div', `fx-ring fx-${kind}`);
  el.style.cssText = cellStyle(x, y);
  layer.append(el);
  void play(
    el,
    [
      { transform: 'scale(0.35)', opacity: 0.95 },
      { transform: 'scale(2.3)', opacity: 0 },
    ],
    { duration: 520, easing: 'cubic-bezier(.15,.7,.3,1)' },
  ).then(() => el.remove());
}

/** 火花（取る・成る時） */
export function sparks(
  layer: HTMLElement,
  x: number,
  y: number,
  kind: 'normal' | 'gold' | 'red' = 'normal',
  count = 9,
): void {
  if (!fullMotion()) return;
  for (let i = 0; i < count; i++) {
    const el = h('div', `fx-spark fx-${kind}`, [h('i')]);
    el.style.cssText = cellStyle(x, y);
    layer.append(el);
    const ang = (i / count) * Math.PI * 2 + Math.random() * 0.6;
    const dist = 90 + Math.random() * 130;
    const dx = Math.cos(ang) * dist;
    const dy = Math.sin(ang) * dist;
    void play(
      el,
      [
        { transform: 'translate(0,0) scale(1)', opacity: 1 },
        { transform: `translate(${dx}%, ${dy}%) scale(0.2)`, opacity: 0 },
      ],
      { duration: 460 + Math.random() * 240, easing: 'cubic-bezier(.1,.8,.3,1)' },
    ).then(() => el.remove());
  }
}

/** 盤を軽く揺らす */
export function shake(el: HTMLElement, strong = false): void {
  if (!fullMotion()) return;
  const a = strong ? 1.1 : 0.6;
  void play(
    el,
    [
      { transform: 'translate(0,0)' },
      { transform: `translate(${-a}%, ${a * 0.5}%)` },
      { transform: `translate(${a}%, ${-a * 0.4}%)` },
      { transform: `translate(${-a * 0.5}%, ${a * 0.3}%)` },
      { transform: 'translate(0,0)' },
    ],
    { duration: strong ? 320 : 220, easing: 'ease-out' },
  );
}

export type BannerKind = 'check' | 'start' | 'promote';

/** 「王手」などの大きな文字演出 */
export async function banner(host: HTMLElement, text: string, kind: BannerKind, hold = 620): Promise<void> {
  const el = h('div', `banner banner-${kind}`, [h('span', 'banner-text', [text]), h('span', 'banner-band')]);
  host.append(el);
  const text$ = el.querySelector('.banner-text') as HTMLElement;
  const band = el.querySelector('.banner-band') as HTMLElement;
  void play(
    band,
    [
      { transform: 'scaleX(0)', opacity: 0 },
      { transform: 'scaleX(1)', opacity: 1 },
    ],
    { duration: 240, easing: 'cubic-bezier(.2,.9,.2,1)', fill: 'forwards' },
  );
  await play(
    text$,
    [
      { transform: 'scale(2.6)', opacity: 0, filter: 'blur(10px)' },
      { transform: 'scale(0.94)', opacity: 1, filter: 'blur(0)', offset: 0.7 },
      { transform: 'scale(1)', opacity: 1, filter: 'blur(0)' },
    ],
    { duration: 340, easing: 'cubic-bezier(.2,.9,.2,1)', fill: 'forwards' },
  );
  await new Promise<void>((r) => setTimeout(r, hold * (fullMotion() ? 1 : 0.4)));
  await Promise.all([
    play(
      text$,
      [
        { transform: 'scale(1)', opacity: 1, filter: 'blur(0)' },
        { transform: 'scale(1.25)', opacity: 0, filter: 'blur(6px)' },
      ],
      { duration: 280, easing: 'ease-in', fill: 'forwards' },
    ),
    play(band, [{ opacity: 1 }, { opacity: 0 }], { duration: 280, fill: 'forwards' }),
  ]);
  el.remove();
}

/** 王手時の赤い縁取り */
export function vignette(host: HTMLElement, kind: 'red' | 'gold' = 'red'): void {
  const el = h('div', `vignette vignette-${kind}`);
  host.append(el);
  void play(el, [{ opacity: 0 }, { opacity: 1, offset: 0.25 }, { opacity: 0 }], { duration: 1100, easing: 'ease-out' }).then(
    () => el.remove(),
  );
}
