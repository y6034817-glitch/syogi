// 持ち時間 + 秒読みの対局時計（ローカル対戦用）。経過は performance.now() で計算する。

import type { Color } from './types.ts';

export interface TimePreset {
  id: string;
  label: string;
  desc: string;
  /** 持ち時間（秒）。main と byo がどちらも 0 なら無制限 */
  mainSec: number;
  /** 秒読み（秒） */
  byoSec: number;
}

export const PRESETS: TimePreset[] = [
  { id: 'none', label: '無制限', desc: '時間を気にせず、じっくり指す', mainSec: 0, byoSec: 0 },
  { id: 'standard', label: '10分 + 秒読み30秒', desc: 'ゆったり標準', mainSec: 600, byoSec: 30 },
  { id: 'rapid', label: '5分 + 秒読み10秒', desc: 'サクッと一局', mainSec: 300, byoSec: 10 },
  { id: 'blitz', label: '1分 + 秒読み10秒', desc: '早指しで勝負', mainSec: 60, byoSec: 10 },
];

export interface ClockSnapshot {
  main: Record<Color, number>;
  byo: Record<Color, number>;
  running: Color | null;
}

export class Clock {
  readonly unlimited: boolean;
  private byoMs: number;
  main: Record<Color, number>;
  byo: Record<Color, number>;
  running: Color | null = null;
  private lastTick = 0;
  private timer = 0;
  onTick: () => void = () => {};
  onTimeout: (loser: Color) => void = () => {};

  constructor(preset: TimePreset) {
    this.unlimited = preset.mainSec === 0 && preset.byoSec === 0;
    this.byoMs = preset.byoSec * 1000;
    this.main = { b: preset.mainSec * 1000, w: preset.mainSec * 1000 };
    this.byo = { b: this.byoMs, w: this.byoMs };
  }

  /** 秒読みに入っているか */
  inByoyomi(c: Color): boolean {
    return !this.unlimited && this.main[c] <= 0;
  }

  start(c: Color): void {
    this.running = c;
    this.lastTick = performance.now();
    if (!this.unlimited && !this.timer) this.timer = window.setInterval(() => this.tick(), 100);
    this.onTick();
  }

  /** サーバーの持ち時間に合わせる（オンライン対戦。受け取るたびに呼ぶ） */
  syncServer(leftMain: Record<Color, number>, turn: Color, elapsedMs: number, byoMs: number): void {
    this.byoMs = byoMs;
    const idle: Color = turn === 'b' ? 'w' : 'b';
    this.main[idle] = leftMain[idle];
    this.byo[idle] = byoMs;
    let main = leftMain[turn];
    let byo = byoMs;
    if (elapsedMs <= main) main -= elapsedMs;
    else {
      byo -= elapsedMs - main;
      main = 0;
    }
    this.main[turn] = main;
    this.byo[turn] = byo;
    this.running = turn;
    this.lastTick = performance.now();
    if (!this.unlimited && !this.timer) this.timer = window.setInterval(() => this.tick(), 100);
    this.onTick();
  }

  /** 着手後: 手番を相手に移す */
  switchTo(next: Color): void {
    if (this.unlimited) {
      this.running = next;
      return;
    }
    this.tick();
    if (!this.running) return; // 直前の tick で時間切れになった
    this.byo[this.running] = this.byoMs;
    this.running = next;
    this.lastTick = performance.now();
    this.onTick();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = 0;
    }
    if (!this.unlimited && this.running) this.tickOnce();
    this.running = null;
  }

  snapshot(): ClockSnapshot {
    return { main: { ...this.main }, byo: { ...this.byo }, running: this.running };
  }

  restore(s: ClockSnapshot): void {
    this.main = { ...s.main };
    this.byo = { ...s.byo };
    if (s.running) this.start(s.running);
    else this.onTick();
  }

  private tickOnce(): void {
    const now = performance.now();
    const dt = now - this.lastTick;
    this.lastTick = now;
    const c = this.running;
    if (!c) return;
    if (this.main[c] > 0) {
      this.main[c] -= dt;
      if (this.main[c] < 0) {
        this.byo[c] += this.main[c];
        this.main[c] = 0;
      }
    } else {
      this.byo[c] -= dt;
    }
  }

  private tick(): void {
    const c = this.running;
    if (!c || this.unlimited) return;
    this.tickOnce();
    this.onTick();
    if (this.main[c] <= 0 && this.byo[c] <= 0) {
      this.stop();
      this.onTimeout(c);
    }
  }

  /** 表示用の文字列 */
  display(c: Color): { text: string; byo: boolean; low: boolean } {
    if (this.unlimited) return { text: '∞', byo: false, low: false };
    if (this.main[c] > 0) {
      const s = Math.ceil(this.main[c] / 1000);
      const m = Math.floor(s / 60);
      return { text: `${m}:${String(s % 60).padStart(2, '0')}`, byo: false, low: false };
    }
    const s = Math.max(0, Math.ceil(this.byo[c] / 1000));
    return { text: `${s}`, byo: true, low: s <= 10 };
  }
}
