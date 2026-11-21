// 効果音（Web Audio API で合成。音声ファイル不要）

import { settings } from '../state/settings.ts';

export type SoundName =
  | 'place'
  | 'capture'
  | 'select'
  | 'deselect'
  | 'promote'
  | 'win'
  | 'draw'
  | 'error'
  | 'click'
  | 'tick';

interface ToneOpts {
  freq: number;
  end?: number;
  at?: number;
  dur: number;
  type?: OscillatorType;
  gain: number;
  attack?: number;
}

class SoundManager {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private last = new Map<string, number>();

  private ensure(): AudioContext | null {
    if (!settings.value.sound) return null;
    if (!this.ctx) {
      const w = window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
      const AC = w.AudioContext ?? w.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      const len = Math.floor(this.ctx.sampleRate * 0.4);
      const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      this.noise = buf;
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
    if (this.master) this.master.gain.value = settings.value.volume;
    return this.ctx;
  }

  /** 最初のユーザー操作で呼んでおくと初回の音が遅れない */
  unlock(): void {
    this.ensure();
  }

  private tone(ctx: AudioContext, o: ToneOpts): void {
    const t0 = ctx.currentTime + (o.at ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.end) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.end), t0 + o.dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(o.gain, t0 + (o.attack ?? 0.004));
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g).connect(this.master as GainNode);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.05);
  }

  /** ノイズを帯域フィルタに通した「パチッ」という音 */
  private clack(ctx: AudioContext, freq: number, q: number, dur: number, gain: number, at = 0): void {
    const t0 = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    src.connect(f).connect(g).connect(this.master as GainNode);
    src.start(t0);
    src.stop(t0 + dur + 0.02);
  }

  play(name: SoundName): void {
    const now = performance.now();
    if (now - (this.last.get(name) ?? -1000) < 25) return;
    this.last.set(name, now);
    const ctx = this.ensure();
    if (!ctx) return;
    switch (name) {
      case 'place':
        this.clack(ctx, 2300, 1.1, 0.05, 0.9);
        this.clack(ctx, 900, 0.8, 0.07, 0.5);
        this.tone(ctx, { freq: 230, end: 110, dur: 0.1, gain: 0.45 });
        break;
      case 'capture':
        this.clack(ctx, 2000, 1, 0.06, 1);
        this.clack(ctx, 700, 0.8, 0.09, 0.7);
        this.tone(ctx, { freq: 190, end: 80, dur: 0.14, gain: 0.55 });
        this.clack(ctx, 1500, 1, 0.05, 0.6, 0.07);
        break;
      case 'select':
        this.tone(ctx, { freq: 880, end: 1250, dur: 0.06, gain: 0.1 });
        this.clack(ctx, 3600, 2, 0.02, 0.15);
        break;
      case 'deselect':
        this.tone(ctx, { freq: 700, end: 480, dur: 0.06, gain: 0.08 });
        break;
      case 'promote':
        [659.25, 830.61, 987.77, 1318.5].forEach((f, i) => {
          this.tone(ctx, { freq: f, dur: 0.55, type: 'triangle', gain: 0.17, at: i * 0.07 });
          this.tone(ctx, { freq: f * 2, dur: 0.4, gain: 0.05, at: i * 0.07 });
        });
        break;
      case 'win':
        [523.25, 587.33, 659.25, 783.99, 880, 1046.5, 1318.5].forEach((f, i) => {
          this.tone(ctx, { freq: f, dur: 0.7, type: 'triangle', gain: 0.18, at: i * 0.09 });
          this.tone(ctx, { freq: f * 2, dur: 0.45, gain: 0.04, at: i * 0.09 });
        });
        this.tone(ctx, { freq: 130.8, end: 65, dur: 0.5, gain: 0.7, at: 0.0 });
        break;
      case 'draw':
        this.tone(ctx, { freq: 523.25, dur: 0.6, type: 'triangle', gain: 0.15 });
        this.tone(ctx, { freq: 392, dur: 0.8, type: 'triangle', gain: 0.15, at: 0.18 });
        break;
      case 'error':
        this.tone(ctx, { freq: 240, end: 170, dur: 0.12, type: 'square', gain: 0.06 });
        this.tone(ctx, { freq: 200, end: 140, dur: 0.14, type: 'square', gain: 0.06, at: 0.1 });
        break;
      case 'click':
        this.tone(ctx, { freq: 660, end: 760, dur: 0.05, gain: 0.07 });
        break;
      case 'tick':
        this.clack(ctx, 1800 + Math.random() * 900, 1.4, 0.035, 0.4);
        this.tone(ctx, { freq: 260, end: 150, dur: 0.05, gain: 0.18 });
        break;
    }
  }
}

export const sound = new SoundManager();
