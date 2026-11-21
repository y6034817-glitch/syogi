import { settings } from '../state/settings.ts';

type Child = Node | string | null | undefined | false;

/** 要素を作る小さなヘルパー */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  cls = '',
  children: Child[] = [],
  attrs: Record<string, string> = {},
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  for (const c of children) if (c) e.append(c);
  return e;
}

const ICONS = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  first: '<path d="M18 5l-7 7 7 7M7 5v14"/>',
  prev: '<path d="M15 5l-7 7 7 7"/>',
  next: '<path d="M9 5l7 7-7 7"/>',
  last: '<path d="M6 5l7 7-7 7M17 5v14"/>',
  undo: '<path d="M9 14L4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 0 12h-3"/>',
  flip: '<path d="M7 4v16M7 4L4 7M7 4l3 3M17 20V4M17 20l-3-3M17 20l3-3"/>',
  flag: '<path d="M5 21V4M5 4h12l-2.5 4.5L17 13H5"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/>',
  settings: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  soundOn: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>',
  soundOff: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 9l5 6M22 9l-5 6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  again: '<path d="M4 12a8 8 0 1 0 3-6.2"/><path d="M4 4v5h5"/>',
  home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/>',
} as const;

export type IconName = keyof typeof ICONS;

export function iconSvg(name: IconName): string {
  return `<svg class="icon" viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

export function iconButton(name: IconName, label: string, cls = 'icon-btn'): HTMLButtonElement {
  const b = h('button', cls, [], { type: 'button', 'aria-label': label, title: label });
  b.innerHTML = iconSvg(name);
  return b;
}

/** 演出の速さ係数（控えめ設定では短くする） */
export function motionScale(): number {
  return settings.value.motion === 'reduced' ? 0.4 : 1;
}

export function fullMotion(): boolean {
  return settings.value.motion === 'full';
}

/** Web Animations API の薄いラッパー。終了まで待つ */
export async function play(el: Element, keyframes: Keyframe[], opts: KeyframeAnimationOptions): Promise<void> {
  const k = motionScale();
  const a = el.animate(keyframes, {
    ...opts,
    duration: Number(opts.duration ?? 300) * k,
    delay: Number(opts.delay ?? 0) * k,
  });
  try {
    await a.finished;
  } catch {
    /* キャンセルされた */
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** 演出の速さ係数を掛けて待つ */
export function wait(ms: number): Promise<void> {
  return sleep(ms * motionScale());
}
