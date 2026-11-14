// Play lobby: matchmaking seeks, friend invites, open challenges and live games to watch.
import { h, mount, toast, modal, fmtDuration } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { socket } from '../lib/socket.js';
import { miniBoard } from '../lib/board.js';
import { seg, toggle } from '../lib/ui.js';
import { navigate, VARIANT_NAMES, VARIANT_BLURB, session } from '../lib/state.js';

const GROUPS = [
  ['Bullet', ['1+0', '1+1', '2+1']], ['Blitz', ['3+0', '3+2', '5+0', '5+3']], ['Rapid', ['10+0', '15+10', '30+0']], ['Classical', ['60+0']], ['Daily', ['1d', '3d', '7d']],
];
const tcLabel = (tc) => (tc.endsWith('d') ? `${tc.slice(0, -1)} day${tc === '1d' ? '' : 's'}` : tc.replace('+', ' | '));

export default async function playView(root, _params, query) {
  const saved = JSON.parse(localStorage.getItem('rookery.play') || '{}');
  const state = { tc: saved.tc || '5+0', variant: query.get('variant') || saved.variant || 'standard', rated: saved.rated ?? true, seeking: null };
  const save = () => localStorage.setItem('rookery.play', JSON.stringify({ tc: state.tc, variant: state.variant, rated: state.rated }));
  const tcBox = h('div'), action = h('div'), seeksEl = h('div'), liveEl = h('div'), mineEl = h('div'), blurb = h('p.muted.small');
  const offs = [];

  function paintTc() {
    mount(tcBox, GROUPS.map(([name, list]) => h('div', { style: { marginBottom: '10px' } },
      h('.muted.small', { style: { fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '5px' } }, name),
      h('.tc-grid', list.map((tc) => h('.tc', { class: tc === state.tc ? 'on' : '', onclick: () => { state.tc = tc; save(); paintTc(); } }, tcLabel(tc)))))));
  }

  function paintAction() {
    if (state.seeking) {
      mount(action, h('.seeking', h('span.spinner'), h('.grow', h('b', `Searching for an opponent…`), h('.muted.small', `${VARIANT_NAMES[state.seeking.variant]} · ${tcLabel(state.seeking.tc)}`)),
        h('button.btn.sm', { onclick: () => socket.send({ t: 'seek:cancel' }) }, 'Cancel')));
    } else {
      mount(action,
        h('button.btn.primary.big', { onclick: () => socket.send({ t: 'seek:create', tc: state.tc, variant: state.variant, rated: state.rated }) }, `Play ${tcLabel(state.tc)}`),
        h('.row', { style: { marginTop: '8px' } },
          h('button.btn.grow', { onclick: friendDialog }, '🤝 Play a friend'),
          h('a.btn.grow', { href: '/bots' }, '🤖 Play a bot')));
    }
  }

  function friendDialog() {
    let color = 'random', rated = false;
    modal('Play a friend', (close) => h('.col',
      h('p.muted', `${VARIANT_NAMES[state.variant]} · ${tcLabel(state.tc)}. You get a private link to share.`),
      h('label.field', 'I play as', seg([['random', 'Random'], ['white', 'White'], ['black', 'Black']], color, (v) => { color = v; })),
      toggle('Rated game', rated, (v) => { rated = v; }),
      h('button.btn.primary.big', {
        onclick: async () => {
          try { const r = await api.post('/api/challenges', { tc: state.tc, variant: state.variant, color, rated }); close(); navigate(`/play/friend/${r.code}`); }
          catch (e) { toast(e.message, 'err'); }
        },
      }, 'Create invite link')));
  }

  function paintLobby(m) {
    mount(seeksEl, m.seeks.length ? h('table.tbl', m.seeks.map((s) => h('tr', h('td', h('b', s.name), h('span.muted', ` (${s.rating})`)), h('td', VARIANT_NAMES[s.variant]), h('td', tcLabel(s.tc)), h('td', s.rated ? 'Rated' : 'Casual'),
      h('td.right', s.name === session.user.username ? h('span.tag', 'yours') : h('button.btn.sm.primary', { onclick: () => socket.send({ t: 'seek:accept', id: s.id }) }, 'Accept')))))
      : h('.empty', 'No open challenges right now. Create one — or warm up against a bot.'));
    mount(liveEl, m.games.length ? h('.grid.c3', m.games.map((g) => h('a.card.pad-s', { href: `/game/${g.id}` }, miniBoard(g.fen),
      h('.small', { style: { marginTop: '6px' } }, h('b', g.white), ` (${g.whiteRating}) – `, h('b', g.black), ` (${g.blackRating})`), h('.muted.small', `${VARIANT_NAMES[g.variant]} · ${g.tc}`))))
      : h('.empty', 'No live games to watch.'));
  }

  const variantSel = h('select.input', { onchange: (e) => { state.variant = e.target.value; blurb.textContent = VARIANT_BLURB[state.variant]; save(); } },
    Object.entries(VARIANT_NAMES).map(([v, n]) => h('option', { value: v, selected: v === state.variant }, n)));
  blurb.textContent = VARIANT_BLURB[state.variant];

  mount(root, h('.page', h('.split.left',
    h('.card.col', h('h2', '♟ New game'), h('label.field', 'Variant', variantSel), blurb, tcBox,
      toggle('Rated', state.rated, (v) => { state.rated = v; save(); }, 'Rated games change your Glicko-2 rating'), action),
    h('.col',
      h('.card', h('h2', 'Your games in progress'), mineEl),
      h('.card', h('h2', 'Open challenges'), seeksEl),
      h('.card', h('h2', 'Watch live'), liveEl)))));
  paintTc(); paintAction();

  offs.push(socket.on('lobby:state', paintLobby));
  offs.push(socket.on('seek:created', (m) => { state.seeking = { tc: m.tc, variant: m.variant }; paintAction(); }));
  offs.push(socket.on('seek:cancelled', () => { state.seeking = null; paintAction(); }));
  offs.push(socket.on('seek:error', (m) => { state.seeking = null; paintAction(); toast(m.error, 'err', 5000, m.gameId ? () => navigate(`/game/${m.gameId}`) : null); if (m.gameId) navigate(`/game/${m.gameId}`); }));
  offs.push(socket.on('open', () => socket.send({ t: 'lobby:sub' })));
  socket.send({ t: 'lobby:sub' });

  api.get('/api/games/ongoing').then(({ games }) => {
    mount(mineEl, games.length ? h('table.tbl', games.map((g) => h('tr.click', { onclick: () => navigate(`/game/${g.id}`) },
      h('td', { style: { width: '48px' } }, miniBoard(g.fen, g.color)), h('td', h('b', g.opponent), h('.muted.small', `${VARIANT_NAMES[g.variant]} · ${g.tc === 'none' ? 'untimed' : g.tc}`)),
      h('td.right', g.myTurn ? h('span.tag.accent', 'Your move') : h('span.tag', 'Waiting'), g.deadline ? h('.muted.small', fmtDuration(g.deadline - Date.now()) + ' left') : null))))
      : h('.empty', 'Nothing in progress.'));
  }).catch(() => {});

  return () => { for (const off of offs) off(); socket.send({ t: 'lobby:unsub' }); if (state.seeking) socket.send({ t: 'seek:cancel' }); };
}
