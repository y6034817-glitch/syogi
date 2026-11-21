// 桜の花びら（メニュー背景）と紙吹雪（勝利演出）を描く Canvas パーティクル

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  size: number;
  color: string;
  kind: 'petal' | 'confetti';
  phase: number;
  gravity: number;
  drag: number;
  born: number;
}

const PETAL_COLORS = ['#ffb7c5', '#ff9fb5', '#ffd1dc', '#ffc4d0'];
const CONFETTI_COLORS = ['#f5c451', '#e5484d', '#ffffff', '#ffb7c5', '#6f7dff', '#f08a3c'];

function rand(a: number, b: number): number {
  return a + Math.random() * (b - a);
}

export class ParticleField {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private parts: Particle[] = [];
  private raf = 0;
  private last = 0;
  private w = 0;
  private h = 0;
  private dpr = 1;
  private ambientTarget = 0;
  private streamUntil = 0;
  private resizeObserver: ResizeObserver | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D を利用できません');
    this.ctx = ctx;
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => this.resize());
      this.resizeObserver.observe(canvas);
    }
  }

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, r.width);
    this.h = Math.max(1, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  /** 花びらを常時ゆっくり降らせる */
  startAmbient(count: number): void {
    this.ambientTarget = count;
    for (let i = this.parts.length; i < count; i++) this.parts.push(this.makePetal(true));
    this.kick();
  }

  /** 紙吹雪を一斉に打ち上げ、しばらく降らせる */
  celebrate(durationMs = 3800): void {
    const now = performance.now();
    this.streamUntil = now + durationMs;
    for (let i = 0; i < 70; i++) {
      const left = i % 2 === 0;
      const p = this.makeConfetti();
      p.x = left ? -10 : this.w + 10;
      p.y = this.h * rand(0.75, 1);
      const power = rand(500, 1100);
      const ang = (left ? rand(-80, -50) : rand(-130, -100)) * (Math.PI / 180);
      p.vx = Math.cos(ang) * power;
      p.vy = Math.sin(ang) * power;
      p.gravity = 900;
      p.drag = 0.6;
      this.parts.push(p);
    }
    this.kick();
  }

  stop(clear = true): void {
    this.ambientTarget = 0;
    this.streamUntil = 0;
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    if (clear) {
      this.parts = [];
      this.ctx.setTransform(1, 0, 0, 1, 0, 0);
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    }
  }

  destroy(): void {
    this.stop();
    this.resizeObserver?.disconnect();
  }

  private kick(): void {
    if (this.raf) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  private makePetal(anywhere: boolean): Particle {
    return {
      x: rand(0, this.w),
      y: anywhere ? rand(-20, this.h) : rand(-40, -10),
      vx: rand(-14, 10),
      vy: rand(26, 58),
      rot: rand(0, Math.PI * 2),
      vr: rand(-1.4, 1.4),
      size: rand(5, 10),
      color: PETAL_COLORS[(Math.random() * PETAL_COLORS.length) | 0],
      kind: 'petal',
      phase: rand(0, Math.PI * 2),
      gravity: 0,
      drag: 0,
      born: performance.now(),
    };
  }

  private makeConfetti(): Particle {
    return {
      x: rand(0, this.w),
      y: rand(-30, -5),
      vx: rand(-60, 60),
      vy: rand(60, 220),
      rot: rand(0, Math.PI * 2),
      vr: rand(-6, 6),
      size: rand(5, 9),
      color: CONFETTI_COLORS[(Math.random() * CONFETTI_COLORS.length) | 0],
      kind: Math.random() < 0.3 ? 'petal' : 'confetti',
      phase: rand(0, Math.PI * 2),
      gravity: 140,
      drag: 0.8,
      born: performance.now(),
    };
  }

  private loop(t: number): void {
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const ctx = this.ctx;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, this.w, this.h);

    // 紙吹雪を上から追加
    if (t < this.streamUntil) {
      const n = Math.ceil(120 * dt);
      for (let i = 0; i < n; i++) this.parts.push(this.makeConfetti());
    }

    const alive: Particle[] = [];
    for (const p of this.parts) {
      p.phase += dt * 2;
      if (p.kind === 'petal' && p.gravity === 0) {
        p.x += (p.vx + Math.sin(p.phase) * 26) * dt;
        p.y += p.vy * dt;
      } else {
        p.vx -= p.vx * p.drag * dt;
        p.vy += p.gravity * dt;
        p.vy -= p.vy * p.drag * dt * (p.vy > 0 ? 1.6 : 0.4);
        p.x += (p.vx + Math.sin(p.phase) * 18) * dt;
        p.y += p.vy * dt;
      }
      p.rot += p.vr * dt;

      const out = p.y > this.h + 30 || p.x < -60 || p.x > this.w + 60;
      if (out) {
        // 常時モードの花びらは上に戻す
        if (p.gravity === 0 && this.ambientTarget > 0) {
          const np = this.makePetal(false);
          Object.assign(p, np);
          alive.push(p);
        }
        continue;
      }
      this.draw(ctx, p);
      alive.push(p);
    }
    this.parts = alive;

    const active = this.ambientTarget > 0 || t < this.streamUntil || this.parts.length > 0;
    if (active) this.raf = requestAnimationFrame((tt) => this.loop(tt));
    else {
      this.raf = 0;
      ctx.clearRect(0, 0, this.w, this.h);
    }
  }

  private draw(ctx: CanvasRenderingContext2D, p: Particle): void {
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(p.rot);
    ctx.fillStyle = p.color;
    if (p.kind === 'petal') {
      const s = p.size;
      ctx.globalAlpha = 0.85;
      ctx.scale(1, 0.7 + 0.3 * Math.cos(p.phase * 1.3));
      ctx.beginPath();
      ctx.moveTo(0, -s);
      ctx.bezierCurveTo(s * 0.95, -s * 0.7, s * 0.8, s * 0.6, 0, s);
      ctx.bezierCurveTo(-s * 0.8, s * 0.6, -s * 0.95, -s * 0.7, 0, -s);
      ctx.fill();
    } else {
      const s = p.size;
      ctx.scale(1, Math.cos(p.phase * 2.2));
      ctx.fillRect(-s / 2, -s * 0.35, s, s * 0.7);
    }
    ctx.restore();
  }
}
