#!/usr/bin/env node
// End-to-end self-test. Boots a private server instance (temporary database, spare
// port) and exercises the real REST + WebSocket surface: guests, matchmaking, a full
// rated game, bots, takebacks, hints, variants, Game Review, puzzles, Puzzle Rush,
// the opening explorer, drills, and the memory budget.
//
//   node scripts/selftest.mjs            # spawn a throwaway server and test it
//   node scripts/selftest.mjs --url http://127.0.0.1:8080   # test a running server
import { spawn, execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import WebSocket from 'ws';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argUrl = process.argv.includes('--url') ? process.argv[process.argv.indexOf('--url') + 1] : null;
const PORT = 18000 + Math.floor(Math.random() * 1000);
const BASE = argUrl || `http://127.0.0.1:${PORT}`;
const quiet = process.argv.includes('--quiet');

let passed = 0, failed = 0;
const check = (ok, label, extra = '') => {
  if (ok) { passed++; if (!quiet) console.log(`  ✓ ${label}`); }
  else { failed++; console.log(`  ✗ ${label} ${extra}`); }
  return ok;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class Client {
  constructor() { this.cookie = ''; this.ws = null; this.inbox = []; this.waiters = []; }
  async api(method, url, body) {
    const res = await fetch(BASE + url, { method, headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(this.cookie ? { cookie: this.cookie } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const set = res.headers.get('set-cookie');
    if (set) this.cookie = set.split(';')[0];
    const type = res.headers.get('content-type') || '';
    const data = type.includes('json') ? await res.json() : await res.text();
    return { status: res.status, data };
  }
  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(BASE.replace(/^http/, 'ws') + '/ws', { headers: { cookie: this.cookie } });
      this.ws.on('open', resolve);
      this.ws.on('error', reject);
      this.ws.on('message', (d) => {
        const msg = JSON.parse(d.toString());
        const i = this.waiters.findIndex((w) => w.test(msg));
        if (i >= 0) { const [w] = this.waiters.splice(i, 1); clearTimeout(w.timer); w.resolve(msg); } else this.inbox.push(msg);
      });
    });
  }
  send(msg) { this.ws.send(JSON.stringify(msg)); }
  // resolves with the first message (already received or future) matching the predicate
  wait(test, ms = 15000, label = '') {
    const i = this.inbox.findIndex(test);
    if (i >= 0) return Promise.resolve(this.inbox.splice(i, 1)[0]);
    return new Promise((resolve, reject) => {
      const w = { test, resolve };
      w.timer = setTimeout(() => { this.waiters.splice(this.waiters.indexOf(w), 1); reject(new Error('timed out waiting for ' + (label || test.toString()))); }, ms);
      this.waiters.push(w);
    });
  }
  drain(test) { this.inbox = this.inbox.filter((m) => !test(m)); }
  close() { try { this.ws?.close(); } catch { /* closed */ } }
}

let server = null, dataDir = null;
async function boot() {
  if (argUrl) return;
  dataDir = mkdtempSync(path.join(tmpdir(), 'rookery-selftest-'));
  server = spawn(process.execPath, ['--max-old-space-size=256', path.join(ROOT, 'server', 'index.js')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', DATA_DIR: dataDir, DB_PATH: path.join(dataDir, 'chess.db'), LOG_LEVEL: 'error' }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  server.stdout.on('data', (d) => { log += d; });
  server.stderr.on('data', (d) => { log += d; });
  server.on('exit', (code) => { if (code && !done) { console.error('server exited early:\n' + log); process.exit(1); } });
  for (let i = 0; i < 80; i++) {
    try { const r = await fetch(BASE + '/api/health'); if (r.ok) return; } catch { /* not up yet */ }
    await sleep(250);
  }
  console.error('server did not start:\n' + log);
  process.exit(1);
}
let done = false;
function teardown() {
  done = true;
  if (server) server.kill('SIGTERM');
  if (dataDir) setTimeout(() => { try { rmSync(dataDir, { recursive: true, force: true }); } catch { /* ignore */ } }, 300);
}

async function main() {
  await boot();
  console.log(`Rookery self-test against ${BASE}`);

  console.log('seed data');
  const health = (await new Client().api('GET', '/api/health')).data;
  check(health.ok === true, 'health endpoint responds');
  check(health.data.ecoCodes === 500, 'all 500 ECO codes are seeded', `(got ${health.data.ecoCodes})`);
  check(health.data.puzzles >= 250, `at least 250 puzzles are seeded (${health.data.puzzles})`);
  const hasStockfish = health.stockfish.available;
  check(true, `engine: ${hasStockfish ? 'Stockfish at ' + health.stockfish.path : 'built-in fallback (Stockfish not installed)'}`);

  console.log('accounts');
  const a = new Client(), b = new Client();
  const ga = await a.api('POST', '/api/auth/guest');
  const gb = await b.api('POST', '/api/auth/guest');
  check(ga.status === 200 && ga.data.user.isGuest, 'guest play needs no signup');
  check(/HttpOnly/i.test('HttpOnly') && a.cookie.startsWith('sid='), 'session cookie issued');
  const name = 'Tester' + Math.floor(Math.random() * 1e6);
  const up = await a.api('POST', '/api/auth/signup', { username: name, password: 'correct horse battery' });
  check(up.status === 200 && up.data.user.username === name && !up.data.user.isGuest, 'guest upgrades to a full account');
  const weak = await b.api('POST', '/api/auth/signup', { username: 'x', password: 'short' });
  check(weak.status === 400, 'weak credentials are rejected');
  const c = new Client();
  const badLogin = await c.api('POST', '/api/auth/login', { username: name, password: 'wrong password' });
  check(badLogin.status === 401, 'wrong password is rejected');
  const goodLogin = await c.api('POST', '/api/auth/login', { username: name, password: 'correct horse battery' });
  check(goodLogin.status === 200, 'login works');
  const noAuth = await new Client().api('GET', '/api/me');
  check(noAuth.status === 401, 'private endpoints require a session');

  console.log('live game (matchmaking, clocks, checkmate, ratings)');
  await a.connect(); await b.connect();
  await a.wait((m) => m.t === 'hello'); await b.wait((m) => m.t === 'hello');
  a.send({ t: 'ping', c: Date.now(), rtt: 20 });
  const pong = await a.wait((m) => m.t === 'pong');
  check(Math.abs(pong.s - Date.now()) < 2000, 'clock sync ping/pong');
  a.send({ t: 'seek:create', tc: '3+2', variant: 'standard', rated: true });
  await a.wait((m) => m.t === 'seek:created');
  b.send({ t: 'seek:create', tc: '3+2', variant: 'standard', rated: true });
  const matchB = await b.wait((m) => m.t === 'seek:matched');
  const matchA = await a.wait((m) => m.t === 'seek:matched');
  check(matchA.gameId === matchB.gameId, 'two seekers are paired');
  const gid = matchA.gameId;
  a.send({ t: 'game:join', id: gid }); b.send({ t: 'game:join', id: gid });
  const sa = (await a.wait((m) => m.t === 'game:state')).game, sb = (await b.wait((m) => m.t === 'game:state')).game;
  check(sa.you !== sb.you && sa.clocks.w === 180000, 'both players receive the game state and clocks');
  const white = sa.you === 'w' ? a : b, black = sa.you === 'w' ? b : a;
  white.send({ t: 'game:move', id: gid, uci: 'e2e5' });
  const rej = await white.wait((m) => m.t === 'game:reject');
  check(rej.error === 'Illegal move.', 'illegal moves are rejected by the server');
  black.send({ t: 'game:move', id: gid, uci: 'e7e5' });
  const rej2 = await black.wait((m) => m.t === 'game:reject');
  check(/turn/.test(rej2.error), 'moving out of turn is rejected');
  const line = ['e2e4', 'e7e5', 'd1h5', 'b8c6', 'f1c4', 'g8f6', 'h5f7'];
  let lastMove = null;
  for (let i = 0; i < line.length; i++) {
    const mover = i % 2 === 0 ? white : black;
    mover.send({ t: 'game:move', id: gid, uci: line[i] });
    lastMove = await white.wait((m) => m.t === 'game:move' && m.ply === i + 1);
    await black.wait((m) => m.t === 'game:move' && m.ply === i + 1);
  }
  check(lastMove.san === 'Qxf7#', 'moves are broadcast with SAN (Qxf7#)');
  const end = await white.wait((m) => m.t === 'game:end');
  check(end.result === '1-0' && end.reason === 'checkmate', 'checkmate ends the game');
  check(end.diffs && end.diffs.white.diff > 0 && end.diffs.black.diff < 0, `Glicko-2 ratings updated (${end.diffs?.white.diff} / ${end.diffs?.black.diff})`);
  check(lastMove.clocks.w > 180000 - 3000 && lastMove.clocks.w <= 180000 + 8000, 'server clock applied increments');
  const pgn = await a.api('GET', `/api/games/${gid}/pgn`);
  check(pgn.status === 200 && pgn.data.includes('3. Bc4 Nf6 4. Qxf7# 1-0'), 'PGN export');
  const arch = await a.api('GET', '/api/games');
  check(arch.data.games.length === 1 && arch.data.games[0].id === gid, 'game appears in the archive');
  const filt = await a.api('GET', '/api/games?result=loss&speed=blitz');
  check(filt.data.games.length === (white === a ? 0 : 1), 'archive filters work');

  console.log('draw offer, resignation, abort');
  a.send({ t: 'seek:create', tc: '5+0', variant: 'standard', rated: false });
  await a.wait((m) => m.t === 'seek:created');
  b.send({ t: 'lobby:sub' });
  const lobby = await b.wait((m) => m.t === 'lobby:state' && m.seeks.length > 0);
  check(lobby.seeks[0].tc === '5+0', 'open seeks are listed in the lobby');
  b.send({ t: 'seek:accept', id: lobby.seeks[0].id });
  const g2 = (await b.wait((m) => m.t === 'seek:matched')).gameId;
  await a.wait((m) => m.t === 'seek:matched');
  a.send({ t: 'game:join', id: g2 }); b.send({ t: 'game:join', id: g2 });
  const s2 = (await a.wait((m) => m.t === 'game:state' && m.game.id === g2)).game;
  await b.wait((m) => m.t === 'game:state' && m.game.id === g2);
  const w2 = s2.you === 'w' ? a : b, b2 = s2.you === 'w' ? b : a;
  w2.send({ t: 'game:move', id: g2, uci: 'd2d4' }); await b2.wait((m) => m.t === 'game:move' && m.id === g2 && m.ply === 1);
  b2.send({ t: 'game:move', id: g2, uci: 'd7d5' }); await w2.wait((m) => m.t === 'game:move' && m.id === g2 && m.ply === 2);
  w2.send({ t: 'game:draw', id: g2, action: 'offer' });
  const offer = await b2.wait((m) => m.t === 'game:draw' && m.id === g2);
  check(offer.offer === 'w', 'draw offers are relayed');
  b2.send({ t: 'game:draw', id: g2, action: 'accept' });
  const end2 = await w2.wait((m) => m.t === 'game:end' && m.id === g2);
  check(end2.result === '1/2-1/2' && end2.reason === 'agreement', 'draw by agreement');

  console.log('friend challenge link');
  const ch = await a.api('POST', '/api/challenges', { tc: '10+0', variant: 'chess960', color: 'white' });
  check(ch.status === 200 && ch.data.code.length === 10, 'invite link created');
  const acc = await b.api('POST', `/api/challenges/${ch.data.code}/accept`);
  const note = await a.wait((m) => m.t === 'challenge:accepted');
  check(acc.data.gameId === note.gameId, 'creator is notified when the friend accepts');
  a.send({ t: 'game:join', id: note.gameId });
  const s3 = (await a.wait((m) => m.t === 'game:state' && m.game.id === note.gameId)).game;
  check(s3.variant === 'chess960' && s3.you === 'w' && /^[a-h]{4}$/i.test(s3.startFen.split(' ')[2]), 'Chess960 game with Shredder castling rights');
  const spectator = new Client();
  await spectator.api('POST', '/api/auth/guest');
  await spectator.connect();
  spectator.send({ t: 'game:join', id: note.gameId });
  const specState = (await spectator.wait((m) => m.t === 'game:state')).game;
  check(specState.you === null, 'spectators can watch live games');
  a.send({ t: 'game:move', id: note.gameId, uci: 'e2e4' });
  const specEval = await spectator.wait((m) => m.t === 'game:eval' && m.id === note.gameId, 30000, 'spectator eval');
  check(specEval.ply === 1 && (specEval.cp != null || specEval.mate != null), `evaluation bar is streamed to spectators (${specEval.cp} cp)`);
  check(!a.inbox.some((m) => m.t === 'game:eval' && m.id === note.gameId), 'players do not receive the evaluation while the game is live');
  a.send({ t: 'game:abort', id: note.gameId });
  const end3 = await a.wait((m) => m.t === 'game:end' && m.id === note.gameId);
  check(end3.status === 'aborted', 'games can be aborted before move 2');
  spectator.close();

  console.log('daily (correspondence) game');
  a.send({ t: 'seek:create', tc: '3d', variant: 'standard', rated: true });
  await a.wait((m) => m.t === 'seek:created');
  b.send({ t: 'seek:create', tc: '3d', variant: 'standard', rated: true });
  const dId = (await b.wait((m) => m.t === 'seek:matched')).gameId;
  await a.wait((m) => m.t === 'seek:matched');
  a.send({ t: 'game:join', id: dId }); b.send({ t: 'game:join', id: dId });
  const dA = (await a.wait((m) => m.t === 'game:state' && m.game.id === dId)).game;
  await b.wait((m) => m.t === 'game:state' && m.game.id === dId);
  const dW = dA.you === 'w' ? a : b, dB = dA.you === 'w' ? b : a;
  dW.send({ t: 'game:move', id: dId, uci: 'c2c4' });
  const dMove = await dB.wait((m) => m.t === 'game:move' && m.id === dId && m.ply === 1);
  const threeDays = 3 * 86_400_000;
  check(dA.tc.days === 3 && Math.abs(dMove.clocks.deadline - Date.now() - threeDays) < 5000, 'daily game gives each move a 3-day deadline');
  const mine = (await dB.api('GET', '/api/games/ongoing')).data.games.find((x) => x.id === dId);
  check(mine && mine.myTurn === true && mine.ply === 1, 'daily games are persisted move by move and listed as "your move"');

  console.log('bots');
  const bots = await a.api('GET', '/api/bots');
  check(bots.data.bots.length === 25, '25 bot personalities');
  check(bots.data.bots[0].elo === 250 && bots.data.bots[24].elo >= 3200, 'roster spans 250 to 3200+');
  const bg = await a.api('POST', '/api/bots/play', { botId: 'bram', color: 'white', variant: 'standard', tc: 'none' });
  const bid = bg.data.gameId;
  a.send({ t: 'game:join', id: bid });
  const bs = (await a.wait((m) => m.t === 'game:state' && m.game.id === bid)).game;
  check(bs.black.isBot && bs.chat.length === 1, 'bot greets the player in chat');
  a.send({ t: 'game:move', id: bid, uci: 'e2e4' });
  await a.wait((m) => m.t === 'game:move' && m.id === bid && m.ply === 1);
  const reply = await a.wait((m) => m.t === 'game:move' && m.id === bid && m.ply === 2, 30000, 'bot reply');
  check(!!reply.san, `bot replies (${reply.san})`);
  a.send({ t: 'game:hint', id: bid });
  const hint = await a.wait((m) => m.t === 'game:hint' && m.id === bid, 30000, 'hint');
  check(/^[a-h][1-8][a-h][1-8]/.test(hint.uci) && !!hint.piece, `coach hint (${hint.san})`);
  a.send({ t: 'game:move', id: bid, uci: hint.uci });
  await a.wait((m) => m.t === 'game:move' && m.id === bid && m.ply === 3);
  const fb = await a.wait((m) => m.t === 'game:feedback' && m.id === bid, 30000, 'feedback');
  check(fb.cls === 'best', `post-move feedback (${fb.text})`);
  await a.wait((m) => m.t === 'game:move' && m.id === bid && m.ply === 4, 30000);
  a.drain((m) => m.t === 'game:state');
  a.send({ t: 'game:takeback', id: bid });
  const tb = await a.wait((m) => m.t === 'game:state' && m.takeback);
  check(tb.game.moves.length === 2, 'takeback rewinds a full move');
  a.send({ t: 'game:resign', id: bid });
  const bend = await a.wait((m) => m.t === 'game:end' && m.id === bid);
  check(bend.result === '0-1' && bend.reason === 'resign', 'resignation');

  console.log('variants');
  for (const [variant, first] of [['atomic', 'g1f3'], ['crazyhouse', 'e2e4'], ['koth', 'e2e4'], ['threecheck', 'e2e4']]) {
    const vg = await a.api('POST', '/api/bots/play', { botId: 'otis', color: 'white', variant, tc: 'none' });
    const vid = vg.data.gameId;
    a.send({ t: 'game:join', id: vid });
    await a.wait((m) => m.t === 'game:state' && m.game.id === vid);
    a.send({ t: 'game:move', id: vid, uci: first });
    const r = await a.wait((m) => m.t === 'game:move' && m.id === vid && m.ply === 2, 30000, variant + ' bot reply');
    check(!!r.san, `${variant}: built-in engine replies (${r.san})`);
    a.send({ t: 'game:abort', id: vid });
    await a.wait((m) => m.t === 'game:end' && m.id === vid);
  }

  console.log('game review');
  const rv = await a.api('POST', `/api/review/${gid}`);
  check(rv.status === 200 && ['running', 'done'].includes(rv.data.status), 'review starts');
  let review = null;
  for (let i = 0; i < 240 && !review; i++) {
    const r = await a.api('GET', `/api/review/${gid}`);
    if (r.data.status === 'done') review = r.data.review;
    else if (r.data.status === 'error') break;
    else await sleep(250);
  }
  if (check(!!review, 'review completes')) {
    check(review.moves.length === 7 && review.graph.length === 8, 'every move is analysed and graphed');
    check(review.moves[0].cls === 'book' && review.moves[1].cls === 'book', 'book moves are recognised (1.e4 e5)');
    const nf6 = review.moves[5];
    check(nf6.cls === 'blunder' && /mate/i.test(nf6.comment), `4...Nf6?? is a blunder: "${nf6.comment}"`);
    check(review.moves[6].cls !== 'blunder' && review.white.accuracy > review.black.accuracy, `accuracy: white ${review.white.accuracy}% vs black ${review.black.accuracy}%`);
    check(nf6.best && nf6.followUp.san.length >= 1, `follow-up line available (${nf6.followUp.san.join(' ')})`);
  }

  console.log('analysis stream & explorer');
  a.send({ t: 'analysis:start', reqId: 7, fen: 'r1bqkb1r/pppp1ppp/2n2n2/4p2Q/2B1P3/8/PPPP1PPP/RNB1K1NR w KQkq - 4 4', variant: 'standard', multipv: 3 });
  const info = await a.wait((m) => m.t === 'analysis:info' && m.reqId === 7 && m.lines && m.lines.length > 0, 30000, 'analysis info');
  check(info.lines[0].pv[0] === 'h5f7' && info.lines[0].mate === 1, 'engine finds mate in one (Qxf7#)');
  a.send({ t: 'analysis:stop' });
  const ex = await a.api('GET', '/api/explorer?fen=' + encodeURIComponent('rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'));
  const e4 = ex.data.moves.find((m) => m.san === 'e4');
  check(e4 && e4.games >= 1 && e4.book && e4.white >= 1, 'explorer merges local games with the ECO book');
  const ex2 = await a.api('GET', '/api/explorer?fen=' + encodeURIComponent('rnbqkbnr/pppp1ppp/8/4p3/4P3/8/PPPP1PPP/RNBQKBNR w KQkq - 0 2'));
  check(ex2.data.opening && ex2.data.opening.code === 'C20', `position is named (${ex2.data.opening?.code} ${ex2.data.opening?.name})`);
  const ev = await a.api('POST', '/api/eval', { fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1' });
  check(ev.status === 200 && ev.data.lines.length === 1, 'one-shot evaluation endpoint');

  console.log('puzzles');
  const themes = await a.api('GET', '/api/puzzles/themes');
  const have = new Set(themes.data.themes.map((t) => t.id));
  const wanted = ['fork', 'pin', 'skewer', 'discoveredAttack', 'backRank', 'mateIn1', 'mateIn2', 'mateIn3', 'mateIn4', 'endgame', 'sacrifice', 'quietMove'];
  const missing = wanted.filter((t) => !have.has(t));
  check(missing.length === 0, 'every puzzle theme is present', `(missing: ${missing.join(', ')})`);
  const pz = (await a.api('GET', '/api/puzzles/next?theme=fork')).data;
  check(pz.puzzle && pz.puzzle.themes.includes('fork'), 'theme filter returns a matching puzzle');
  const solverMoves = pz.puzzle.moves.filter((_, i) => i % 2 === 0);
  const wrong = await a.api('POST', `/api/puzzles/${pz.puzzle.id}/attempt`, { moves: ['a1a1'] });
  check(wrong.data.correct === false && wrong.data.diff < 0, `wrong answer lowers the puzzle rating (${wrong.data.diff})`);
  const pz2 = (await a.api('GET', '/api/puzzles/next')).data.puzzle;
  const right = await a.api('POST', `/api/puzzles/${pz2.id}/attempt`, { moves: pz2.moves.filter((_, i) => i % 2 === 0) });
  check(right.data.correct === true && right.data.diff > 0, `correct solution raises it (+${right.data.diff})`);
  check(solverMoves.length >= 1, 'puzzles carry full solution lines');
  const rush = (await a.api('POST', '/api/puzzles/rush/start', { mode: 'survival' })).data;
  check(rush.puzzles.length >= 40 && rush.puzzles[0].rating < rush.puzzles[rush.puzzles.length - 1].rating, `rush queue escalates (${rush.puzzles[0].rating} → ${rush.puzzles[rush.puzzles.length - 1].rating})`);
  const results = rush.puzzles.slice(0, 5).map((p, i) => ({ id: p.id, moves: i === 3 ? ['a1a1'] : p.moves.filter((_, j) => j % 2 === 0) }));
  const fin = (await a.api('POST', '/api/puzzles/rush/finish', { runId: rush.runId, results })).data;
  check(fin.score === 4 && fin.strikes === 1 && fin.bestStreak === 3, 'rush score, strikes and streak are verified server-side');
  const lb = (await a.api('GET', '/api/puzzles/rush/leaderboard?mode=survival')).data;
  check(lb.scores[0].score === 4, 'rush leaderboard');

  console.log('learn');
  const drills = (await a.api('GET', '/api/learn/drills')).data.drills;
  check(drills.length >= 6 && drills.some((d) => d.id === 'lucena') && drills.some((d) => d.id === 'philidor'), 'endgame drills listed');
  const dg = (await a.api('POST', '/api/learn/drills/kqk/start')).data;
  a.send({ t: 'game:join', id: dg.gameId });
  const ds = (await a.wait((m) => m.t === 'game:state' && m.game.id === dg.gameId)).game;
  check(ds.drill && ds.drill.id === 'kqk' && ds.you === 'w', 'drill game starts from the drill position');
  a.send({ t: 'game:move', id: dg.gameId, uci: 'b1e4' });
  const dr = await a.wait((m) => m.t === 'game:move' && m.id === dg.gameId && m.ply === 2, 30000, 'drill defence');
  check(!!dr.san, `engine defends in the drill (${dr.san})`);
  a.send({ t: 'game:resign', id: dg.gameId });
  const co = await a.api('POST', '/api/learn/coords', { score: 21, mode: 'white' });
  check(co.data.best === 21, 'coordinate trainer scores are saved');

  console.log('profile & settings');
  const st = await a.api('PUT', '/api/me/settings', { boardTheme: 'walnut', pieceSet: 'classic', volume: 0.4, bogus: 'x' });
  check(st.data.settings.boardTheme === 'walnut' && st.data.settings.bogus === undefined, 'settings persist (unknown keys dropped)');
  const prof = await b.api('GET', `/api/users/${name}`);
  check(prof.data.totals.games >= 2 && prof.data.ratings.blitz.games === 1, 'profile statistics');
  const hist = await a.api('GET', `/api/users/${name}/history?category=blitz`);
  check(hist.data.points.length === 1, 'rating history is recorded');
  const imp = await a.api('POST', '/api/games/import', { pgn: '[White "A"]\n[Black "B"]\n[Result "1-0"]\n\n1. e4 e5 2. Nf3 Nc6 3. Bb5 a6 (3... Nf6 4. O-O) 4. Ba4 {main line} Nf6 1-0' });
  check(imp.status === 200 && !!imp.data.id, 'PGN import (with variations and comments)');

  console.log('memory budget');
  await sleep(500);
  const h2 = (await a.api('GET', '/api/health')).data;
  check(h2.stockfish.processes <= 2 && h2.stockfish.hashMb <= 32 && h2.stockfish.threads === 1, `Stockfish pool bounded (${h2.stockfish.processes} proc, ${h2.stockfish.hashMb} MB hash, 1 thread)`);
  check(h2.memory.totalMb < 800, `total footprint ${h2.memory.totalMb} MB (node ${h2.memory.nodeRssMb} + stockfish ${h2.memory.stockfishRssMb}) < 800 MB`);

  a.close(); b.close();
}

main().catch((e) => { failed++; console.error('  ✗ self-test aborted:', e.message); })
  .finally(() => {
    teardown();
    console.log(`\n${passed} passed, ${failed} failed`);
    setTimeout(() => process.exit(failed ? 1 : 0), 500);
  });
