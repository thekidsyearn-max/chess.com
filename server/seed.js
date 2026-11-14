// First-boot seeding: ECO encyclopedia and the tactical puzzle set.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { db, getMeta, setMeta } from './db.js';
import { ROOT } from './config.js';
import { seedEco } from './openings.js';
import { Position } from '../public/assets/js/chess/chess.js';

const SEED_VERSION = '1';

export function seedPuzzles() {
  const file = path.join(ROOT, 'server', 'data', 'puzzles.json');
  if (!existsSync(file)) throw new Error('server/data/puzzles.json is missing — run: npm run puzzles:generate');
  const list = JSON.parse(readFileSync(file, 'utf8'));
  const ins = db.prepare('INSERT INTO puzzles (id, fen, moves, last_move, rating, themes) VALUES (?, ?, ?, ?, ?, ?)');
  const insTheme = db.prepare('INSERT OR IGNORE INTO puzzle_themes (theme, puzzle_id, rating) VALUES (?, ?, ?)');
  let n = 0;
  db.transaction(() => {
    db.exec('DELETE FROM puzzle_themes; DELETE FROM puzzles;');
    for (const p of list) {
      // re-verify every solution line against the rules engine before it is stored
      let pos = Position.fromFen(p.fen, 'standard');
      let ok = true;
      for (const u of p.moves.split(' ')) { const m = pos.parseUci(u); if (!m) { ok = false; break; } pos = pos.after(m); }
      if (!ok) continue;
      ins.run(p.id, p.fen, p.moves, p.lastMove || '', p.rating, p.themes.join(' '));
      for (const t of p.themes) insTheme.run(t, p.id, p.rating);
      n++;
    }
  })();
  return n;
}

// Idempotent: seeds whatever is missing. Returns a summary.
export function ensureSeeded({ force = false } = {}) {
  const out = { eco: 0, ecoCodes: 0, puzzles: 0, seeded: false };
  const current = getMeta('seed_version');
  const ecoCount = db.prepare('SELECT COUNT(*) n FROM eco').get().n;
  const puzzleCount = db.prepare('SELECT COUNT(*) n FROM puzzles').get().n;
  if (force || current !== SEED_VERSION || ecoCount === 0) {
    const r = seedEco();
    out.seeded = true;
    out.eco = r.openings; out.ecoCodes = r.codes;
  } else { out.eco = ecoCount; out.ecoCodes = db.prepare('SELECT COUNT(DISTINCT code) n FROM eco').get().n; }
  if (force || current !== SEED_VERSION || puzzleCount === 0) { out.puzzles = seedPuzzles(); out.seeded = true; }
  else out.puzzles = puzzleCount;
  setMeta('seed_version', SEED_VERSION);
  return out;
}
