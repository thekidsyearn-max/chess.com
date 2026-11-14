// Rookery server entry point: Fastify (REST) + ws (WebSockets) + SQLite + bounded Stockfish pool.
import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import { createReadStream, readFileSync, statSync, existsSync, readdirSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { config, ROOT } from './config.js';
import { migrate, closeDb } from './db.js';
import { ensureSeeded } from './seed.js';
import { registerApi, memoryReport } from './api.js';
import { attachWebSocket } from './ws.js';
import { recoverOnBoot, sweepDaily, shutdownGames } from './games.js';
import { cleanup } from './users.js';
import { engineShutdown } from './engine.js';
import { stockfish } from './stockfish.js';

const pkg = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));

// ---- boot: schema, seed data, crash recovery ---------------------------------------------
const ran = migrate();
if (ran.length) console.log(`[db] applied migrations: ${ran.join(', ')}`);
const seed = ensureSeeded();
console.log(`[db] ${seed.eco} opening lines (${seed.ecoCodes} ECO codes), ${seed.puzzles} puzzles${seed.seeded ? ' — seeded' : ''}`);
const aborted = recoverOnBoot();
if (aborted) console.log(`[games] aborted ${aborted} live game(s) interrupted by the last shutdown`);

// ---- static files (only used when Nginx is not in front) -----------------------------------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8', '.wav': 'audio/wav', '.png': 'image/png', '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json', '.txt': 'text/plain; charset=utf-8', '.woff2': 'font/woff2',
};
const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.json', '.txt', '.webmanifest']);
const ROOT_FILES = new Set(['/favicon.svg', '/robots.txt', '/manifest.webmanifest']);

// Build id = hash of asset names + mtimes, so "immutable" caching is safe across deploys.
function buildId() {
  const h = createHash('sha1').update(pkg.version);
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p); else h.update(p).update(String(statSync(p).mtimeMs));
    }
  };
  try { walk(path.join(config.publicDir, 'assets')); } catch { /* assets missing */ }
  return h.digest('hex').slice(0, 10);
}
const BUILD = buildId();
const shell = () => readFileSync(path.join(config.publicDir, 'index.html'), 'utf8').replaceAll('__BUILD__', BUILD).replaceAll('__VERSION__', pkg.version);
let shellHtml = shell();

function sendStatic(req, reply, urlPath) {
  let rel = urlPath.replace(/^\/assets\/v\/[^/]+\//, '/assets/');
  try { rel = decodeURIComponent(rel); } catch { return reply.code(400).send('Bad request'); }
  const file = path.join(config.publicDir, path.normalize(rel));
  if (!file.startsWith(config.publicDir + path.sep)) return reply.code(403).send('Forbidden');
  let st;
  try { st = statSync(file); } catch { return reply.code(404).send('Not found'); }
  if (!st.isFile()) return reply.code(404).send('Not found');
  const ext = path.extname(file).toLowerCase();
  const etag = `W/"${st.size.toString(16)}-${Math.round(st.mtimeMs).toString(16)}"`;
  reply.header('content-type', MIME[ext] || 'application/octet-stream').header('etag', etag)
    .header('cache-control', config.env === 'development' ? 'no-cache' : 'public, max-age=2592000, immutable');
  if (req.headers['if-none-match'] === etag) return reply.code(304).send();
  if (COMPRESSIBLE.has(ext) && /\bgzip\b/.test(String(req.headers['accept-encoding'] || '')) && st.size > 1024) {
    reply.header('content-encoding', 'gzip').header('vary', 'Accept-Encoding');
    return reply.send(createReadStream(file).pipe(createGzip({ level: 6 })));
  }
  reply.header('content-length', st.size);
  return reply.send(createReadStream(file));
}

// ---- HTTP -----------------------------------------------------------------------------------
const app = Fastify({ logger: { level: process.env.LOG_LEVEL || 'warn' }, trustProxy: config.trustProxy, bodyLimit: 262_144, routerOptions: { ignoreTrailingSlash: true } });
await app.register(cookie);

app.addHook('onSend', async (req, reply) => {
  reply.header('x-content-type-options', 'nosniff');
  reply.header('referrer-policy', 'same-origin');
  reply.header('x-frame-options', 'SAMEORIGIN');
});

await registerApi(app);

app.setNotFoundHandler((req, reply) => {
  const urlPath = req.url.split('?')[0];
  if (req.method !== 'GET' && req.method !== 'HEAD') return reply.code(404).send({ error: 'Not found.' });
  if (/^\/(assets|pieces|sounds)\//.test(urlPath) || ROOT_FILES.has(urlPath)) {
    if (!config.serveStatic) return reply.code(404).send('Static files are served by Nginx.');
    return sendStatic(req, reply, urlPath);
  }
  // single-page app shell for every other route
  if (config.env === 'development') shellHtml = shell();
  return reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-cache').send(shellHtml);
});

const hub = attachWebSocket(app.server);

// ---- background jobs ---------------------------------------------------------------------------
const timers = [
  setInterval(() => { try { sweepDaily(); } catch (e) { console.error('[daily]', e); } }, 60_000),
  setInterval(() => { try { cleanup(); } catch (e) { console.error('[cleanup]', e); } }, 3_600_000),
  // memory watchdog: the whole stack (Node + Stockfish workers) must stay under the ceiling
  setInterval(async () => {
    const m = await memoryReport();
    if (m.totalMb > config.limits.memoryCeilingMb * 0.85) {
      console.warn(`[memory] ${m.totalMb} MB in use (node ${m.nodeRssMb}, stockfish ${m.stockfishRssMb}) — recycling engine workers`);
      stockfish.shutdown();
      if (global.gc) global.gc();
    }
    if (m.nodeRssMb > config.limits.memoryCeilingMb) { console.error('[memory] ceiling exceeded, restarting'); shutdown(1); }
  }, 30_000),
];
for (const t of timers) t.unref();

let closing = false;
async function shutdown(code = 0) {
  if (closing) return;
  closing = true;
  console.log('[server] shutting down');
  for (const t of timers) clearInterval(t);
  try { hub.close(); } catch { /* ignore */ }
  try { shutdownGames(); } catch { /* ignore */ }
  try { engineShutdown(); } catch { /* ignore */ }
  try { await app.close(); } catch { /* ignore */ }
  try { closeDb(); } catch { /* ignore */ }
  process.exit(code);
}
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('unhandledRejection', (e) => console.error('[unhandledRejection]', e));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (e) {
  console.error(`[server] could not listen on ${config.host}:${config.port}: ${e.message}`);
  process.exit(1);
}
const mem = await memoryReport();
console.log(`[server] Rookery ${pkg.version} (build ${BUILD}) listening on http://${config.host}:${config.port}`);
console.log(`[server] static: ${config.serveStatic ? 'served by Node' : 'served by Nginx'} · stockfish: ${stockfish.available ? config.stockfish.path : 'NOT FOUND — using built-in engine'} · memory: ${mem.totalMb} MB`);
if (!existsSync(path.join(config.publicDir, 'pieces')) || !existsSync(path.join(config.publicDir, 'sounds', 'move-self.wav'))) {
  console.warn('[server] piece sets or sounds are missing — run: npm run assets');
}
