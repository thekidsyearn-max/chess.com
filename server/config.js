import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function findStockfish() {
  const candidates = [
    process.env.STOCKFISH_PATH,
    '/opt/homebrew/bin/stockfish', // Apple Silicon Homebrew
    '/usr/local/bin/stockfish', // Intel Homebrew
    '/usr/games/stockfish',
    '/usr/bin/stockfish',
  ].filter(Boolean);
  for (const c of candidates) if (existsSync(c)) return c;
  try {
    const found = execFileSync('which', ['stockfish'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (found && existsSync(found)) return found;
  } catch { /* not on PATH */ }
  return null;
}

const int = (v, d) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : d);

export const config = {
  root: ROOT,
  env: process.env.NODE_ENV || 'production',
  host: process.env.HOST || '127.0.0.1',
  port: int(process.env.PORT, 8080),
  publicDir: path.join(ROOT, 'public'),
  dataDir: process.env.DATA_DIR || path.join(ROOT, 'data'),
  dbPath: process.env.DB_PATH || path.join(process.env.DATA_DIR || path.join(ROOT, 'data'), 'chess.db'),
  // Node serves /public itself unless Nginx is in front (SERVE_STATIC=0).
  serveStatic: process.env.SERVE_STATIC !== '0',
  cookieSecure: process.env.COOKIE_SECURE === '1',
  trustProxy: process.env.TRUST_PROXY !== '0',
  allowedOrigins: (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean),
  sessionDays: int(process.env.SESSION_DAYS, 30),
  stockfish: {
    path: findStockfish(),
    maxProcesses: Math.min(2, Math.max(1, int(process.env.STOCKFISH_PROCESSES, 2))), // hard cap: 2
    hashMb: Math.min(32, Math.max(1, int(process.env.STOCKFISH_HASH_MB, 32))), // hard cap: 32 MB
    threads: 1, // always single-threaded per worker
    idleKillMs: int(process.env.STOCKFISH_IDLE_MS, 90_000),
  },
  review: { nodes: int(process.env.REVIEW_NODES, 300_000), maxDepth: int(process.env.REVIEW_DEPTH, 18), multipv: 3 },
  analysis: { maxDepth: int(process.env.ANALYSIS_DEPTH, 26), maxMs: int(process.env.ANALYSIS_MS, 12_000) },
  limits: { disconnectGraceMs: 45_000, firstMoveMs: 30_000, maxLagCompMs: 500, memoryCeilingMb: int(process.env.MEMORY_CEILING_MB, 900) },
};
