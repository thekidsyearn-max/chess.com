// Landing page: quick actions, games in progress, recent results.
import { h, mount, fmtDuration, timeAgo } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { miniBoard } from '../lib/board.js';
import { session, VARIANT_NAMES, SPEED_ICON } from '../lib/state.js';

const TILES = [
  ['/play', '♟', 'Play Online', 'Bullet, blitz, rapid, classical and daily games'],
  ['/bots', '🤖', 'Play Bots', '25 personalities from 250 to 3200+'],
  ['/puzzles', '🧩', 'Puzzles', 'Rated tactics matched to your level'],
  ['/puzzles/rush', '🔥', 'Puzzle Rush', '3 min, 5 min or survival'],
  ['/puzzles/battle', '⚔️', 'Puzzle Battle', 'Race an opponent through the same puzzles'],
  ['/archive', '🔍', 'Game Review', 'Accuracy, move grades and coach commentary'],
  ['/analysis', '🔬', 'Analysis Board', 'Stockfish lines, explorer and board editor'],
  ['/learn', '🎓', 'Learn', 'Coordinate trainer and endgame drills'],
  ['/variants', '🎲', 'Variants', 'Chess960, Hill, Three-Check, Crazyhouse, Atomic'],
];

export default async function home(root) {
  const u = session.user;
  const ongoing = h('div'), recent = h('div');
  mount(root, h('.page',
    h('.hero',
      h('div',
        h('h1', 'Your own chess server.'),
        h('p', 'Live games, bots, unlimited game review, puzzles and variants — every feature unlocked, running on your Mac.'),
        h('.row.wrap', h('a.btn.primary', { href: '/play', style: { padding: '12px 22px', fontSize: '17px' } }, '♟ Play now'), h('a.btn', { href: '/bots', style: { padding: '12px 22px', fontSize: '17px' } }, '🤖 Play a bot'),
          u.isGuest ? h('button.btn.ghost', { onclick: () => window.rookery.authDialog('signup') }, 'Create account') : null),
        h('p.muted.small', { style: { marginTop: '12px' } }, u.isGuest ? `Playing as ${u.username}. No signup needed — create an account any time to keep your history.` : `Welcome back, ${u.username}.`)),
      h('.card.pad-s', { style: { maxWidth: '360px', justifySelf: 'center', width: '100%' } }, miniBoard('r1bq1rk1/pp2bppp/2n1pn2/3p4/3P1B2/2NBPN2/PP3PPP/R2Q1RK1 w - - 0 9'))),
    h('.grid.c3', TILES.map(([href, ico, title, sub]) => h('a.tile', { href }, h('.ico', ico), h('div', h('b', title), h('span', sub))))),
    h('.grid.c2', { style: { marginTop: '14px' } }, h('.card', h('h2', 'Games in progress'), ongoing), h('.card', h('h2', 'Recent games'), recent))));

  api.get('/api/games/ongoing').then(({ games }) => {
    if (!games.length) return mount(ongoing, h('.empty', 'No games in progress.'));
    mount(ongoing, h('table.tbl', games.slice(0, 8).map((g) => h('tr.click', { onclick: () => { history.pushState({}, '', `/game/${g.id}`); dispatchEvent(new PopStateEvent('popstate')); } },
      h('td', { style: { width: '54px' } }, miniBoard(g.fen, g.color)),
      h('td', h('b', g.opponent), h('.muted.small', `${VARIANT_NAMES[g.variant]} · ${g.tc === 'none' ? 'untimed' : g.tc}`)),
      h('td.right', g.myTurn ? h('span.tag.accent', 'Your move') : h('span.tag', 'Waiting'), g.deadline ? h('.muted.small', fmtDuration(g.deadline - Date.now()) + ' left') : null)))));
  }).catch(() => mount(ongoing, h('.empty', 'Could not load games.')));

  api.get('/api/games').then(({ games }) => {
    if (!games.length) return mount(recent, h('.empty', 'Play a game and it will show up here.'));
    mount(recent, h('table.tbl', games.slice(0, 6).map((g) => {
      const opp = g.color === 'w' ? g.black : g.white;
      return h('tr.click', { onclick: () => { history.pushState({}, '', `/game/${g.id}`); dispatchEvent(new PopStateEvent('popstate')); } },
        h('td', { style: { width: '30px' } }, SPEED_ICON[g.speed] || '♟'),
        h('td', h('b', opp.name), opp.rating ? h('span.muted', ` (${opp.rating})`) : null, h('.muted.small', g.opening || VARIANT_NAMES[g.variant])),
        h('td', h('span.tag', { class: g.outcome === 'win' ? 'good' : g.outcome === 'loss' ? 'bad' : '' }, g.outcome || g.result)),
        h('td.right.muted.small', timeAgo(g.createdAt)));
    })));
  }).catch(() => mount(recent, h('.empty', 'Could not load games.')));
}
