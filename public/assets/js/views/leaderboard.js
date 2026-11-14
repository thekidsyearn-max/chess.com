// Leaderboards per rating category, plus Puzzle Rush high scores.
import { h, mount } from '../lib/dom.js';
import { api, qs } from '../lib/api.js';
import { CATEGORY_NAMES, session } from '../lib/state.js';

const BOARDS = [...Object.entries(CATEGORY_NAMES), ['rush:3min', 'Rush 3 min'], ['rush:5min', 'Rush 5 min'], ['rush:survival', 'Rush Survival']];

export default async function leaderboardView(root) {
  let cat = 'blitz';
  const tabs = h('.seg'), body = h('div');
  async function load() {
    for (const b of tabs.children) b.classList.toggle('on', b.dataset.v === cat);
    mount(body, h('.empty', h('span.spinner')));
    try {
      if (cat.startsWith('rush:')) {
        const r = await api.get('/api/puzzles/rush/leaderboard' + qs({ mode: cat.slice(5) }));
        return mount(body, r.scores.length ? h('table.tbl', h('tr', h('th', '#'), h('th', 'Player'), h('th.right', 'Best score')), r.scores.map((s) => h('tr', h('td', String(s.rank)), h('td', h('a.link', { href: `/@/${s.username}` }, s.username)), h('td.right', h('b', String(s.score)))))) : h('.empty', 'No runs yet.'));
      }
      const r = await api.get('/api/leaderboard' + qs({ category: cat }));
      mount(body, r.players.length ? h('table.tbl', h('tr', h('th', '#'), h('th', 'Player'), h('th.right', 'Rating'), h('th.right', 'Games')),
        r.players.map((p) => h('tr', { style: p.username === session.user.username ? { background: 'var(--panel-2)' } : null }, h('td', String(p.rank)), h('td', h('a.link', { href: `/@/${p.username}` }, p.username)),
          h('td.right', h('b', String(p.rating)), p.provisional ? h('span.muted', '?') : null), h('td.right.muted', String(p.games)))))
        : h('.empty', `Nobody has a ${r.name} rating yet. Play a rated game to claim first place.`));
    } catch (e) { mount(body, h('.empty', e.message)); }
  }
  for (const [v, label] of BOARDS) tabs.append(h('button', { dataset: { v }, onclick: () => { cat = v; load(); } }, label));
  mount(root, h('.page.narrow', h('h1', '🏆 Leaderboards'), tabs, h('.card.flush', { style: { marginTop: '12px' } }, body), h('p.muted.small', { style: { marginTop: '8px' } }, 'Ratings use Glicko-2. A “?” marks a provisional rating (high deviation).')));
  await load();
}
