// Unified engine facade: Stockfish for standard chess and Chess960, the built-in
// engine for the other variants (or when Stockfish is unavailable).
import { Worker } from 'node:worker_threads';
import { stockfish, scoreToCp } from './stockfish.js';

export { scoreToCp };
export const stockfishVariant = (variant) => variant === 'standard' || variant === 'chess960';

let worker = null, idleTimer = null, seq = 0;
const pending = new Map();

function liteWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('./lite-worker.js', import.meta.url), { resourceLimits: { maxOldGenerationSizeMb: 64, maxYoungGenerationSizeMb: 8 } });
  const fail = (err) => {
    for (const p of pending.values()) p.reject(err);
    pending.clear();
    worker = null;
  };
  worker.on('message', ({ id, result, error }) => {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    if (error) p.reject(new Error(error)); else p.resolve(result);
    if (!pending.size) {
      worker.unref();
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => { if (!pending.size && worker) { worker.terminate(); worker = null; } }, 45_000);
      idleTimer.unref();
    }
  });
  worker.on('error', fail);
  worker.on('exit', () => fail(new Error('engine worker exited')));
  return worker;
}

export function liteAnalyse(opts) {
  return new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    clearTimeout(idleTimer);
    const w = liteWorker();
    w.ref();
    w.postMessage({ id, opts });
  });
}

/**
 * Analyse a position. Scores are from the side to move.
 * opts: { variant, fen (current position), startFen?, moves? (uci from startFen), multipv, depth, nodes, movetime,
 *         limitStrength, elo, skill, contempt, moveOverhead, searchmoves, onInfo, preemptible, liteNodes }
 * Returns { lines: [{ uci, pv, cp|mate, depth, nodes, nps }], bestmove, source: 'stockfish'|'lite', cancelled }
 * The returned promise carries .cancel().
 */
export function analysePosition(opts) {
  const variant = opts.variant || 'standard';
  if (stockfishVariant(variant) && stockfish.available) {
    const job = stockfish.analyse({
      fen: opts.startFen && opts.moves ? opts.startFen : opts.fen,
      moves: opts.startFen && opts.moves ? opts.moves : undefined,
      chess960: variant === 'chess960',
      multipv: opts.multipv, depth: opts.depth, nodes: opts.nodes, movetime: opts.movetime,
      limitStrength: opts.limitStrength, elo: opts.elo, skill: opts.skill, contempt: opts.contempt, moveOverhead: opts.moveOverhead,
      searchmoves: opts.searchmoves, preemptible: opts.preemptible, hardTimeoutMs: opts.hardTimeoutMs,
      onInfo: opts.onInfo ? (lines) => opts.onInfo(lines.map(normalise), 'stockfish') : undefined,
    });
    const out = job.then((r) => ({ lines: r.lines.map(normalise), bestmove: r.bestmove, source: 'stockfish', cancelled: r.cancelled }))
      .catch(() => liteFallback(opts));
    out.cancel = job.cancel;
    return out;
  }
  const p = liteFallback(opts);
  p.cancel = () => {};
  return p;
}

const normalise = (l) => ({ uci: l.pv[0], pv: l.pv, cp: l.cp, mate: l.mate, depth: l.depth, nodes: l.nodes, nps: l.nps, multipv: l.multipv });

async function liteFallback(opts) {
  const nodes = opts.liteNodes || Math.min(250_000, Math.max(2_000, Math.round((opts.nodes || 300_000) / 3)));
  const maxDepth = Math.max(1, Math.min(6, opts.liteDepth || (opts.depth ? Math.ceil(opts.depth / 3) : 5)));
  const r = await liteAnalyse({ fen: opts.fen, variant: opts.variant || 'standard', nodes, maxDepth, multipv: opts.multipv || 1 });
  if (opts.onInfo) { try { opts.onInfo(r.lines, 'lite'); } catch { /* listener error */ } }
  return { lines: r.lines, bestmove: r.lines[0]?.uci || null, source: 'lite', cancelled: false };
}

export function engineShutdown() {
  stockfish.shutdown();
  if (worker) { worker.terminate(); worker = null; }
}
