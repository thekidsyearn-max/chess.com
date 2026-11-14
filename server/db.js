import Database from 'better-sqlite3';
import { mkdirSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { config, ROOT } from './config.js';

mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);

// Strict memory caps: 16 MB page cache, 64 MB mmap window, WAL journal.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('cache_size = -16000');
db.pragma('mmap_size = 67108864');
db.pragma('temp_store = MEMORY');
db.pragma('foreign_keys = ON');
db.pragma('busy_timeout = 5000');
db.pragma('wal_autocheckpoint = 1000');
db.pragma('journal_size_limit = 16777216');

export function migrate() {
  db.exec('CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL) WITHOUT ROWID');
  const dir = path.join(ROOT, 'server', 'migrations');
  const applied = new Set(db.prepare('SELECT name FROM schema_migrations').all().map((r) => r.name));
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  const ran = [];
  for (const f of files) {
    if (applied.has(f)) continue;
    const sql = readFileSync(path.join(dir, f), 'utf8');
    db.transaction(() => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)').run(f, Date.now());
    })();
    ran.push(f);
  }
  return ran;
}

const cache = new Map();
// Cached prepared statement helper.
export function q(sql) {
  let st = cache.get(sql);
  if (!st) { st = db.prepare(sql); cache.set(sql, st); }
  return st;
}

export const tx = (fn) => db.transaction(fn);
export const now = () => Date.now();

export function getMeta(key, fallback = null) {
  const r = q('SELECT value FROM meta WHERE key = ?').get(key);
  return r ? r.value : fallback;
}
export function setMeta(key, value) {
  q('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
}

export function closeDb() {
  try { db.pragma('wal_checkpoint(TRUNCATE)'); } catch { /* ignore */ }
  db.close();
}
