// Settings: board & pieces, gameplay, sound, appearance, account, system status.
import { h, mount, toast, modal } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { settings, BOARD_THEMES, PIECE_SETS, pieceUrl } from '../lib/settings.js';
import { seg, toggle } from '../lib/ui.js';
import { play } from '../lib/sound.js';
import { miniBoard } from '../lib/board.js';
import { session } from '../lib/state.js';

export default async function settingsView(root) {
  const s = () => settings.all();
  const preview = h('div', { style: { maxWidth: '260px' } });
  const themes = h('.swatches'), sets = h('.swatches');
  const paintPreview = () => mount(preview, miniBoard('r1bqk2r/pppp1ppp/2n2n2/2b1p3/2B1P3/2NP1N2/PPP2PPP/R1BQK2R b KQkq - 0 5'));
  const paintThemes = () => mount(themes, BOARD_THEMES.map(([id, name, light, dark]) => h('.swatch', { class: s().boardTheme === id ? 'on' : '', onclick: () => { settings.set({ boardTheme: id }); paintThemes(); } },
    h('.sw', h('i', { style: { background: light } }), h('i', { style: { background: dark } })), name)));
  const paintSets = () => mount(sets, PIECE_SETS.map(([id, name]) => h('.swatch', { class: s().pieceSet === id ? 'on' : '', onclick: () => { settings.set({ pieceSet: id }); paintSets(); paintPreview(); } },
    h('.pc', { style: { backgroundImage: `url(${pieceUrl('wN', id)})` } }), name)));
  const status = h('div.muted.small', 'Loading…');
  const u = session.user;

  function passwordDialog() {
    modal('Change password', (close) => {
      const cur = h('input.input', { type: 'password', autocomplete: 'current-password' }), next = h('input.input', { type: 'password', autocomplete: 'new-password' });
      return h('.col', h('label.field', 'Current password', cur), h('label.field', 'New password (8+ characters)', next),
        h('button.btn.primary.big', { onclick: async () => { try { await api.post('/api/auth/password', { current: cur.value, next: next.value }); close(); toast('Password changed', 'ok'); } catch (e) { toast(e.message, 'err'); } } }, 'Change password'));
    });
  }

  mount(root, h('.page', h('h1', '⚙️ Settings'), h('.grid.c2', { style: { alignItems: 'start' } },
    h('.col',
      h('.card.col', h('h2', 'Board'), h('.row', { style: { alignItems: 'flex-start' } }, preview, h('.muted.small.grow', 'Your choices apply everywhere and are saved to your account.')),
        h('h3', 'Board colours'), themes, h('h3', 'Piece set'), sets,
        h('label.field', 'Coordinates', seg([['inside', 'Inside'], ['outside', 'Outside'], ['off', 'Off']], s().coords, (v) => settings.set({ coords: v }))),
        h('label.field', 'Piece animation', seg([['instant', 'Instant'], ['fast', 'Fast'], ['normal', 'Normal'], ['slow', 'Slow']], s().animation, (v) => settings.set({ animation: v }))),
        toggle('Show legal moves', s().showLegal, (v) => settings.set({ showLegal: v })),
        toggle('Highlight the last move', s().highlightLast, (v) => settings.set({ highlightLast: v })))),
    h('.col',
      h('.card.col', h('h2', 'Gameplay'),
        toggle('Always promote to a queen', s().autoQueen, (v) => settings.set({ autoQueen: v }), 'Off: choose the piece each time'),
        toggle('Confirm each move', s().confirmMove, (v) => settings.set({ confirmMove: v }), 'Adds a confirm step before a move is sent'),
        toggle('Premoves', s().premoves, (v) => settings.set({ premoves: v }), 'Queue up to 5 moves while your opponent thinks; right-click cancels')),
      h('.card.col', h('h2', 'Sound'),
        h('label.field', 'Sound theme', seg([['wood', 'Wood'], ['digital', 'Digital'], ['silent', 'Silent']], s().soundTheme, (v) => { settings.set({ soundTheme: v }); setTimeout(() => play('move-self'), 60); })),
        h('label.field', `Volume`, h('input', { type: 'range', min: 0, max: 1, step: 0.05, value: s().volume, oninput: (e) => settings.set({ volume: +e.target.value }), onchange: () => play('capture') })),
        h('.row.wrap.gap-s', ['move-self', 'capture', 'castle', 'check', 'promote', 'game-start', 'game-end', 'tenseconds', 'premove', 'illegal', 'puzzle-solve'].map((n) => h('button.btn.sm', { onclick: () => play(n) }, n)))),
      h('.card.col', h('h2', 'Appearance'), h('label.field', 'Interface theme', seg([['dark', 'Dark'], ['light', 'Light'], ['amoled', 'AMOLED']], s().uiTheme, (v) => settings.set({ uiTheme: v })))),
      h('.card.col', h('h2', 'Account'), h('.row', h('.avatar', u.username.slice(0, 1).toUpperCase()), h('.grow', h('b', u.username), h('.muted.small', u.isGuest ? 'Guest account — sign up to keep it' : 'Registered account'))),
        u.isGuest ? h('.row', h('button.btn.primary.grow', { onclick: () => window.rookery.authDialog('signup') }, 'Create account'), h('button.btn.grow', { onclick: () => window.rookery.authDialog('login') }, 'Log in'))
          : h('.row', h('button.btn.grow', { onclick: passwordDialog }, 'Change password'), h('button.btn.grow', { onclick: () => window.rookery.logout() }, 'Log out'))),
      h('.card.col', h('h2', 'Server'), status)))));
  paintPreview(); paintThemes(); paintSets();
  const unsub = settings.subscribe((_, patch) => { if ('boardTheme' in patch || 'pieceSet' in patch) paintPreview(); });

  api.get('/api/health').then((r) => {
    mount(status,
      h('div', `Rookery ${session.version} · build ${session.build}`),
      h('div', `Engine: ${r.stockfish.available ? `${r.stockfish.engine || 'Stockfish'} — ${r.stockfish.processes}/${r.stockfish.maxProcesses} workers, ${r.stockfish.hashMb} MB hash, ${r.stockfish.threads} thread each` : 'built-in engine (Stockfish not installed)'}`),
      h('div', `Endgame tablebases: ${r.stockfish.syzygy ? 'Syzygy at ' + r.stockfish.syzygy : 'not installed (set SYZYGY_PATH to enable)'}`),
      h('div', `Memory: ${r.memory.totalMb} MB in use (server ${r.memory.nodeRssMb} MB + engines ${r.memory.stockfishRssMb} MB) of a ${r.memory.budgetMb} MB budget`),
      h('div', `Data: ${r.data.ecoCodes} ECO codes (${r.data.openings} lines), ${r.data.puzzles} puzzles, ${r.data.games} games, ${r.data.users} players`),
      h('div', `Live: ${r.sockets.users} online, ${r.games.playing} games in progress`));
  }).catch(() => { status.textContent = 'Status unavailable.'; });
  return () => unsub();
}
