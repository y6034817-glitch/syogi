// ルールエンジンの検証: `npm run test:rules`
// （Node 22.18+ の型除去機能でそのまま実行できます）

import { Position, fromSfen, toSfen } from '../src/game/position.ts';
import { legalMoves, perft } from '../src/game/movegen.ts';
import { DROP } from '../src/game/types.ts';
import { GameSession } from '../src/game/session.ts';
import { formatMove, moveToUsi, parseUsi } from '../src/game/notation.ts';

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
const sqOf = (file: number, rank: number): number => (rank - 1) * 9 + (9 - file);

console.log('perft（初期局面の指し手数。王手の制限がないので depth4 は通常の将棋(719731)より多くなる）');
const start = Position.initial();
const expected = [30, 900, 25470, 720850];
for (let d = 1; d <= expected.length; d++) {
  const t0 = Date.now();
  const n = perft(start, d);
  check(`depth ${d} = ${expected[d - 1]}`, n === expected[d - 1], `got ${n} (${Date.now() - t0}ms)`);
}

console.log('SFEN の往復');
check('初期局面', toSfen(Position.initial()) === 'lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1');
{
  const s = '7pk/7p1/7G1/9/9/9/9/9/4K4 b 2Pr3p 1';
  check('持ち駒つき', toSfen(fromSfen(s)) === s, toSfen(fromSfen(s)));
}

console.log('二歩');
{
  const pos = fromSfen('4k4/9/9/9/9/9/4P4/9/4K4 b P 1');
  const drops = legalMoves(pos).filter((m) => m.from === DROP);
  check('同じ筋(5筋)に歩を打てない', drops.every((m) => m.to % 9 !== 4));
  check('他の筋には打てる', drops.some((m) => m.to % 9 === 3));
}

console.log('王手に関する制限がない（実際の盤と同じ）');
{
  // 打ち歩詰めの形でも歩を打てる
  const mate = fromSfen('7pk/7p1/7G1/9/9/9/9/9/4K4 b P 1');
  check('打ち歩詰めの位置にも歩を打てる', legalMoves(mate).some((m) => m.from === DROP && m.to === sqOf(1, 2)));
  // ピンされた駒も動かせる
  const pinned = fromSfen('k3r4/9/9/9/9/9/9/4G4/4K4 b - 1');
  const gold = legalMoves(pinned).filter((m) => m.from === sqOf(5, 8));
  check('ピンされた金も横に動ける', gold.some((m) => m.to === sqOf(4, 8)));
  // 王手されていても、どんな手も指せる
  const attacked = fromSfen('k3r4/9/9/9/9/9/9/9/4K4 b N 1');
  const replies = legalMoves(attacked);
  const kingMoves = replies.filter((m) => m.from !== DROP);
  const drops = replies.filter((m) => m.from === DROP);
  check('王手されていても玉は盤内の5マスへ動ける', kingMoves.length === 5, `got ${kingMoves.length}`);
  check('王手されていても桂は三段目以降の62マスに打てる', drops.length === 62, `got ${drops.length}`);
  check('飛車の利きの中(5八)にも玉を動かせる', kingMoves.some((m) => m.to === sqOf(5, 8)));
}

console.log('玉を取ったら勝ち');
{
  const g = new GameSession(fromSfen('k3r4/9/9/9/9/9/9/9/4K4 w - 1'));
  const r = g.play(parseUsi(g.position, '5a5i')!);
  check('後手が先手の玉を取ると後手の勝ち', r?.kind === 'king_capture' && r.winner === 'w', JSON.stringify(r));
  const g2 = new GameSession(fromSfen('k3r4/9/9/9/9/9/9/9/4K4 b - 1'));
  g2.play(parseUsi(g2.position, '5i5h')!);
  check('玉を取らない手では対局が続く', g2.result === null);
}

console.log('成り');
{
  const pos = fromSfen('k8/4P4/9/9/9/9/9/9/4K4 b - 1');
  const pm = legalMoves(pos).filter((m) => m.from === sqOf(5, 2));
  check('最終段の歩は成りのみ', pm.length === 1 && pm[0].promote);
  const kn = fromSfen('k8/9/9/4N4/9/9/9/9/4K4 b - 1');
  const km = legalMoves(kn).filter((m) => m.from === sqOf(5, 4));
  check('二段目に進む桂は成りのみ', km.length === 2 && km.every((m) => m.promote));
  const sv = fromSfen('k8/9/4S4/9/9/9/9/9/4K4 b - 1');
  const sm = legalMoves(sv).filter((m) => m.from === sqOf(5, 3));
  check('銀は成・不成を選べる', sm.some((m) => m.promote) && sm.some((m) => !m.promote));
}

console.log('駒打ちの制限');
{
  const pos = fromSfen('k8/9/9/9/9/9/9/9/4K4 b NLP 1');
  const drops = legalMoves(pos).filter((m) => m.from === DROP);
  check('歩・香は一段目に打てない', !drops.some((m) => (m.piece === 'FU' || m.piece === 'KY') && m.to < 9));
  check('桂は二段目以内に打てない', !drops.some((m) => m.piece === 'KE' && m.to < 18));
  check('桂は三段目には打てる', drops.some((m) => m.piece === 'KE' && m.to >= 18 && m.to < 27));
}

console.log('千日手');
{
  const s = new GameSession(fromSfen('4k4/9/9/9/9/9/9/9/4K4 b - 1'));
  const seq = ['5i4i', '5a4a', '4i5i', '4a5a'];
  let r = null;
  for (let i = 0; i < 12; i++) {
    const m = parseUsi(s.position, seq[i % 4]);
    if (!m) throw new Error(`指せない手: ${seq[i % 4]}`);
    r = s.play(m);
    if (i < 11 && r) break;
  }
  check('同一局面4回で引き分け', r?.kind === 'repetition' && r.winner === null, JSON.stringify(r));
}

console.log('棋譜表記・USI');
{
  const s = new GameSession();
  const m1 = parseUsi(s.position, '7g7f');
  check('USI → 指し手', m1 !== null && moveToUsi(m1) === '7g7f');
  s.play(m1!);
  check('▲７六歩', s.labels[0] === '▲７六歩', s.labels[0]);
  s.play(parseUsi(s.position, '3c3d')!);
  check('△３四歩', s.labels[1] === '△３四歩', s.labels[1]);
  s.play(parseUsi(s.position, '8h2b+')!);
  check('角交換(成)', s.labels[2] === '▲２二角成', s.labels[2]);
  s.play(parseUsi(s.position, '3a2b')!);
  check('同銀', s.labels[3] === '△同銀', s.labels[3]);
  s.play(parseUsi(s.position, 'B*5e')!);
  check('駒打ち', s.labels[4] === '▲５五角', s.labels[4]);
  // 金が6九と4九にいて、どちらも5八へ動ける → 右/左で区別
  const g = new GameSession(fromSfen('k8/9/9/9/9/9/9/9/3GKG3 b - 1'.replace('3GKG3', '3G1G3')));
  const gr = formatMove(g.position, parseUsi(g.position, '4i5h')!, null, g.legal);
  const gl = formatMove(g.position, parseUsi(g.position, '6i5h')!, null, g.legal);
  check('右の金: ▲５八金右', gr === '▲５八金右', gr);
  check('左の金: ▲５八金左', gl === '▲５八金左', gl);
  // 金が5九(まっすぐ)と4八(横)から5八へ → 直 / 寄
  const g2 = new GameSession(fromSfen('k8/9/9/9/9/9/9/5G3/4G4 b - 1'));
  const straight = formatMove(g2.position, parseUsi(g2.position, '5i5h')!, null, g2.legal);
  const side = formatMove(g2.position, parseUsi(g2.position, '4h5h')!, null, g2.legal);
  check('まっすぐ上がる金: 直', straight === '▲５八金直', straight);
  check('横に寄る金: 寄', side === '▲５八金寄', side);
  // 打ち: 同じマスへ動ける歩が盤上にある場合のみ「打」
  const d = new GameSession(fromSfen('k8/9/9/9/9/9/9/9/4K4 b G 1'));
  const dl = formatMove(d.position, parseUsi(d.position, 'G*5e')!, null, d.legal);
  check('曖昧でなければ「打」は付けない', dl === '▲５五金', dl);
  const d2 = new GameSession(fromSfen('k8/9/9/9/9/9/9/4G4/4K4 b G 1'));
  const dl2 = formatMove(d2.position, parseUsi(d2.position, 'G*5g')!, null, d2.legal);
  check('盤上の金も動ける場合は「打」', dl2 === '▲５七金打', dl2);
}

console.log(`\n${passed} 件成功 / ${failed} 件失敗`);
process.exit(failed ? 1 : 0);
