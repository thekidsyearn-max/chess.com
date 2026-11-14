// Bot brains: engine candidates -> human-error model -> style-biased choice, plus the chat engine.
import { BOTS, STYLES, botById, publicBot, TIERS } from './data/bots.js';
import { analysePosition, scoreToCp } from './engine.js';
import { PAWN, KNIGHT, BISHOP, QUEEN, KING, WHITE, F_CASTLE_K, F_CASTLE_Q, F_DROP, PIECE_VALUE, colorOf, typeOf } from '../public/assets/js/chess/chess.js';

export { BOTS, botById, publicBot, TIERS };

const CENTER16 = new Set([18, 19, 20, 21, 26, 27, 28, 29, 34, 35, 36, 37, 42, 43, 44, 45]);
const cheb = (a, b) => Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 3) - (b >> 3)));

function pawnStructure(pos, color) {
  const files = new Int8Array(8);
  for (let s = 0; s < 64; s++) { const p = pos.board[s]; if (p && typeOf(p) === PAWN && colorOf(p) === color) files[s & 7]++; }
  let score = 0;
  for (let f = 0; f < 8; f++) {
    if (!files[f]) continue;
    if (files[f] > 1) score -= 12 * (files[f] - 1);
    if (!(f > 0 && files[f - 1]) && !(f < 7 && files[f + 1])) score -= 10 * files[f];
  }
  return score;
}

// Centipawn-equivalent bonus a bot's personality gives to a move.
function styleBonus(pos, m, w, ply) {
  let b = 0;
  const us = pos.turn, them = us ^ 1;
  if (m.captured) {
    b += (w.capture || 0) * (PIECE_VALUE[m.captured] / 100);
    if (w.trade && m.piece !== PAWN && PIECE_VALUE[m.captured] >= PIECE_VALUE[m.piece] - 30) b += w.trade;
  }
  const next = pos.after(m);
  if (w.check && next.inCheck()) b += w.check;
  if (w.kingAttack && m.flag !== F_CASTLE_K && m.flag !== F_CASTLE_Q) {
    const k = next.kings[them];
    if (k >= 0) { const d = cheb(m.to, k); if (d <= 2) b += w.kingAttack * (3 - d); }
  }
  if (w.advance && m.piece === PAWN && m.flag !== F_DROP) {
    const adv = us === WHITE ? m.to >> 3 : 7 - (m.to >> 3);
    if (adv >= 3) b += w.advance * (adv - 2) * 0.5;
  }
  if (w.center && CENTER16.has(m.to)) b += w.center;
  if (w.develop && ply < 18 && (m.piece === KNIGHT || m.piece === BISHOP) && m.from >= 0 && (m.from >> 3) === (us === WHITE ? 0 : 7)) b += w.develop;
  if (w.queenSortie && m.piece === QUEEN && ply < 14) b += w.queenSortie;
  if (w.knight && m.piece === KNIGHT) b += w.knight;
  if (w.castle && (m.flag === F_CASTLE_K || m.flag === F_CASTLE_Q)) b += w.castle;
  if (w.mobility) {
    const probe = next.clone();
    probe.turn = us;
    probe.ep = -1;
    b += w.mobility * (probe.pseudoMoves().length - pos.pseudoMoves().length);
  }
  if (w.structure && (m.piece === PAWN || m.captured === PAWN)) b += w.structure * (pawnStructure(next, us) - pawnStructure(pos, us));
  return b;
}

// Extra candidate moves a personality insists on considering even if the engine ranks them low.
function styleCandidates(pos, bot, ply) {
  const legal = pos.moves();
  switch (bot.extra) {
    case 'queen': return ply < 12 ? legal.filter((m) => m.piece === QUEEN && !m.captured) : [];
    case 'checks': return legal.filter((m) => pos.after(m).inCheck());
    case 'pawns': return legal.filter((m) => m.piece === PAWN && !m.captured && m.flag !== F_DROP);
    case 'captures': return legal.filter((m) => m.captured && PIECE_VALUE[m.captured] >= PIECE_VALUE[m.piece] - 30);
    default: return [];
  }
}

function softmaxPick(values, temp, rng) {
  const max = Math.max(...values);
  if (temp <= 0.5) return values.indexOf(max);
  const ws = values.map((v) => Math.exp(Math.max(-40, (v - max) / temp)));
  let x = rng() * ws.reduce((a, b) => a + b, 0);
  for (let i = 0; i < ws.length; i++) { x -= ws[i]; if (x <= 0) return i; }
  return ws.length - 1;
}

/**
 * Picks the bot's move for the current position of `game` (a rules-engine Game).
 * Returns { move, uci, best: {uci, score}, score, lines, source, blundered }.
 * Scores are centipawns from the bot's point of view (mate mapped to large values).
 */
export async function chooseBotMove({ bot, game, rng = Math.random, clockMs = null }) {
  const pos = game.pos, legal = pos.moves(), ply = game.ply;
  if (!legal.length) return null;
  const w = STYLES[bot.style] || {};
  const params = {
    variant: game.variant, fen: pos.fen(), startFen: game.startFen, moves: game.uciMoves(),
    multipv: Math.max(1, Math.min(bot.multipv, legal.length)),
    limitStrength: bot.uci.limitStrength, elo: bot.uci.elo, skill: bot.uci.skill, contempt: bot.uci.contempt, moveOverhead: bot.uci.moveOverhead,
    liteNodes: Math.round(3000 + bot.elo * 45), liteDepth: Math.min(6, 1 + Math.floor(bot.elo / 550)),
  };
  if (bot.movetime) {
    params.movetime = clockMs != null ? Math.max(80, Math.min(bot.movetime, Math.floor(clockMs / 30))) : bot.movetime;
  } else params.depth = bot.depth;
  const res = await analysePosition(params);
  const cands = [];
  for (const l of res.lines) { const m = pos.parseUci(l.uci); if (m && !cands.some((c) => c.move === m)) cands.push({ move: m, score: scoreToCp(l), mate: l.mate, line: l }); }
  if (res.source === 'stockfish') {
    const extra = styleCandidates(pos, bot, ply).filter((m) => !cands.some((c) => c.move === m)).slice(0, 5);
    if (extra.length) {
      try {
        const r2 = await analysePosition({ ...params, multipv: extra.length, searchmoves: extra.map((m) => pos.uci(m)), depth: params.depth || 10, movetime: params.movetime ? Math.min(300, params.movetime) : undefined });
        for (const l of r2.lines) { const m = pos.parseUci(l.uci); if (m && !cands.some((c) => c.move === m)) cands.push({ move: m, score: scoreToCp(l), mate: l.mate, line: l }); }
      } catch { /* style candidates are optional */ }
    }
  }
  const randomLegal = () => legal[Math.floor(rng() * legal.length)];
  if (!cands.length) { const m = randomLegal(); return { move: m, uci: pos.uci(m), best: null, score: null, lines: [], source: res.source, blundered: false }; }
  cands.sort((a, b) => b.score - a.score);
  const best = cands[0];
  const done = (c, blundered = false) => ({
    move: c.move, uci: pos.uci(c.move), best: { uci: pos.uci(best.move), score: best.score, mate: best.mate }, score: c.score ?? null,
    lines: res.lines, source: res.source, blundered,
  });

  // 1. never miss mate in one above the very bottom of the ladder
  const mateNow = cands.find((c) => c.mate === 1);
  if (mateNow && (bot.elo >= 500 || rng() < 0.5)) return done(mateNow);

  // 2. calibrated blunders: a random legal move, less often when in check or in the first moves
  let pBlunder = bot.blunder;
  if (pos.inCheck()) pBlunder *= 0.5;
  if (ply < 6) pBlunder *= 0.4;
  if (legal.length > 1 && rng() < pBlunder) {
    const others = legal.filter((m) => m !== best.move);
    const m = others[Math.floor(rng() * others.length)];
    const known = cands.find((c) => c.move === m);
    return done(known || { move: m, score: null }, true);
  }

  // 3. strength-limited engine pick (UCI_Elo) for bots inside Stockfish's own Elo range
  const hasStyle = Object.keys(w).length > 0;
  if (res.source === 'stockfish' && bot.uci.limitStrength && bot.elo >= 1320 && res.bestmove) {
    const sfPick = pos.parseUci(res.bestmove);
    const c = sfPick && cands.find((x) => x.move === sfPick);
    if (c && (!hasStyle || rng() < 0.5)) return done(c);
  }

  // 4. personality: style-biased softmax over the candidates
  const values = cands.map((c) => c.score + (hasStyle ? styleBonus(pos, c.move, w, ply) : 0));
  // don't let style talk a bot into a clearly losing move unless it is weak enough to do so
  const tolerance = 60 + Math.max(0, 2000 - bot.elo) * 0.35;
  for (let i = 0; i < cands.length; i++) if (best.score - cands[i].score > tolerance) values[i] -= 2 * (best.score - cands[i].score);
  return done(cands[softmaxPick(values, bot.temp, rng)]);
}

// Human-looking thinking time (ms) with variance; faster when forced or short on clock.
export function thinkDelay(bot, { legalCount, clockMs, ply, rng = Math.random }) {
  const [lo, hi] = bot.think;
  let ms = lo + rng() * (hi - lo);
  if (rng() < 0.12) ms *= 1.8; // the occasional long think
  if (legalCount <= 1) ms = Math.min(ms, 400);
  if (ply < 8) ms *= 0.6;
  if (clockMs != null) ms = Math.min(ms, Math.max(100, clockMs / 40));
  return Math.round(ms);
}

// ---- personality chat ---------------------------------------------------------
export function botLine(bot, event, vars = {}, rng = Math.random) {
  const pool = bot.lines[event];
  if (!pool || !pool.length) return null;
  return pool[Math.floor(rng() * pool.length)].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

const nonPawn = (pos) => {
  let v = 0;
  for (let s = 0; s < 64; s++) { const p = pos.board[s]; if (p && typeOf(p) !== PAWN && typeOf(p) !== KING) v += PIECE_VALUE[typeOf(p)]; }
  return v;
};

/**
 * Decides whether a board event deserves a comment. `state` is per-game memory:
 * { lastSaidPly, openingSaid, endgameSaid, lastBotScore }.
 * ctx: { rec (move record), byBot, ply, pos, opening, botScore (current best score, bot POV) }
 */
export function botReaction(bot, state, ctx, rng = Math.random) {
  const { rec, byBot, ply, pos, opening } = ctx;
  let event = null, force = false;
  if (rec.captured === QUEEN) { event = byBot ? 'wonQueen' : 'lostQueen'; force = true; }
  if (!event && !byBot && ctx.botScore != null && state.lastBotScore != null) {
    const swing = ctx.botScore - state.lastBotScore;
    if (swing >= 220 && ctx.botScore > -150) { event = 'userBlunder'; force = swing >= 400; }
    else if (swing <= -260 && state.lastBotScore < 9000) event = 'selfBlunder';
  }
  if (!event && !state.endgameSaid && ply > 24 && nonPawn(pos) <= 2600) { event = 'endgame'; state.endgameSaid = true; }
  if (!event && !state.openingSaid && opening && ply >= 4 && ply <= 16 && opening.ply >= 3 && rng() < 0.55) { event = 'opening'; state.openingSaid = true; }
  if (!event && /[+]/.test(rec.san) && rng() < 0.4) event = byBot ? 'giveCheck' : 'inCheck';
  if (!event) return null;
  if (!force && ply - (state.lastSaidPly ?? -10) < 4) return null;
  const text = botLine(bot, event, { opening: opening ? opening.name.split(':')[0] : 'this opening' }, rng);
  if (!text) return null;
  state.lastSaidPly = ply;
  return { event, text };
}
