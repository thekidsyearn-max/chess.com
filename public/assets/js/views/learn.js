// Learn: coordinate (vision) trainer and endgame / checkmate drills.
import { h, mount, toast } from '../lib/dom.js';
import { api, qs } from '../lib/api.js';
import { Board, miniBoard } from '../lib/board.js';
import { fitBoard, seg, toggle } from '../lib/ui.js';
import { play } from '../lib/sound.js';
import { navigate } from '../lib/state.js';
import { Position, sqName } from '../chess/chess.js';

const GOAL = { mate: 'Deliver checkmate', win: 'Convert the win', draw: 'Hold the draw' };

async function hub(root) {
  const { drills } = await api.get('/api/learn/drills');
  const cats = [...new Set(drills.map((d) => d.category))];
  mount(root, h('.page',
    h('h1', '🎓 Learn'),
    h('.grid.c2', { style: { marginBottom: '16px' } },
      h('a.tile', { href: '/learn/coordinates' }, h('.ico', '🎯'), h('div', h('b', 'Vision: Coordinate Trainer'), h('span', '30 seconds. Click the named square as fast as you can.'))),
      h('a.tile', { href: '/puzzles' }, h('.ico', '🧩'), h('div', h('b', 'Tactics'), h('span', 'Rated puzzles by theme: forks, pins, mates and more.')))),
    h('h2', 'Endgame & checkmate drills'),
    h('p.muted', 'Stockfish defends perfectly. Convert the position (or hold the draw) to earn up to three stars.'),
    cats.map((c) => h('div', { style: { marginBottom: '16px' } }, h('h3.muted', c), h('.grid.c3', drills.filter((d) => d.category === c).map((d) => h('.card.col', { style: { cursor: 'pointer' }, onclick: () => startDrill(d.id) },
      h('.row', { style: { alignItems: 'flex-start' } }, h('div', { style: { width: '96px', flex: 'none' } }, miniBoard(d.fen, d.userColor)),
        h('div', h('b', d.name), h('.small', { style: { color: 'var(--accent)' } }, '★'.repeat(d.stars) + '☆'.repeat(3 - d.stars)), h('.muted.small', `${GOAL[d.goal]} · you play ${d.userColor === 'w' ? 'White' : 'Black'}`))),
      h('.muted.small', d.description))))))));
}

async function startDrill(id) {
  try { const r = await api.post(`/api/learn/drills/${id}/start`); navigate(`/game/${r.gameId}`); } catch (e) { toast(e.message, 'err'); }
}

async function coordinates(root) {
  const saved = JSON.parse(localStorage.getItem('rookery.coords') || '{}');
  const s = { side: saved.side || 'white', showCoords: saved.showCoords ?? false, pieces: saved.pieces ?? true };
  const save = () => localStorage.setItem('rookery.coords', JSON.stringify(s));
  let running = false, score = 0, wrong = 0, target = -1, endsAt = 0, timer = null, orient = 'w';
  const boardHost = h('div'), panel = h('.col');
  const layout = h('.game.no-eval', h('.board-col', boardHost), h('.side-col', { style: { height: 'auto' } }, h('.card', panel)));
  mount(root, layout);
  const unfit = fitBoard(layout);
  let board = null;
  const targetEl = h('.coord-target', '–'), timeEl = h('.v', '30.0'), scoreEl = h('.v', '0');

  function makeBoard() {
    if (board) board.destroy();
    board = new Board(boardHost, { free: true, coords: s.showCoords ? 'inside' : 'off', orientation: orient, onSquareClick: click, onFreeMove: () => {} });
    const pos = s.pieces ? Position.start() : Position.fromFen('8/8/8/8/8/8/8/8 w - - 0 1');
    board.set(pos, { animate: false });
  }

  function nextTarget() {
    let t;
    do { t = Math.floor(Math.random() * 64); } while (t === target);
    target = t;
    targetEl.textContent = sqName(t);
  }

  function click(sq) {
    if (!running) return;
    if (sq === target) { score++; scoreEl.textContent = String(score); play('move-self'); board.setMarks([{ sq, cls: 'good' }]); nextTarget(); }
    else { wrong++; play('illegal'); board.setMarks([{ sq, cls: 'bad' }]); }
    setTimeout(() => board && board.setMarks([]), 220);
  }

  async function menu(last = null) {
    running = false;
    clearInterval(timer);
    let best = { best: 0, scores: [] };
    try { best = await api.get('/api/learn/coords' + qs({ mode: s.side })); } catch { /* offline */ }
    mount(panel, h('h1', '🎯 Coordinate Trainer'),
      last ? h('.banner', { class: last.isBest ? 'good' : 'accent' }, h('b', `${last.score} squares in 30 seconds`), h('div.small', `${last.wrong} miss${last.wrong === 1 ? '' : 'es'}${last.isBest ? ' · new personal best!' : ''}`)) : h('p.muted', 'A square name appears — click it on the board. You have 30 seconds.'),
      h('label.field', 'Board side', seg([['white', 'White'], ['black', 'Black'], ['random', 'Random']], s.side, (v) => { s.side = v; save(); orient = v === 'black' ? 'b' : 'w'; makeBoard(); menu(); })),
      toggle('Show coordinates on the board', s.showCoords, (v) => { s.showCoords = v; save(); makeBoard(); }, 'Turn off for the real test'),
      toggle('Show pieces', s.pieces, (v) => { s.pieces = v; save(); makeBoard(); }),
      h('button.btn.primary.big', { onclick: start }, last ? 'Go again' : 'Start'),
      h('h3', { style: { marginTop: '8px' } }, `Your best: ${best.best}`),
      best.scores.length ? h('table.tbl', best.scores.slice(0, 8).map((x) => h('tr', h('td', `#${x.rank}`), h('td', x.username), h('td.right', h('b', String(x.score)))))) : null,
      h('a.btn', { href: '/learn' }, '← Back to Learn'));
  }

  function start() {
    orient = s.side === 'black' ? 'b' : s.side === 'random' ? (Math.random() < 0.5 ? 'w' : 'b') : 'w';
    makeBoard();
    score = 0; wrong = 0; running = true; endsAt = Date.now() + 30_000;
    scoreEl.textContent = '0';
    mount(panel, h('h2', 'Click this square'), targetEl, h('.rush-hud', { style: { gridTemplateColumns: '1fr 1fr' } }, h('div', timeEl, h('small', 'Seconds')), h('div', scoreEl, h('small', 'Score'))),
      h('button.btn', { onclick: () => menu() }, 'Stop'));
    nextTarget();
    play('game-start');
    clearInterval(timer);
    timer = setInterval(async () => {
      const left = endsAt - Date.now();
      timeEl.textContent = (Math.max(0, left) / 1000).toFixed(1);
      if (left > 0) return;
      clearInterval(timer);
      running = false;
      play('game-end');
      let isBest = false;
      try { const prev = (await api.get('/api/learn/coords' + qs({ mode: s.side }))).best; const r = await api.post('/api/learn/coords', { score, mode: s.side, showCoords: s.showCoords }); isBest = score > prev && r.best === score; } catch { /* offline */ }
      menu({ score, wrong, isBest });
    }, 50);
  }

  orient = s.side === 'black' ? 'b' : 'w';
  makeBoard();
  await menu();
  return () => { clearInterval(timer); unfit(); if (board) board.destroy(); };
}

export default async function learnView(root, [sub]) {
  if (sub === 'coordinates') return coordinates(root);
  return hub(root);
}
