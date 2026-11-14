// Puzzle Rush: 3 minutes, 5 minutes or survival — three strikes and you are out.
import { h, mount, toast, fmtClock } from '../lib/dom.js';
import { api, qs } from '../lib/api.js';
import { Board } from '../lib/board.js';
import { fitBoard } from '../lib/ui.js';
import { play } from '../lib/sound.js';
import { PuzzleRunner } from '../lib/puzzle-runner.js';

const MODES = [['3min', '3 Minutes', '⏱', 'Solve as many as you can in three minutes.'], ['5min', '5 Minutes', '⏳', 'A longer sprint — five minutes on the clock.'], ['survival', 'Survival', '❤️', 'No clock. The run ends on your third mistake.']];

export default async function rushView(root) {
  let run = null, idx = 0, score = 0, strikes = 0, streak = 0, bestStreak = 0, results = [], endsAt = 0, timer = null, finished = false;
  const boardHost = h('div'), panel = h('.col');
  const layout = h('.game.no-eval', h('.board-col', boardHost), h('.side-col', { style: { height: 'auto' } }, h('.card', panel)));
  mount(root, layout);
  const unfit = fitBoard(layout);
  const board = new Board(boardHost, { viewOnly: true });
  const runner = new PuzzleRunner(board, { onSolved: (p) => answer(true, p), onFailed: (p) => answer(false, p) });
  const clockEl = h('.v', '–'), scoreEl = h('.v', '0'), strikeEl = h('.v.strikes'), streakEl = h('div.center.muted');

  function hud() {
    scoreEl.textContent = String(score);
    mount(strikeEl, [0, 1, 2].map((i) => h('span', { class: i < strikes ? 'x' : 'o' }, '✕')));
    streakEl.textContent = streak >= 2 ? `🔥 ${streak} in a row` : 'Solve quickly, but accurately.';
  }

  async function menu() {
    clearInterval(timer);
    board.setViewOnly(true);
    const boards = h('.col');
    mount(panel, h('h1', '🔥 Puzzle Rush'), h('p.muted', 'Puzzles start easy and get harder. Three strikes end the run.'),
      MODES.map(([id, name, ico, sub]) => h('.tile', { onclick: () => start(id) }, h('.ico', ico), h('div', h('b', name), h('span', sub)))), boards);
    for (const [id, name] of MODES) {
      api.get('/api/puzzles/rush/leaderboard' + qs({ mode: id })).then((r) => {
        boards.append(h('div', { style: { marginTop: '8px' } }, h('h3', `${name} — best ${r.best}`),
          r.scores.length ? h('table.tbl', r.scores.slice(0, 5).map((s) => h('tr', h('td', `#${s.rank}`), h('td', h('a.link', { href: `/@/${s.username}` }, s.username)), h('td.right', h('b', String(s.score)))))) : h('.muted.small', 'No scores yet — set the first one.')));
      }).catch(() => {});
    }
  }

  async function start(mode) {
    try { run = await api.post('/api/puzzles/rush/start', { mode }); } catch (e) { return toast(e.message, 'err'); }
    idx = 0; score = 0; strikes = 0; streak = 0; bestStreak = 0; results = []; finished = false;
    endsAt = run.ms ? Date.now() + run.ms : 0;
    mount(panel, h('h2', `Puzzle Rush · ${MODES.find((m) => m[0] === mode)[1]}`),
      h('.rush-hud', h('div', clockEl, h('small', 'Time')), h('div', scoreEl, h('small', 'Score')), h('div', strikeEl, h('small', 'Strikes'))), streakEl,
      h('button.btn', { onclick: () => end() }, 'End run'));
    hud();
    play('game-start');
    clearInterval(timer);
    timer = setInterval(() => {
      if (!endsAt) { clockEl.textContent = '∞'; return; }
      const left = endsAt - Date.now();
      clockEl.textContent = fmtClock(left);
      clockEl.style.color = left < 10_000 ? 'var(--danger)' : '';
      if (left <= 0) end();
    }, 100);
    runner.load(run.puzzles[0]);
  }

  function answer(ok, played) {
    if (finished) return;
    results.push({ id: run.puzzles[idx].id, moves: played });
    if (ok) { score++; streak++; bestStreak = Math.max(bestStreak, streak); play('puzzle-solve'); } else { strikes++; streak = 0; }
    hud();
    idx++;
    if (strikes >= run.strikes || idx >= run.puzzles.length) return setTimeout(end, ok ? 250 : 700);
    setTimeout(() => { if (!finished) runner.load(run.puzzles[idx]); }, ok ? 250 : 700);
  }

  async function end() {
    if (finished || !run) return;
    finished = true;
    clearInterval(timer);
    runner.stop();
    play('game-end');
    let r;
    try { r = await api.post('/api/puzzles/rush/finish', { runId: run.runId, results }); } catch (e) { toast(e.message, 'err'); r = { score, strikes, bestStreak, best: score, breakdown: [] }; }
    mount(panel, h('h1', `Score: ${r.score}`), r.isBest ? h('.banner.good', '🏆 New personal best!') : h('.muted', `Personal best: ${r.best}`),
      h('.muted', `Longest streak: ${r.bestStreak} · Strikes: ${r.strikes}`),
      h('h3', { style: { marginTop: '10px' } }, 'Run breakdown'),
      h('.dots', r.breakdown.map((b, i) => h('i', { class: b.ok ? 'ok' : 'no', title: `Puzzle ${i + 1} · rated ${b.rating} — click to analyse`, onclick: () => { const p = run.puzzles.find((x) => x.id === b.id); if (p) window.open(`/analysis${qs({ fen: p.fen })}`, '_blank'); } }, b.ok ? '✓' : '✕'))),
      r.breakdown.some((b) => !b.ok) ? h('.muted.small', 'Click a red square to study the puzzle you missed.') : null,
      h('.row', { style: { marginTop: '10px' } }, h('button.btn.primary.grow', { onclick: () => start(run.mode) }, 'Play again'), h('button.btn.grow', { onclick: menu }, 'Change mode')));
  }

  board.set((await import('../chess/chess.js')).Position.start());
  await menu();
  return () => { finished = true; clearInterval(timer); runner.destroy(); unfit(); board.destroy(); };
}
