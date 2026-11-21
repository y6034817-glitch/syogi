import { h } from '../dom.ts';
import { openModal } from '../dialogs.ts';
import { createPiece } from '../board.ts';
import type { PieceType } from '../../game/types.ts';
import { PIECE_LABEL } from '../../game/types.ts';

const MOVES: { t: PieceType; text: string }[] = [
  { t: 'OU', text: '全方向に1マス' },
  { t: 'HI', text: 'たて・よこに何マスでも' },
  { t: 'KA', text: 'ななめに何マスでも' },
  { t: 'KI', text: '前・横・後ろ、ななめ前に1マス' },
  { t: 'GI', text: 'ななめ4方向と、前に1マス' },
  { t: 'KE', text: '前に2、横に1（飛び越えられる）' },
  { t: 'KY', text: '前にだけ何マスでも' },
  { t: 'FU', text: '前に1マス' },
];

export function openHowTo(): void {
  const list = h('div', 'howto-pieces');
  for (const m of MOVES) {
    list.append(h('div', 'howto-piece', [createPiece(m.t, 'b', true), h('div', '', [h('strong', '', [PIECE_LABEL[m.t]]), h('small', '', [m.text])])]));
  }
  const body = h('div', 'howto', [
    h('section', '', [
      h('h3', '', ['操作のしかた']),
      h('ol', 'howto-steps', [
        h('li', '', ['自分の番になったら、「動かす」か「置く」を選びます（Qキー / Wキー）。']),
        h('li', '', ['「動かす」では、動かせる駒が光ります。駒を選ぶと動ける先が表示されます。']),
        h('li', '', ['「置く」では、持ち駒を置けるマスが光ります。マスを押して、置く駒を選びます。']),
        h('li', '', ['成れるときは「成る／成らない」を選びます。']),
      ]),
    ]),
    h('section', '', [h('h3', '', ['駒の動き']), list]),
    h('section', '', [
      h('h3', '', ['反則と勝敗']),
      h('ul', 'howto-rules', [
        h('li', '', ['二歩（同じ筋に歩を2枚）・行き所のない駒は指せません。']),
        h('li', '', ['王手・詰みのルールはありません。王手されても自由に指せます。']),
        h('li', '', ['相手の王将を取ったら勝ちです。同じ局面が4回になると千日手（引き分け）です。']),
      ]),
    ]),
  ]);
  openModal({ title: '遊び方', body, wide: true, actions: [{ label: '閉じる', variant: 'primary' }] });
}
