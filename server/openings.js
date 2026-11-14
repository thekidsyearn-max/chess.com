// Opening book: ECO seeding, opening detection and book-move lookups.
import { db, q } from './db.js';
import { parseEco } from './data/eco.js';
import { Game } from '../public/assets/js/chess/chess.js';

export function seedEco() {
  const entries = parseEco();
  const lines = [];
  const finals = new Map();
  for (const e of entries) {
    const g = new Game();
    for (const s of e.sans) if (!g.play(s)) throw new Error(`ECO ${e.code} "${e.name}": illegal move ${s}`);
    const key = g.pos.hash();
    if (!finals.has(key)) finals.set(key, e);
    lines.push({ e, g, key });
  }
  const insEco = db.prepare('INSERT INTO eco (code, name, pgn, uci, ply, key) VALUES (?, ?, ?, ?, ?, ?)');
  const insMove = db.prepare('INSERT OR IGNORE INTO eco_moves (key, uci, code, name) VALUES (?, ?, ?, ?)');
  db.transaction(() => {
    db.exec('DELETE FROM eco; DELETE FROM eco_moves;');
    for (const { e, g, key } of lines) {
      insEco.run(e.code, e.name, g.moveText('').trim(), g.uciMoves().join(' '), g.ply, key);
      // every prefix position gets its continuing book move, named after the position it leads to
      const walk = new Game();
      let cls = null;
      for (const rec of g.moves) {
        const from = walk.pos.hash();
        walk.play(rec.uci);
        cls = finals.get(walk.pos.hash()) || cls || e;
        insMove.run(from, rec.uci, cls.code, cls.name);
      }
    }
  })();
  return { openings: entries.length, codes: new Set(entries.map((e) => e.code)).size };
}

export const openingByKey = (key) => q('SELECT code, name, ply FROM eco WHERE key = ? ORDER BY ply DESC LIMIT 1').get(key) || null;
export const bookMoves = (key) => q('SELECT uci, code, name FROM eco_moves WHERE key = ?').all(key);
export const isBookMove = (key, uci) => !!q('SELECT 1 FROM eco_moves WHERE key = ? AND uci = ?').get(key, uci);

// Deepest named opening position reached in a game's first 40 plies.
export function detectOpening(game) {
  if (game.variant !== 'standard' || game.startPly !== 0) return null;
  let found = null;
  const n = Math.min(game.moves.length, 40);
  for (let i = 0; i < n; i++) {
    const hit = openingByKey(game.moves[i].hash);
    if (hit) found = { code: hit.code, name: hit.name, ply: i + 1 };
  }
  return found;
}

export function searchOpenings(text, limit = 30) {
  const t = `%${String(text || '').replace(/[%_]/g, '')}%`;
  return q('SELECT code, name, pgn, uci FROM eco WHERE name LIKE ? OR code LIKE ? ORDER BY code, ply LIMIT ?').all(t, t, limit);
}
