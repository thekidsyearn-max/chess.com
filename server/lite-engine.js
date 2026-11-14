// Built-in alpha-beta engine. Understands every variant the rules engine does,
// so it powers bots in King of the Hill / Three-Check / Crazyhouse / Atomic and
// stands in for Stockfish when the binary is missing.
import { Position, WHITE, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, F_DROP, F_CASTLE_K, F_CASTLE_Q, PIECE_VALUE } from '../public/assets/js/chess/chess.js';

const MATE = 30000, INF = 32000;
const CENTRALITY = new Int8Array(64);
for (let s = 0; s < 64; s++) {
  const f = s & 7, r = s >> 3;
  CENTRALITY[s] = Math.round(3.5 - Math.max(Math.abs(f - 3.5), Math.abs(r - 3.5))); // 0 (rim) .. 3 (centre)
}
const hillDist = (s) => Math.max(Math.max(0, Math.abs((s & 7) - 3.5) - 0.5), Math.max(0, Math.abs((s >> 3) - 3.5) - 0.5));

function evaluate(pos) {
  const b = pos.board, v = pos.variant;
  let score = 0, npm = 0;
  for (let s = 0; s < 64; s++) {
    const p = b[s];
    if (!p) continue;
    const t = p & 7, white = (p >> 3) === WHITE;
    let x = PIECE_VALUE[t];
    if (t === PAWN) {
      const adv = white ? (s >> 3) - 1 : 6 - (s >> 3);
      x += adv * adv * 2 + (((s & 7) === 3 || (s & 7) === 4) ? 8 * Math.min(adv, 3) : 0);
    } else if (t === KNIGHT) { x += CENTRALITY[s] * 12; npm += 320; }
    else if (t === BISHOP) { x += CENTRALITY[s] * 7; npm += 330; }
    else if (t === ROOK) { x += ((white ? s >> 3 : 7 - (s >> 3)) === 6 ? 18 : 0); npm += 500; }
    else if (t === QUEEN) { x += CENTRALITY[s] * 3; npm += 900; }
    score += white ? x : -x;
  }
  // king placement: sheltered in the middlegame, active in the endgame
  for (let c = 0; c < 2; c++) {
    const k = pos.kings[c];
    if (k < 0) continue;
    let x;
    if (v === 'koth') x = (4 - hillDist(k)) * 45;
    else if (npm > 2600) { const home = c === WHITE ? k >> 3 : 7 - (k >> 3); x = -home * 22 - CENTRALITY[k] * 8 + (((k & 7) < 3 || (k & 7) > 5) ? 14 : 0); }
    else x = CENTRALITY[k] * 12;
    score += c === WHITE ? x : -x;
  }
  if (pos.pockets) for (let t = PAWN; t <= QUEEN; t++) score += (pos.pockets[0][t] - pos.pockets[1][t]) * (PIECE_VALUE[t] + 40);
  if (pos.checks) score += (pos.checks[0] - pos.checks[1]) * 320 + (pos.checks[0] === 2 ? 250 : 0) - (pos.checks[1] === 2 ? 250 : 0);
  return pos.turn === WHITE ? score : -score;
}

function orderMoves(moves) {
  for (const m of moves) {
    let s = 0;
    if (m.captured) s = 1000 + PIECE_VALUE[m.captured] * 10 - PIECE_VALUE[m.piece];
    if (m.promo) s += 900 + PIECE_VALUE[m.promo];
    if (m.flag === F_CASTLE_K || m.flag === F_CASTLE_Q) s += 60;
    if (m.flag === F_DROP) s -= 5;
    else if (!m.captured) s += CENTRALITY[m.to] - CENTRALITY[m.from];
    m.order = s;
  }
  return moves.sort((a, b) => b.order - a.order);
}

/**
 * @param {{fen:string, variant?:string, nodes?:number, maxDepth?:number, multipv?:number}} opts
 * @returns {{lines:{uci:string, pv:string[], cp?:number, mate?:number, depth:number}[], depth:number, nodes:number}}
 */
export function liteSearch({ fen, variant = 'standard', nodes = 20000, maxDepth = 6, multipv = 3 }) {
  const root = Position.fromFen(fen, variant);
  const legal = root.moves();
  if (!legal.length) return { lines: [], depth: 0, nodes: 0 };
  let used = 0, aborted = false;

  const quiesce = (pos, alpha, beta, qd, ply) => {
    used++;
    const vw = pos.variantWinner();
    if (vw >= 0) return vw === pos.turn ? MATE - ply : -(MATE - ply);
    const stand = evaluate(pos);
    if (qd === 0 || stand >= beta) return stand;
    if (stand > alpha) alpha = stand;
    const us = pos.turn;
    const caps = orderMoves(pos.pseudoMoves().filter((m) => m.captured || m.promo));
    for (const m of caps) {
      const child = pos.clone();
      child.play(m);
      if (!child.safeFor(us)) continue;
      const sc = -quiesce(child, -beta, -alpha, qd - 1, ply + 1);
      if (sc > alpha) { alpha = sc; if (alpha >= beta) break; }
    }
    return alpha;
  };

  const search = (pos, depth, alpha, beta, ply) => {
    if (used++ >= nodes) { aborted = true; return 0; }
    const vw = pos.variantWinner();
    if (vw >= 0) return vw === pos.turn ? MATE - ply : -(MATE - ply);
    if (depth <= 0) return quiesce(pos, alpha, beta, 4, ply);
    const us = pos.turn;
    let best = -INF, any = false;
    for (const m of orderMoves(pos.pseudoMoves())) {
      const child = pos.clone();
      child.play(m);
      if (!child.safeFor(us)) continue;
      any = true;
      const sc = -search(child, depth - 1, -beta, -alpha, ply + 1);
      if (aborted) return 0;
      if (sc > best) { best = sc; if (sc > alpha) { alpha = sc; if (alpha >= beta) break; } }
    }
    if (!any) return pos.inCheck() ? -(MATE - ply) : 0;
    if (pos.half >= 100 || pos.insufficientMaterial()) return 0;
    return best;
  };

  let results = orderMoves(legal.slice()).map((m) => ({ m, score: 0 }));
  let depthDone = 0;
  for (let d = 1; d <= maxDepth; d++) {
    const round = [];
    const kth = [];
    for (const r of results) {
      const child = root.after(r.m);
      // exact scores for the best `multipv` moves, cheap upper bounds for the rest
      const floor = kth.length >= multipv ? kth[multipv - 1] : -INF;
      const sc = -search(child, d - 1, -INF, -floor + (floor > -INF ? 1 : 0), 1);
      if (aborted) break;
      round.push({ m: r.m, score: sc });
      kth.push(sc);
      kth.sort((a, b) => b - a);
    }
    if (aborted && d > 1) break;
    if (round.length === results.length) { results = round.sort((a, b) => b.score - a.score); depthDone = d; }
    if (aborted) break;
    if (Math.abs(results[0].score) > MATE - 100 && d >= 2) break;
  }
  const lines = results.slice(0, multipv).map((r) => {
    const line = { uci: root.uci(r.m), pv: [root.uci(r.m)], depth: depthDone };
    if (Math.abs(r.score) > MATE - 200) { const n = Math.ceil((MATE - Math.abs(r.score)) / 2); line.mate = r.score > 0 ? Math.max(1, n) : -Math.max(1, n); }
    else line.cp = Math.round(r.score);
    return line;
  });
  return { lines, depth: depthDone, nodes: used };
}
