// Rated tactical puzzles with theme filter, hints and Glicko-2 rating.
import { h, mount, toast } from '../lib/dom.js';
import { api, qs } from '../lib/api.js';
import { Board } from '../lib/board.js';
import { fitBoard } from '../lib/ui.js';
import { play } from '../lib/sound.js';
import { PuzzleRunner } from '../lib/puzzle-runner.js';
import { session } from '../lib/state.js';

export default async function puzzlesView(root, _p, query) {
  let theme = query.get('theme') || '';
  let puzzle = null, rating = session.ratings.puzzle?.rating ?? 1200, result = null, hints = 0, themes = [];
  const boardHost = h('div'), panel = h('.col'), historyEl = h('.dots');
  const layout = h('.game.no-eval', h('.board-col', boardHost), h('.side-col', { style: { height: 'auto' } }, h('.card', panel), h('.card', h('h3', 'Recent puzzles'), historyEl)));
  mount(root, layout);
  const unfit = fitBoard(layout);
  const board = new Board(boardHost, {});
  const runner = new PuzzleRunner(board, {
    onSolved: (played) => finish(played),
    onFailed: (played) => finish(played),
    onStep: () => paint(),
  });

  async function finish(played) {
    try {
      const r = await api.post(`/api/puzzles/${puzzle.id}/attempt`, { moves: played, hints: hints > 0 });
      result = r;
      rating = r.rating;
      if (session.ratings.puzzle) session.ratings.puzzle.rating = r.rating;
      if (r.correct) play('puzzle-solve');
    } catch (e) { toast(e.message, 'err'); result = { correct: false, diff: 0, rating, rated: false }; }
    paint();
    loadHistory();
  }

  async function next() {
    result = null; hints = 0;
    mount(panel, h('.row', h('span.spinner'), h('span.muted', 'Finding a puzzle…')));
    try {
      const r = await api.get('/api/puzzles/next' + qs({ theme }));
      puzzle = r.puzzle;
      rating = r.rating.rating;
      runner.load(puzzle);
      paint();
    } catch (e) { mount(panel, h('.empty', e.message)); }
  }

  function paint() {
    const side = runner.solver === 'w' ? 'White' : 'Black';
    const themeSel = h('select.input', { onchange: (e) => { theme = e.target.value; history.replaceState({}, '', '/puzzles' + qs({ theme })); next(); } },
      h('option', { value: '' }, 'All themes — matched to my rating'), themes.map((t) => h('option', { value: t.id, selected: t.id === theme }, `${t.name} (${t.count})`)));
    const head = h('.row.between', h('div', h('.muted.small', 'YOUR PUZZLE RATING'), h('div', { style: { font: '800 30px var(--mono)' } }, String(rating),
      result && result.rated ? h('span', { class: result.diff >= 0 ? 'pos' : 'neg', style: { fontSize: '18px', marginLeft: '8px' } }, `${result.diff >= 0 ? '+' : ''}${result.diff}`) : null)),
      h('.col.gap-s', h('a.btn.sm', { href: '/puzzles/rush' }, '🔥 Rush'), h('a.btn.sm', { href: '/puzzles/battle' }, '⚔️ Battle')));
    let body;
    if (!result) {
      body = [
        h('.banner.accent', h('b', `${side} to move`), h('div.small', `Find the best move${runner.solverMoves > 1 ? ` — the solution is ${runner.solverMoves} moves long` : ''}. ${runner.index ? 'Keep going!' : ''}`)),
        h('.row', h('button.btn.grow', { onclick: () => { hints = runner.hint(); } }, hints === 0 ? '💡 Hint' : '💡 Show the move'),
          h('button.btn.grow', { onclick: () => { hints = 2; runner.showSolution(false); finish(runner.played.concat(['0000'])); } }, 'Give up')),
        hints ? h('.muted.small', 'Using a hint means this puzzle no longer counts as solved for your rating.') : null,
      ];
    } else {
      body = [
        h('.banner', { class: result.correct ? 'good' : 'bad' }, h('b', result.correct ? (hints ? 'Solved — with a hint' : 'Solved!') : 'Not the move'),
          h('div.small', result.rated ? `Puzzle rating ${result.puzzleRating}` : 'Already attempted — not rated this time.')),
        h('.row.wrap.gap-s', puzzle.themes.map((t) => h('span.tag', (themes.find((x) => x.id === t) || {}).name || t))),
        h('button.btn.primary.big', { onclick: next }, 'Next puzzle →'),
        h('.row', result.correct ? null : h('button.btn.grow', { onclick: () => runner.showSolution(true) }, '▶ Show solution'),
          result.correct ? null : h('button.btn.grow', { onclick: () => { runner.load(puzzle); result = null; hints = 0; paint(); } }, '↻ Retry'),
          h('a.btn.grow', { href: `/analysis${qs({ fen: puzzle.fen })}` }, '🔬 Analyse')),
      ];
    }
    mount(panel, head, h('label.field', 'Theme', themeSel), body);
  }

  async function loadHistory() {
    try {
      const { history: list } = await api.get('/api/puzzles/history');
      mount(historyEl, list.length ? list.slice(0, 24).map((a) => h('i', { class: a.solved ? 'ok' : 'no', title: `Puzzle ${a.id} (${a.puzzleRating}) ${a.diff >= 0 ? '+' : ''}${a.diff}` }, a.solved ? '✓' : '✕')) : h('span.muted.small', 'Your solved and missed puzzles appear here.'));
    } catch { /* optional */ }
  }

  api.get('/api/puzzles/themes').then((r) => { themes = r.themes; if (puzzle) paint(); }).catch(() => {});
  loadHistory();
  await next();
  return () => { runner.destroy(); unfit(); board.destroy(); };
}
