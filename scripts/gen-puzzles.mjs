#!/usr/bin/env node
// Tactical puzzle generator.
//
// Plays engine-vs-engine games in which one side errs on purpose, and whenever the
// other side gets a tactic it verifies with Stockfish that every solver move is the
// ONLY good move (so each puzzle has exactly one solution), extracts the line,
// tags themes from board geometry and estimates a rating from search depth.
//
//   node scripts/gen-puzzles.mjs [--target 420] [--minutes 30] [--seed 7] [--workers 4] [--out server/data/puzzles.json]
//   node scripts/gen-puzzles.mjs --rerate 1     (re-estimate ratings of the existing set)
//
// The result ships in the repository (server/data/puzzles.json) and is seeded into
// SQLite on first boot; re-run this script only if you want a fresh/larger set.
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { StockfishPool, scoreToCp } from '../server/stockfish.js';
import { config, ROOT } from '../server/config.js';
import { parseEco } from '../server/data/eco.js';
import {
  Game, PIECE_VALUE, PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, BLACK, SLIDE_RAYS, F_EP, typeOf, colorOf,
} from '../public/assets/js/chess/chess.js';

const args = Object.fromEntries(process.argv.slice(2).join(' ').split('--').filter(Boolean).map((s) => s.trim().split(/\s+/)));
const TARGET = parseInt(args.target || '420', 10);
const MINUTES = parseFloat(args.minutes || '30');
const SEED = parseInt(args.seed || '7', 10);
const OUT = path.resolve(ROOT, args.out || 'server/data/puzzles.json');
const HARD_MAX = Math.max(TARGET + 100, 720);

if (!config.stockfish.path) { console.error('Stockfish binary not found (set STOCKFISH_PATH).'); process.exit(1); }

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WANT = { mateIn1: 28, mateIn2: 40, mateIn3: 24, mateIn4: 6, fork: 40, pin: 20, skewer: 10, discoveredAttack: 20, backRank: 8, endgame: 40, sacrifice: 30, quietMove: 20 };
const MATE_CAP = { 1: 42, 2: 75, 3: 60, 4: 45, 5: 15 };
const ecoList = parseEco().filter((e) => e.sans.length >= 2);
const puzzles = [];
const seen = new Set();
const counts = {};
const started = Date.now();
let games = 0, rejected = 0;
const why = {};
const no = (reason) => { why[reason] = (why[reason] || 0) + 1; return null; };

const timeUp = () => (Date.now() - started) / 60000 >= MINUTES;
const quotasMet = () => Object.entries(WANT).every(([k, v]) => (counts[k] || 0) >= v);
const needs = (themes) => themes.some((t) => WANT[t] && (counts[t] || 0) < WANT[t]);
const finished = () => timeUp() || puzzles.length >= HARD_MAX || (puzzles.length >= TARGET && quotasMet());

const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-2000, Math.min(2000, cp)))) - 1);

function nonPawnMaterial(pos, color) {
  let v = 0;
  for (let s = 0; s < 64; s++) { const p = pos.board[s]; if (p && colorOf(p) === color && typeOf(p) !== PAWN && typeOf(p) !== KING) v += PIECE_VALUE[typeOf(p)]; }
  return v;
}

function analyseThemes(startPos, line, type, finalCp) {
  const th = new Set();
  const solver = startPos.turn, opp = solver ^ 1;
  let pos = startPos.clone();
  const steps = [];
  for (const u of line) { const m = pos.parseUci(u); const after = pos.after(m); steps.push({ m, before: pos, after }); pos = after; }
  const n = Math.ceil(steps.length / 2);
  if (type === 'mate') { th.add('mate'); th.add('mateIn' + Math.min(n, 5)); }
  else th.add(finalCp >= 600 ? 'crushing' : 'advantage');
  th.add(n === 1 ? 'oneMove' : n === 2 ? 'short' : n === 3 ? 'long' : 'veryLong');
  steps.forEach((s, i) => {
    if (i % 2) return;
    const { m, before, after } = s;
    const next = steps[i + 1];
    const later = steps.filter((_, j) => j > i && j % 2 === 0);
    const movedType = m.promo || m.piece, movedVal = PIECE_VALUE[movedType];
    if (next && next.m.captured && next.m.to === m.to && movedVal - PIECE_VALUE[m.captured || 0] >= 200) th.add('sacrifice');
    // fork: the moved piece hits two or more worthwhile targets and later wins one of them
    const targets = [];
    for (let sq = 0; sq < 64; sq++) {
      const p = after.board[sq];
      if (!p || colorOf(p) !== opp || !after.attackers(sq, solver).includes(m.to)) continue;
      const t = typeOf(p);
      if (t === KING || PIECE_VALUE[t] > movedVal || (t !== PAWN && after.attackers(sq, opp).length === 0)) targets.push(sq);
    }
    if (targets.length >= 2 && later.some((l) => l.m.captured && targets.includes(l.m.to))) th.add('fork');
    // pins and skewers along the moved slider's rays
    if (movedType === BISHOP || movedType === ROOK || movedType === QUEEN) {
      const d0 = movedType === BISHOP ? 4 : 0, d1 = movedType === ROOK ? 4 : 8;
      for (let d = d0; d < d1; d++) {
        let front = -1, back = -1;
        for (const sq of SLIDE_RAYS[m.to][d]) {
          const p = after.board[sq];
          if (!p) continue;
          if (front < 0) { if (colorOf(p) !== opp) break; front = sq; }
          else { if (colorOf(p) === opp) back = sq; break; }
        }
        if (front < 0 || back < 0) continue;
        const a = typeOf(after.board[front]), b = typeOf(after.board[back]);
        const va = a === KING ? 10000 : PIECE_VALUE[a], vb = b === KING ? 10000 : PIECE_VALUE[b];
        if (a !== KING && a !== PAWN && vb > va && (b === KING || vb > movedVal)) th.add('pin');
        if (va > vb && b !== PAWN && (a === KING || va > movedVal) && later.some((l) => l.m.captured && l.m.to === back)) th.add('skewer');
      }
    }
    // discovered attack: another slider now bears on a target it could not see before
    for (let sq = 0; sq < 64; sq++) {
      const p = after.board[sq];
      if (!p || colorOf(p) !== opp || typeOf(p) === PAWN) continue;
      const t = typeOf(p);
      const prior = new Set(before.attackers(sq, solver));
      for (const a of after.attackers(sq, solver)) {
        if (a === m.to || prior.has(a)) continue;
        const at = typeOf(after.board[a]);
        if (at !== BISHOP && at !== ROOK && at !== QUEEN) continue;
        if (t === KING || PIECE_VALUE[t] > PIECE_VALUE[at] || after.attackers(sq, opp).length === 0) th.add('discoveredAttack');
      }
    }
    if (i === 0 && !m.captured && !m.promo && !after.inCheck()) th.add('quietMove');
    if (m.promo) th.add(m.promo === QUEEN ? 'promotion' : 'underPromotion');
    if (m.flag === F_EP) th.add('enPassant');
  });
  if (type === 'mate') {
    const k = pos.kings[opp], home = opp === WHITE ? 0 : 7, last = steps[steps.length - 1].m, mt = last.promo || last.piece;
    if ((k >> 3) === home && (mt === ROOK || mt === QUEEN) && (last.to >> 3) === home) {
      const dir = opp === WHITE ? 8 : -8;
      let blocked = 0, total = 0;
      for (const df of [-1, 0, 1]) {
        const f = (k & 7) + df;
        if (f < 0 || f > 7) continue;
        total++;
        const p = pos.board[k + dir + df];
        if (p && colorOf(p) === opp) blocked++;
      }
      if (blocked === total) th.add('backRank');
    }
  }
  const mw = nonPawnMaterial(startPos, WHITE), mb = nonPawnMaterial(startPos, BLACK);
  th.add(mw <= 1000 && mb <= 1000 && mw + mb <= 1700 ? 'endgame' : startPos.full <= 12 ? 'opening' : 'middlegame');
  return [...th];
}

// Difficulty probe: the smallest search budget from which Stockfish finds the key move
// and keeps finding it. Returns a level 0 (instantly obvious) .. 8 (needs a deep search).
const BUDGETS = [60, 200, 600, 2000, 6000, 20000, 60000, 200000];
async function searchLevel(sf, fen, first) {
  let level = 0;
  for (let i = 0; i < BUDGETS.length; i++) {
    const r = await sf.analyse({ fen, nodes: BUDGETS[i] });
    if (r.bestmove !== first) level = i + 1;
  }
  return level;
}

// Initial rating estimate (Glicko-2 refines it as people solve the puzzle). Engines see
// most short tactics instantly, so human difficulty is modelled mainly on structure:
// how long the line is, whether it is a forced mate, and whether the key move is quiet
// or a sacrifice; the search level only fine-tunes within a band.
const MATE_BASE = [0, 780, 1180, 1560, 1900, 2150];
const ADV_BASE = [0, 950, 1150, 1600, 1950, 2250, 2450];
function estimateRating(startPos, line, themes, level, rng) {
  const n = Math.ceil(line.length / 2);
  const first = startPos.parseUci(line[0]);
  const forcing = !!first.captured || startPos.after(first).inCheck();
  const mate = themes.includes('mate');
  let r = mate ? MATE_BASE[Math.min(n, 5)] : ADV_BASE[Math.min(n, 6)];
  r += 70 * level;
  if (themes.includes('quietMove')) r += 150;
  if (themes.includes('sacrifice')) r += 120;
  if (themes.includes('underPromotion')) r += 150;
  if (themes.includes('endgame') && n >= 2) r += 40;
  if (forcing && !mate) r -= 70;
  return Math.round(Math.max(500, Math.min(2900, r + (rng() - 0.5) * 160)));
}

const FAST = { first: 40_000, next: 30_000, reply: 15_000 };
const FULL = { first: 650_000, next: 400_000, reply: 250_000 };

// Cheap pass first (most slips are simple one-move wins), then the deep verification.
async function buildPuzzle(sf, startPos, lastMove, rng) {
  const draft = await buildLine(sf, startPos, lastMove, rng, FAST);
  if (!draft) return null;
  return buildLine(sf, startPos, lastMove, rng, FULL);
}

async function buildLine(sf, startPos, lastMove, rng, budget) {
  const full = budget === FULL;
  const line = [];
  let pos = startPos.clone();
  let type = null, lastCp = 0;
  for (let step = 0; step < 6; step++) {
    const r = await sf.analyse({ fen: pos.fen(), multipv: 2, nodes: step === 0 ? budget.first : budget.next });
    const best = r.lines[0], second = r.lines[1];
    if (!best) break;
    const bcp = scoreToCp(best), scp = second ? scoreToCp(second) : -1e9;
    if (step === 0) {
      if (best.mate > 0 && best.mate <= 5) type = 'mate';
      else if (best.mate == null && bcp >= 200) type = 'adv';
      else return no('not-winning-at-depth');
    }
    let unique;
    if (type === 'mate') {
      if (!(best.mate > 0)) return no('mate-vanished');
      unique = best.mate === 1 || !second || !(second.mate > 0);
      if (!unique) return no('mate-dual'); // a mating puzzle must be forced all the way
    } else {
      if (best.mate == null && bcp < 180) break;
      // first move: nothing else may keep an edge; later moves: clearly the only way to stay on top
      unique = !second || (step === 0 ? bcp - scp >= 180 && scp < 150 : bcp - scp >= 150 && winPct(bcp) - winPct(scp) >= 12);
      if (!unique) break;
    }
    const m = pos.parseUci(best.pv[0]);
    if (!m) break;
    line.push(pos.uci(m));
    pos = pos.after(m);
    lastCp = bcp;
    if (pos.outcome()) break;
    const rr = await sf.analyse({ fen: pos.fen(), nodes: budget.reply });
    const reply = rr.lines[0] && pos.parseUci(rr.lines[0].pv[0]);
    if (!reply) break;
    line.push(pos.uci(reply));
    pos = pos.after(reply);
    if (pos.outcome()) break;
  }
  if (line.length % 2 === 0) line.pop();
  const n = Math.ceil(line.length / 2);
  if (n < 1) return no('first-move-not-unique');
  if (type === 'mate') {
    let end = startPos.clone();
    for (const u of line) end = end.after(end.parseUci(u));
    const o = end.outcome();
    if (!o || o.reason !== 'checkmate') return no('mate-line-incomplete');
  } else if (n < 2) return no('single-move-win');
  if (!full) return { line };
  const themes = analyseThemes(startPos, line, type, lastCp);
  if (type === 'mate') {
    const key = 'mateIn' + Math.min(n, 5);
    if ((counts[key] || 0) >= MATE_CAP[Math.min(n, 5)] && !needs(themes.filter((t) => t !== key))) return no('mate-cap');
  }
  const rating = estimateRating(startPos, line, themes, await searchLevel(sf, startPos.fen(), line[0]), rng);
  return { fen: startPos.fen(), moves: line.join(' '), lastMove: lastMove || '', rating, themes };
}

function accept(pz) {
  const key = pz.fen.split(' ').slice(0, 2).join(' ');
  if (seen.has(key)) return false;
  if (puzzles.length >= TARGET && !needs(pz.themes)) return false; // pool is full: only rare themes still wanted
  seen.add(key);
  puzzles.push(pz);
  for (const t of pz.themes) counts[t] = (counts[t] || 0) + 1;
  return true;
}

// Probes every plausible slip from a balanced position: after each legal move, a quick
// search checks whether the opponent now has a single, forcing refutation.
async function minePosition(sf, pos, evalForMover, rng) {
  const legal = pos.moves().slice();
  for (let i = legal.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [legal[i], legal[j]] = [legal[j], legal[i]]; }
  let found = 0;
  for (const m of legal.slice(0, 24)) {
    if (finished() || found >= 2) break;
    const q = pos.after(m);
    if (q.outcome()) continue;
    const probe = await sf.analyse({ fen: q.fen(), multipv: 2, nodes: 7_000 });
    const a = probe.lines[0], b = probe.lines[1];
    if (!a) continue;
    const acp = scoreToCp(a), bcp = b ? scoreToCp(b) : -1e9;
    const mateCand = a.mate > 0 && a.mate <= 4 && !(b && b.mate > 0) && ((counts['mateIn' + a.mate] || 0) < MATE_CAP[a.mate] || (counts.backRank || 0) < WANT.backRank);
    const advCand = a.mate == null && acp >= 220 && acp + evalForMover >= 150 && acp - bcp >= 170 && bcp < 150;
    if (!mateCand && !advCand) continue;
    const pz = await buildPuzzle(sf, q, pos.uci(m), rng);
    if (pz && accept(pz)) found++; else rejected++;
  }
  return found;
}

// Base games are well-played and balanced; puzzles come from the slips probed off them.
async function playGame(sf, rng) {
  const eco = ecoList[Math.floor(rng() * ecoList.length)];
  const g = new Game();
  const openPlies = Math.min(eco.sans.length, 3 + Math.floor(rng() * 7));
  for (let i = 0; i < openPlies; i++) g.play(eco.sans[i]);
  const sampleRate = 0.2 + rng() * 0.2;
  let taken = 0;
  for (let ply = 0; ply < 170 && !finished(); ply++) {
    if (g.status().over) break;
    const pos = g.pos;
    const res = await sf.analyse({ fen: pos.fen(), multipv: 3, nodes: 25_000 });
    const top = res.lines[0];
    if (!top) break;
    const topCp = scoreToCp(top);
    if (Math.abs(topCp) > 350) break;
    const endgame = nonPawnMaterial(pos, WHITE) <= 1000 && nonPawnMaterial(pos, BLACK) <= 1000;
    if (g.ply >= 8 && taken < 6 && rng() < (endgame ? 0.6 : sampleRate)) taken += await minePosition(sf, pos, topCp, rng);
    const close = res.lines.filter((l) => topCp - scoreToCp(l) <= 45);
    if (!g.play(close[Math.floor(rng() * close.length)].pv[0])) break;
  }
  games++;
}

async function worker(id) {
  const sf = new StockfishPool({ ...config.stockfish, maxProcesses: 1, idleKillMs: 600_000 });
  const rng = mulberry(SEED * 1000 + id);
  while (!finished()) {
    try { await playGame(sf, rng); } catch (e) { console.error('worker', id, e.message); }
  }
  sf.shutdown();
}

// --rerate: keep the existing puzzles, recompute themes and ratings only.
if ('rerate' in args) {
  const { readFileSync } = await import('node:fs');
  const { Position } = await import('../public/assets/js/chess/chess.js');
  const list = JSON.parse(readFileSync(OUT, 'utf8'));
  const sf = new StockfishPool({ ...config.stockfish, maxProcesses: 1, idleKillMs: 600_000 });
  const rng = mulberry(SEED);
  for (const p of list) {
    const pos = Position.fromFen(p.fen, 'standard');
    const line = p.moves.split(' ');
    p.rating = estimateRating(pos, line, p.themes, await searchLevel(sf, p.fen, line[0]), rng);
  }
  sf.shutdown();
  list.sort((a, b) => a.rating - b.rating);
  list.forEach((p, i) => { p.id = i + 1; });
  writeFileSync(OUT, '[\n' + list.map((p) => JSON.stringify(p)).join(',\n') + '\n]\n');
  const rs = list.map((p) => p.rating);
  console.log(`re-rated ${list.length} puzzles: ${rs[0]} – ${rs[rs.length - 1]}, median ${rs[rs.length >> 1]}`);
  process.exit(0);
}

const WORKERS = Math.max(1, Math.min(8, parseInt(args.workers || '4', 10)));
const ticker = setInterval(() => {
  const m = ((Date.now() - started) / 60000).toFixed(1);
  const short = Object.entries(WANT).filter(([k, v]) => (counts[k] || 0) < v).map(([k, v]) => `${k} ${counts[k] || 0}/${v}`).join(', ');
  console.log(`[${m} min] games ${games}  puzzles ${puzzles.length}  rejected ${rejected}  still needed: ${short || 'none'}`);
}, 30_000);

await Promise.all(Array.from({ length: WORKERS }, (_, i) => worker(i + 1)));
clearInterval(ticker);

puzzles.sort((a, b) => a.rating - b.rating);
const out = puzzles.map((p, i) => ({ id: i + 1, ...p }));
writeFileSync(OUT, '[\n' + out.map((p) => JSON.stringify(p)).join(',\n') + '\n]\n');
console.log(`wrote ${out.length} puzzles to ${path.relative(ROOT, OUT)} after ${games} games`);
console.log(Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join('  '));
console.log('rejections:', Object.entries(why).map(([k, v]) => `${k}:${v}`).join('  '));
process.exit(0);
