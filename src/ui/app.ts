// アプリの外枠（ナビゲーション・画面遷移）

import { h, iconButton, play, sleep } from './dom.ts';
import { settings } from '../state/settings.ts';
import { sound } from '../audio/sound.ts';
import { openSettings } from './screens/settings.ts';
import type { GameOptions } from './screens/game.ts';
import { auth } from '../online/api.ts';
import { openAccount, openAuth } from './screens/auth.ts';
import { checkResume } from './resume.ts';

export interface Screen {
  root: HTMLElement;
  start?(): void | Promise<void>;
  destroy(): void;
}

export type Route = 'home' | 'matching' | 'ranking' | 'game';

export interface RouteParams {
  game: GameOptions;
}

const TABS: { route: Exclude<Route, 'game'>; label: string; icon: string }[] = [
  { route: 'home', label: 'ホーム', icon: '<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/>' },
  {
    route: 'matching',
    label: 'マッチング',
    icon: '<circle cx="8" cy="9" r="3"/><circle cx="16" cy="9" r="3"/><path d="M3 19c0-3 2.5-5 5-5s5 2 5 5M11 19c0-3 2.5-5 5-5s5 2 5 5"/>',
  },
  {
    route: 'ranking',
    label: 'ランキング',
    icon: '<path d="M7 20V11M12 20V5M17 20v-6"/><path d="M4 20h16"/>',
  },
];

let shell: HTMLElement;
let content: HTMLElement;
let nav: HTMLElement;
let indicator: HTMLElement;
let curtain: HTMLElement;
let tabEls = new Map<string, HTMLAnchorElement>();
let current: Screen | null = null;
let currentRoute: Route | null = null;
let busy = false;

export function mountApp(host: HTMLElement): void {
  settings.apply();

  curtain = h('div', 'curtain');
  content = h('main', 'content');
  indicator = h('span', 'tab-indicator');

  const tabs = h('div', 'tabs', [indicator]);
  for (const t of TABS) {
    const a = h('a', 'tab', [], { href: `#/${t.route}`, 'data-route': t.route });
    a.innerHTML = `<svg class="icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${t.icon}</svg><span>${t.label}</span>`;
    a.addEventListener('click', (e) => {
      e.preventDefault();
      sound.play('click');
      navigate(t.route);
    });
    tabEls.set(t.route, a);
    tabs.append(a);
  }

  const soundBtn = iconButton(settings.value.sound ? 'soundOn' : 'soundOff', '効果音の切り替え');
  soundBtn.addEventListener('click', () => {
    settings.set({ sound: !settings.value.sound });
    sound.unlock();
    sound.play('click');
  });
  settings.subscribe((s) => {
    soundBtn.innerHTML = iconButton(s.sound ? 'soundOn' : 'soundOff', '').innerHTML;
  });
  const settingsBtn = iconButton('settings', '設定');
  settingsBtn.addEventListener('click', () => {
    sound.play('click');
    openSettings();
  });

  const brand = h('a', 'brand', [h('span', 'brand-mark', ['☗']), h('span', 'brand-name', ['将棋', h('small', '', ['ONLINE'])])], {
    href: '#/home',
  });
  brand.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('home');
  });

  const acct = h('button', 'acct-chip', [], { type: 'button' });
  const renderAcct = (): void => {
    const p = auth.profile;
    acct.replaceChildren(
      ...(p
        ? [h('i', 'avatar', [p.display_name.slice(-1)]), h('span', 'acct-name', [p.display_name]), h('b', 'acct-rate', [String(p.rating)])]
        : [h('span', 'acct-name', ['ログイン'])]),
    );
    acct.classList.toggle('in', !!p);
    acct.setAttribute('aria-label', p ? 'アカウント' : 'ログイン');
  };
  acct.addEventListener('click', () => {
    sound.play('click');
    if (auth.profile) openAccount();
    else void openAuth('login').then((ok) => ok && void checkResume(inGame));
  });
  renderAcct();
  let wasIn = false;
  auth.subscribe((p) => {
    renderAcct();
    if (p && !wasIn) void checkResume(inGame);
    wasIn = !!p;
  });
  void auth.init();

  nav = h('header', 'topbar', [brand, tabs, h('div', 'topbar-actions', [acct, soundBtn, settingsBtn])]);
  shell = h('div', 'app', [nav, content, curtain]);
  host.replaceChildren(shell);

  // 最初のユーザー操作で音を使えるようにする
  window.addEventListener('pointerdown', () => sound.unlock(), { once: true });
  window.addEventListener('resize', () => moveIndicator(false));
  window.addEventListener('hashchange', () => {
    const r = routeFromHash();
    if (r && r !== currentRoute && r !== 'game') navigate(r, undefined, false);
  });

  const first = routeFromHash();
  navigate(first && first !== 'game' ? first : 'home', undefined, false, true);
}

const inGame = (): boolean => currentRoute === 'game' || busy;

function routeFromHash(): Route | null {
  const m = location.hash.match(/^#\/(home|matching|ranking|game)$/);
  return m ? (m[1] as Route) : null;
}

function moveIndicator(animate: boolean): void {
  const el = currentRoute ? tabEls.get(currentRoute) : undefined;
  if (!el) {
    indicator.style.opacity = '0';
    return;
  }
  indicator.style.opacity = '1';
  indicator.style.transition = animate && settings.value.motion === 'full' ? '' : 'none';
  indicator.style.width = `${el.offsetWidth}px`;
  indicator.style.transform = `translateX(${el.offsetLeft}px)`;
  for (const [r, a] of tabEls) a.classList.toggle('active', r === currentRoute);
}

async function create(route: Route, params?: unknown): Promise<Screen> {
  switch (route) {
    case 'home': {
      const { HomeScreen } = await import('./screens/home.ts');
      return new HomeScreen();
    }
    case 'matching': {
      const { MatchingScreen } = await import('./screens/matching.ts');
      return new MatchingScreen();
    }
    case 'ranking': {
      const { RankingScreen } = await import('./screens/ranking.ts');
      return new RankingScreen();
    }
    case 'game': {
      const { GameScreen } = await import('./screens/game.ts');
      return new GameScreen(params as GameOptions);
    }
  }
}

export function navigate<R extends Route>(
  route: R,
  params?: R extends 'game' ? RouteParams['game'] : undefined,
  pushHash = true,
  instant = false,
): void {
  void go(route, params, pushHash, instant);
}

async function go(route: Route, params: unknown, pushHash: boolean, instant: boolean): Promise<void> {
  if (busy) return;
  if (route === currentRoute && route !== 'game') return;
  busy = true;
  const animated = !instant && settings.value.motion === 'full';
  const toGame = route === 'game';
  try {
    // 暗幕を左から右へ閉じる
    if (animated) {
      curtain.dataset.kind = toGame ? 'game' : 'page';
      await play(curtain, [{ transform: 'translateX(-101%)' }, { transform: 'translateX(0)' }], {
        duration: 340,
        easing: 'cubic-bezier(.7,0,.3,1)',
        fill: 'forwards',
      });
    }
    current?.destroy();
    current = null;
    content.replaceChildren();
    document.body.classList.toggle('in-game', toGame);
    const screen = await create(route, params);
    current = screen;
    currentRoute = route;
    content.append(screen.root);
    if (pushHash && !toGame && location.hash !== `#/${route}`) history.replaceState(null, '', `#/${route}`);
    if (toGame) history.replaceState(null, '', '#/game');
    moveIndicator(!instant);
    // 暗幕を開ける
    if (animated) {
      await sleep(40);
      await play(curtain, [{ transform: 'translateX(0)' }, { transform: 'translateX(101%)' }], {
        duration: 420,
        easing: 'cubic-bezier(.7,0,.3,1)',
        fill: 'forwards',
      });
      curtain.getAnimations().forEach((a) => a.cancel());
      curtain.style.transform = 'translateX(-101%)';
    }
    busy = false;
    await screen.start?.();
  } finally {
    busy = false;
  }
}
