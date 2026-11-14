#!/usr/bin/env node
// Creates data/chess.db (if needed), applies every schema migration and seeds the
// ECO opening encyclopedia and the tactical puzzle set. Safe to run repeatedly.
//   node scripts/init-db.mjs            # migrate + seed whatever is missing
//   node scripts/init-db.mjs --force    # re-seed openings and puzzles from the bundled data
import { migrate, db, closeDb } from '../server/db.js';
import { ensureSeeded } from '../server/seed.js';
import { config } from '../server/config.js';

const force = process.argv.includes('--force');
const ran = migrate();
const seed = ensureSeeded({ force });
const pragma = (name) => db.pragma(name, { simple: true });
const themes = db.prepare('SELECT theme, COUNT(*) n FROM puzzle_themes GROUP BY theme ORDER BY n DESC').all();

console.log(`database      ${config.dbPath}`);
console.log(`migrations    ${ran.length ? ran.join(', ') : 'up to date'}`);
console.log(`openings      ${seed.eco} lines covering ${seed.ecoCodes} ECO codes (A00–E99)`);
console.log(`puzzles       ${seed.puzzles} (${themes.length} themes: ${themes.slice(0, 8).map((t) => `${t.theme} ${t.n}`).join(', ')}, …)`);
console.log(`pragmas       journal_mode=${pragma('journal_mode')} synchronous=${pragma('synchronous')} cache_size=${pragma('cache_size')} mmap_size=${pragma('mmap_size')}`);

let ok = true;
if (seed.ecoCodes !== 500) { console.error(`expected 500 ECO codes, found ${seed.ecoCodes}`); ok = false; }
if (seed.puzzles < 250) { console.error(`expected at least 250 puzzles, found ${seed.puzzles}`); ok = false; }
if (pragma('journal_mode') !== 'wal') { console.error('journal_mode is not WAL'); ok = false; }
closeDb();
process.exit(ok ? 0 : 1);
