// ログイン / 新規登録 / アカウントのダイアログ

import { auth, errorText, validateDisplayName, validatePassword, validateUsername } from '../../online/api.ts';
import { h } from '../dom.ts';
import { openModal, toast } from '../dialogs.ts';
import { sound } from '../../audio/sound.ts';

type Tab = 'login' | 'signup';

/** ログイン / 新規登録。ログインできたら true、閉じたら false */
export function openAuth(initial: Tab = 'login'): Promise<boolean> {
  return new Promise((resolve) => {
    let tab: Tab = initial;
    let busy = false;
    let done = false;

    const username = h('input', 'input', [], {
      type: 'text',
      autocomplete: 'username',
      autocapitalize: 'none',
      spellcheck: 'false',
      maxlength: '16',
      placeholder: 'abc_123',
      'aria-label': 'ユーザー名',
    }) as HTMLInputElement;
    const display = h('input', 'input', [], {
      type: 'text',
      autocomplete: 'nickname',
      maxlength: '12',
      placeholder: '例: さくら',
      'aria-label': '表示名',
    }) as HTMLInputElement;
    const password = h('input', 'input', [], {
      type: 'password',
      autocomplete: 'current-password',
      maxlength: '72',
      'aria-label': 'パスワード',
    }) as HTMLInputElement;
    const error = h('p', 'form-error', [], { role: 'alert' });
    const submit = h('button', 'btn primary big', [], { type: 'submit' });
    const tabs = h('div', 'segmented');
    const tabBtns = new Map<Tab, HTMLButtonElement>();
    for (const [t, label] of [
      ['login', 'ログイン'],
      ['signup', '新規登録'],
    ] as const) {
      const b = h('button', 'seg', [label], { type: 'button' });
      b.addEventListener('click', () => {
        if (busy) return;
        tab = t;
        sound.play('select');
        render();
      });
      tabBtns.set(t, b);
      tabs.append(b);
    }

    const field = (label: string, input: HTMLElement, hint?: string): HTMLElement =>
      h('label', 'field', [h('span', 'field-label', [label]), input, hint ? h('small', 'field-hint', [hint]) : null]);

    const displayField = field('表示名', display, 'あとから変更できます（12文字まで）');
    const usernameHint = h('small', 'field-hint', []);
    const usernameField = h('label', 'field', [h('span', 'field-label', ['ユーザー名']), username, usernameHint]);
    const notice = h('p', 'auth-note', []);

    const form = h('form', 'auth-form', [usernameField, displayField, field('パスワード', password), error, submit, notice], {
      novalidate: '',
    });

    function render(): void {
      for (const [t, b] of tabBtns) b.classList.toggle('on', t === tab);
      const signup = tab === 'signup';
      displayField.style.display = signup ? '' : 'none';
      password.autocomplete = signup ? 'new-password' : 'current-password';
      usernameHint.textContent = signup ? '半角英数字と _ で3〜16文字。登録後は変更できません' : '';
      submit.textContent = signup ? '登録して始める' : 'ログイン';
      notice.textContent = signup
        ? 'メールアドレスは不要です。パスワードを忘れると復旧できないので、控えておいてください。'
        : '';
      error.textContent = '';
    }

    function setBusy(b: boolean): void {
      busy = b;
      submit.disabled = b;
      if (b) submit.textContent = '通信中…';
      else render();
    }

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (busy) return;
      error.textContent = '';
      const signup = tab === 'signup';
      const msg = signup
        ? (validateUsername(username.value) ?? validateDisplayName(display.value) ?? validatePassword(password.value))
        : null;
      if (msg) {
        error.textContent = msg;
        sound.play('error');
        return;
      }
      setBusy(true);
      const run = signup
        ? auth.signUp(username.value, password.value, display.value)
        : auth.signIn(username.value, password.value);
      void run
        .then(() => {
          done = true;
          sound.play('win');
          toast(signup ? '登録しました' : 'ログインしました');
          modal.close();
          resolve(true);
        })
        .catch((err) => {
          error.textContent = errorText(err);
          sound.play('error');
          setBusy(false);
        });
    });

    const modal = openModal({
      title: 'アカウント',
      body: h('div', '', [tabs, form]),
      onClose: () => {
        if (!done) resolve(false);
      },
    });
    render();
    username.focus();
  });
}

/** 自分のアカウント（表示名の変更・戦績・ログアウト） */
export function openAccount(): void {
  const p = auth.profile;
  if (!p) {
    void openAuth('login');
    return;
  }
  const name = h('input', 'input', [], { type: 'text', maxlength: '12', value: p.display_name, 'aria-label': '表示名' }) as HTMLInputElement;
  const error = h('p', 'form-error', [], { role: 'alert' });
  const save = h('button', 'btn primary', ['表示名を保存'], { type: 'button' });
  save.addEventListener('click', () => {
    error.textContent = '';
    const msg = validateDisplayName(name.value);
    if (msg) {
      error.textContent = msg;
      return;
    }
    save.disabled = true;
    void auth
      .setDisplayName(name.value)
      .then(() => {
        sound.play('click');
        toast('表示名を変更しました');
      })
      .catch((e) => {
        error.textContent = errorText(e);
      })
      .finally(() => {
        save.disabled = false;
      });
  });

  const total = p.wins + p.losses + p.draws;
  const stat = (label: string, value: string): HTMLElement =>
    h('div', 'acct-stat', [h('small', '', [label]), h('strong', '', [value])]);

  const body = h('div', 'acct', [
    h('div', 'acct-stats', [
      stat('レーティング', String(p.rating)),
      stat('戦績', `${p.wins}勝 ${p.losses}敗${p.draws ? ` ${p.draws}分` : ''}`),
      stat('勝率', total ? `${Math.round((p.wins / total) * 100)}%` : '—'),
      stat('連勝', p.streak > 0 ? `${p.streak}連勝` : '—'),
    ]),
    h('label', 'field', [h('span', 'field-label', ['ユーザー名（変更できません）']), h('input', 'input', [], { value: p.username, readonly: '', 'aria-label': 'ユーザー名' })]),
    h('label', 'field', [h('span', 'field-label', ['表示名']), name]),
    error,
    save,
  ]);

  const modal = openModal({
    title: 'アカウント',
    body,
    actions: [
      {
        label: 'ログアウト',
        variant: 'danger',
        onClick: () => {
          void auth.signOut().then(() => toast('ログアウトしました'));
        },
      },
      { label: '閉じる', variant: 'ghost' },
    ],
  });
  void modal;
  void auth.refresh();
}
