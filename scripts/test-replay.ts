// サーバー側の手の検証（validateMove）のテスト: `npm run test:replay`

import { validateMove } from '../src/game/replay.ts';

let failed = 0;
let passed = 0;
function check(name: string, cond: boolean, detail = ''): void {
  if (cond) {
    passed++;
    console.log(`  ok   ${name}`);
  } else {
    failed++;
    console.log(`  FAIL ${name} ${detail}`);
  }
}

console.log('validateMove');
{
  const v = validateMove([], '7g7f');
  check('初手 7g7f は合法・継続', v.ok && v.result === null);
  check('動けない手(7g7e)は不正', JSON.stringify(validateMove([], '7g7e')) === JSON.stringify({ ok: false, reason: 'illegal' }));
  check('相手の駒は動かせない(3c3d)', !validateMove([], '3c3d').ok);
  check('成り指定が不正(7g7f+ は成れない)', !validateMove([], '7g7f+').ok);
  check('持ち駒が無いのに打つ(P*5e)', !validateMove([], 'P*5e').ok);
  check('でたらめな文字列', !validateMove([], 'zzzz').ok);
}
{
  const hist = ['7g7f', '3c3d', '8h2b+'];
  const v = validateMove(hist, '3a2b');
  check('履歴を再生して同銀は合法', v.ok && v.result === null);
  const bad = validateMove(['7g7f', '7g7f'], '3c3d');
  check('不正な履歴は bad_history', !bad.ok && bad.reason === 'bad_history');
  check('手番が違う手(先手がもう一度)', !validateMove(['7g7f'], '2g2f').ok);
}
{
  // 王手は無視できる。玉を取った手で対局が終わる（王将を取った側の勝ち）
  const sfen = 'k3r4/9/9/9/9/9/9/9/4K4 w - 1';
  const v = validateMove([], '5a5i', sfen);
  check('玉を取る手は king_capture・後手の勝ち', v.ok && v.result?.kind === 'king_capture' && v.result.winner === 'w', JSON.stringify(v));
  check('王手を放置する手も指せる', validateMove([], '5i5h', 'k3r4/9/9/9/9/9/9/9/4K4 b - 1').ok);
  check('持ち駒が違う手は不正', !validateMove([], 'S*1b', '8k/9/8L/9/9/9/9/9/4K4 b G 1').ok);
}
{
  // 二歩はサーバーでも拒否される。打ち歩詰めは指せる
  check('二歩は不正', !validateMove([], 'P*7e', '4k4/9/9/9/9/9/2P6/9/4K4 b P 1').ok);
  const mateSfen = '7pk/7p1/7G1/9/9/9/9/9/4K4 b P 1';
  check('打ち歩詰め(P*1b)も指せる', validateMove([], 'P*1b', mateSfen).ok);
}
{
  // 千日手(同一局面4回)
  const loop = ['5i4i', '5a4a', '4i5i', '4a5a'];
  const sfen = '4k4/9/9/9/9/9/9/9/4K4 b - 1';
  const hist: string[] = [];
  let last = validateMove(hist, loop[0], sfen);
  for (let i = 0; i < 20 && last.ok && !last.result; i++) {
    hist.push(loop[i % 4]);
    last = validateMove(hist, loop[(i + 1) % 4], sfen);
  }
  check('千日手で repetition・引き分け', last.ok && last.result?.kind === 'repetition' && last.result.winner === null, JSON.stringify(last));
}

console.log(`\n${passed} 件成功 / ${failed} 件失敗`);
process.exit(failed ? 1 : 0);
