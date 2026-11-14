// Game Review: per-position MultiPV analysis, move classification, CAPS-style
// accuracy and coach commentary. Reviews are cached in SQLite and unlimited.
import { q } from './db.js';
import { config } from './config.js';
import { Game, Position, WHITE, PAWN, PIECE_VALUE, F_DROP, reasonText } from '../public/assets/js/chess/chess.js';
import { analysePosition, stockfishVariant } from './engine.js';
import { stockfish } from './stockfish.js';
import { isBookMove } from './openings.js';
import { winPct, lineCp, moveAccuracy, lossBucket, MATE_CP, CLASS_INFO } from './judge.js';
import { explain, summarise } from './coach.js';

const jobs = new Map(); // gameId -> { progress, error }
let chain = Promise.resolve(); // reviews run one at a time so live play keeps an engine free

export const CLASSES = Object.keys(CLASS_INFO);

// Does the move give up real material (a piece, not just a pawn)?
function isSacrifice(pos, m, next) {
  if (m.flag === F_DROP) return false;
  const us = pos.turn, them = us ^ 1;
  const movedVal = PIECE_VALUE[m.promo || m.piece];
  const took = PIECE_VALUE[m.captured || 0];
  // the moved piece can be won for less than it is worth
  if (m.piece !== PAWN && movedVal >= 300) {
    const lost = next.see(m.to, them);
    if (lost - took >= 200) return true;
  }
  // or another piece is left hanging that was safe before
  for (let s = 0; s < 64; s++) {
    const p = next.board[s];
    if (!p || (p >> 3) !== us || s === m.to) continue;
    const v = PIECE_VALUE[p & 7];
    if (v < 300) continue;
    const now = next.see(s, them);
    if (now >= 200 && now - took >= 200 && pos.see(s, them) < 100) return true;
  }
  return false;
}

function terminalEval(pos) {
  const o = pos.outcome();
  if (!o) return null;
  if (o.winner === null) return { cp: 0, mate: null, lines: [], terminal: true };
  // side to move has been mated / lost
  return { cp: -MATE_CP, mate: 0, lines: [], terminal: true, lost: o.winner !== pos.turn };
}

function sanLine(pos, ucis, max = 10) {
  const out = [];
  let p = pos;
  for (const u of ucis.slice(0, max)) {
    const m = p.parseUci(u);
    if (!m) break;
    out.push(p.san(m));
    p = p.after(m);
  }
  return out;
}

function gameAccuracy(accs, wps) {
  if (!accs.length) return 100;
  // volatility-weighted mean blended with the harmonic mean
  const win = Math.max(2, Math.min(8, Math.round(wps.length / 10)));
  const weights = accs.map((_, i) => {
    const a = Math.max(0, i - win + 1), seg = wps.slice(a, a + win + 1);
    const mean = seg.reduce((x, y) => x + y, 0) / seg.length;
    const sd = Math.sqrt(seg.reduce((x, y) => x + (y - mean) ** 2, 0) / seg.length);
    return Math.max(0.5, Math.min(12, sd));
  });
  const wsum = weights.reduce((a, b) => a + b, 0);
  const weighted = accs.reduce((a, v, i) => a + v * weights[i], 0) / wsum;
  const harmonic = accs.length / accs.reduce((a, v) => a + 1 / Math.max(1, v), 0);
  return Math.max(0, Math.min(100, (weighted + harmonic) / 2));
}

const PERF_TABLE = [[0, 100], [40, 300], [55, 600], [65, 900], [72, 1150], [78, 1400], [83, 1650], [87, 1900], [90, 2100], [93, 2350], [95, 2550], [97, 2800], [99, 3100], [100, 3300]];
function estimatedRating(acc) {
  for (let i = 1; i < PERF_TABLE.length; i++) {
    const [a0, r0] = PERF_TABLE[i - 1], [a1, r1] = PERF_TABLE[i];
    if (acc <= a1) return Math.round((r0 + ((acc - a0) / (a1 - a0)) * (r1 - r0)) / 50) * 50;
  }
  return 3300;
}

/**
 * Analyse a finished (or in-progress) game.
 * @param {{variant:string, startFen:string, moves:string[]}} input
 * @param {(done:number,total:number)=>void} onProgress
 */
export async function analyseGame(input, onProgress = () => {}, meta = {}) {
  const game = Game.fromMoves({ variant: input.variant, fen: input.startFen, moves: input.moves });
  const n = game.moves.length;
  const fens = [game.startFen, ...game.moves.map((m) => m.fen)];
  const positions = fens.map((f) => Position.fromFen(f, game.variant));
  const useSf = stockfishVariant(game.variant) && stockfish.available;

  // 1. engine pass over every position (MultiPV 3)
  const evals = [];
  for (let i = 0; i <= n; i++) {
    const pos = positions[i];
    const term = terminalEval(pos);
    if (term) { evals.push(term); onProgress(i + 1, n + 1); continue; }
    const r = await analysePosition({
      variant: game.variant, fen: fens[i], multipv: config.review.multipv, nodes: config.review.nodes, depth: useSf ? undefined : 9,
      liteNodes: 70_000, liteDepth: 4, hardTimeoutMs: 30_000,
    });
    const lines = r.lines.filter((l) => l && l.uci).map((l) => ({ uci: l.uci, pv: l.pv || [l.uci], cp: l.cp ?? null, mate: l.mate ?? null, depth: l.depth || 0 }));
    if (!lines.length) { evals.push({ cp: 0, mate: null, lines: [] }); onProgress(i + 1, n + 1); continue; }
    evals.push({ cp: lineCp(lines[0]), mate: lines[0].mate, lines, depth: lines[0].depth, source: r.source });
    onProgress(i + 1, n + 1);
  }

  // 2. classify
  const moves = [];
  let inBook = game.variant === 'standard' && game.startPly === 0;
  let prevCls = null;
  const accs = [[], []], wpsByColor = [[], []];
  const counts = [Object.fromEntries(CLASSES.map((c) => [c, 0])), Object.fromEntries(CLASSES.map((c) => [c, 0]))];
  const graph = [];
  const whiteEval = (i) => {
    const e = evals[i], sign = positions[i].turn === WHITE ? 1 : -1;
    if (e.terminal) return e.mate === 0 ? { cp: sign * -MATE_CP, mate: sign * -0.5 } : { cp: 0, mate: null };
    return { cp: e.mate != null ? null : sign * e.cp, mate: e.mate != null ? sign * e.mate : null, raw: sign * e.cp };
  };
  const wpWhite = (i) => {
    const e = evals[i], sign = positions[i].turn === WHITE ? 1 : -1;
    return winPct(sign * e.cp);
  };
  graph.push(Math.round(wpWhite(0) * 10) / 10);

  for (let i = 0; i < n; i++) {
    const rec = game.moves[i], pos = positions[i], next = positions[i + 1], color = rec.color;
    const before = evals[i], after = evals[i + 1];
    const move = pos.parseUci(rec.uci);
    const best = before.lines[0] || null;
    const bestMove = best ? pos.parseUci(best.uci) : null;
    const playedIsBest = !!bestMove && bestMove === move;
    const bestCp = best ? lineCp(best) : -after.cp;
    let afterCp = -after.cp; // mover's point of view
    if (playedIsBest || afterCp > bestCp) afterCp = Math.max(afterCp, bestCp);
    const wpBefore = winPct(bestCp), wpAfter = playedIsBest ? wpBefore : winPct(afterCp);
    const loss = Math.max(0, wpBefore - wpAfter);
    const mateBefore = best && best.mate != null ? best.mate : null;
    const mateAfter = after.terminal ? (after.mate === 0 ? 0.5 : null) : after.mate != null ? -after.mate : null;
    const second = before.lines[1] || null;
    const legalCount = pos.moves().length;
    const prevRec = i > 0 ? game.moves[i - 1] : null;
    const isRecapture = !!(prevRec && prevRec.captured && move.captured && prevRec.to === move.to);

    let cls;
    const bookHit = inBook && i < 30 && isBookMove(pos.hash(), rec.uci);
    if (!bookHit) inBook = false;
    if (bookHit) cls = 'book';
    else if (legalCount === 1) cls = 'forced';
    else if (playedIsBest || loss < 0.4) {
      cls = 'best';
      const gap = second ? wpBefore - winPct(lineCp(second)) : 100;
      if (isSacrifice(pos, move, next) && wpAfter >= 45 && wpBefore < 97 && gap >= 2) cls = 'brilliant';
      else if (playedIsBest && second && gap >= 12 && !isRecapture && wpBefore >= 30 && wpBefore < 99.5 && legalCount > 2) cls = 'great';
      else if (!playedIsBest) cls = 'excellent';
    } else {
      cls = lossBucket(loss);
      const missedMate = mateBefore != null && mateBefore > 0 && !(mateAfter != null && mateAfter > 0);
      if (missedMate) cls = wpAfter >= 90 ? 'miss' : 'blunder';
      else if ((prevCls === 'mistake' || prevCls === 'blunder') && loss >= 10 && wpAfter >= 40) cls = 'miss';
    }

    const acc = cls === 'book' || cls === 'forced' ? 100 : moveAccuracy(wpBefore, wpAfter);
    accs[color].push(acc);
    wpsByColor[color].push(wpAfter);
    counts[color][cls]++;

    const bestLineUci = best ? best.pv.slice(0, 10) : [];
    const refutationUci = after.lines && after.lines[0] ? after.lines[0].pv.slice(0, 10) : [];
    const ev = whiteEval(i + 1);
    const comment = explain({
      cls, pos, move, next, san: rec.san, bestSan: bestMove ? pos.san(bestMove) : null, bestUci: best ? best.uci : null,
      bestLine: bestLineUci, refutation: refutationUci, wpBefore, wpAfter, mateBefore,
      mateAfter: mateAfter === 0.5 ? null : mateAfter, opening: meta.opening || null, ply: i, prevCls, loss,
    });
    moves.push({
      ply: i + 1, color: color === WHITE ? 'w' : 'b', san: rec.san, uci: rec.uci, fenBefore: fens[i], fen: fens[i + 1],
      cls, loss: Math.round(loss * 10) / 10, accuracy: Math.round(acc * 10) / 10,
      eval: { cp: ev.cp != null ? Math.round(ev.cp) : null, mate: ev.mate === 0.5 || ev.mate === -0.5 ? (ev.mate > 0 ? 'W' : 'B') : ev.mate },
      wp: Math.round(wpWhite(i + 1) * 10) / 10,
      best: bestMove ? { uci: pos.uci(bestMove), san: pos.san(bestMove) } : null,
      lines: before.lines.slice(0, 3).map((l) => ({ uci: l.uci, cp: l.cp, mate: l.mate, san: sanLine(pos, l.pv, 8) })),
      bestLine: { uci: bestLineUci, san: sanLine(pos, bestLineUci) },
      followUp: { uci: refutationUci, san: sanLine(next, refutationUci) },
      comment,
    });
    graph.push(Math.round(wpWhite(i + 1) * 10) / 10);
    prevCls = cls;
  }

  const side = (c) => {
    const accuracy = Math.round(gameAccuracy(accs[c], wpsByColor[c]) * 10) / 10;
    return { accuracy, counts: counts[c], moves: accs[c].length, estimatedRating: accs[c].length >= 8 ? estimatedRating(accuracy) : null };
  };
  const white = side(0), black = side(1);
  const startEval = whiteEval(0);
  return {
    version: 1, variant: game.variant, startFen: game.startFen, engine: useSf ? stockfish.engineName || 'Stockfish' : 'Rookery built-in engine',
    depth: Math.max(0, ...evals.map((e) => e.depth || 0)), nodes: useSf ? config.review.nodes : null,
    white, black, graph, startEval: { cp: startEval.cp != null ? Math.round(startEval.cp) : null, mate: startEval.mate },
    moves,
    summary: summarise({ white, black, result: meta.result, reason: reasonText(meta.reason), opening: meta.opening, userColor: meta.userColor }),
    opening: meta.opening || null, result: meta.result || '*', reason: meta.reason || '',
  };
}

// ---- cached, queued reviews of archived games ---------------------------------------
export function getReview(gameId) {
  const row = q('SELECT data FROM reviews WHERE game_id = ?').get(gameId);
  if (row) return { status: 'done', review: JSON.parse(row.data) };
  const job = jobs.get(gameId);
  if (job) return job.error ? { status: 'error', error: job.error } : { status: 'running', progress: job.progress, queued: job.queued };
  return { status: 'none' };
}

export function startReview(gameId, userId = null) {
  const existing = getReview(gameId);
  if (existing.status === 'done' || existing.status === 'running') return existing;
  const row = q('SELECT * FROM games WHERE id = ?').get(gameId);
  if (!row) return { status: 'error', error: 'Game not found.' };
  const moveList = row.moves ? row.moves.split(' ') : [];
  if (moveList.length < 2) return { status: 'error', error: 'This game is too short to review.' };
  if (moveList.length > 600) return { status: 'error', error: 'This game is too long to review.' };
  const job = { progress: 0, queued: true, error: null };
  jobs.set(gameId, job);
  chain = chain.then(async () => {
    job.queued = false;
    try {
      const review = await analyseGame(
        { variant: row.variant, startFen: row.start_fen, moves: moveList },
        (done, total) => { job.progress = done / total; },
        { opening: row.opening || null, result: row.result, reason: row.reason, userColor: userId && row.white_id === userId ? 'w' : userId && row.black_id === userId ? 'b' : null },
      );
      review.gameId = gameId;
      review.white.name = row.white_name; review.black.name = row.black_name;
      review.white.rating = row.white_rating; review.black.rating = row.black_rating;
      q('INSERT OR REPLACE INTO reviews (game_id, data, created_at) VALUES (?, ?, ?)').run(gameId, JSON.stringify(review), Date.now());
      jobs.delete(gameId);
    } catch (e) {
      job.error = 'Analysis failed: ' + (e.message || e);
      setTimeout(() => jobs.delete(gameId), 60_000).unref();
    }
  });
  return { status: 'running', progress: 0, queued: true };
}

export const reviewStats = () => ({ pending: jobs.size });
