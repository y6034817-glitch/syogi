// モーダル・確認ダイアログ・トースト

import { h, iconButton, play } from './dom.ts';
import { sound } from '../audio/sound.ts';

export interface ModalAction {
  label: string;
  variant?: 'primary' | 'ghost' | 'danger';
  /** false を返すと閉じない */
  onClick?: () => boolean | void;
}

export interface ModalHandle {
  close(): void;
}

export interface ModalOptions {
  title: string;
  body: HTMLElement;
  actions?: ModalAction[];
  wide?: boolean;
  onClose?: () => void;
}

function host(): HTMLElement {
  let e = document.getElementById('modal-host');
  if (!e) {
    e = h('div', 'modal-host', [], { id: 'modal-host' });
    document.body.append(e);
  }
  return e;
}

export function openModal(opts: ModalOptions): ModalHandle {
  const backdrop = h('div', 'modal-backdrop');
  const card = h('div', `modal${opts.wide ? ' wide' : ''}`, [], { role: 'dialog', 'aria-modal': 'true', 'aria-label': opts.title });
  const closeBtn = iconButton('close', '閉じる', 'icon-btn modal-close');
  const head = h('div', 'modal-head', [h('h2', 'modal-title', [opts.title]), closeBtn]);
  const body = h('div', 'modal-body', [opts.body]);
  card.append(head, body);

  let closed = false;
  const prevFocus = document.activeElement as HTMLElement | null;

  const close = (): void => {
    if (closed) return;
    closed = true;
    document.removeEventListener('keydown', onKey);
    void Promise.all([
      play(card, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(0.96) translateY(8px)', opacity: 0 }], {
        duration: 160,
        easing: 'ease-in',
        fill: 'forwards',
      }),
      play(backdrop, [{ opacity: 1 }, { opacity: 0 }], { duration: 160, fill: 'forwards' }),
    ]).then(() => {
      backdrop.remove();
      prevFocus?.focus?.();
      opts.onClose?.();
    });
  };

  if (opts.actions?.length) {
    const foot = h('div', 'modal-actions');
    for (const a of opts.actions) {
      const b = h('button', `btn ${a.variant ?? 'ghost'}`, [a.label], { type: 'button' });
      b.addEventListener('click', () => {
        sound.play('click');
        if (a.onClick?.() !== false) close();
      });
      foot.append(b);
    }
    card.append(foot);
  }

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onKey);
  closeBtn.addEventListener('click', close);
  backdrop.addEventListener('pointerdown', (e) => {
    if (e.target === backdrop) close();
  });

  backdrop.append(card);
  host().append(backdrop);
  void play(backdrop, [{ opacity: 0 }, { opacity: 1 }], { duration: 180, fill: 'backwards' });
  void play(
    card,
    [
      { transform: 'scale(0.94) translateY(14px)', opacity: 0 },
      { transform: 'scale(1) translateY(0)', opacity: 1 },
    ],
    { duration: 260, easing: 'cubic-bezier(.2,.9,.25,1.1)', fill: 'backwards' },
  );
  (card.querySelector('.modal-actions .btn.primary, .modal-actions .btn') as HTMLElement | null)?.focus();
  return { close };
}

export function confirmDialog(title: string, message: string, confirmLabel: string, danger = false): Promise<boolean> {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v: boolean): void => {
      if (answered) return;
      answered = true;
      resolve(v);
    };
    openModal({
      title,
      body: h('p', 'modal-text', [message]),
      actions: [
        { label: 'キャンセル', variant: 'ghost', onClick: () => done(false) },
        { label: confirmLabel, variant: danger ? 'danger' : 'primary', onClick: () => done(true) },
      ],
      onClose: () => done(false),
    });
  });
}

let toastTimer = 0;
export function toast(message: string): void {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', 'toast', [], { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => el?.classList.remove('show'), 2200);
}
