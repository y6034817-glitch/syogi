// 設定（localStorage に保存）

export type Theme = 'dark' | 'light';
export type Motion = 'full' | 'reduced';

export interface Settings {
  theme: Theme;
  sound: boolean;
  volume: number;
  motion: Motion;
  /** 合法手のハイライト */
  hints: boolean;
  /** 盤の座標表示 */
  coords: boolean;
}

const KEY = 'shogi-online:settings:v1';

function load(): Settings {
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  const base: Settings = {
    theme: 'dark',
    sound: true,
    volume: 0.7,
    motion: reduce ? 'reduced' : 'full',
    hints: true,
    coords: true,
  };
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...base, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    /* 無視 */
  }
  return base;
}

type Listener = (s: Settings) => void;

class SettingsStore {
  value: Settings = load();
  private listeners = new Set<Listener>();

  set(patch: Partial<Settings>): void {
    this.value = { ...this.value, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.value));
    } catch {
      /* 無視 */
    }
    this.apply();
    this.listeners.forEach((f) => f(this.value));
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  /** <html> に反映（テーマなどは CSS 側で参照） */
  apply(): void {
    const r = document.documentElement;
    r.dataset.theme = this.value.theme;
    r.dataset.motion = this.value.motion;
    r.dataset.coords = this.value.coords ? 'on' : 'off';
  }
}

export const settings = new SettingsStore();
