// ランキング画面（Supabase の ranking_top を表示）

import { h } from '../dom.ts';
import { errorText, rpc } from '../../online/api.ts';
import type { Screen } from '../app.ts';

interface Row {
  rank: number;
  display_name: string;
  rating: number;
  wins: number;
  losses: number;
  draws: number;
  streak: number;
  is_me: boolean;
}

const rate = (e: Row): string => {
  const t = e.wins + e.losses + e.draws;
  return t ? `${Math.round((e.wins / t) * 100)}%` : '—';
};

export class RankingScreen implements Screen {
  readonly root: HTMLElement;
  private disposed = false;
  private list = h('div', 'rank-list');
  private podium = h('div', 'podium');

  constructor() {
    this.root = h('div', 'screen ranking', [
      h('div', 'page', [
        h('header', 'page-head', [h('h1', '', ['ランキング']), h('p', '', ['レーティング順。対局が終わるたびに更新されます。'])]),
        this.podium,
        h('div', 'panel rank-panel', [
          h('div', 'rank-head', [h('span', '', ['順位']), h('span', '', ['プレイヤー']), h('span', 'num', ['レート']), h('span', 'num hide-s', ['勝-敗']), h('span', 'num hide-s', ['勝率']), h('span', 'num', ['連勝'])]),
          this.list,
        ]),
      ]),
    ]);
    this.load();
  }

  private load(): void {
    this.podium.replaceChildren();
    this.list.replaceChildren(h('div', 'empty', ['読み込み中…']));
    void rpc<Row[]>('ranking_top', { p_limit: 50 })
      .then((rows) => {
        if (!this.disposed) this.show(rows ?? []);
      })
      .catch((e) => {
        if (this.disposed) return;
        const retry = h('button', 'btn ghost', ['再読み込み'], { type: 'button' });
        retry.addEventListener('click', () => this.load());
        this.list.replaceChildren(h('div', 'empty', [errorText(e), h('div', '', [retry])]));
      });
  }

  private show(rows: Row[]): void {
    this.list.replaceChildren();
    if (!rows.length) {
      this.list.append(h('div', 'empty', ['まだランキングデータがありません。対局するとここに載ります。']));
      return;
    }
    const medal = ['gold', 'silver', 'bronze'];
    if (rows.length >= 3) {
      rows.slice(0, 3).forEach((e, i) => {
        const el = h('div', `pod ${medal[i]}`, [h('span', 'pod-rank', [String(e.rank)]), h('strong', '', [e.display_name]), h('span', 'pod-rate', [String(e.rating)])]);
        el.style.setProperty('--i', String(i));
        this.podium.append(el);
      });
      this.podium.insertBefore(this.podium.children[1], this.podium.children[0]);
    }
    rows.forEach((e, i) => {
      const row = h('div', `rank-row${e.is_me ? ' me' : ''}`, [
        h('span', `rk${e.rank <= 3 ? ' top' : ''}`, [String(e.rank)]),
        h('span', 'who', [h('i', 'avatar', [e.display_name.slice(-1)]), h('strong', '', [e.display_name]), e.is_me ? h('small', 'me-tag', ['あなた']) : null]),
        h('span', 'num rt', [String(e.rating)]),
        h('span', 'num hide-s', [`${e.wins}-${e.losses}`]),
        h('span', 'num hide-s', [rate(e)]),
        h('span', `num${e.streak >= 3 ? ' hot' : ''}`, [e.streak > 0 ? `${e.streak}連勝` : '—']),
      ]);
      row.style.setProperty('--i', String(i));
      this.list.append(row);
    });
  }

  destroy(): void {
    this.disposed = true;
  }
}
