import { h } from '../dom.ts';
import { openModal } from '../dialogs.ts';
import { settings } from '../../state/settings.ts';
import { sound } from '../../audio/sound.ts';

function toggleRow(label: string, desc: string, get: () => boolean, set: (v: boolean) => void): HTMLElement {
  const input = h('input', '', [], { type: 'checkbox', role: 'switch' }) as HTMLInputElement;
  input.checked = get();
  input.addEventListener('change', () => {
    set(input.checked);
    sound.play('click');
  });
  return h('label', 'setting-row', [
    h('span', 'setting-text', [h('strong', '', [label]), h('small', '', [desc])]),
    h('span', 'switch', [input, h('i')]),
  ]);
}

export function openSettings(): void {
  const s = settings.value;
  const body = h('div', 'settings');

  const themeSeg = h('div', 'segmented', [], { role: 'radiogroup', 'aria-label': 'テーマ' });
  for (const [v, label] of [
    ['dark', 'ダーク'],
    ['light', 'ライト'],
  ] as const) {
    const b = h('button', `seg${s.theme === v ? ' on' : ''}`, [label], { type: 'button', role: 'radio', 'aria-checked': String(s.theme === v) });
    b.addEventListener('click', () => {
      settings.set({ theme: v });
      themeSeg.querySelectorAll('.seg').forEach((e) => {
        const on = e === b;
        e.classList.toggle('on', on);
        e.setAttribute('aria-checked', String(on));
      });
      sound.play('click');
    });
    themeSeg.append(b);
  }

  const vol = h('input', 'range', [], { type: 'range', min: '0', max: '100', step: '5', 'aria-label': '音量' }) as HTMLInputElement;
  vol.value = String(Math.round(s.volume * 100));
  vol.addEventListener('input', () => settings.set({ volume: Number(vol.value) / 100 }));
  vol.addEventListener('change', () => sound.play('place'));

  body.append(
    h('div', 'setting-row column', [h('span', 'setting-text', [h('strong', '', ['テーマ'])]), themeSeg]),
    toggleRow('効果音', '駒音や演出の音を鳴らします', () => settings.value.sound, (v) => settings.set({ sound: v })),
    h('div', 'setting-row column', [h('span', 'setting-text', [h('strong', '', ['音量'])]), vol]),
    toggleRow(
      'アニメーションを控えめにする',
      '画面の揺れや大きな演出を減らします',
      () => settings.value.motion === 'reduced',
      (v) => settings.set({ motion: v ? 'reduced' : 'full' }),
    ),
    toggleRow('移動先のヒント', '選んだ駒の動ける先を光らせます', () => settings.value.hints, (v) => settings.set({ hints: v })),
    toggleRow('盤の座標', '筋と段の数字を表示します', () => settings.value.coords, (v) => settings.set({ coords: v })),
  );

  openModal({ title: '設定', body, actions: [{ label: '閉じる', variant: 'primary' }] });
}
