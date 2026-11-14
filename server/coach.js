// Virtual coach: turns engine facts about a move into plain-English commentary.
import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, F_CASTLE_K, F_CASTLE_Q, F_DROP, PIECE_VALUE, sqName, typeOf, colorOf } from '../public/assets/js/chess/chess.js';
import { winPct } from './judge.js';

const NAME = ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'];
const CENTER = new Set([27, 28, 35, 36]);
const fmt = (cp, mate) => (mate != null ? (mate > 0 ? `+M${mate}` : `−M${-mate}`) : `${cp >= 0 ? '+' : '−'}${(Math.abs(cp) / 100).toFixed(1)}`);
const pick = (arr, seed) => arr[Math.abs(seed) % arr.length];

function materialFor(pos, color) {
  let v = 0;
  for (let s = 0; s < 64; s++) { const p = pos.board[s]; if (p && typeOf(p) !== KING) v += (colorOf(p) === color ? 1 : -1) * PIECE_VALUE[typeOf(p)]; }
  if (pos.pockets) for (let t = PAWN; t <= QUEEN; t++) v += (pos.pockets[color][t] - pos.pockets[color ^ 1][t]) * PIECE_VALUE[t];
  return v;
}

// Material swing (for `color`) after playing up to `plies` moves of a UCI line.
function lineSwing(pos, ucis, color, plies = 6) {
  let p = pos;
  const start = materialFor(pos, color);
  let last = start;
  const n = Math.min(plies, ucis.length);
  for (let i = 0; i < n; i++) {
    const m = p.parseUci(ucis[i]);
    if (!m) break;
    p = p.after(m);
    // only trust the balance when the side that just captured is not about to be recaptured
    if (i === n - 1 || !p.parseUci(ucis[i + 1])?.captured) last = materialFor(p, color);
  }
  return last - start;
}

// Pieces of `victim` colour attacked by the piece on `sq` that are worth more than it or undefended.
function forkTargets(pos, sq, victim) {
  const attacker = pos.board[sq];
  if (!attacker) return [];
  const av = PIECE_VALUE[typeOf(attacker)];
  const out = [];
  for (let s = 0; s < 64; s++) {
    const p = pos.board[s];
    if (!p || colorOf(p) !== victim || typeOf(p) === PAWN) continue;
    if (!pos.attackers(s, victim ^ 1).includes(sq)) continue;
    if (typeOf(p) === KING || PIECE_VALUE[typeOf(p)] > av || pos.attackers(s, victim).length === 0) out.push(s);
  }
  return out;
}

// What does the move visibly do? Returns a short clause ("develops the knight", ...).
function describe(pos, m, next) {
  const us = pos.turn, them = us ^ 1;
  const bits = [];
  if (m.flag === F_CASTLE_K || m.flag === F_CASTLE_Q) return 'tucks the king away and connects the rooks';
  if (m.flag === F_DROP) return `drops a ${NAME[m.piece]} onto ${sqName(m.to)}`;
  if (m.promo) bits.push(`promotes to a ${NAME[m.promo]}`);
  if (m.captured) {
    const gain = PIECE_VALUE[m.captured] - next.see(m.to, them);
    if (gain >= 150) bits.push(`wins the ${NAME[m.captured]} on ${sqName(m.to)}`);
    else if (PIECE_VALUE[m.captured] >= PIECE_VALUE[m.piece] - 40) bits.push(`trades off the ${NAME[m.captured]}`);
    else bits.push(`captures the ${NAME[m.captured]}`);
  }
  if (next.inCheck()) bits.push('gives check');
  const fork = forkTargets(next, m.to, them);
  if (fork.length >= 2) bits.push(`forks the ${NAME[typeOf(next.board[fork[0]])]} and ${NAME[typeOf(next.board[fork[1]])]}`);
  if (!bits.length) {
    const home = us === WHITE ? 0 : 7;
    if ((m.piece === KNIGHT || m.piece === BISHOP) && (m.from >> 3) === home && pos.full <= 12) bits.push(`develops the ${NAME[m.piece]}${CENTER.has(m.to) || [18, 21, 42, 45, 26, 29, 34, 37].includes(m.to) ? ' toward the centre' : ''}`);
    else if (m.piece === PAWN && CENTER.has(m.to)) bits.push('stakes a claim in the centre');
    else if (m.piece === PAWN && (us === WHITE ? m.to >> 3 : 7 - (m.to >> 3)) >= 5) bits.push('pushes the pawn closer to promotion');
    else if (m.piece === ROOK) {
      let open = true;
      for (let r = 0; r < 8; r++) { const p = next.board[r * 8 + (m.to & 7)]; if (p && typeOf(p) === PAWN) open = false; }
      bits.push(open ? 'puts the rook on an open file' : 'repositions the rook');
    } else if (m.piece === KING && pos.full > 30) bits.push('activates the king');
    else if (m.piece === QUEEN) bits.push('repositions the queen');
    else if (m.piece === PAWN) bits.push('gains space');
    else bits.push(`improves the ${NAME[m.piece]}`);
  }
  return bits.slice(0, 2).join(' and ');
}

const edge = (wp) => (wp >= 90 ? 'a winning position' : wp >= 70 ? 'a clear advantage' : wp >= 57 ? 'a small edge' : wp >= 43 ? 'an equal position' : wp >= 30 ? 'a slightly worse position' : wp >= 10 ? 'a difficult position' : 'a lost position');

/**
 * ctx: { cls, pos, move, next, san, bestSan, bestUci, bestLine (uci[]), refutation (uci[] from `next`),
 *        wpBefore, wpAfter (mover POV, 0-100), mateBefore, mateAfter (mover POV), opening, ply, prevCls, loss }
 */
export function explain(ctx) {
  const { cls, pos, move: m, next, san, bestSan, wpBefore, wpAfter, mateBefore, mateAfter, ply } = ctx;
  const us = pos.turn, them = us ^ 1;
  const did = describe(pos, m, next);
  const Did = did.charAt(0).toUpperCase() + did.slice(1);
  const out = next.outcome();
  if (out && out.winner === us) {
    const how = { checkmate: 'delivers checkmate', explosion: 'blows up the enemy king', hill: 'marches the king onto the hill', threecheck: 'lands the third check' }[out.reason] || 'wins the game';
    return `${san} ${how}. Game over!`;
  }
  switch (cls) {
    case 'book': return ctx.opening ? `${san} is a book move — this is the ${ctx.opening}.` : `${san} is a standard book move.`;
    case 'forced': return `${san} was the only legal move.`;
    case 'brilliant': return `Brilliant! ${san} offers material, yet the engine confirms it is the strongest move in the position. It leaves you with ${edge(wpAfter)}.`;
    case 'great': {
      const what = wpBefore >= 62 ? 'keeps your advantage' : wpBefore >= 42 ? 'holds the balance' : 'keeps you in the game';
      return `Great move! ${san} is the only move that ${what} — everything else is clearly worse. It ${did}.`;
    }
    case 'best': {
      if (mateAfter != null && mateAfter > 0) return `Best move. ${san} ${did} and forces mate in ${mateAfter}.`;
      return pick([`Best move. ${Did}.`, `${san} is the engine's top choice: it ${did}.`, `Exactly right — ${san} ${did}.`], ply);
    }
    case 'excellent': return `${san} is an excellent move: it ${did}. ${bestSan && bestSan !== san ? `${bestSan} was a hair more precise.` : ''}`.trim();
    case 'good': return `${san} is a decent move — it ${did}. ${bestSan ? `The engine prefers ${bestSan}.` : ''}`.trim();
    default: break;
  }

  // ---- inaccuracy / mistake / blunder / miss: find the concrete reason -------------------
  const label = { inaccuracy: 'an inaccuracy', mistake: 'a mistake', blunder: 'a blunder', miss: 'a missed opportunity' }[cls] || 'inaccurate';
  const better = bestSan ? ` ${bestSan} was the move.` : '';
  const ref = ctx.refutation || [];
  const refMove = ref.length ? next.parseUci(ref[0]) : null;
  const refSan = refMove ? next.san(refMove) : null;

  if (mateAfter != null && mateAfter < 0 && !(mateBefore != null && mateBefore < 0)) {
    return `${san} is ${label}: it allows a forced mate in ${-mateAfter}${refSan ? ` starting with ${refSan}` : ''}.${better}`;
  }
  if (mateBefore != null && mateBefore > 0 && !(mateAfter != null && mateAfter > 0)) {
    return `${san} misses a forced mate in ${mateBefore}${bestSan ? ` starting with ${bestSan}` : ''}. ${wpAfter >= 90 ? 'You are still winning, but the quick finish is gone.' : `Now you only have ${edge(wpAfter)}.`}`;
  }
  if (cls === 'miss') {
    const gain = ctx.bestLine ? lineSwing(pos, ctx.bestLine, us) : 0;
    const prize = gain >= 800 ? 'won the queen' : gain >= 450 ? 'won a rook' : gain >= 250 ? 'won a piece' : gain >= 90 ? 'won a pawn' : `given you ${edge(wpBefore)}`;
    return `${san} misses a chance to punish your opponent's last move.${bestSan ? ` ${bestSan} would have ${prize}.` : ''}`;
  }
  if (refMove) {
    const after = next.after(refMove);
    // 1. the reply simply takes something
    if (refMove.captured && refMove.captured !== PAWN || (refMove.captured === PAWN && cls !== 'inaccuracy')) {
      const net = PIECE_VALUE[refMove.captured] - after.see(refMove.to, us);
      if (net >= 90) {
        const what = NAME[refMove.captured], where = sqName(refMove.to);
        if (refMove.to === m.to && m.flag !== F_DROP) return `${san} is ${label}: this hangs your ${what} on ${where} — ${refSan} simply takes it.${better}`;
        return `${san} is ${label}: it leaves your ${what} on ${where} undefended, and ${refSan} wins it.${better}`;
      }
    }
    // 2. the reply is a fork
    const forked = forkTargets(after, refMove.to, us);
    if (forked.length >= 2 && lineSwing(next, ref, them) >= 150) {
      const a = NAME[typeOf(after.board[forked[0]])], b = NAME[typeOf(after.board[forked[1]])];
      return `${san} is ${label}: it walks into a fork — ${refSan} attacks your ${a} and ${b} at the same time.${better}`;
    }
    // 3. material goes in the next few moves
    const swing = lineSwing(next, ref, them);
    if (swing >= 250) return `${san} is ${label}: after ${refSan} you lose ${swing >= 800 ? 'your queen' : swing >= 450 ? 'a rook' : 'a piece'} by force.${better}`;
    if (swing >= 90 && cls !== 'inaccuracy') return `${san} is ${label}: ${refSan} wins a pawn.${better}`;
  }
  // 4. you could have won material instead
  if (ctx.bestLine && ctx.bestLine.length) {
    const gain = lineSwing(pos, ctx.bestLine, us);
    if (gain >= 250) return `${san} is ${label}: you missed ${bestSan}, which wins ${gain >= 800 ? 'the queen' : gain >= 450 ? 'a rook' : 'a piece'}.`;
    if (gain >= 90 && cls !== 'inaccuracy') return `${san} is ${label}: ${bestSan} would have won a pawn.`;
  }
  // 5. positional explanation from the evaluation swing
  const from = edge(wpBefore), to = edge(wpAfter);
  if (from !== to) return `${san} is ${label}: it turns ${from} into ${to}.${refSan ? ` ${refSan} is the reply that shows why.` : ''}${better}`;
  return `${san} is ${label} — it ${did}, but gives up some of your ${wpBefore >= 50 ? 'advantage' : 'defensive chances'}.${better}`;
}

export function evalText(cp, mate) { return fmt(cp ?? 0, mate); }

// One-paragraph summary shown at the top of a review.
export function summarise({ white, black, result, reason, opening, userColor }) {
  const parts = [];
  if (opening) parts.push(`The game opened with the ${opening}.`);
  const better = white.accuracy - black.accuracy;
  if (Math.abs(better) < 3) parts.push('Both sides played at a similar level of accuracy.');
  else parts.push(`${better > 0 ? 'White' : 'Black'} played the more accurate game (${Math.max(white.accuracy, black.accuracy).toFixed(1)}% vs ${Math.min(white.accuracy, black.accuracy).toFixed(1)}%).`);
  const side = userColor === 'b' ? black : white, who = userColor ? 'You' : 'White';
  const bad = side.counts.blunder + side.counts.mistake + side.counts.miss;
  const brilliant = side.counts.brilliant + side.counts.great;
  if (brilliant) parts.push(`${who} found ${brilliant} standout move${brilliant > 1 ? 's' : ''}.`);
  if (bad === 0) parts.push(`${who} made no serious errors — a clean game.`);
  else parts.push(`${who} had ${bad} serious error${bad > 1 ? 's' : ''}; use "Retry" on those moves to drill the right idea.`);
  if (result && result !== '*') parts.push(`Result: ${result}${reason ? ` by ${reason}` : ''}.`);
  return parts.join(' ');
}

export { winPct };
