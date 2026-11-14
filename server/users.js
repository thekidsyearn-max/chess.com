// Accounts, sessions and Glicko-2 rating storage.
import bcrypt from 'bcryptjs';
import { randomBytes, createHash, randomInt } from 'node:crypto';
import { db, q, tx } from './db.js';
import { config } from './config.js';
import { glicko2, DEFAULT_RATING } from './glicko2.js';

export const CATEGORIES = ['bullet', 'blitz', 'rapid', 'daily', 'puzzle', 'chess960', 'koth', 'threecheck', 'crazyhouse', 'atomic'];
export const CATEGORY_NAMES = {
  bullet: 'Bullet', blitz: 'Blitz', rapid: 'Rapid', daily: 'Daily', puzzle: 'Puzzles',
  chess960: 'Chess960', koth: 'King of the Hill', threecheck: 'Three-Check', crazyhouse: 'Crazyhouse', atomic: 'Atomic',
};
const USERNAME_RE = /^[A-Za-z][A-Za-z0-9_-]{2,19}$/;
const RESERVED = new Set(['admin', 'root', 'system', 'rookery', 'stockfish', 'guest', 'anonymous', 'null', 'undefined', 'bot']);
const SESSION_MS = config.sessionDays * 86_400_000;

const hashToken = (t) => createHash('sha256').update(t).digest('hex');

export class AuthError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}

export function createSession(userId) {
  const token = randomBytes(32).toString('base64url');
  const t = Date.now();
  q('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(hashToken(token), userId, t, t + SESSION_MS);
  return token;
}

export function destroySession(token) {
  if (token) q('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
}

export function userFromToken(token) {
  if (!token || token.length > 128) return null;
  const h = hashToken(token);
  const row = q('SELECT u.*, s.expires_at AS session_expires FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?').get(h);
  if (!row) return null;
  const t = Date.now();
  if (row.session_expires < t) { q('DELETE FROM sessions WHERE token_hash = ?').run(h); return null; }
  if (t - row.last_seen > 60_000) {
    q('UPDATE users SET last_seen = ? WHERE id = ?').run(t, row.id);
    if (row.session_expires - t < SESSION_MS / 2) q('UPDATE sessions SET expires_at = ? WHERE token_hash = ?').run(t + SESSION_MS, h);
  }
  return row;
}

export function createGuest() {
  const t = Date.now();
  for (let i = 0; i < 20; i++) {
    const name = 'Guest' + randomInt(10000, 999999);
    try {
      const r = q('INSERT INTO users (username, is_guest, created_at, last_seen) VALUES (?, 1, ?, ?)').run(name, t, t);
      return q('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
    } catch (e) { if (!String(e.message).includes('UNIQUE')) throw e; }
  }
  throw new AuthError('Could not allocate a guest name', 500);
}

function checkCredentials(username, password) {
  if (typeof username !== 'string' || !USERNAME_RE.test(username)) throw new AuthError('Username must be 3–20 characters: letters, digits, _ or -, starting with a letter.');
  if (RESERVED.has(username.toLowerCase()) || /^guest\d*$/i.test(username)) throw new AuthError('That username is reserved.');
  if (typeof password !== 'string' || password.length < 8 || password.length > 72) throw new AuthError('Password must be 8–72 characters.');
}

// Creates an account, or upgrades the current guest in place so history is kept.
export async function signup(username, password, current) {
  checkCredentials(username, password);
  if (q('SELECT 1 FROM users WHERE username = ?').get(username)) throw new AuthError('That username is taken.', 409);
  const hash = await bcrypt.hash(password, 11);
  const t = Date.now();
  try {
    if (current && current.is_guest) {
      q('UPDATE users SET username = ?, password_hash = ?, is_guest = 0 WHERE id = ?').run(username, hash, current.id);
      for (const col of ['white', 'black']) q(`UPDATE games SET ${col}_name = ? WHERE ${col}_id = ?`).run(username, current.id);
      return q('SELECT * FROM users WHERE id = ?').get(current.id);
    }
    const r = q('INSERT INTO users (username, password_hash, is_guest, created_at, last_seen) VALUES (?, ?, 0, ?, ?)').run(username, hash, t, t);
    return q('SELECT * FROM users WHERE id = ?').get(r.lastInsertRowid);
  } catch (e) {
    if (String(e.message).includes('UNIQUE')) throw new AuthError('That username is taken.', 409);
    throw e;
  }
}

// constant-ish time: always run a bcrypt comparison
const DUMMY_HASH = '$2b$11$CwTycUXWue0Thq9StjUM0uJ8.1Vq0iY2W1PZb7v5eXQy9W1b0J8G6';
export async function login(username, password) {
  if (typeof username !== 'string' || typeof password !== 'string') throw new AuthError('Invalid credentials.', 401);
  const row = q('SELECT * FROM users WHERE username = ? AND is_guest = 0').get(username);
  const ok = await bcrypt.compare(password.slice(0, 72), row?.password_hash || DUMMY_HASH);
  if (!row || !ok) throw new AuthError('Wrong username or password.', 401);
  return row;
}

export async function changePassword(user, oldPassword, newPassword) {
  if (user.is_guest) throw new AuthError('Guests have no password.');
  if (typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 72) throw new AuthError('Password must be 8–72 characters.');
  if (!(await bcrypt.compare(String(oldPassword || '').slice(0, 72), user.password_hash))) throw new AuthError('Current password is wrong.', 401);
  q('UPDATE users SET password_hash = ? WHERE id = ?').run(await bcrypt.hash(newPassword, 11), user.id);
}

export const userById = (id) => q('SELECT * FROM users WHERE id = ?').get(id);
export const userByName = (name) => q('SELECT * FROM users WHERE username = ?').get(name);

export function parseSettings(user) {
  try { return JSON.parse(user.settings || '{}') || {}; } catch { return {}; }
}

const SETTING_KEYS = {
  boardTheme: 'string', pieceSet: 'string', coords: 'string', animation: 'string', autoQueen: 'boolean', confirmMove: 'boolean',
  soundTheme: 'string', volume: 'number', uiTheme: 'string', showLegal: 'boolean', highlightLast: 'boolean', premoves: 'boolean',
  evalBar: 'boolean', pieceNotation: 'string', zen: 'boolean',
};
export function saveSettings(userId, patch) {
  const user = userById(userId);
  const cur = parseSettings(user);
  for (const [k, v] of Object.entries(patch || {})) {
    if (SETTING_KEYS[k] && typeof v === SETTING_KEYS[k] && String(v).length <= 40) cur[k] = v;
  }
  q('UPDATE users SET settings = ? WHERE id = ?').run(JSON.stringify(cur), userId);
  return cur;
}

export function publicUser(u) {
  return u ? { id: u.id, username: u.username, isGuest: !!u.is_guest, bio: u.bio, country: u.country, createdAt: u.created_at, lastSeen: u.last_seen } : null;
}

// ---- ratings ---------------------------------------------------------------
export function getRating(userId, category) {
  const r = q('SELECT * FROM ratings WHERE user_id = ? AND category = ?').get(userId, category);
  return r || { user_id: userId, category, ...DEFAULT_RATING, games: 0, wins: 0, losses: 0, draws: 0, peak: DEFAULT_RATING.rating, updated_at: Date.now() };
}

export function getRatings(userId) {
  const out = {};
  for (const c of CATEGORIES) out[c] = { rating: DEFAULT_RATING.rating, rd: DEFAULT_RATING.rd, games: 0, wins: 0, losses: 0, draws: 0, peak: DEFAULT_RATING.rating, provisional: true };
  for (const r of q('SELECT * FROM ratings WHERE user_id = ?').all(userId)) {
    out[r.category] = { rating: Math.round(r.rating), rd: Math.round(r.rd), games: r.games, wins: r.wins, losses: r.losses, draws: r.draws, peak: Math.round(r.peak), provisional: r.rd > 110 };
  }
  return out;
}

const idlePeriods = (row) => Math.min(60, Math.max(0, (Date.now() - row.updated_at) / 86_400_000) * 0.2);

function storeRating(userId, category, prev, next, score, gameId) {
  const t = Date.now();
  q(`INSERT INTO ratings (user_id, category, rating, rd, vol, games, wins, losses, draws, peak, updated_at)
     VALUES (@user_id, @category, @rating, @rd, @vol, 1, @w, @l, @d, @peak, @t)
     ON CONFLICT(user_id, category) DO UPDATE SET rating = @rating, rd = @rd, vol = @vol, games = games + 1,
       wins = wins + @w, losses = losses + @l, draws = draws + @d, peak = MAX(peak, @rating), updated_at = @t`)
    .run({ user_id: userId, category, rating: next.rating, rd: next.rd, vol: next.vol, w: score === 1 ? 1 : 0, l: score === 0 ? 1 : 0, d: score === 0.5 ? 1 : 0, peak: Math.max(prev.peak || 0, next.rating), t });
  q('INSERT INTO rating_history (user_id, category, rating, game_id, created_at) VALUES (?, ?, ?, ?, ?)').run(userId, category, next.rating, gameId || null, t);
}

// Rates a finished two-player game. scoreWhite: 1, 0.5 or 0. Returns rating diffs.
export const rateGame = tx((whiteId, blackId, category, scoreWhite, gameId) => {
  const w = getRating(whiteId, category), b = getRating(blackId, category);
  const wNext = glicko2(w, [{ rating: b.rating, rd: b.rd, score: scoreWhite }], idlePeriods(w));
  const bNext = glicko2(b, [{ rating: w.rating, rd: w.rd, score: 1 - scoreWhite }], idlePeriods(b));
  storeRating(whiteId, category, w, wNext, scoreWhite, gameId);
  storeRating(blackId, category, b, bNext, 1 - scoreWhite, gameId);
  return {
    white: { before: Math.round(w.rating), after: Math.round(wNext.rating), diff: Math.round(wNext.rating) - Math.round(w.rating) },
    black: { before: Math.round(b.rating), after: Math.round(bNext.rating), diff: Math.round(bNext.rating) - Math.round(b.rating) },
  };
});

// Rates one player against a fixed-strength opponent (puzzles). Returns the diff.
export const rateSolo = tx((userId, category, opponent, score, ref) => {
  const p = getRating(userId, category);
  const next = glicko2(p, [{ rating: opponent.rating, rd: opponent.rd, score }], idlePeriods(p));
  storeRating(userId, category, p, next, score, ref);
  return { before: Math.round(p.rating), after: Math.round(next.rating), diff: Math.round(next.rating) - Math.round(p.rating) };
});

export function ratingHistory(userId, category, limit = 400) {
  return q('SELECT rating, created_at FROM (SELECT rating, created_at, id FROM rating_history WHERE user_id = ? AND category = ? ORDER BY id DESC LIMIT ?) ORDER BY id ASC')
    .all(userId, category, limit).map((r) => ({ r: Math.round(r.rating), t: r.created_at }));
}

export function leaderboard(category, limit = 50) {
  return q(`SELECT u.username, r.rating, r.rd, r.games FROM ratings r JOIN users u ON u.id = r.user_id
            WHERE r.category = ? AND r.games >= 1 ORDER BY r.rating DESC LIMIT ?`).all(category, limit)
    .map((r, i) => ({ rank: i + 1, username: r.username, rating: Math.round(r.rating), games: r.games, provisional: r.rd > 110 }));
}

// Housekeeping: expired sessions and abandoned guests that never played.
export function cleanup() {
  const t = Date.now();
  q('DELETE FROM sessions WHERE expires_at < ?').run(t);
  db.prepare(`DELETE FROM users WHERE is_guest = 1 AND last_seen < ?
    AND NOT EXISTS (SELECT 1 FROM games g WHERE g.white_id = users.id OR g.black_id = users.id)
    AND NOT EXISTS (SELECT 1 FROM puzzle_attempts a WHERE a.user_id = users.id)`).run(t - 14 * 86_400_000);
}

// Tiny fixed-window limiter (per key) used for auth endpoints.
const windows = new Map();
export function rateLimit(key, max, windowMs) {
  const t = Date.now();
  let w = windows.get(key);
  if (!w || w.reset < t) { w = { n: 0, reset: t + windowMs }; windows.set(key, w); }
  w.n++;
  if (windows.size > 5000) for (const [k, v] of windows) if (v.reset < t) windows.delete(k);
  return w.n <= max;
}
