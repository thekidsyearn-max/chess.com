// WebSocket hub (/ws): authentication, heartbeats, lag measurement and message routing.
import { WebSocketServer } from 'ws';
import { config } from './config.js';
import { userFromToken } from './users.js';
import * as G from './games.js';
import { analysePosition } from './engine.js';
import { Position, VARIANTS } from '../public/assets/js/chess/chess.js';
import { queueBattle, cancelBattle, battleAnswer, battleDisconnect } from './battle.js';

const users = new Map(); // userId -> Set<conn>
const conns = new Set();
let lobbyTimer = null, nextConnId = 1;

export const onlineCount = () => users.size;
export const isOnline = (userId) => users.has(userId);
export function sendUser(userId, msg) { const set = users.get(userId); if (set) for (const c of set) c.send(msg); }

function lobbyChanged() {
  if (lobbyTimer) return;
  lobbyTimer = setTimeout(() => {
    lobbyTimer = null;
    const msg = { t: 'lobby:state', ...G.lobbyState(), online: users.size };
    for (const c of conns) if (c.lobby) c.send(msg);
  }, 250);
}

G.setTransport({ sendUser, lobbyChanged, isOnline });

function parseCookies(header) {
  const out = {};
  for (const part of String(header || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function originAllowed(req) {
  const origin = req.headers.origin;
  if (!origin) return true; // non-browser clients
  try {
    const host = new URL(origin).host;
    if (host === req.headers.host || host === req.headers['x-forwarded-host']) return true;
    return config.allowedOrigins.some((o) => o === origin || o === host);
  } catch { return false; }
}

// ---- interactive engine analysis -------------------------------------------------------
function stopAnalysis(conn) {
  if (conn.analysis) { conn.analysis.job.cancel(); conn.analysis = null; }
}

function startAnalysis(conn, msg) {
  stopAnalysis(conn);
  const variant = VARIANTS.includes(msg.variant) ? msg.variant : 'standard';
  const reqId = msg.reqId;
  let pos;
  try { pos = Position.fromFen(String(msg.fen || ''), variant); } catch { return conn.send({ t: 'analysis:info', reqId, error: 'Invalid FEN.' }); }
  const bad = pos.validate();
  if (bad) return conn.send({ t: 'analysis:info', reqId, error: bad });
  const o = pos.outcome();
  if (o) return conn.send({ t: 'analysis:info', reqId, lines: [], done: true, over: o });
  const multipv = Math.max(1, Math.min(5, parseInt(msg.multipv, 10) || 1));
  let last = 0, pending = null, timer = null;
  const pack = (lines, source, done) => ({
    t: 'analysis:info', reqId, source, done,
    lines: lines.map((l) => ({ multipv: l.multipv, depth: l.depth, cp: l.cp ?? null, mate: l.mate ?? null, nodes: l.nodes, nps: l.nps, pv: (l.pv || [l.uci]).slice(0, 14) })),
  });
  const flush = () => { timer = null; if (pending && conn.analysis && conn.analysis.reqId === reqId) { conn.send(pending); pending = null; last = Date.now(); } };
  const job = analysePosition({
    variant, fen: pos.fen(), multipv, depth: config.analysis.maxDepth, movetime: msg.deeper ? config.analysis.maxMs * 2 : config.analysis.maxMs,
    preemptible: true, hardTimeoutMs: 6000, liteNodes: 200_000, liteDepth: 6,
    onInfo: (lines, source) => {
      pending = pack(lines, source, false);
      if (!timer) timer = setTimeout(flush, Math.max(0, 140 - (Date.now() - last)));
    },
  });
  conn.analysis = { job, reqId };
  job.then((r) => {
    clearTimeout(timer);
    if (!conn.analysis || conn.analysis.job !== job) return;
    conn.analysis = null;
    if (r.lines.length) conn.send(pack(r.lines, r.source, true));
  }).catch(() => {});
}

// ---- message routing ---------------------------------------------------------------------
const handlers = {
  ping(conn, m) {
    if (Number.isFinite(m.rtt)) conn.lag = Math.max(0, Math.min(2000, m.rtt));
    conn.send({ t: 'pong', c: m.c, s: Date.now() });
  },
  'lobby:sub'(conn) { conn.lobby = true; conn.send({ t: 'lobby:state', ...G.lobbyState(), online: users.size }); },
  'lobby:unsub'(conn) { conn.lobby = false; },
  'seek:create'(conn, m) {
    const r = G.createSeek(conn.user, { tc: m.tc, variant: m.variant, rated: m.rated });
    if (r.error) conn.send({ t: 'seek:error', error: r.error, gameId: r.gameId || null });
    else if (r.gameId) conn.send({ t: 'seek:matched', gameId: r.gameId });
    else conn.send({ t: 'seek:created', seekId: r.seekId, tc: m.tc, variant: m.variant || 'standard' });
  },
  'seek:cancel'(conn) { G.cancelSeek(conn.user.id); conn.send({ t: 'seek:cancelled' }); },
  'seek:accept'(conn, m) {
    const r = G.acceptSeek(conn.user, m.id);
    if (r.error) conn.send({ t: 'seek:error', error: r.error, gameId: r.gameId || null });
    else conn.send({ t: 'seek:matched', gameId: r.gameId });
  },
  'game:join'(conn, m) { if (typeof m.id === 'string') G.joinGame(conn, m.id); },
  'game:leave'(conn, m) { if (typeof m.id === 'string') G.leaveGame(conn, m.id); },
  'game:move'(conn, m) { G.playerMove(conn, m); },
  'game:resign'(conn, m) { G.resign(conn, m.id); },
  'game:abort'(conn, m) { G.abort(conn, m.id); },
  'game:draw'(conn, m) { G.drawOffer(conn, m.id, m.action); },
  'game:takeback'(conn, m) { G.takeback(conn, m.id); },
  'game:hint'(conn, m) { G.hint(conn, m.id); },
  'game:chat'(conn, m) { G.chat(conn, m.id, m.text); },
  'game:rematch'(conn, m) { G.rematch(conn, m.id); },
  'analysis:start'(conn, m) { startAnalysis(conn, m); },
  'analysis:stop'(conn) { stopAnalysis(conn); },
  'battle:queue'(conn) { queueBattle(conn); },
  'battle:cancel'(conn) { cancelBattle(conn); },
  'battle:answer'(conn, m) { battleAnswer(conn, m); },
};

function onConnection(ws, user) {
  const conn = {
    id: nextConnId++, ws, user, games: new Set(), lag: 0, lobby: false, analysis: null, battle: null, alive: true, tokens: 60, refill: Date.now(),
    send(msg) { if (ws.readyState === 1) ws.send(JSON.stringify(msg)); },
  };
  conns.add(conn);
  let set = users.get(user.id);
  if (!set) users.set(user.id, (set = new Set()));
  set.add(conn);
  conn.send({ t: 'hello', user: { id: user.id, username: user.username }, now: Date.now() });

  ws.on('pong', () => { conn.alive = true; });
  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    // token bucket: 60 burst, 30 messages per second sustained
    const t = Date.now();
    conn.tokens = Math.min(60, conn.tokens + ((t - conn.refill) / 1000) * 30);
    conn.refill = t;
    if (conn.tokens < 1) return ws.close(1008, 'rate limit');
    conn.tokens--;
    let msg;
    try { msg = JSON.parse(data.toString()); } catch { return; }
    if (!msg || typeof msg.t !== 'string') return;
    const h = handlers[msg.t];
    if (!h) return;
    try { h(conn, msg); } catch (e) { console.error('ws handler', msg.t, e); conn.send({ t: 'error', error: 'Internal error.' }); }
  });
  ws.on('close', () => {
    conns.delete(conn);
    stopAnalysis(conn);
    battleDisconnect(conn);
    for (const id of [...conn.games]) G.leaveGame(conn, id);
    const s = users.get(user.id);
    if (s) { s.delete(conn); if (!s.size) { users.delete(user.id); G.userOffline(user.id); } }
  });
  ws.on('error', () => {});
}

export function attachWebSocket(server) {
  const wss = new WebSocketServer({ noServer: true, perMessageDeflate: false, maxPayload: 32 * 1024 });
  server.on('upgrade', (req, socket, head) => {
    let pathname = '';
    try { pathname = new URL(req.url, 'http://x').pathname; } catch { /* malformed */ }
    if (pathname !== '/ws') { socket.destroy(); return; }
    if (!originAllowed(req)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); return; }
    const user = userFromToken(parseCookies(req.headers.cookie).sid);
    if (!user) { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); return; }
    wss.handleUpgrade(req, socket, head, (ws) => onConnection(ws, user));
  });
  const beat = setInterval(() => {
    for (const c of conns) {
      if (!c.alive) { c.ws.terminate(); continue; }
      c.alive = false;
      try { c.ws.ping(); } catch { /* closing */ }
    }
  }, 30_000);
  beat.unref();
  return { wss, close: () => { clearInterval(beat); for (const c of conns) c.ws.close(1001, 'server shutting down'); wss.close(); } };
}

export const hubStats = () => ({ connections: conns.size, users: users.size });
