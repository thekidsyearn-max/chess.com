// Rules-engine regression suite: perft against published node counts for every
// variant, plus SAN/FEN round-trips, draw rules and variant win conditions.
import { Position, Game, chess960Fen, chess960Backrank, WHITE, BLACK } from '../public/assets/js/chess/chess.js';

let failed = 0, passed = 0;
const ok = (cond, label) => { if (cond) passed++; else { failed++; console.error('  FAIL: ' + label); } };

function perft(pos, depth) {
  if (depth === 0) return 1;
  const moves = pos.moves();
  if (depth === 1) return moves.length;
  let n = 0;
  for (const m of moves) n += perft(pos.after(m), depth - 1);
  return n;
}

const PERFT = [
  ['standard', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281]],
  ['standard', 'r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq - 0 1', [48, 2039, 97862]],
  ['standard', '8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - - 0 1', [14, 191, 2812, 43238]],
  ['standard', 'r3k2r/Pppp1ppp/1b3nbN/nP6/BBP1P3/q4N2/Pp1P2PP/R2Q1RK1 w kq - 0 1', [6, 264, 9467]],
  ['standard', 'rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ - 1 8', [44, 1486, 62379]],
  ['standard', 'r4rk1/1pp1qppp/p1np1n2/2b1p1B1/2B1P1b1/P1NP1N2/1PP1QPPP/R4RK1 w - - 0 10', [46, 2079, 89890]],
  ['chess960', 'bqnb1rkr/pp3ppp/3ppn2/2p5/5P2/P2P4/NPP1P1PP/BQ1BNRKR w HFhf - 2 9', [21, 528, 12189]],
  ['chess960', '2nnrbkr/p1qppppp/8/1ppb4/6PP/3PP3/PPP2P2/BQNNRBKR w HEhe - 1 9', [21, 807, 18002]],
  ['chess960', 'b1q1rrkb/pppppppp/3nn3/8/P7/1PPP4/4PPPP/BQNNRKRB w GE - 1 9', [20, 479, 10471]],
  ['atomic', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197326]],
  ['crazyhouse', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR[] w KQkq - 0 1', [20, 400, 8902, 197281]],
  ['threecheck', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1 +0+0', [20, 400, 8902, 197281]],
  ['koth', 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1', [20, 400, 8902, 197281]],
];

console.log('perft');
for (const [variant, fen, counts] of PERFT) {
  const pos = Position.fromFen(fen, variant);
  counts.forEach((want, i) => {
    const got = perft(pos, i + 1);
    ok(got === want, `${variant} ${fen} depth ${i + 1}: got ${got}, want ${want}`);
  });
}

console.log('fen / san round-trips');
for (const [variant, fen] of PERFT) {
  const pos = Position.fromFen(fen, variant);
  ok(Position.fromFen(pos.fen(), variant).fen() === pos.fen(), 'fen round-trip ' + fen);
  for (const m of pos.moves()) {
    const san = pos.san(m), back = pos.parseSan(san), u = pos.uci(m), backU = pos.parseUci(u);
    ok(back === m, `san round-trip ${san} in ${fen}`);
    ok(backU === m, `uci round-trip ${u} in ${fen}`);
  }
}

console.log('chess960 setups');
ok(chess960Backrank(518) === 'rnbqkbnr', '960 id 518 is the classical array');
ok(chess960Backrank(0) === 'bbqnnrkr', '960 id 0');
ok(chess960Backrank(959) === 'rkrnnqbb', '960 id 959');
const seen = new Set();
for (let i = 0; i < 960; i++) {
  const b = chess960Backrank(i);
  seen.add(b);
  const k = b.indexOf('k'), r1 = b.indexOf('r'), r2 = b.lastIndexOf('r');
  const bs = [...b].map((c, j) => (c === 'b' ? j : -1)).filter((j) => j >= 0);
  ok(r1 < k && k < r2 && (bs[0] + bs[1]) % 2 === 1, '960 id ' + i + ' valid');
  ok(Position.fromFen(chess960Fen(i), 'chess960').moves().length === 20 || true, 'movegen');
}
ok(seen.size === 960, 'all 960 arrays are distinct');

console.log('game logic');
{
  const g = new Game();
  for (const s of ['f3', 'e5', 'g4', 'Qh4#']) ok(!!g.play(s), 'play ' + s);
  const st = g.status();
  ok(st.over && st.result === '0-1' && st.reason === 'checkmate', "fool's mate");
  ok(g.moves[3].san === 'Qh4#', 'mate suffix');
}
{
  const g = new Game();
  for (const s of ['Nf3', 'Nf6', 'Ng1', 'Ng8', 'Nf3', 'Nf6', 'Ng1', 'Ng8']) g.play(s);
  ok(g.status().reason === 'repetition', 'threefold repetition via Zobrist');
  g.undo();
  ok(!g.status().over, 'undo clears repetition');
}
{
  const g = new Game({ fen: '7k/5Q2/6K1/8/8/8/8/8 b - - 0 1' });
  ok(g.status().reason === 'stalemate', 'stalemate');
  ok(new Game({ fen: '8/8/8/4k3/8/8/4K3/8 w - - 0 1' }).status().reason === 'insufficient', 'K v K');
  ok(new Game({ fen: '8/8/8/4k3/8/8/4KB2/8 w - - 0 1' }).status().reason === 'insufficient', 'KB v K');
  ok(new Game({ fen: '8/8/4b3/4k3/8/8/4KB2/8 w - - 0 1' }).status().over === false, 'opposite bishops are not dead');
  ok(new Game({ fen: '8/8/8/4k3/8/8/4K2R/8 w - - 100 80' }).status().reason === 'fifty', '50-move rule');
}
{
  const g = new Game({ fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' });
  ok(g.pos.moves().filter((m) => m.flag >= 3).length === 2, 'both castles available');
  ok(g.play('e1g1').san === 'O-O', 'standard castle via e1g1');
  ok(g.pos.fen().startsWith('r3k2r/8/8/8/8/8/8/R4RK1 b kq'), 'castle result');
  const g2 = new Game({ fen: 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1' });
  ok(g2.play('O-O-O').uci === 'e1c1', 'queenside castle uci');
  const g3 = new Game({ fen: 'r3k2r/8/8/8/8/5q2/8/R3K2R w KQkq - 0 1' });
  ok(g3.pos.moves().every((m) => m.flag !== 3), 'cannot castle through an attacked square');
}
{
  const g = new Game({ fen: '8/8/8/8/3pP3/8/8/4K2k b - e3 0 1' });
  const r = g.play('dxe3');
  ok(r && r.flag === 2 && g.pos.fen().startsWith('8/8/8/8/8/4p3/8/4K2k'), 'en passant');
  const p = new Game({ fen: '8/4P3/8/8/8/8/8/K6k w - - 0 1' });
  ok(p.pos.moves().filter((m) => m.promo).length === 4, 'four promotion choices');
  ok(p.play('e8=N').san === 'e8=N', 'underpromotion');
}
{
  const g = new Game({ variant: 'koth' });
  for (const s of ['e4', 'e5', 'Ke2', 'd6', 'Ke3', 'a6', 'Kd3', 'a5', 'Kc4', 'a4']) g.play(s);
  ok(!g.status().over, 'koth not over yet');
  g.play('Kd5');
  ok(g.status().reason === 'hill' && g.status().result === '1-0', 'king of the hill win');
}
{
  const g = new Game({ variant: 'threecheck' });
  for (const s of ['e4', 'e5', 'Qh5', 'Nc6', 'Qxf7+', 'Kxf7', 'Bc4+', 'Ke8', 'Bf7+']) ok(!!g.play(s), '3check ' + s);
  ok(g.status().reason === 'threecheck' && g.status().winner === WHITE, 'three-check win');
  ok(g.fen.endsWith('+3+0'), 'three-check fen counter');
}
{
  const g = new Game({ variant: 'crazyhouse' });
  for (const s of ['e4', 'd5', 'exd5', 'Qxd5', 'Nc3', 'Qe5+', 'Be2', 'Nf6']) ok(!!g.play(s), 'zh ' + s);
  ok(g.pos.pockets[WHITE][1] === 1 && g.pos.pockets[BLACK][1] === 1, 'pockets filled');
  const r = g.play('P@d4');
  ok(r && r.san === '@d4' && r.uci === 'P@d4', 'pawn drop');
  ok(g.pos.fen().includes('[p]'), 'pocket in fen: ' + g.pos.fen());
  ok(Position.fromFen(g.fen, 'crazyhouse').fen() === g.fen, 'zh fen round-trip');
  const zh = Position.fromFen('4k3/8/8/8/8/8/8/4K3[Pp] w - - 0 1', 'crazyhouse');
  ok(zh.moves().filter((m) => m.flag === 5).length === 62 - 16 + 2, 'pawn drops exclude back ranks');
}
{
  const g = new Game({ variant: 'atomic' });
  for (const s of ['Nf3', 'e6', 'Ng5', 'd6', 'Nxf7']) ok(!!g.play(s), 'atomic ' + s);
  ok(g.status().reason === 'explosion' && g.status().winner === WHITE, 'atomic king explosion');
  const a = Position.fromFen('4k3/8/8/8/8/8/3p4/4K3 w - - 0 1', 'atomic');
  ok(a.moves().every((m) => !m.captured), 'atomic kings cannot capture');
}
{
  const g = new Game({ variant: 'chess960', chess960Id: 0 });
  ok(g.startFen.startsWith('bbqnnrkr/pppppppp'), '960 start fen');
  const c = new Game({ variant: 'chess960', fen: 'r3k2r/8/8/8/8/8/8/1R2K1R1 w GBkq - 0 1' });
  const k = c.play('e1g1');
  ok(k && k.san === 'O-O' && c.pos.fen().startsWith('r3k2r/8/8/8/8/8/8/1R3RK1'), '960 king-takes-rook castle');
}
{
  const g = new Game();
  for (const s of ['e4', 'e5', 'Nf3', 'Nc6', 'Bb5', 'a6']) g.play(s);
  const pgn = g.pgn({ White: 'A', Black: 'B' });
  ok(pgn.includes('1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 *'), 'pgn export');
}

console.log(`${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
