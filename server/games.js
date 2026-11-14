// Live game manager: server-authoritative moves and clocks, matchmaking, friend
// challenges, bot games (hints / takebacks / feedback), drills and daily games.
import { randomBytes, randomInt } from 'node:crypto';
import { Game, WHITE, BLACK, VARIANTS, PIECE_VALUE, PAWN, QUEEN, KING, typeOf, colorOf } from '../public/assets/js/chess/chess.js';
import { db, q } from './db.js';
import { config } from './config.js';
import { rateGame, getRating, userById } from './users.js';
import { openingByKey, detectOpening } from './openings.js';
import { chooseBotMove, thinkDelay, botReaction, botLine, botById } from './bots.js';
import { analysePosition, scoreToCp } from './engine.js';
import { winPct, lossBucket } from './judge.js';
import { indexGame } from './explorer.js';
import { drillById } from './data/drills.js';

export const TIME_CONTROLS = ['1+0', '1+1', '2+1', '3+0', '3+2', '5+0', '5+3', '10+0', '15+10', '30+0', '60+0', '1d', '3d', '7d'];
const DAY = 86_400_000;
const COLORS = 'wb';

export function parseTc(label) {
  if (!label || label === 'none') return { label: 'none', base: 0, inc: 0, days: 0, untimed: true };
  let m = /^(\d{1,2})d$/.exec(label);
  if (m) return { label, base: 0, inc: 0, days: +m[1], untimed: false };
  m = /^(\d{1,3})\+(\d{1,3})$/.exec(label);
  if (m && +m[1] + +m[2] > 0) return { label, base: +m[1] * 60_000, inc: +m[2] * 1000, days: 0, untimed: false };
  return null;
}

export function speedOf(tc) {
  if (tc.untimed) return 'unlimited';
  if (tc.days) return 'daily';
  const est = tc.base / 1000 + 40 * (tc.inc / 1000);
  return est < 180 ? 'bullet' : est < 600 ? 'blitz' : 'rapid';
}

export const ratingCategory = (variant, speed) => (variant !== 'standard' ? variant : speed === 'unlimited' ? null : speed);

const newId = (n = 8) => {
  const abc = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(n);
  let s = '';
  for (let i = 0; i < n; i++) s += abc[bytes[i] % abc.length];
  return s;
};

// ---- transport hooks (set by the WebSocket hub) -------------------------------
let transport = { sendUser: () => {}, lobbyChanged: () => {}, isOnline: () => false };
export const setTransport = (t) => { transport = { ...transport, ...t }; };

const games = new Map(); // id -> LiveGame (in memory)
const seeks = new Map(); // userId -> seek
const userGames = new Map(); // userId -> Set<gameId> of live (clocked) games in progress

class LiveGame {
  constructor(o) {
    this.id = o.id || newId();
    this.variant = o.variant;
    this.tc = o.tc;
    this.timed = !o.tc.untimed && !o.tc.days;
    this.speed = speedOf(o.tc);
    this.rated = !!o.rated;
    this.source = o.source || 'live';
    this.players = o.players; // [white, black]
    this.game = o.game;
    this.chess960Id = o.chess960Id ?? null;
    this.clocks = o.clocks || [o.tc.base, o.tc.base];
    this.turnStarted = o.turnStarted ?? null;
    this.status = 'playing';
    this.result = '*';
    this.reason = '';
    this.drawOffer = o.drawOffer ?? -1;
    this.rematch = [false, false];
    this.sockets = new Set();
    this.chat = [];
    this.createdAt = o.createdAt || Date.now();
    this.endedAt = null;
    this.flagTimer = null;
    this.firstMoveTimer = null;
    this.dcTimers = [null, null];
    this.dcSince = [null, null];
    this.bot = o.bot || null;
    this.drill = o.drill || null;
    this.opening = o.opening || null;
    this.lastEval = null;
    this.evalJob = null;
    this.diffs = null;
    this.evictTimer = null;
  }

  colorOfUser(userId) {
    if (userId == null) return -1;
    if (this.players[0].id === userId) return WHITE;
    if (this.players[1].id === userId) return BLACK;
    return -1;
  }

  remaining(color, at = Date.now()) {
    if (!this.timed) return Infinity;
    const running = this.status === 'playing' && this.turnStarted != null && this.game.turn === color;
    return this.clocks[color] - (running ? at - this.turnStarted : 0);
  }

  connected(color) {
    const id = this.players[color].id;
    if (this.players[color].isBot) return true;
    for (const c of this.sockets) if (c.user.id === id) return true;
    return false;
  }

  broadcast(msg, filter = null) {
    for (const c of this.sockets) if (!filter || filter(c)) c.send(msg);
  }

  clockJson() {
    return {
      w: Math.max(0, Math.round(this.clocks[0])), b: Math.max(0, Math.round(this.clocks[1])),
      running: this.timed && this.status === 'playing' && this.turnStarted != null,
      turnStarted: this.turnStarted, now: Date.now(),
      deadline: this.tc.days && this.status === 'playing' ? (this.turnStarted || this.createdAt) + this.tc.days * DAY : null,
    };
  }

  canSeeEval(conn) {
    if (this.status !== 'playing') return true;
    if (this.bot) return !!this.bot.evalBar;
    return this.colorOfUser(conn.user.id) < 0; // spectators only while a human game is live
  }

  state(conn) {
    const me = conn ? this.colorOfUser(conn.user.id) : -1;
    const g = this.game;
    const pj = (p, c) => ({ id: p.id, name: p.name, rating: p.rating, isBot: !!p.isBot, botId: p.botId || null, emoji: p.emoji || null, tint: p.tint || null, diff: this.diffs ? this.diffs[c ? 'black' : 'white'].diff : null });
    let spectators = 0;
    for (const c of this.sockets) if (this.colorOfUser(c.user.id) < 0) spectators++;
    return {
      id: this.id, variant: this.variant, chess960Id: this.chess960Id, tc: this.tc, speed: this.speed, rated: this.rated, source: this.source,
      status: this.status, result: this.result, reason: this.reason,
      startFen: g.startFen, fen: g.fen, moves: g.moves.map((m) => ({ uci: m.uci, san: m.san })),
      white: pj(this.players[0], 0), black: pj(this.players[1], 1), you: me < 0 ? null : COLORS[me],
      clocks: this.clockJson(), drawOffer: this.drawOffer < 0 ? null : COLORS[this.drawOffer],
      bot: this.bot ? { id: this.bot.def.id, name: this.bot.def.name, hints: this.bot.hints, takebacks: this.bot.takebacks, feedback: this.bot.feedback, evalBar: this.bot.evalBar } : null,
      drill: this.drill ? { id: this.drill.def.id, name: this.drill.def.name, goal: this.drill.def.goal, description: this.drill.def.description, tips: this.drill.def.tips, par: this.drill.def.par, outcome: this.drill.outcome || null } : null,
      opening: this.opening, chat: this.chat.slice(-60), spectators,
      presence: [this.connected(0), this.connected(1)],
      eval: conn && this.canSeeEval(conn) ? this.lastEval : null,
      rematch: this.rematch, createdAt: this.createdAt,
    };
  }
}

// ---- persistence ----------------------------------------------------------------
function insertRow(game) {
  const [w, b] = game.players;
  q(`INSERT INTO games (id, variant, chess960_id, speed, tc_base, tc_inc, tc_days, rated, source, white_id, black_id, white_name, black_name,
       white_rating, black_rating, bot_id, start_fen, fen, clock_w, clock_b, turn_started, created_at)
     VALUES (@id, @variant, @c960, @speed, @base, @inc, @days, @rated, @source, @wid, @bid, @wn, @bn, @wr, @br, @bot, @sf, @fen, @cw, @cb, @ts, @t)`)
    .run({
      id: game.id, variant: game.variant, c960: game.chess960Id, speed: game.speed, base: game.tc.base, inc: game.tc.inc, days: game.tc.days,
      rated: game.rated ? 1 : 0, source: game.source, wid: w.isBot ? null : w.id, bid: b.isBot ? null : b.id, wn: w.name, bn: b.name,
      wr: w.rating ?? null, br: b.rating ?? null, bot: game.bot ? game.bot.def.id : null, sf: game.game.startFen, fen: game.game.fen,
      cw: game.clocks[0], cb: game.clocks[1], ts: game.turnStarted || 0, t: game.createdAt,
    });
}

function saveProgress(game) {
  q('UPDATE games SET fen = ?, moves = ?, ply = ?, clock_w = ?, clock_b = ?, turn_started = ?, draw_offer = ?, eco = ?, opening = ? WHERE id = ?')
    .run(game.game.fen, game.game.uciMoves().join(' '), game.game.ply, Math.round(game.clocks[0]), Math.round(game.clocks[1]), game.turnStarted || 0,
      game.drawOffer < 0 ? '' : COLORS[game.drawOffer], game.opening?.code || '', game.opening?.name || '', game.id);
}

function saveFinal(game) {
  const d = game.diffs;
  q(`UPDATE games SET fen = ?, moves = ?, ply = ?, status = ?, result = ?, reason = ?, eco = ?, opening = ?, clock_w = ?, clock_b = ?,
       white_diff = ?, black_diff = ?, ended_at = ?, draw_offer = '' WHERE id = ?`)
    .run(game.game.fen, game.game.uciMoves().join(' '), game.game.ply, game.status, game.result, game.reason, game.opening?.code || '', game.opening?.name || '',
      Math.max(0, Math.round(game.clocks[0])), Math.max(0, Math.round(game.clocks[1])), d ? d.white.diff : null, d ? d.black.diff : null, game.endedAt, game.id);
}

// Live (clocked) games do not survive a restart; daily games do.
export function recoverOnBoot() {
  const t = Date.now();
  const r = db.prepare("UPDATE games SET status = 'aborted', reason = 'server-restart', ended_at = ? WHERE status = 'playing' AND tc_days = 0").run(t);
  return r.changes;
}

function loadDaily(id) {
  const row = q("SELECT * FROM games WHERE id = ? AND status = 'playing' AND tc_days > 0").get(id);
  if (!row) return null;
  const game = Game.fromMoves({ variant: row.variant, fen: row.start_fen, moves: row.moves ? row.moves.split(' ') : [] });
  const lg = new LiveGame({
    id: row.id, variant: row.variant, tc: { label: row.tc_days + 'd', base: 0, inc: 0, days: row.tc_days, untimed: false }, rated: row.rated, source: row.source,
    players: [{ id: row.white_id, name: row.white_name, rating: row.white_rating }, { id: row.black_id, name: row.black_name, rating: row.black_rating }],
    game, chess960Id: row.chess960_id, turnStarted: row.turn_started || row.created_at, createdAt: row.created_at,
    drawOffer: row.draw_offer ? COLORS.indexOf(row.draw_offer) : -1, opening: row.eco ? { code: row.eco, name: row.opening } : null,
  });
  games.set(lg.id, lg);
  return lg;
}

export const getLive = (id) => games.get(id) || loadDaily(id);

// Read-only state for a game that is no longer in memory.
export function stateFromRow(row, userId) {
  const game = Game.fromMoves({ variant: row.variant, fen: row.start_fen, moves: row.moves ? row.moves.split(' ') : [] });
  const bot = row.bot_id ? botById(row.bot_id) : null;
  const side = (c) => {
    const isBot = !row[c + '_id'] && !!bot;
    return { id: row[c + '_id'], name: row[c + '_name'], rating: row[c + '_rating'], isBot, botId: isBot ? bot.id : null, emoji: isBot ? bot.emoji : null, tint: isBot ? bot.color : null, diff: row[c + '_diff'] };
  };
  return {
    id: row.id, variant: row.variant, chess960Id: row.chess960_id,
    tc: row.tc_days ? { label: row.tc_days + 'd', base: 0, inc: 0, days: row.tc_days } : row.tc_base || row.tc_inc ? { label: `${row.tc_base / 60000}+${row.tc_inc / 1000}`, base: row.tc_base, inc: row.tc_inc, days: 0 } : { label: 'none', base: 0, inc: 0, days: 0, untimed: true },
    speed: row.speed, rated: !!row.rated, source: row.source, status: row.status, result: row.result, reason: row.reason,
    startFen: game.startFen, fen: game.fen, moves: game.moves.map((m) => ({ uci: m.uci, san: m.san })),
    white: side('white'), black: side('black'), you: userId && row.white_id === userId ? 'w' : userId && row.black_id === userId ? 'b' : null,
    clocks: { w: row.clock_w, b: row.clock_b, running: false, turnStarted: null, now: Date.now(), deadline: null },
    drawOffer: null, bot: bot ? { id: bot.id, name: bot.name, hints: false, takebacks: false, feedback: false, evalBar: true } : null, drill: null,
    opening: row.eco ? { code: row.eco, name: row.opening } : null, chat: [], spectators: 0, presence: [false, false], eval: null, rematch: [false, false],
    createdAt: row.created_at, archived: true,
  };
}

// ---- creation -------------------------------------------------------------------
function trackUser(game, add) {
  if (game.tc.days || game.bot) return;
  for (const p of game.players) {
    if (p.isBot || p.id == null) continue;
    let set = userGames.get(p.id);
    if (add) { if (!set) userGames.set(p.id, (set = new Set())); set.add(game.id); }
    else if (set) { set.delete(game.id); if (!set.size) userGames.delete(p.id); }
  }
}

export const activeLiveGame = (userId) => { const s = userGames.get(userId); return s && s.size ? [...s][0] : null; };

function humanPlayer(user, category) {
  const r = category ? getRating(user.id, category) : null;
  return { id: user.id, name: user.username, rating: r ? Math.round(r.rating) : null, isBot: false };
}

function createGame({ variant, tc, rated, white, black, source, fen = null, bot = null, drill = null, chess960Id = null }) {
  if (variant === 'chess960' && chess960Id == null && !fen) chess960Id = randomInt(0, 960);
  const game = new Game({ variant, fen, chess960Id });
  const lg = new LiveGame({ variant, tc, rated, source, players: [white, black], game, chess960Id, bot, drill });
  if (tc.days) lg.turnStarted = lg.createdAt;
  games.set(lg.id, lg);
  insertRow(lg);
  trackUser(lg, true);
  if (lg.timed && !bot) lg.firstMoveTimer = setTimeout(() => { if (lg.status === 'playing' && lg.game.ply < 2) finish(lg, '*', 'aborted'); }, config.limits.firstMoveMs * 2);
  if (bot && lg.game.turn === bot.color) setImmediate(() => botTurn(lg));
  else if (bot) setImmediate(() => preEvaluate(lg));
  transport.lobbyChanged();
  return lg;
}

function pairHumans(a, b, { variant, tc, rated, source, colorOfA = 'random' }) {
  const category = ratingCategory(variant, speedOf(tc));
  const pa = humanPlayer(a, category), pb = humanPlayer(b, category);
  const aWhite = colorOfA === 'white' ? true : colorOfA === 'black' ? false : randomInt(0, 2) === 0;
  return createGame({ variant, tc, rated: rated && !!category, white: aWhite ? pa : pb, black: aWhite ? pb : pa, source });
}

// ---- matchmaking ----------------------------------------------------------------
export function createSeek(user, { tc: tcLabel, variant = 'standard', rated = true }) {
  const tc = parseTc(tcLabel);
  if (!tc || tc.untimed || !TIME_CONTROLS.includes(tcLabel)) return { error: 'Unknown time control.' };
  if (!VARIANTS.includes(variant)) return { error: 'Unknown variant.' };
  const busy = !tc.days && activeLiveGame(user.id);
  if (busy) return { error: 'You already have a live game in progress.', gameId: busy };
  rated = !!rated;
  const category = ratingCategory(variant, speedOf(tc));
  const myRating = Math.round(getRating(user.id, category).rating);
  let best = null;
  for (const s of seeks.values()) {
    if (s.userId === user.id || s.tc !== tcLabel || s.variant !== variant || s.rated !== rated) continue;
    if (!best || Math.abs(s.rating - myRating) < Math.abs(best.rating - myRating)) best = s;
  }
  if (best) {
    seeks.delete(best.userId);
    const other = userById(best.userId);
    if (other) {
      const game = pairHumans(user, other, { variant, tc, rated, source: tc.days ? 'daily' : 'live' });
      transport.sendUser(other.id, { t: 'seek:matched', gameId: game.id });
      transport.lobbyChanged();
      return { gameId: game.id };
    }
  }
  const seek = { id: newId(6), userId: user.id, name: user.username, rating: myRating, tc: tcLabel, variant, rated, createdAt: Date.now() };
  seeks.set(user.id, seek);
  transport.lobbyChanged();
  return { seekId: seek.id };
}

export function cancelSeek(userId) {
  if (seeks.delete(userId)) transport.lobbyChanged();
}

export function acceptSeek(user, seekId) {
  const seek = [...seeks.values()].find((s) => s.id === seekId);
  if (!seek) return { error: 'That challenge is no longer available.' };
  if (seek.userId === user.id) return { error: 'That is your own challenge.' };
  const tc = parseTc(seek.tc);
  const busy = !tc.days && activeLiveGame(user.id);
  if (busy) return { error: 'You already have a live game in progress.', gameId: busy };
  const other = userById(seek.userId);
  seeks.delete(seek.userId);
  seeks.delete(user.id);
  if (!other) return { error: 'That challenge is no longer available.' };
  const game = pairHumans(user, other, { variant: seek.variant, tc, rated: seek.rated, source: tc.days ? 'daily' : 'live' });
  transport.sendUser(other.id, { t: 'seek:matched', gameId: game.id });
  return { gameId: game.id };
}

export function lobbyState() {
  const live = [];
  for (const g of games.values()) {
    if (g.status !== 'playing' || g.bot || g.tc.days) continue;
    live.push({ id: g.id, white: g.players[0].name, whiteRating: g.players[0].rating, black: g.players[1].name, blackRating: g.players[1].rating, tc: g.tc.label, variant: g.variant, rated: g.rated, ply: g.game.ply, fen: g.game.fen });
  }
  live.sort((a, b) => (b.whiteRating + b.blackRating) - (a.whiteRating + a.blackRating));
  return {
    seeks: [...seeks.values()].map((s) => ({ id: s.id, name: s.name, rating: s.rating, tc: s.tc, variant: s.variant, rated: s.rated })),
    games: live.slice(0, 12), playing: live.length,
  };
}

// ---- friend challenges ------------------------------------------------------------
export function createChallenge(user, { tc: tcLabel, variant = 'standard', rated = false, color = 'random' }) {
  const tc = parseTc(tcLabel);
  if (!tc || tc.untimed) return { error: 'Unknown time control.' };
  if (!VARIANTS.includes(variant)) return { error: 'Unknown variant.' };
  if (!['white', 'black', 'random'].includes(color)) color = 'random';
  const code = newId(10);
  q('INSERT INTO challenges (code, creator_id, variant, tc, rated, color, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(code, user.id, variant, tc.label, rated ? 1 : 0, color, Date.now());
  return { code };
}

export function getChallenge(code) {
  const row = q('SELECT c.*, u.username AS creator FROM challenges c JOIN users u ON u.id = c.creator_id WHERE c.code = ?').get(code);
  if (!row) return null;
  return { code: row.code, creator: row.creator, creatorId: row.creator_id, variant: row.variant, tc: row.tc, rated: !!row.rated, color: row.color, gameId: row.game_id, expired: !row.game_id && Date.now() - row.created_at > 7 * DAY };
}

export function acceptChallenge(user, code) {
  const ch = getChallenge(code);
  if (!ch || ch.expired) return { error: 'This invite link has expired.' };
  if (ch.gameId) return { gameId: ch.gameId };
  if (ch.creatorId === user.id) return { error: 'Share this link with a friend — you cannot accept your own invite.' };
  const creator = userById(ch.creatorId);
  if (!creator) return { error: 'This invite link has expired.' };
  const tc = parseTc(ch.tc);
  const game = pairHumans(creator, user, { variant: ch.variant, tc, rated: ch.rated, source: 'friend', colorOfA: ch.color });
  q('UPDATE challenges SET game_id = ? WHERE code = ?').run(game.id, code);
  transport.sendUser(creator.id, { t: 'challenge:accepted', code, gameId: game.id });
  return { gameId: game.id };
}

// ---- bot & drill games --------------------------------------------------------------
export function createBotGame(user, { botId, color = 'random', variant = 'standard', tc: tcLabel = 'none', fen = null, hints = true, takebacks = true, feedback = true, evalBar = false }) {
  const def = botById(botId);
  if (!def) return { error: 'Unknown bot.' };
  if (!VARIANTS.includes(variant)) return { error: 'Unknown variant.' };
  const tc = parseTc(tcLabel);
  if (!tc || tc.days) return { error: 'Unknown time control.' };
  const userWhite = color === 'white' ? true : color === 'black' ? false : randomInt(0, 2) === 0;
  const me = { id: user.id, name: user.username, rating: null, isBot: false };
  const it = { id: null, name: def.name, rating: def.elo, isBot: true, botId: def.id, emoji: def.emoji, tint: def.color };
  if (fen) { try { const g = new Game({ variant, fen }); const bad = g.pos.validate(); if (bad) return { error: bad }; if (g.status().over) return { error: 'That position is already finished.' }; } catch (e) { return { error: 'Invalid FEN.' }; } }
  const bot = { def, color: userWhite ? BLACK : WHITE, hints: !!hints, takebacks: !!takebacks, feedback: !!feedback, evalBar: !!evalBar, token: 0, pre: null, state: {}, hintsUsed: 0 };
  const game = createGame({ variant, tc, rated: false, white: userWhite ? me : it, black: userWhite ? it : me, source: 'bot', fen, bot });
  say(game, botLine(def, 'greet'));
  return { gameId: game.id };
}

export function createDrillGame(user, drillId) {
  const d = drillById(drillId);
  if (!d) return { error: 'Unknown drill.' };
  const def = botById('stockfish-max');
  const userWhite = d.userColor === 'w';
  const me = { id: user.id, name: user.username, rating: null, isBot: false };
  const it = { id: null, name: 'Stockfish', rating: def.elo, isBot: true, botId: def.id, emoji: '🐟', tint: def.color };
  const bot = { def: { ...def, movetime: 500, think: [250, 600], lines: {} }, color: userWhite ? BLACK : WHITE, hints: true, takebacks: true, feedback: false, evalBar: false, token: 0, pre: null, state: {}, hintsUsed: 0 };
  const game = createGame({ variant: 'standard', tc: parseTc('none'), rated: false, white: userWhite ? me : it, black: userWhite ? it : me, source: 'drill', fen: d.fen, bot, drill: { def: d, userColor: userWhite ? WHITE : BLACK, outcome: null } });
  return { gameId: game.id };
}

// ---- joining / presence ---------------------------------------------------------------
export function joinGame(conn, id) {
  const game = getLive(id);
  if (!game) {
    const row = q('SELECT * FROM games WHERE id = ?').get(id);
    if (!row) return conn.send({ t: 'game:error', id, error: 'Game not found.' });
    return conn.send({ t: 'game:state', game: stateFromRow(row, conn.user.id) });
  }
  clearTimeout(game.evictTimer);
  game.sockets.add(conn);
  conn.games.add(id);
  const color = game.colorOfUser(conn.user.id);
  if (color >= 0 && game.dcTimers[color]) {
    clearTimeout(game.dcTimers[color]);
    game.dcTimers[color] = null;
    game.dcSince[color] = null;
    game.broadcast({ t: 'game:presence', id, color: COLORS[color], connected: true });
  }
  conn.send({ t: 'game:state', game: game.state(conn) });
  if (color < 0) { game.broadcast({ t: 'game:spectators', id, n: game.state(null).spectators }); requestEval(game); }
}

export function leaveGame(conn, id) {
  const game = games.get(id);
  conn.games.delete(id);
  if (!game || !game.sockets.delete(conn)) return;
  const color = game.colorOfUser(conn.user.id);
  if (color < 0) { game.broadcast({ t: 'game:spectators', id, n: game.state(null).spectators }); maybeEvict(game); return; }
  if (game.connected(color) || game.status !== 'playing') { maybeEvict(game); return; }
  if (game.tc.days) { maybeEvict(game); return; }
  // disconnect grace: 45 s for live games (bot games get 10 minutes before they are cleaned up)
  const grace = game.bot ? 600_000 : config.limits.disconnectGraceMs;
  game.dcSince[color] = Date.now();
  game.broadcast({ t: 'game:presence', id, color: COLORS[color], connected: false, graceMs: grace });
  game.dcTimers[color] = setTimeout(() => {
    game.dcTimers[color] = null;
    if (game.status !== 'playing' || game.connected(color)) return;
    if (game.game.ply < 2 || game.bot) finish(game, '*', 'aborted');
    else finish(game, color === WHITE ? '0-1' : '1-0', 'abandon');
  }, grace);
}

function maybeEvict(game) {
  if (game.sockets.size) return;
  if (game.status === 'playing' && !game.tc.days) return;
  clearTimeout(game.evictTimer);
  game.evictTimer = setTimeout(() => { if (!game.sockets.size) { if (game.status === 'playing') saveProgress(game); games.delete(game.id); } }, game.tc.days ? 30_000 : 120_000);
}

// ---- moves & clocks ---------------------------------------------------------------------
function scheduleFlag(game) {
  clearTimeout(game.flagTimer);
  if (!game.timed || game.status !== 'playing' || game.turnStarted == null) return;
  const color = game.game.turn;
  const ms = Math.max(0, game.remaining(color)) + 40;
  game.flagTimer = setTimeout(() => {
    if (game.status !== 'playing' || game.game.turn !== color) return;
    if (game.remaining(color) <= 0) flag(game, color); else scheduleFlag(game);
  }, Math.min(ms, 2_000_000_000));
}

function flag(game, color) {
  game.clocks[color] = 0;
  if (game.game.ply < 2) return finish(game, '*', 'aborted');
  const opp = color ^ 1;
  if (!game.game.pos.canWin(opp)) return finish(game, '1/2-1/2', 'timeout-insufficient');
  finish(game, opp === WHITE ? '1-0' : '0-1', 'timeout');
}

export function playerMove(conn, { id, uci }) {
  const game = games.get(id) || loadDaily(id);
  if (!game) return conn.send({ t: 'game:error', id, error: 'Game not found.' });
  const color = game.colorOfUser(conn.user.id);
  if (color < 0) return;
  const err = applyMove(game, color, String(uci || ''), { lag: conn.lag });
  if (err) conn.send({ t: 'game:reject', id, error: err, fen: game.game.fen, ply: game.game.ply, clocks: game.clockJson() });
}

function applyMove(game, color, uci, { lag = 0, fromBot = false } = {}) {
  const g = game.game, now = Date.now();
  if (game.status !== 'playing') return 'The game is over.';
  if (g.turn !== color) return 'It is not your turn.';
  let elapsed = 0;
  const running = game.timed && game.turnStarted != null;
  if (running) {
    elapsed = now - game.turnStarted;
    if (!fromBot) elapsed = Math.max(0, elapsed - Math.min(Math.max(0, lag), config.limits.maxLagCompMs));
    if (game.clocks[color] - elapsed <= 0) { flag(game, color); return null; }
  }
  const rec = g.play(uci);
  if (!rec) return 'Illegal move.';
  if (running) game.clocks[color] = game.clocks[color] - elapsed + game.tc.inc;
  game.turnStarted = now;
  if (game.drawOffer === (color ^ 1)) game.drawOffer = -1; // moving declines the opponent's offer
  if (game.firstMoveTimer && g.ply >= 2) { clearTimeout(game.firstMoveTimer); game.firstMoveTimer = null; }
  if (game.variant === 'standard' && g.startPly === 0 && g.ply <= 40) {
    const hit = openingByKey(rec.hash);
    if (hit) game.opening = { code: hit.code, name: hit.name, ply: g.ply };
  }
  const st = g.status();
  game.broadcast({
    t: 'game:move', id: game.id, ply: g.ply, uci: rec.uci, san: rec.san, fen: rec.fen, clocks: game.clockJson(),
    opening: game.opening, drawOffer: game.drawOffer < 0 ? null : COLORS[game.drawOffer],
  });
  if (st.over) { if (game.drill) drillOutcome(game, st); else finish(game, st.result, st.reason); return null; }
  if (game.drill && checkDrill(game)) return null;
  scheduleFlag(game);
  if (game.tc.days) saveProgress(game);
  if (game.bot) {
    if (fromBot) {
      const react = botReaction(game.bot.def, game.bot.state, { rec, byBot: true, ply: g.ply, pos: g.pos, opening: game.opening });
      if (react) say(game, react.text);
      preEvaluate(game);
    } else botTurn(game);
  } else {
    requestEval(game);
    if (game.tc.days) transport.sendUser(game.players[g.turn].id, { t: 'daily:turn', gameId: game.id, opponent: game.players[color].name });
  }
  return null;
}

// ---- endings -------------------------------------------------------------------------------
function finish(game, result, reason) {
  if (game.status !== 'playing') return;
  const now = Date.now();
  if (game.timed && game.turnStarted != null && reason !== 'timeout' && reason !== 'timeout-insufficient') {
    const c = game.game.turn;
    game.clocks[c] = Math.max(0, game.clocks[c] - (now - game.turnStarted));
  }
  game.status = reason === 'aborted' ? 'aborted' : 'finished';
  game.result = game.status === 'aborted' ? '*' : result;
  game.reason = reason;
  game.endedAt = now;
  game.turnStarted = null;
  game.drawOffer = -1;
  clearTimeout(game.flagTimer); clearTimeout(game.firstMoveTimer);
  for (const t of game.dcTimers) clearTimeout(t);
  if (game.bot) game.bot.token++;
  if (game.evalJob) { game.evalJob.cancel(); game.evalJob = null; }
  if (!game.opening) game.opening = detectOpening(game.game);
  trackUser(game, false);

  const [w, b] = game.players;
  const category = ratingCategory(game.variant, game.speed);
  if (game.status === 'finished' && game.rated && category && !w.isBot && !b.isBot && game.game.ply >= 2) {
    try { game.diffs = rateGame(w.id, b.id, category, result === '1-0' ? 1 : result === '0-1' ? 0 : 0.5, game.id); } catch (e) { console.error('rating update failed', e); }
  }
  try {
    saveFinal(game);
    if (game.status === 'finished' && game.game.ply >= 6) indexGame(game.game, game.result, [w.rating, b.rating]);
  } catch (e) { console.error('failed to archive game', game.id, e); }

  if (game.drill && !game.drill.outcome) game.drill.outcome = { success: false, text: 'Drill ended.' };
  game.broadcast({
    t: 'game:end', id: game.id, status: game.status, result: game.result, reason, clocks: game.clockJson(), opening: game.opening,
    diffs: game.diffs, drill: game.drill ? game.drill.outcome : null,
  });
  for (const c of game.sockets) if (game.lastEval) c.send({ t: 'game:eval', id: game.id, ...game.lastEval });
  if (game.bot && game.status === 'finished' && !game.drill) {
    const botWon = (result === '1-0' && game.bot.color === WHITE) || (result === '0-1' && game.bot.color === BLACK);
    say(game, botLine(game.bot.def, result === '1/2-1/2' ? 'draw' : botWon ? 'win' : 'lose'));
  }
  for (const p of game.players) if (!p.isBot && p.id != null) transport.sendUser(p.id, { t: 'game:finished', gameId: game.id, result: game.result, reason });
  transport.lobbyChanged();
  clearTimeout(game.evictTimer);
  game.evictTimer = setTimeout(() => { if (!game.sockets.size) games.delete(game.id); else maybeEvict(game); }, 600_000);
}

export function resign(conn, id) {
  const game = getLive(id);
  if (!game || game.status !== 'playing') return;
  const color = game.colorOfUser(conn.user.id);
  if (color < 0) return;
  if (game.game.ply < 2 && !game.drill) finish(game, '*', 'aborted');
  else finish(game, color === WHITE ? '0-1' : '1-0', 'resign');
}

export function abort(conn, id) {
  const game = getLive(id);
  if (!game || game.status !== 'playing' || game.colorOfUser(conn.user.id) < 0) return;
  if (game.game.ply >= 2 && !game.bot) return conn.send({ t: 'game:error', id, error: 'Games can only be aborted before both sides have moved.' });
  finish(game, '*', 'aborted');
}

export function drawOffer(conn, id, action) {
  const game = getLive(id);
  if (!game || game.status !== 'playing') return;
  const color = game.colorOfUser(conn.user.id);
  if (color < 0) return;
  if (action === 'decline') {
    if (game.drawOffer === (color ^ 1)) { game.drawOffer = -1; game.broadcast({ t: 'game:draw', id, offer: null, declined: true }); if (game.tc.days) saveProgress(game); }
    return;
  }
  if (game.drawOffer === (color ^ 1)) return finish(game, '1/2-1/2', 'agreement');
  if (game.game.ply < 2) return conn.send({ t: 'game:error', id, error: 'Play a move before offering a draw.' });
  if (game.bot) {
    // bots agree only when they do not think they are better
    const s = game.bot.state.lastBotScore;
    if (game.game.ply >= 30 && s != null && s <= 25) return finish(game, '1/2-1/2', 'agreement');
    say(game, 'No draw — let\'s play on.');
    return;
  }
  if (game.drawOffer === color) return;
  game.drawOffer = color;
  game.broadcast({ t: 'game:draw', id, offer: COLORS[color] });
  if (game.tc.days) saveProgress(game);
}

export function rematch(conn, id) {
  const game = games.get(id);
  if (!game || game.status === 'playing') return conn.send({ t: 'game:error', id, error: 'Rematch is no longer available.' });
  const color = game.colorOfUser(conn.user.id);
  if (color < 0) return;
  if (game.rematchId) return conn.send({ t: 'game:rematch', id, gameId: game.rematchId });
  if (game.bot && !game.drill) {
    const r = createBotGame(conn.user, { botId: game.bot.def.id, color: color === WHITE ? 'black' : 'white', variant: game.variant, tc: game.tc.label, hints: game.bot.hints, takebacks: game.bot.takebacks, feedback: game.bot.feedback, evalBar: game.bot.evalBar });
    if (r.gameId) { game.rematchId = r.gameId; conn.send({ t: 'game:rematch', id, gameId: r.gameId }); }
    return;
  }
  if (game.drill) {
    const r = createDrillGame(conn.user, game.drill.def.id);
    if (r.gameId) conn.send({ t: 'game:rematch', id, gameId: r.gameId });
    return;
  }
  game.rematch[color] = true;
  if (game.rematch[0] && game.rematch[1]) {
    const a = userById(game.players[0].id), b = userById(game.players[1].id);
    if (!a || !b) return;
    const ng = pairHumans(a, b, { variant: game.variant, tc: game.tc, rated: game.rated, source: game.source, colorOfA: 'black' });
    game.rematchId = ng.id;
    game.broadcast({ t: 'game:rematch', id, gameId: ng.id });
    for (const p of game.players) transport.sendUser(p.id, { t: 'seek:matched', gameId: ng.id });
  } else game.broadcast({ t: 'game:rematch', id, offer: COLORS[color] });
}

// ---- chat ------------------------------------------------------------------------------------
function say(game, text) {
  if (!text || !game.bot) return;
  const msg = { from: game.bot.def.name, color: COLORS[game.bot.color], text, ts: Date.now(), bot: true };
  game.chat.push(msg);
  if (game.chat.length > 100) game.chat.shift();
  game.broadcast({ t: 'game:chat', id: game.id, msg });
}

export function chat(conn, id, text) {
  const game = games.get(id);
  if (!game) return;
  const color = game.colorOfUser(conn.user.id);
  if (color < 0) return; // players only, so spectators cannot coach
  text = String(text || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
  if (!text) return;
  const now = Date.now();
  if (conn.lastChat && now - conn.lastChat < 400) return;
  conn.lastChat = now;
  const msg = { from: conn.user.username, color: COLORS[color], text, ts: now };
  game.chat.push(msg);
  if (game.chat.length > 100) game.chat.shift();
  game.broadcast({ t: 'game:chat', id, msg });
}

// ---- evaluation streaming (spectators / bot eval bar) -------------------------------------------
function setEval(game, ply, line, turn) {
  const sign = turn === WHITE ? 1 : -1;
  game.lastEval = { ply, cp: line.cp != null ? sign * line.cp : null, mate: line.mate != null ? sign * line.mate : null };
  game.broadcast({ t: 'game:eval', id: game.id, ...game.lastEval }, (c) => game.canSeeEval(c));
}

function requestEval(game) {
  if (game.bot || game.status !== 'playing') return;
  let watchers = false;
  for (const c of game.sockets) if (game.colorOfUser(c.user.id) < 0) { watchers = true; break; }
  if (!watchers) return;
  if (game.evalJob) game.evalJob.cancel();
  const g = game.game, ply = g.ply, turn = g.turn;
  const job = analysePosition({ variant: game.variant, fen: g.fen, nodes: 120_000 });
  game.evalJob = job;
  job.then((r) => {
    if (game.evalJob === job) game.evalJob = null;
    if (r.cancelled || !r.lines[0] || game.game.ply !== ply) return;
    setEval(game, ply, r.lines[0], turn);
  }).catch(() => {});
}

// ---- bots: move, feedback, hints, takebacks -------------------------------------------------------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function botTurn(game) {
  const b = game.bot, g = game.game, color = b.color;
  const token = ++b.token;
  const started = Date.now();
  let choice = null;
  try { choice = await chooseBotMove({ bot: b.def, game: g, clockMs: game.timed ? Math.max(200, game.remaining(color)) : null }); }
  catch (e) { console.error('bot move failed', e.message); }
  if (token !== b.token || game.status !== 'playing' || g.turn !== color) return;
  if (!choice) { const legal = g.pos.moves(); if (!legal.length) return; choice = { uci: g.pos.uci(legal[Math.floor(Math.random() * legal.length)]), best: null, score: null }; }
  const last = g.moves[g.moves.length - 1];
  if (choice.best) {
    const botScore = choice.best.score;
    setEval(game, g.ply, choice.best.mate != null ? { mate: choice.best.mate } : { cp: botScore }, color);
    if (last && b.feedback && b.pre && b.pre.ply === g.ply - 1) sendFeedback(game, last, botScore);
    if (last) {
      const react = botReaction(b.def, b.state, { rec: last, byBot: false, ply: g.ply, pos: g.pos, opening: game.opening, botScore });
      if (react) say(game, react.text);
    }
    b.state.lastBotScore = choice.score ?? botScore;
  }
  const wait = thinkDelay(b.def, { legalCount: g.pos.moves().length, clockMs: game.timed ? game.remaining(color) : null, ply: g.ply }) - (Date.now() - started);
  if (wait > 0) await sleep(wait);
  if (token !== b.token || game.status !== 'playing' || g.turn !== color) return;
  applyMove(game, color, choice.uci, { fromBot: true });
}

// Evaluate the human's position in the background so hints and feedback are instant.
function preEvaluate(game) {
  const b = game.bot, g = game.game;
  if (!b || game.status !== 'playing' || g.turn === b.color) return;
  if (!b.hints && !b.feedback && !b.evalBar) return;
  const ply = g.ply, token = b.token, turn = g.turn;
  if (b.preJob) b.preJob.cancel();
  const job = analysePosition({ variant: game.variant, fen: g.fen, startFen: g.startFen, moves: g.uciMoves(), nodes: 180_000, liteNodes: 60_000 });
  b.preJob = job;
  job.then((r) => {
    if (b.preJob === job) b.preJob = null;
    const l = r.lines[0];
    if (r.cancelled || !l || token !== b.token || game.game.ply !== ply) return;
    const m = g.pos.parseUci(l.uci);
    if (!m) return;
    b.pre = { ply, uci: g.pos.uci(m), san: g.pos.san(m), from: m.from, to: m.to, score: scoreToCp(l), mate: l.mate ?? null };
    setEval(game, ply, l, turn);
    if (b.hintWaiting) { const c = b.hintWaiting; b.hintWaiting = null; sendHint(game, c); }
  }).catch(() => {});
}

const FEEDBACK_TEXT = {
  best: 'Best move!', excellent: 'Excellent move.', good: 'Good move.', inaccuracy: 'Inaccuracy.', mistake: 'Mistake.', blunder: 'Blunder.',
};

function sendFeedback(game, rec, botScore) {
  const pre = game.bot.pre;
  const before = pre.score, after = -botScore;
  const loss = Math.max(0, winPct(before) - winPct(after));
  const cls = rec.uci === pre.uci ? 'best' : lossBucket(loss);
  let text = FEEDBACK_TEXT[cls];
  if (cls === 'inaccuracy' || cls === 'mistake' || cls === 'blunder') text += ` ${pre.san} was stronger.`;
  game.broadcast({ t: 'game:feedback', id: game.id, ply: game.game.ply, cls, text, best: pre.san, bestUci: pre.uci, loss: Math.round(loss * 10) / 10 },
    (c) => game.colorOfUser(c.user.id) >= 0);
}

function sendHint(game, conn) {
  const pre = game.bot.pre;
  const pos = game.game.pos;
  const piece = pos.board[pre.from] ? ['', 'pawn', 'knight', 'bishop', 'rook', 'queen', 'king'][typeOf(pos.board[pre.from])] : 'piece';
  conn.send({ t: 'game:hint', id: game.id, ply: game.game.ply, uci: pre.uci, san: pre.san, piece, coach: botLine(game.bot.def, 'hint') });
}

export function hint(conn, id) {
  const game = games.get(id);
  if (!game || !game.bot || game.status !== 'playing') return;
  const b = game.bot;
  if (game.colorOfUser(conn.user.id) < 0 || game.game.turn === b.color) return;
  if (!b.hints) return conn.send({ t: 'game:error', id, error: 'Hints are switched off for this game.' });
  b.hintsUsed++;
  if (b.pre && b.pre.ply === game.game.ply) return sendHint(game, conn);
  b.hintWaiting = conn;
  if (!b.preJob) preEvaluate(game);
}

export function takeback(conn, id) {
  const game = games.get(id);
  if (!game || !game.bot || game.status !== 'playing') return;
  const b = game.bot, g = game.game;
  const color = game.colorOfUser(conn.user.id);
  if (color < 0) return;
  if (!b.takebacks) return conn.send({ t: 'game:error', id, error: 'Takebacks are switched off for this game.' });
  const mine = g.moves.filter((m) => m.color === color).length;
  if (!mine) return;
  b.token++; // cancels any move the bot is thinking about
  if (b.preJob) { b.preJob.cancel(); b.preJob = null; }
  if (g.turn === color) g.undo(); // undo the bot's reply first
  g.undo();
  b.pre = null;
  b.state.lastBotScore = null;
  game.turnStarted = game.timed && g.ply > 0 ? Date.now() : null;
  game.drawOffer = -1;
  const said = botLine(b.def, 'takeback');
  for (const c of game.sockets) c.send({ t: 'game:state', game: game.state(c), takeback: true });
  if (said && Math.random() < 0.5) say(game, said);
  scheduleFlag(game);
  if (g.turn === b.color) botTurn(game); else preEvaluate(game);
}

// ---- drills -----------------------------------------------------------------------------------------
function material(pos, color) {
  let v = 0;
  for (let s = 0; s < 64; s++) { const p = pos.board[s]; if (p && colorOf(p) === color && typeOf(p) !== KING) v += PIECE_VALUE[typeOf(p)]; }
  return v;
}

function endDrill(game, success, text) {
  const d = game.drill, user = game.players[d.userColor];
  const userMoves = game.game.moves.filter((m) => m.color === d.userColor).length;
  const stars = success ? (userMoves <= d.def.par ? 3 : userMoves <= d.def.par * 1.5 ? 2 : 1) : 0;
  d.outcome = { success, text, moves: userMoves, par: d.def.par, stars, hints: game.bot.hintsUsed };
  if (success && user.id != null) {
    q('INSERT INTO scores (user_id, kind, score, detail, created_at) VALUES (?, ?, ?, ?, ?)').run(user.id, 'drill:' + d.def.id, stars, JSON.stringify({ moves: userMoves, hints: game.bot.hintsUsed }), Date.now());
  }
  const userWins = d.userColor === WHITE ? '1-0' : '0-1', userLoses = d.userColor === WHITE ? '0-1' : '1-0';
  finish(game, success ? (d.def.goal === 'draw' ? '1/2-1/2' : userWins) : (d.def.goal === 'draw' ? userLoses : '1/2-1/2'), success ? 'drill-complete' : 'drill-failed');
}

// Called after every move of a drill game that did not end by the normal rules.
function checkDrill(game) {
  const d = game.drill, g = game.game, pos = g.pos, me = d.userColor, opp = me ^ 1;
  const userMoves = g.moves.filter((m) => m.color === me).length;
  if (d.def.goal === 'win' && g.turn === me) {
    // decisive once a new queen has survived the defender's reply
    let queens = 0;
    for (let s = 0; s < 64; s++) if (pos.board[s] === (QUEEN | (me << 3))) queens++;
    if (queens > 0 && material(pos, me) - material(pos, opp) >= 400) { endDrill(game, true, 'Promotion secured — the rest is a basic mate.'); return true; }
    if (material(pos, me) === 0 || (material(pos, me) < 500 && !hasPawn(pos, me) && material(pos, opp) > 0)) { endDrill(game, false, 'The winning material is gone.'); return true; }
  }
  if (d.def.goal === 'draw') {
    let oppQueens = 0;
    for (let s = 0; s < 64; s++) if (pos.board[s] === (QUEEN | (opp << 3))) oppQueens++;
    if (oppQueens) { endDrill(game, false, 'The pawn promoted — the defence broke down.'); return true; }
    if (!hasPawn(pos, opp)) { endDrill(game, true, 'The pawn is gone. Drawn!'); return true; }
    if (g.turn === me && userMoves >= d.def.par && (game.bot.state.lastBotScore ?? 0) < 150) { endDrill(game, true, `You held the position for ${userMoves} moves. That is a draw.`); return true; }
  }
  return false;
}

const hasPawn = (pos, color) => { for (let s = 0; s < 64; s++) if (pos.board[s] === (PAWN | (color << 3))) return true; return false; };

// Normal game endings need translating for drills.
function drillOutcome(game, st) {
  const d = game.drill, me = d.userColor;
  if (d.def.goal === 'draw') return endDrill(game, st.winner === null, st.winner === null ? 'Drawn — textbook defence.' : 'Checkmated.');
  if (st.winner === me) return endDrill(game, true, st.reason === 'checkmate' ? 'Checkmate!' : 'Won!');
  const why = { stalemate: 'Stalemate — the king had no moves but was not in check.', fifty: 'Fifty moves passed without progress.', repetition: 'Threefold repetition.', insufficient: 'Not enough material left to mate.' }[st.reason] || 'The win slipped away.';
  return endDrill(game, false, why);
}

// ---- housekeeping ---------------------------------------------------------------------------------------
export function sweepDaily() {
  const now = Date.now();
  const rows = db.prepare("SELECT id FROM games WHERE status = 'playing' AND tc_days > 0 AND turn_started > 0 AND turn_started + tc_days * 86400000 < ?").all(now);
  for (const r of rows) {
    const game = getLive(r.id);
    if (!game || game.status !== 'playing') continue;
    const color = game.game.turn;
    if (game.game.ply < 2) finish(game, '*', 'aborted');
    else if (!game.game.pos.canWin(color ^ 1)) finish(game, '1/2-1/2', 'timeout-insufficient');
    else finish(game, color === WHITE ? '0-1' : '1-0', 'timeout');
  }
  return rows.length;
}

export function userOffline(userId) { cancelSeek(userId); }

export function ongoingGames(userId) {
  return q(`SELECT id, variant, speed, tc_base, tc_inc, tc_days, white_id, black_id, white_name, black_name, fen, ply, turn_started, bot_id, source, created_at
            FROM games WHERE status = 'playing' AND (white_id = ? OR black_id = ?) ORDER BY created_at DESC LIMIT 50`).all(userId, userId)
    .map((r) => {
      const mine = r.white_id === userId ? 'w' : 'b';
      const turn = r.fen.split(' ')[1];
      return {
        id: r.id, variant: r.variant, speed: r.speed, tc: r.tc_days ? r.tc_days + 'd' : r.tc_base || r.tc_inc ? `${r.tc_base / 60000}+${r.tc_inc / 1000}` : 'none',
        opponent: mine === 'w' ? r.black_name : r.white_name, color: mine, fen: r.fen, ply: r.ply, myTurn: turn === mine, source: r.source,
        deadline: r.tc_days ? (r.turn_started || r.created_at) + r.tc_days * DAY : null,
      };
    });
}

export function managerStats() {
  let playing = 0;
  for (const g of games.values()) if (g.status === 'playing') playing++;
  return { inMemory: games.size, playing, seeks: seeks.size };
}

export function shutdownGames() {
  for (const g of games.values()) {
    clearTimeout(g.flagTimer); clearTimeout(g.firstMoveTimer); clearTimeout(g.evictTimer);
    for (const t of g.dcTimers) clearTimeout(t);
    if (g.status === 'playing' && g.tc.days) saveProgress(g);
  }
}
