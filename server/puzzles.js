// Rated puzzles (Glicko-2 for both solver and puzzle), Puzzle Rush runs and leaderboards.
import { randomBytes } from 'node:crypto';
import { db, q } from './db.js';
import { Position } from '../public/assets/js/chess/chess.js';
import { getRating, rateSolo } from './users.js';
import { glicko2 } from './glicko2.js';

export const THEME_NAMES = {
  mateIn1: 'Mate in 1', mateIn2: 'Mate in 2', mateIn3: 'Mate in 3', mateIn4: 'Mate in 4', mateIn5: 'Mate in 5', mate: 'Checkmate',
  fork: 'Fork', pin: 'Pin', skewer: 'Skewer', discoveredAttack: 'Discovered Attack', backRank: 'Back Rank', sacrifice: 'Sacrifice',
  quietMove: 'Quiet Move', endgame: 'Endgame', middlegame: 'Middlegame', opening: 'Opening', promotion: 'Promotion', underPromotion: 'Underpromotion',
  enPassant: 'En Passant', advantage: 'Advantage', crushing: 'Crushing', oneMove: 'One Move', short: 'Short', long: 'Long', veryLong: 'Very Long',
};
const FEATURED = ['mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'fork', 'pin', 'skewer', 'discoveredAttack', 'backRank', 'sacrifice', 'quietMove', 'endgame'];

const json = (p) => ({
  id: p.id, fen: p.fen, moves: p.moves.split(' '), lastMove: p.last_move || null, rating: Math.round(p.rating),
  themes: p.themes.split(' '), plays: p.plays, solved: p.solved,
});

export function listThemes() {
  const counts = new Map(q('SELECT theme, COUNT(*) n FROM puzzle_themes GROUP BY theme').all().map((r) => [r.theme, r.n]));
  const all = [...counts.keys()].sort((a, b) => (FEATURED.indexOf(a) + 100 * (FEATURED.indexOf(a) < 0)) - (FEATURED.indexOf(b) + 100 * (FEATURED.indexOf(b) < 0)) || a.localeCompare(b));
  return all.map((t) => ({ id: t, name: THEME_NAMES[t] || t, count: counts.get(t), featured: FEATURED.includes(t) }));
}

export const puzzleById = (id) => { const p = q('SELECT * FROM puzzles WHERE id = ?').get(id); return p ? json(p) : null; };

// A puzzle near the solver's rating that they have not seen recently.
export function nextPuzzle(user, { theme = null, around = null } = {}) {
  const rating = around ?? getRating(user.id, 'puzzle').rating;
  const recent = 'SELECT puzzle_id FROM (SELECT puzzle_id, id FROM puzzle_attempts WHERE user_id = ? ORDER BY id DESC LIMIT 400)';
  for (const win of [120, 250, 500, 5000]) {
    const row = theme
      ? q(`SELECT p.* FROM puzzle_themes t JOIN puzzles p ON p.id = t.puzzle_id WHERE t.theme = ? AND t.rating BETWEEN ? AND ? AND p.id NOT IN (${recent}) ORDER BY RANDOM() LIMIT 1`).get(theme, rating - win, rating + win, user.id)
      : q(`SELECT p.* FROM puzzles p WHERE p.rating BETWEEN ? AND ? AND p.id NOT IN (${recent}) ORDER BY RANDOM() LIMIT 1`).get(rating - win, rating + win, user.id);
    if (row) return json(row);
  }
  const any = theme
    ? q('SELECT p.* FROM puzzle_themes t JOIN puzzles p ON p.id = t.puzzle_id WHERE t.theme = ? ORDER BY ABS(t.rating - ?) + ABS(RANDOM() % 300) LIMIT 1').get(theme, rating)
    : q('SELECT * FROM puzzles ORDER BY ABS(rating - ?) + ABS(RANDOM() % 300) LIMIT 1').get(rating);
  return any ? json(any) : null;
}

// Checks the solver's moves against the stored line. Any mating move is accepted as the final move.
export function checkSolution(puzzle, played) {
  if (!Array.isArray(played)) return false;
  const line = puzzle.moves;
  let pos = Position.fromFen(puzzle.fen, 'standard');
  let k = 0;
  for (let i = 0; i < line.length; i++) {
    if (i % 2 === 0) {
      const mine = pos.parseUci(String(played[k++] || ''));
      const want = pos.parseUci(line[i]);
      if (!mine) return false;
      if (mine !== want) {
        const after = pos.after(mine);
        const o = after.outcome();
        return !!(o && o.reason === 'checkmate'); // an alternative mate also solves it
      }
      pos = pos.after(mine);
    } else pos = pos.after(pos.parseUci(line[i]));
  }
  return true;
}

export const submitAttempt = db.transaction((user, puzzleId, { moves, hints = 0 }) => {
  const row = q('SELECT * FROM puzzles WHERE id = ?').get(puzzleId);
  if (!row) return { error: 'Puzzle not found.' };
  const puzzle = json(row);
  const correct = checkSolution(puzzle, moves);
  const clean = correct && !hints;
  const seen = !!q('SELECT 1 FROM puzzle_attempts WHERE user_id = ? AND puzzle_id = ? LIMIT 1').get(user.id, puzzleId);
  const mine = getRating(user.id, 'puzzle');
  let diff = 0, after = Math.round(mine.rating);
  if (!seen) {
    const r = rateSolo(user.id, 'puzzle', { rating: row.rating, rd: row.rd }, clean ? 1 : 0, 'p' + puzzleId);
    diff = r.diff; after = r.after;
    const pn = glicko2({ rating: row.rating, rd: Math.max(row.rd, 45), vol: row.vol }, [{ rating: mine.rating, rd: mine.rd, score: clean ? 0 : 1 }]);
    q('UPDATE puzzles SET rating = ?, rd = ?, vol = ?, plays = plays + 1, solved = solved + ? WHERE id = ?').run(pn.rating, Math.max(45, pn.rd), pn.vol, clean ? 1 : 0, puzzleId);
    q('UPDATE puzzle_themes SET rating = ? WHERE puzzle_id = ?').run(pn.rating, puzzleId);
  }
  q('INSERT INTO puzzle_attempts (user_id, puzzle_id, solved, rating, diff, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(user.id, puzzleId, clean ? 1 : 0, after, diff, Date.now());
  return { correct, rated: !seen, diff, rating: after, puzzleRating: Math.round(row.rating), solution: puzzle.moves };
});

export function puzzleHistory(userId, limit = 30) {
  return q(`SELECT a.puzzle_id AS id, a.solved, a.rating, a.diff, a.created_at AS at, p.themes, p.rating AS puzzleRating
            FROM puzzle_attempts a JOIN puzzles p ON p.id = a.puzzle_id WHERE a.user_id = ? ORDER BY a.id DESC LIMIT ?`).all(userId, limit)
    .map((r) => ({ ...r, solved: !!r.solved, puzzleRating: Math.round(r.puzzleRating), themes: r.themes.split(' ') }));
}

export function puzzleStats(userId) {
  const r = q('SELECT COUNT(*) n, COALESCE(SUM(solved), 0) s FROM puzzle_attempts WHERE user_id = ?').get(userId);
  return { attempts: r.n, solved: r.s };
}

// ---- Puzzle Rush ----------------------------------------------------------------------
export const RUSH_MODES = { '3min': { label: '3 Minutes', ms: 180_000, strikes: 3 }, '5min': { label: '5 Minutes', ms: 300_000, strikes: 3 }, survival: { label: 'Survival', ms: 0, strikes: 3 } };
const runs = new Map();

// An escalating queue: easy mates first, climbing ~30 rating points per puzzle.
export function rushQueue(count = 80, startRating = 450, step = 30) {
  const used = new Set();
  const out = [];
  const max = q('SELECT MAX(rating) m FROM puzzles').get().m || 2500;
  for (let i = 0; i < count; i++) {
    const target = Math.min(max, startRating + i * step);
    const rows = q('SELECT * FROM puzzles WHERE rating BETWEEN ? AND ? ORDER BY RANDOM() LIMIT 8').all(target - 90, target + 90);
    let pick = rows.find((r) => !used.has(r.id));
    if (!pick) pick = q('SELECT * FROM puzzles ORDER BY ABS(rating - ?) + ABS(RANDOM() % 200) LIMIT 30').all(target).find((r) => !used.has(r.id));
    if (!pick) break;
    used.add(pick.id);
    out.push(json(pick));
  }
  return out;
}

export function startRush(user, mode) {
  const def = RUSH_MODES[mode];
  if (!def) return { error: 'Unknown mode.' };
  const runId = randomBytes(9).toString('base64url');
  const puzzles = rushQueue();
  runs.set(runId, { userId: user.id, mode, startedAt: Date.now(), ids: puzzles.map((p) => p.id) });
  if (runs.size > 2000) for (const [k, v] of runs) if (Date.now() - v.startedAt > 3_600_000) runs.delete(k);
  return { runId, mode, ms: def.ms, strikes: def.strikes, puzzles };
}

export function finishRush(user, { runId, results }) {
  const run = runs.get(runId);
  if (!run || run.userId !== user.id) return { error: 'This run has expired.' };
  runs.delete(runId);
  const def = RUSH_MODES[run.mode];
  const elapsed = Date.now() - run.startedAt;
  let score = 0, strikes = 0, streak = 0, bestStreak = 0;
  const breakdown = [];
  const list = Array.isArray(results) ? results.slice(0, run.ids.length) : [];
  for (let i = 0; i < list.length && strikes < def.strikes; i++) {
    const r = list[i];
    if (!r || r.id !== run.ids[i]) break; // puzzles must be answered in queue order
    const p = puzzleById(r.id);
    const ok = !!p && checkSolution(p, r.moves);
    if (ok) { score++; streak++; bestStreak = Math.max(bestStreak, streak); } else { strikes++; streak = 0; }
    breakdown.push({ id: r.id, ok, rating: p ? p.rating : 0 });
  }
  if (def.ms && elapsed > def.ms + 20_000) return { error: 'Time limit exceeded.' };
  q('INSERT INTO scores (user_id, kind, score, detail, created_at) VALUES (?, ?, ?, ?, ?)').run(user.id, 'rush:' + run.mode, score, JSON.stringify({ strikes, bestStreak, ms: elapsed }), Date.now());
  const best = q('SELECT MAX(score) m FROM scores WHERE user_id = ? AND kind = ?').get(user.id, 'rush:' + run.mode).m || 0;
  return { score, strikes, bestStreak, best, isBest: score >= best && score > 0, breakdown };
}

export function scoreboard(kind, limit = 20) {
  return q(`SELECT u.username, MAX(s.score) AS score, MAX(s.created_at) AS at FROM scores s JOIN users u ON u.id = s.user_id
            WHERE s.kind = ? GROUP BY s.user_id ORDER BY score DESC, at ASC LIMIT ?`).all(kind, limit)
    .map((r, i) => ({ rank: i + 1, username: r.username, score: r.score, at: r.at }));
}

export const bestScore = (userId, kind) => q('SELECT MAX(score) m FROM scores WHERE user_id = ? AND kind = ?').get(userId, kind).m || 0;

export function addScore(userId, kind, score, detail = {}) {
  q('INSERT INTO scores (user_id, kind, score, detail, created_at) VALUES (?, ?, ?, ?, ?)').run(userId, kind, Math.round(score), JSON.stringify(detail), Date.now());
  return bestScore(userId, kind);
}
