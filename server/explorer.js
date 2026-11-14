// Opening explorer: aggregates every archived game by position and merges the ECO book.
import { q, db } from './db.js';
import { Position } from '../public/assets/js/chess/chess.js';
import { bookMoves, openingByKey } from './openings.js';

const MAX_PLY = 40;
const upsert = () => q(`INSERT INTO explorer (variant, key, uci, white, draws, black, rating_sum, rated_n) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT(variant, key, uci) DO UPDATE SET white = white + excluded.white, draws = draws + excluded.draws, black = black + excluded.black,
    rating_sum = rating_sum + excluded.rating_sum, rated_n = rated_n + excluded.rated_n`);

// Adds a finished game (rules-engine Game) to the explorer tables.
export function indexGame(game, result, ratings = []) {
  if (game.variant === 'chess960' || game.startPly !== 0 || !['1-0', '0-1', '1/2-1/2'].includes(result)) return 0;
  const w = result === '1-0' ? 1 : 0, d = result === '1/2-1/2' ? 1 : 0, b = result === '0-1' ? 1 : 0;
  const known = ratings.filter((r) => Number.isFinite(r) && r > 0);
  const avg = known.length ? Math.round(known.reduce((a, c) => a + c, 0) / known.length) : 0;
  const st = upsert();
  const startKey = Position.fromFen(game.startFen, game.variant).hash();
  const n = Math.min(game.moves.length, MAX_PLY);
  db.transaction(() => {
    for (let i = 0; i < n; i++) st.run(game.variant, i === 0 ? startKey : game.moves[i - 1].hash, game.moves[i].uci, w, d, b, avg, avg ? 1 : 0);
  })();
  return n;
}

export function explore(fen, variant = 'standard') {
  const pos = Position.fromFen(fen, variant);
  const key = pos.hash();
  const byUci = new Map();
  for (const r of q('SELECT uci, white, draws, black, rating_sum, rated_n FROM explorer WHERE variant = ? AND key = ?').all(variant, key)) {
    byUci.set(r.uci, { uci: r.uci, white: r.white, draws: r.draws, black: r.black, games: r.white + r.draws + r.black, avgRating: r.rated_n ? Math.round(r.rating_sum / r.rated_n) : null, book: false, eco: null, name: null });
  }
  if (variant === 'standard') {
    for (const bm of bookMoves(key)) {
      const e = byUci.get(bm.uci) || { uci: bm.uci, white: 0, draws: 0, black: 0, games: 0, avgRating: null };
      byUci.set(bm.uci, { ...e, book: true, eco: bm.code, name: bm.name });
    }
  }
  const moves = [];
  const total = { white: 0, draws: 0, black: 0, games: 0 };
  for (const e of byUci.values()) {
    const m = pos.parseUci(e.uci);
    if (!m) continue;
    moves.push({ ...e, san: pos.san(m) });
    total.white += e.white; total.draws += e.draws; total.black += e.black; total.games += e.games;
  }
  moves.sort((a, b) => b.games - a.games || (b.book ? 1 : 0) - (a.book ? 1 : 0) || a.san.localeCompare(b.san));
  return { fen: pos.fen(), opening: variant === 'standard' ? openingByKey(key) : null, moves, total };
}
