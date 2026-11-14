// REST API (/api/*). JSON in, JSON out; session cookie auth.
import { execFile } from 'node:child_process';
import { db, q } from './db.js';
import { config } from './config.js';
import * as U from './users.js';
import * as G from './games.js';
import * as P from './puzzles.js';
import { BOTS, TIERS, publicBot } from './bots.js';
import { DRILLS } from './data/drills.js';
import { getReview, startReview, reviewStats } from './review.js';
import { explore } from './explorer.js';
import { searchOpenings, detectOpening } from './openings.js';
import { analysePosition } from './engine.js';
import { stockfish } from './stockfish.js';
import { hubStats, onlineCount, isOnline } from './ws.js';
import { Game, Position, VARIANTS, VARIANT_NAMES, variantFromName, reasonText } from '../public/assets/js/chess/chess.js';
import { parsePgn } from '../public/assets/js/chess/pgn.js';

const COOKIE = 'sid';
const started = Date.now();

class HttpError extends Error { constructor(status, message) { super(message); this.status = status; } }
const bad = (msg, status = 400) => { throw new HttpError(status, msg); };

function cookieOpts(req) {
  const secure = config.cookieSecure || req.protocol === 'https' || /"scheme":"https"/.test(String(req.headers['cf-visitor'] || ''));
  return { path: '/', httpOnly: true, sameSite: 'lax', secure, maxAge: config.sessionDays * 86400 };
}

const clientIp = (req) => String(req.headers['cf-connecting-ip'] || req.ip || '').slice(0, 64);

function me(user) {
  return { user: U.publicUser(user), ratings: U.getRatings(user.id), settings: U.parseSettings(user) };
}

function gameSummary(r, userId) {
  const mine = r.white_id === userId ? 'w' : r.black_id === userId ? 'b' : null;
  let outcome = null;
  if (mine && r.result !== '*') outcome = r.result === '1/2-1/2' ? 'draw' : (r.result === '1-0') === (mine === 'w') ? 'win' : 'loss';
  return {
    id: r.id, variant: r.variant, speed: r.speed, rated: !!r.rated, source: r.source,
    tc: r.tc_days ? r.tc_days + 'd' : r.tc_base || r.tc_inc ? `${r.tc_base / 60000}+${r.tc_inc / 1000}` : '∞',
    white: { name: r.white_name, rating: r.white_rating, diff: r.white_diff }, black: { name: r.black_name, rating: r.black_rating, diff: r.black_diff },
    result: r.result, reason: r.reason, status: r.status, ply: r.ply, eco: r.eco, opening: r.opening, fen: r.fen,
    color: mine, outcome, createdAt: r.created_at, endedAt: r.ended_at, reviewed: !!r.reviewed,
  };
}

function pgnForRow(row) {
  const game = Game.fromMoves({ variant: row.variant, fen: row.start_fen, moves: row.moves ? row.moves.split(' ') : [] });
  const d = new Date(row.created_at);
  const pad = (n) => String(n).padStart(2, '0');
  return game.pgn({
    Event: `${row.rated ? 'Rated' : 'Casual'} ${row.speed} game`, Site: 'Rookery', Date: `${d.getUTCFullYear()}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`,
    White: row.white_name, Black: row.black_name, Result: row.status === 'playing' ? '*' : row.result,
    WhiteElo: row.white_rating || undefined, BlackElo: row.black_rating || undefined,
    TimeControl: row.tc_days ? `${row.tc_days * 86400}` : row.tc_base || row.tc_inc ? `${row.tc_base / 1000}+${row.tc_inc / 1000}` : '-',
    ECO: row.eco || undefined, Opening: row.opening || undefined, Termination: reasonText(row.reason) || undefined,
  });
}

function processRss(pids) {
  return new Promise((resolve) => {
    if (!pids.length) return resolve(0);
    execFile('ps', ['-o', 'rss=', '-p', pids.join(',')], { timeout: 2000 }, (err, out) => {
      if (err) return resolve(0);
      resolve(String(out).split('\n').map((s) => parseInt(s, 10)).filter(Number.isFinite).reduce((a, b) => a + b, 0) / 1024);
    });
  });
}

export async function memoryReport() {
  const m = process.memoryUsage();
  const sf = stockfish.stats();
  const engineMb = await processRss(sf.pids);
  const nodeMb = m.rss / 1048576;
  return {
    nodeRssMb: Math.round(nodeMb), heapUsedMb: Math.round(m.heapUsed / 1048576), stockfishRssMb: Math.round(engineMb),
    totalMb: Math.round(nodeMb + engineMb), budgetMb: 1024, ceilingMb: config.limits.memoryCeilingMb,
  };
}

export async function registerApi(app) {
  app.setErrorHandler((err, req, reply) => {
    const status = err.status || err.statusCode || 500;
    if (status >= 500) req.log.error(err);
    reply.code(status).send({ error: status >= 500 ? 'Internal server error.' : err.message });
  });

  // attach the session user to every request
  app.addHook('onRequest', async (req) => {
    req.user = U.userFromToken(req.cookies[COOKIE]) || null;
  });
  // state-changing requests must be same-origin JSON (CSRF defence on top of SameSite=Lax)
  app.addHook('preHandler', async (req) => {
    if (req.method === 'GET' || req.method === 'HEAD') return;
    const origin = req.headers.origin;
    if (origin) {
      let host = '';
      try { host = new URL(origin).host; } catch { bad('Bad origin.', 403); }
      if (host !== req.headers.host && host !== req.headers['x-forwarded-host'] && !config.allowedOrigins.includes(origin) && !config.allowedOrigins.includes(host)) bad('Cross-origin request refused.', 403);
    }
  });
  const need = (req) => req.user || bad('Sign in or continue as a guest first.', 401);

  // ---- health --------------------------------------------------------------------------
  app.get('/api/health', async () => ({
    ok: true, uptimeSec: Math.round((Date.now() - started) / 1000), memory: await memoryReport(),
    stockfish: (({ pids, ...rest }) => rest)(stockfish.stats()), games: G.managerStats(), sockets: hubStats(), reviews: reviewStats(),
    data: {
      openings: q('SELECT COUNT(*) n FROM eco').get().n, ecoCodes: q('SELECT COUNT(DISTINCT code) n FROM eco').get().n,
      puzzles: q('SELECT COUNT(*) n FROM puzzles').get().n, users: q('SELECT COUNT(*) n FROM users').get().n, games: q('SELECT COUNT(*) n FROM games').get().n,
    },
  }));

  // ---- auth ----------------------------------------------------------------------------
  app.get('/api/me', async (req) => me(need(req)));

  app.post('/api/auth/guest', async (req, reply) => {
    if (req.user) return me(req.user);
    if (!U.rateLimit('guest:' + clientIp(req), 30, 3_600_000)) bad('Too many guest sessions from this address. Try again later.', 429);
    const user = U.createGuest();
    reply.setCookie(COOKIE, U.createSession(user.id), cookieOpts(req));
    return me(user);
  });

  app.post('/api/auth/signup', async (req, reply) => {
    if (!U.rateLimit('signup:' + clientIp(req), 10, 3_600_000)) bad('Too many sign-ups from this address. Try again later.', 429);
    const { username, password } = req.body || {};
    let user;
    try { user = await U.signup(username, password, req.user); } catch (e) { if (e instanceof U.AuthError) bad(e.message, e.status); throw e; }
    if (!req.user || req.user.id !== user.id) reply.setCookie(COOKIE, U.createSession(user.id), cookieOpts(req));
    return me(user);
  });

  app.post('/api/auth/login', async (req, reply) => {
    const { username, password } = req.body || {};
    if (!U.rateLimit('login:' + clientIp(req), 12, 600_000) || !U.rateLimit('login-user:' + String(username).toLowerCase(), 12, 600_000)) bad('Too many attempts. Wait a few minutes and try again.', 429);
    let user;
    try { user = await U.login(username, password); } catch (e) { if (e instanceof U.AuthError) bad(e.message, e.status); throw e; }
    U.destroySession(req.cookies[COOKIE]);
    reply.setCookie(COOKIE, U.createSession(user.id), cookieOpts(req));
    return me(user);
  });

  app.post('/api/auth/logout', async (req, reply) => {
    U.destroySession(req.cookies[COOKIE]);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.post('/api/auth/password', async (req) => {
    const user = need(req);
    try { await U.changePassword(user, req.body?.current, req.body?.next); } catch (e) { if (e instanceof U.AuthError) bad(e.message, e.status); throw e; }
    return { ok: true };
  });

  app.put('/api/me/settings', async (req) => ({ settings: U.saveSettings(need(req).id, req.body || {}) }));

  app.put('/api/me/profile', async (req) => {
    const user = need(req);
    const bio = String(req.body?.bio ?? user.bio).slice(0, 300);
    const country = String(req.body?.country ?? user.country).replace(/[^A-Za-z ]/g, '').slice(0, 40);
    q('UPDATE users SET bio = ?, country = ? WHERE id = ?').run(bio, country, user.id);
    return { user: U.publicUser(U.userById(user.id)) };
  });

  // ---- users, profiles, social -----------------------------------------------------------
  app.get('/api/users/:name', async (req) => {
    const u = U.userByName(req.params.name) || bad('No such player.', 404);
    const totals = q(`SELECT COUNT(*) n,
        SUM(CASE WHEN (white_id = @id AND result = '1-0') OR (black_id = @id AND result = '0-1') THEN 1 ELSE 0 END) w,
        SUM(CASE WHEN result = '1/2-1/2' THEN 1 ELSE 0 END) d
      FROM games WHERE status = 'finished' AND (white_id = @id OR black_id = @id)`).get({ id: u.id });
    const recent = q(`SELECT g.*, (SELECT 1 FROM reviews r WHERE r.game_id = g.id) AS reviewed FROM games g
      WHERE g.status = 'finished' AND (g.white_id = ? OR g.black_id = ?) ORDER BY g.created_at DESC LIMIT 10`).all(u.id, u.id).map((r) => gameSummary(r, u.id));
    const puzzles = P.puzzleStats(u.id);
    return {
      user: U.publicUser(u), ratings: U.getRatings(u.id), online: isOnline(u.id),
      totals: { games: totals.n, wins: totals.w || 0, draws: totals.d || 0, losses: totals.n - (totals.w || 0) - (totals.d || 0) },
      puzzles: { ...puzzles, rush3: P.bestScore(u.id, 'rush:3min'), rush5: P.bestScore(u.id, 'rush:5min'), survival: P.bestScore(u.id, 'rush:survival') },
      recent,
      following: req.user ? !!q('SELECT 1 FROM follows WHERE user_id = ? AND target_id = ?').get(req.user.id, u.id) : false,
      followers: q('SELECT COUNT(*) n FROM follows WHERE target_id = ?').get(u.id).n,
    };
  });

  app.get('/api/users/:name/history', async (req) => {
    const u = U.userByName(req.params.name) || bad('No such player.', 404);
    const category = U.CATEGORIES.includes(req.query.category) ? req.query.category : 'blitz';
    return { category, points: U.ratingHistory(u.id, category) };
  });

  app.post('/api/follow/:name', async (req) => {
    const user = need(req);
    const t = U.userByName(req.params.name) || bad('No such player.', 404);
    if (t.id === user.id) bad('You cannot follow yourself.');
    q('INSERT OR IGNORE INTO follows (user_id, target_id, created_at) VALUES (?, ?, ?)').run(user.id, t.id, Date.now());
    return { following: true };
  });
  app.delete('/api/follow/:name', async (req) => {
    const user = need(req);
    const t = U.userByName(req.params.name) || bad('No such player.', 404);
    q('DELETE FROM follows WHERE user_id = ? AND target_id = ?').run(user.id, t.id);
    return { following: false };
  });
  app.get('/api/friends', async (req) => {
    const user = need(req);
    return {
      friends: q('SELECT u.id, u.username, u.last_seen FROM follows f JOIN users u ON u.id = f.target_id WHERE f.user_id = ? ORDER BY u.username').all(user.id)
        .map((r) => ({ username: r.username, online: isOnline(r.id), lastSeen: r.last_seen })),
    };
  });

  app.get('/api/leaderboard', async (req) => {
    const category = U.CATEGORIES.includes(req.query.category) ? req.query.category : 'blitz';
    return { category, name: U.CATEGORY_NAMES[category], players: U.leaderboard(category, 50) };
  });

  // ---- games & archive ---------------------------------------------------------------------
  app.get('/api/games', async (req) => {
    const viewer = need(req);
    const target = req.query.user ? U.userByName(req.query.user) || bad('No such player.', 404) : viewer;
    const where = ["g.status = 'finished'"], args = { id: target.id };
    if (req.query.source === 'import') { where.push('g.owner_id = @id'); } else where.push('(g.white_id = @id OR g.black_id = @id)');
    const { result, color, speed, variant, opening, opponent, source } = req.query;
    if (color === 'white') where.push('g.white_id = @id');
    if (color === 'black') where.push('g.black_id = @id');
    if (result === 'win') where.push("((g.white_id = @id AND g.result = '1-0') OR (g.black_id = @id AND g.result = '0-1'))");
    if (result === 'loss') where.push("((g.white_id = @id AND g.result = '0-1') OR (g.black_id = @id AND g.result = '1-0'))");
    if (result === 'draw') where.push("g.result = '1/2-1/2'");
    if (speed && /^[a-z]+$/.test(speed)) { where.push('g.speed = @speed'); args.speed = speed; }
    if (variant && VARIANTS.includes(variant)) { where.push('g.variant = @variant'); args.variant = variant; }
    if (source === 'bot') where.push('g.bot_id IS NOT NULL');
    if (source === 'human') where.push('g.bot_id IS NULL AND g.owner_id IS NULL');
    if (opening) { where.push('(g.opening LIKE @op OR g.eco LIKE @op)'); args.op = `%${String(opening).replace(/[%_]/g, '').slice(0, 60)}%`; }
    if (opponent) { where.push('(g.white_name LIKE @opp OR g.black_name LIKE @opp)'); args.opp = `%${String(opponent).replace(/[%_]/g, '').slice(0, 30)}%`; }
    const page = Math.max(1, parseInt(req.query.page, 10) || 1), size = 20;
    const sqlWhere = where.join(' AND ');
    const total = db.prepare(`SELECT COUNT(*) n FROM games g WHERE ${sqlWhere}`).get(args).n;
    const rows = db.prepare(`SELECT g.*, (SELECT 1 FROM reviews r WHERE r.game_id = g.id) AS reviewed FROM games g WHERE ${sqlWhere} ORDER BY g.created_at DESC LIMIT ${size} OFFSET ${(page - 1) * size}`).all(args);
    return { games: rows.map((r) => gameSummary(r, target.id)), page, pages: Math.max(1, Math.ceil(total / size)), total };
  });

  app.get('/api/games/ongoing', async (req) => ({ games: G.ongoingGames(need(req).id) }));

  app.get('/api/games/:id', async (req) => {
    const live = G.getLive(req.params.id);
    if (live) return { game: live.state(req.user ? { user: req.user } : null) };
    const row = q('SELECT * FROM games WHERE id = ?').get(req.params.id) || bad('Game not found.', 404);
    return { game: G.stateFromRow(row, req.user?.id) };
  });

  app.get('/api/games/:id/pgn', async (req, reply) => {
    const live = G.getLive(req.params.id);
    if (live && live.status === 'playing' && !live.bot) bad('The PGN is available once the game has finished.', 409);
    const row = q('SELECT * FROM games WHERE id = ?').get(req.params.id) || bad('Game not found.', 404);
    reply.header('content-type', 'application/x-chess-pgn; charset=utf-8').header('content-disposition', `attachment; filename="rookery-${row.id}.pgn"`);
    return pgnForRow(row);
  });

  // import a PGN into the archive (so it can be reviewed / explored)
  app.post('/api/games/import', async (req) => {
    const user = need(req);
    const text = String(req.body?.pgn || '');
    if (!text.trim() || text.length > 200_000) bad('Paste a PGN (up to 200 kB).');
    const parsed = parsePgn(text);
    const variant = variantFromName(parsed.headers.Variant);
    let game;
    try { game = new Game({ variant, fen: parsed.headers.FEN || null }); } catch { bad('The PGN has an invalid FEN header.'); }
    for (const node of parsed.moves) if (!game.play(node.san)) bad(`Could not read move "${node.san}" (move ${Math.floor(game.ply / 2) + 1}).`);
    if (game.ply < 1) bad('No moves found in that PGN.');
    const st = game.status();
    const result = ['1-0', '0-1', '1/2-1/2'].includes(parsed.result) ? parsed.result : st.over ? st.result : '*';
    const op = detectOpening(game);
    const id = 'i' + Math.random().toString(36).slice(2, 9);
    const t = Date.now();
    const elo = (v) => (Number.isFinite(parseInt(v, 10)) ? parseInt(v, 10) : null);
    q(`INSERT INTO games (id, variant, speed, rated, source, owner_id, white_name, black_name, white_rating, black_rating, start_fen, fen, moves, ply,
         status, result, reason, eco, opening, created_at, ended_at)
       VALUES (?, ?, 'imported', 0, 'import', ?, ?, ?, ?, ?, ?, ?, ?, ?, 'finished', ?, ?, ?, ?, ?, ?)`)
      .run(id, variant, user.id, String(parsed.headers.White || 'White').slice(0, 40), String(parsed.headers.Black || 'Black').slice(0, 40), elo(parsed.headers.WhiteElo), elo(parsed.headers.BlackElo),
        game.startFen, game.fen, game.uciMoves().join(' '), game.ply, result, st.over ? st.reason : '', op?.code || '', op?.name || '', t, t);
    return { id };
  });

  // ---- challenges (play a friend) ------------------------------------------------------------
  app.post('/api/challenges', async (req) => {
    const r = G.createChallenge(need(req), req.body || {});
    if (r.error) bad(r.error);
    return r;
  });
  app.get('/api/challenges/:code', async (req) => {
    const ch = G.getChallenge(req.params.code) || bad('This invite link does not exist.', 404);
    return { challenge: { ...ch, creatorId: undefined, mine: !!req.user && req.user.id === ch.creatorId } };
  });
  app.post('/api/challenges/:code/accept', async (req) => {
    const r = G.acceptChallenge(need(req), req.params.code);
    if (r.error) bad(r.error);
    return r;
  });

  // ---- bots ------------------------------------------------------------------------------------
  app.get('/api/bots', async () => ({ tiers: TIERS, bots: BOTS.map(publicBot), engine: stockfish.available ? stockfish.engineName || 'Stockfish' : null }));
  app.post('/api/bots/play', async (req) => {
    const r = G.createBotGame(need(req), req.body || {});
    if (r.error) bad(r.error);
    return r;
  });

  // ---- review & analysis --------------------------------------------------------------------------
  app.get('/api/review/:id', async (req) => getReview(req.params.id));
  app.post('/api/review/:id', async (req) => {
    const user = need(req);
    const live = G.getLive(req.params.id);
    if (live && live.status === 'playing' && !live.bot) bad('Finish the game before reviewing it.', 409);
    return startReview(req.params.id, user.id);
  });

  // one-shot evaluation (used by "Retry mistake" and post-puzzle exploration)
  app.post('/api/eval', async (req) => {
    const user = need(req);
    if (!U.rateLimit('eval:' + user.id, 60, 60_000)) bad('Slow down a little.', 429);
    const variant = VARIANTS.includes(req.body?.variant) ? req.body.variant : 'standard';
    let pos;
    try { pos = Position.fromFen(String(req.body?.fen || ''), variant); } catch { bad('Invalid FEN.'); }
    const err = pos.validate();
    if (err) bad(err);
    const over = pos.outcome();
    if (over) return { over, lines: [] };
    const r = await analysePosition({ variant, fen: pos.fen(), multipv: Math.max(1, Math.min(3, parseInt(req.body?.multipv, 10) || 1)), nodes: 200_000, liteNodes: 60_000 });
    return { lines: r.lines.map((l) => ({ uci: l.uci, cp: l.cp ?? null, mate: l.mate ?? null, pv: (l.pv || []).slice(0, 10), depth: l.depth })), source: r.source, turn: pos.turn ? 'b' : 'w' };
  });

  app.get('/api/explorer', async (req) => {
    const variant = VARIANTS.includes(req.query.variant) ? req.query.variant : 'standard';
    try { return explore(String(req.query.fen || ''), variant); } catch { bad('Invalid FEN.'); }
  });

  app.get('/api/openings', async (req) => ({ openings: searchOpenings(req.query.q || '', 40) }));

  // ---- puzzles --------------------------------------------------------------------------------------
  app.get('/api/puzzles/themes', async () => ({ themes: P.listThemes(), total: q('SELECT COUNT(*) n FROM puzzles').get().n }));
  app.get('/api/puzzles/next', async (req) => {
    const user = need(req);
    const theme = typeof req.query.theme === 'string' && /^[A-Za-z0-9]+$/.test(req.query.theme) ? req.query.theme : null;
    const puzzle = P.nextPuzzle(user, { theme }) || bad('No puzzles available.', 404);
    return { puzzle, rating: U.getRatings(user.id).puzzle };
  });
  app.get('/api/puzzles/history', async (req) => ({ history: P.puzzleHistory(need(req).id) }));
  app.get('/api/puzzles/:id', async (req) => ({ puzzle: P.puzzleById(parseInt(req.params.id, 10)) || bad('Puzzle not found.', 404) }));
  app.post('/api/puzzles/:id/attempt', async (req) => {
    const r = P.submitAttempt(need(req), parseInt(req.params.id, 10), { moves: req.body?.moves, hints: req.body?.hints ? 1 : 0 });
    if (r.error) bad(r.error, 404);
    return r;
  });
  app.post('/api/puzzles/rush/start', async (req) => {
    const r = P.startRush(need(req), String(req.body?.mode || ''));
    if (r.error) bad(r.error);
    return r;
  });
  app.post('/api/puzzles/rush/finish', async (req) => {
    const r = P.finishRush(need(req), req.body || {});
    if (r.error) bad(r.error);
    return r;
  });
  app.get('/api/puzzles/rush/leaderboard', async (req) => {
    const mode = P.RUSH_MODES[req.query.mode] ? req.query.mode : '3min';
    return { mode, scores: P.scoreboard('rush:' + mode), best: req.user ? P.bestScore(req.user.id, 'rush:' + mode) : 0 };
  });

  // ---- learn: drills & coordinate trainer --------------------------------------------------------------
  app.get('/api/learn/drills', async (req) => {
    const done = req.user ? new Map(q("SELECT kind, MAX(score) s FROM scores WHERE user_id = ? AND kind LIKE 'drill:%' GROUP BY kind").all(req.user.id).map((r) => [r.kind.slice(6), r.s])) : new Map();
    return { drills: DRILLS.map((d) => ({ id: d.id, name: d.name, category: d.category, goal: d.goal, description: d.description, fen: d.fen, userColor: d.userColor, par: d.par, stars: done.get(d.id) || 0 })) };
  });
  app.post('/api/learn/drills/:id/start', async (req) => {
    const r = G.createDrillGame(need(req), req.params.id);
    if (r.error) bad(r.error, 404);
    return r;
  });
  app.post('/api/learn/coords', async (req) => {
    const user = need(req);
    const score = Math.max(0, Math.min(200, parseInt(req.body?.score, 10) || 0));
    const mode = ['white', 'black', 'random'].includes(req.body?.mode) ? req.body.mode : 'white';
    return { best: P.addScore(user.id, 'coords:' + mode, score, { coords: !!req.body?.showCoords }), scores: P.scoreboard('coords:' + mode, 10) };
  });
  app.get('/api/learn/coords', async (req) => {
    const mode = ['white', 'black', 'random'].includes(req.query.mode) ? req.query.mode : 'white';
    return { mode, best: req.user ? P.bestScore(req.user.id, 'coords:' + mode) : 0, scores: P.scoreboard('coords:' + mode, 10) };
  });

  app.get('/api/site', async () => ({
    name: 'Rookery', online: onlineCount(), playing: G.managerStats().playing, variants: VARIANTS.map((v) => ({ id: v, name: VARIANT_NAMES[v] })),
    timeControls: G.TIME_CONTROLS, engine: stockfish.available ? stockfish.engineName || 'Stockfish' : 'built-in',
  }));

  app.all('/api/*', async () => bad('Unknown API route.', 404));
}
