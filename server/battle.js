// Puzzle Battle: two players race through the same escalating puzzle queue.
// Three minutes, three strikes; highest score wins. If nobody else is queueing
// within a few seconds, a sparring ghost matched to your puzzle rating steps in.
import { randomBytes } from 'node:crypto';
import { rushQueue, checkSolution, puzzleById, addScore } from './puzzles.js';
import { getRating } from './users.js';

const DURATION = 180_000, STRIKES = 3, GHOST_WAIT = 6_000;
const waiting = []; // { conn, timer }
const battles = new Map();

const view = (b) => ({ id: b.id, endsAt: b.endsAt, players: b.players.map((p) => ({ name: p.name, rating: p.rating, score: p.score, strikes: p.strikes, done: p.done, ghost: !!p.ghost })) });
const send = (b, msg) => { for (const p of b.players) if (p.conn) p.conn.send(msg); };

function start(a, bConn) {
  const id = randomBytes(6).toString('base64url');
  const puzzles = rushQueue(70, 500, 32);
  const mk = (conn) => ({ conn, userId: conn.user.id, name: conn.user.username, rating: Math.round(getRating(conn.user.id, 'puzzle').rating), score: 0, strikes: 0, done: false, index: 0 });
  const players = [mk(a)];
  if (bConn) players.push(mk(bConn));
  else {
    const r = players[0].rating;
    players.push({ conn: null, userId: null, name: 'Sparring Ghost', rating: r, score: 0, strikes: 0, done: false, index: 0, ghost: true });
  }
  const b = { id, puzzles, players, startedAt: Date.now() + 3000, endsAt: Date.now() + 3000 + DURATION, timers: [] };
  battles.set(id, b);
  for (const p of players) if (p.conn) { p.conn.battle = id; p.conn.send({ t: 'battle:start', battle: view(b), puzzles, countdown: 3000, strikes: STRIKES, you: p.name }); }
  b.timers.push(setTimeout(() => end(b), 3000 + DURATION + 500));
  const ghost = players.find((p) => p.ghost);
  if (ghost) {
    // the ghost solves at a pace and accuracy that depend on puzzle difficulty versus its rating
    const tick = () => {
      if (!battles.has(id) || ghost.done) return;
      const pz = puzzles[ghost.index];
      if (!pz) { ghost.done = true; return maybeEnd(b); }
      const pSolve = 1 / (1 + Math.pow(10, (pz.rating - ghost.rating - 150) / 400));
      if (Math.random() < pSolve) ghost.score++; else ghost.strikes++;
      ghost.index++;
      if (ghost.strikes >= STRIKES) ghost.done = true;
      send(b, { t: 'battle:update', battle: view(b) });
      if (!maybeEnd(b)) b.timers.push(setTimeout(tick, 3500 + Math.random() * 5000 + ghost.index * 350));
    };
    b.timers.push(setTimeout(tick, 3000 + 4000 + Math.random() * 3000));
  }
}

function maybeEnd(b) {
  if (b.players.every((p) => p.done)) { end(b); return true; }
  // a player who has struck out cannot be caught? then the leader has already won
  const [x, y] = b.players;
  if (x.done && y.score > x.score) { end(b); return true; }
  if (y.done && x.score > y.score) { end(b); return true; }
  return false;
}

function end(b) {
  if (!battles.delete(b.id)) return;
  for (const t of b.timers) clearTimeout(t);
  const [x, y] = b.players;
  const winner = x.score === y.score ? null : x.score > y.score ? x.name : y.name;
  for (const p of b.players) {
    if (!p.conn) continue;
    p.conn.battle = null;
    if (p.userId) addScore(p.userId, 'battle', p.score, { won: winner === p.name, opponent: b.players.find((o) => o !== p).name });
  }
  send(b, { t: 'battle:end', battle: view(b), winner });
}

export function queueBattle(conn) {
  if (conn.battle) return;
  cancelBattle(conn);
  const other = waiting.find((w) => w.conn.user.id !== conn.user.id);
  if (other) {
    waiting.splice(waiting.indexOf(other), 1);
    clearTimeout(other.timer);
    return start(other.conn, conn);
  }
  const entry = { conn, timer: setTimeout(() => { const i = waiting.indexOf(entry); if (i >= 0) { waiting.splice(i, 1); start(conn, null); } }, GHOST_WAIT) };
  waiting.push(entry);
  conn.send({ t: 'battle:waiting', ghostInMs: GHOST_WAIT });
}

export function cancelBattle(conn) {
  const i = waiting.findIndex((w) => w.conn === conn);
  if (i >= 0) { clearTimeout(waiting[i].timer); waiting.splice(i, 1); }
}

export function battleAnswer(conn, { id, puzzleId, moves }) {
  const b = battles.get(id);
  if (!b) return;
  const p = b.players.find((x) => x.conn === conn);
  if (!p || p.done || Date.now() < b.startedAt - 500 || Date.now() > b.endsAt + 1500) return;
  const pz = b.puzzles[p.index];
  if (!pz || pz.id !== puzzleId) return;
  const ok = checkSolution(puzzleById(pz.id), moves);
  if (ok) p.score++; else p.strikes++;
  p.index++;
  if (p.strikes >= STRIKES || p.index >= b.puzzles.length) p.done = true;
  send(b, { t: 'battle:update', battle: view(b) });
  maybeEnd(b);
}

export function battleDisconnect(conn) {
  cancelBattle(conn);
  const b = conn.battle && battles.get(conn.battle);
  if (!b) return;
  const p = b.players.find((x) => x.conn === conn);
  if (p) { p.done = true; p.conn = null; }
  maybeEnd(b);
}
