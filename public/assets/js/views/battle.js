// Puzzle Battle: race an opponent through the same puzzle queue (3 minutes, 3 strikes).
import { h, mount, fmtClock } from '../lib/dom.js';
import { socket } from '../lib/socket.js';
import { Board } from '../lib/board.js';
import { fitBoard } from '../lib/ui.js';
import { play } from '../lib/sound.js';
import { PuzzleRunner } from '../lib/puzzle-runner.js';
import { Position } from '../chess/chess.js';
import { session } from '../lib/state.js';

export default async function battleView(root) {
  let battle = null, puzzles = [], idx = 0, timer = null, over = false, myDone = false;
  const offs = [];
  const boardHost = h('div'), panel = h('.col');
  const layout = h('.game.no-eval', h('.board-col', boardHost), h('.side-col', { style: { height: 'auto' } }, h('.card', panel)));
  mount(root, layout);
  const unfit = fitBoard(layout);
  const board = new Board(boardHost, { viewOnly: true });
  board.set(Position.start());
  const runner = new PuzzleRunner(board, { onSolved: (p) => answer(true, p), onFailed: (p) => answer(false, p) });
  const clockEl = h('.v', '3:00');
  const scores = h('div');

  const meName = () => session.user.username;
  function paintScores() {
    mount(scores, h('table.tbl', battle.players.map((p) => h('tr', h('td', h('b', p.name), p.name === meName() ? h('span.tag.accent', { style: { marginLeft: '6px' } }, 'you') : null, h('.muted.small', `Puzzle rating ${p.rating}${p.ghost ? ' · sparring ghost' : ''}`)),
      h('td.right', { style: { font: '800 24px var(--mono)' } }, String(p.score)), h('td.right.strikes', [0, 1, 2].map((i) => h('span', { class: i < p.strikes ? 'x' : 'o' }, '✕')))))));
  }

  function menu() {
    over = false; battle = null;
    mount(panel, h('h1', '⚔️ Puzzle Battle'), h('p.muted', 'You and an opponent get the same puzzles for three minutes. Three strikes and you are out; the higher score wins.'),
      h('button.btn.primary.big', { onclick: queue }, 'Find an opponent'), h('a.btn', { href: '/puzzles/rush' }, '🔥 Solo Puzzle Rush instead'));
  }

  function queue() {
    socket.send({ t: 'battle:queue' });
    mount(panel, h('h1', '⚔️ Puzzle Battle'), h('.seeking', h('span.spinner'), h('.grow', h('b', 'Looking for an opponent…'), h('.muted.small', 'If nobody is around, a sparring ghost at your level steps in after a few seconds.')),
      h('button.btn.sm', { onclick: () => { socket.send({ t: 'battle:cancel' }); menu(); } }, 'Cancel')));
  }

  function answer(ok, played) {
    if (over || myDone) return;
    socket.send({ t: 'battle:answer', id: battle.id, puzzleId: puzzles[idx].id, moves: played });
    if (ok) play('puzzle-solve');
    idx++;
    setTimeout(() => { if (!over && !myDone && puzzles[idx]) runner.load(puzzles[idx]); }, ok ? 250 : 700);
  }

  offs.push(socket.on('battle:start', (m) => {
    battle = m.battle; puzzles = m.puzzles; idx = 0; over = false; myDone = false;
    mount(panel, h('h2', 'Puzzle Battle'), h('.rush-hud', { style: { gridTemplateColumns: '1fr' } }, h('div', clockEl, h('small', 'Time left'))), scores);
    paintScores();
    clockEl.textContent = 'Get ready…';
    clearInterval(timer);
    const startAt = Date.now() + m.countdown;
    let started = false;
    timer = setInterval(() => {
      const now = Date.now();
      if (now < startAt) { clockEl.textContent = String(Math.ceil((startAt - now) / 1000)); return; }
      if (!started) { started = true; play('game-start'); runner.load(puzzles[0]); }
      clockEl.textContent = fmtClock(Math.max(0, startAt + 180_000 - now));
    }, 100);
  }));
  offs.push(socket.on('battle:update', (m) => {
    if (!battle || m.battle.id !== battle.id) return;
    battle = m.battle;
    const mine = battle.players.find((p) => p.name === meName());
    if (mine && mine.done && !myDone) { myDone = true; runner.stop(); }
    paintScores();
  }));
  offs.push(socket.on('battle:end', (m) => {
    if (!battle || m.battle.id !== battle.id) return;
    battle = m.battle; over = true;
    clearInterval(timer);
    runner.stop();
    play('game-end');
    const won = m.winner === meName();
    mount(panel, h('h1', m.winner == null ? 'It\'s a tie!' : won ? '🏆 You won the battle!' : `${m.winner} wins`), scores,
      h('.row', h('button.btn.primary.grow', { onclick: queue }, 'Battle again'), h('a.btn.grow', { href: '/puzzles' }, 'Back to puzzles')));
    paintScores();
  }));
  offs.push(socket.on('battle:waiting', () => {}));

  menu();
  return () => { over = true; clearInterval(timer); socket.send({ t: 'battle:cancel' }); for (const off of offs) off(); runner.destroy(); unfit(); board.destroy(); };
}
