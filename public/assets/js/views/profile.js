// Player profile: ratings per category with progression charts, statistics, recent games, friends.
import { h, mount, toast, modal, timeAgo } from '../lib/dom.js';
import { api, qs } from '../lib/api.js';
import { ratingChart } from '../lib/ui.js';
import { session, navigate, CATEGORY_NAMES, VARIANT_NAMES, SPEED_ICON } from '../lib/state.js';

const ICON = { bullet: '🚀', blitz: '⚡', rapid: '⏱', daily: '☀️', puzzle: '🧩', chess960: '🎲', koth: '⛰', threecheck: '✚', crazyhouse: '🏠', atomic: '💥' };

export default async function profileView(root, [name]) {
  name = name || session.user.username;
  let data;
  try { data = await api.get(`/api/users/${encodeURIComponent(name)}`); }
  catch (e) { mount(root, h('.page.narrow', h('.card.empty', h('h2', 'Player not found'), h('p.muted', e.message)))); return; }
  const u = data.user, mine = u.id === session.user.id;
  let cat = Object.entries(data.ratings).sort((a, b) => b[1].games - a[1].games)[0][0];
  const chartBox = h('div'), statsGrid = h('.grid.c4'), friendsEl = h('div');

  async function paintChart() {
    for (const el of statsGrid.children) el.classList.toggle('on', el.dataset.cat === cat);
    const r = data.ratings[cat];
    mount(chartBox, h('.row.between.wrap', h('h2', `${ICON[cat]} ${CATEGORY_NAMES[cat]} rating`), h('span.muted.small', `Peak ${r.peak} · RD ${r.rd}${r.provisional ? ' (provisional)' : ''}`)), h('.empty', h('span.spinner')));
    try {
      const { points } = await api.get(`/api/users/${encodeURIComponent(u.username)}/history` + qs({ category: cat }));
      const seed = points.length === 1 ? [{ r: 1200, t: points[0].t - 1 }, ...points] : points;
      chartBox.lastChild.replaceWith(ratingChart(seed));
    } catch (e) { chartBox.lastChild.replaceWith(h('.empty', e.message)); }
  }

  function paintStats() {
    mount(statsGrid, Object.entries(data.ratings).map(([c, r]) => h('.stat', { dataset: { cat: c }, onclick: () => { cat = c; paintChart(); } },
      h('.k', `${ICON[c]} ${CATEGORY_NAMES[c]}`), h('.v', r.games ? String(r.rating) + (r.provisional ? '?' : '') : '—'),
      h('.s', r.games ? (c === 'puzzle' ? `${r.wins} solved · ${r.losses} missed` : `${r.games} games · ${r.wins}W ${r.draws}D ${r.losses}L`) : 'unrated'))));
  }

  function editDialog() {
    modal('Edit profile', (close) => {
      const bio = h('textarea.input', { value: u.bio, maxlength: 300, style: { fontFamily: 'inherit', minHeight: '80px' }, placeholder: 'A few words about you' });
      const country = h('input.input', { value: u.country, maxlength: 40, placeholder: 'Country' });
      return h('.col', h('label.field', 'About', bio), h('label.field', 'Country', country),
        h('button.btn.primary.big', { onclick: async () => { try { await api.put('/api/me/profile', { bio: bio.value, country: country.value }); close(); navigate(location.pathname); } catch (e) { toast(e.message, 'err'); } } }, 'Save'));
    });
  }

  const followBtn = h('button.btn', { onclick: async () => {
    try { const r = data.following ? await api.del(`/api/follow/${u.username}`) : await api.post(`/api/follow/${u.username}`); data.following = r.following; followBtn.textContent = data.following ? '✓ Following' : '+ Follow'; }
    catch (e) { toast(e.message, 'err'); }
  } }, data.following ? '✓ Following' : '+ Follow');

  const t = data.totals;
  mount(root, h('.page',
    h('.card.row.wrap', { style: { marginBottom: '14px' } },
      h('.avatar.lg', u.username.slice(0, 1).toUpperCase()),
      h('.grow', h('h1', { style: { margin: 0 } }, u.username, ' ', u.isGuest ? h('span.tag', 'guest') : null, data.online ? h('span.tag.good', '● online') : null),
        h('.muted', `Joined ${new Date(u.createdAt).toLocaleDateString()}${u.country ? ' · ' + u.country : ''} · ${data.followers} follower${data.followers === 1 ? '' : 's'}${data.online ? '' : ' · last seen ' + timeAgo(u.lastSeen)}`),
        u.bio ? h('p', { style: { margin: '6px 0 0' } }, u.bio) : null),
      mine ? h('.row.wrap', u.isGuest ? h('button.btn.primary', { onclick: () => window.rookery.authDialog('signup') }, 'Create account') : h('button.btn', { onclick: editDialog }, '✎ Edit'),
        u.isGuest ? null : h('button.btn', { onclick: () => window.rookery.logout() }, 'Log out')) : h('.row.wrap', followBtn, h('a.btn', { href: `/archive${qs({ user: u.username })}` }, '📚 Games'))),
    h('.grid.c4', { style: { marginBottom: '14px' } },
      h('.stat', { style: { cursor: 'default' } }, h('.k', 'Games played'), h('.v', String(t.games)), h('.s', `${t.wins}W · ${t.draws}D · ${t.losses}L`)),
      h('.stat', { style: { cursor: 'default' } }, h('.k', 'Win rate'), h('.v', t.games ? Math.round((t.wins / t.games) * 100) + '%' : '—'), h('.s', 'all finished games')),
      h('.stat', { style: { cursor: 'default' } }, h('.k', 'Puzzles solved'), h('.v', String(data.puzzles.solved)), h('.s', `${data.puzzles.attempts} attempted`)),
      h('.stat', { style: { cursor: 'default' } }, h('.k', 'Puzzle Rush best'), h('.v', String(Math.max(data.puzzles.rush3, data.puzzles.rush5, data.puzzles.survival))), h('.s', `3m ${data.puzzles.rush3} · 5m ${data.puzzles.rush5} · surv ${data.puzzles.survival}`))),
    h('.card', { style: { marginBottom: '14px' } }, h('h2', 'Ratings'), statsGrid, h('div', { style: { marginTop: '14px' } }, chartBox)),
    h('.grid.c2',
      h('.card', h('h2', 'Recent games'), data.recent.length ? h('table.tbl', data.recent.map((g) => {
        const opp = g.color === 'w' ? g.black : g.white;
        return h('tr.click', { onclick: () => navigate(`/game/${g.id}`) }, h('td', { style: { width: '28px' } }, SPEED_ICON[g.speed] || '♟'), h('td', h('b', opp.name), opp.rating ? h('span.muted', ` (${opp.rating})`) : null, h('.muted.small', g.opening || VARIANT_NAMES[g.variant])),
          h('td', h('span.tag', { class: g.outcome === 'win' ? 'good' : g.outcome === 'loss' ? 'bad' : '' }, g.outcome || g.result)), h('td.right.muted.small', timeAgo(g.createdAt)));
      })) : h('.empty', 'No finished games yet.'), h('a.btn.sm', { href: `/archive${mine ? '' : qs({ user: u.username })}`, style: { marginTop: '8px' } }, 'All games →')),
      h('.card', h('h2', mine ? 'Friends' : 'Challenge'), mine ? friendsEl : h('.col', h('p.muted', `Create a private link and send it to ${u.username}.`), h('a.btn.primary', { href: '/play' }, '🤝 Play a friend'))))));
  paintStats();
  paintChart();
  if (mine) {
    api.get('/api/friends').then(({ friends }) => {
      mount(friendsEl, friends.length ? h('table.tbl', friends.map((f) => h('tr.click', { onclick: () => navigate(`/@/${f.username}`) }, h('td', h('b', f.username)), h('td.right', f.online ? h('span.tag.good', '● online') : h('span.muted.small', timeAgo(f.lastSeen)))))) : h('.empty', 'Follow players from their profile to see them here.'));
    }).catch(() => {});
  }
}
