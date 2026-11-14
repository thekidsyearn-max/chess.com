// Rookery single-page app: session bootstrap, shell, and History-API router.
import { h, mount, toast, modal } from './lib/dom.js';
import { api } from './lib/api.js';
import { socket } from './lib/socket.js';
import { settings } from './lib/settings.js';
import { session, setNavigator, navigate } from './lib/state.js';
import { preload } from './lib/sound.js';

const script = document.getElementById('app-script');
session.build = script?.dataset.build || '';
session.version = script?.dataset.version || '';

const main = document.getElementById('main');
const sidebar = document.getElementById('sidebar');

const ROUTES = [
  [/^\/$/, () => import('./views/home.js')],
  [/^\/play\/friend\/([\w-]+)$/, () => import('./views/friend.js')],
  [/^\/(play|variants)$/, () => import('./views/play.js')],
  [/^\/game\/([\w-]+)$/, () => import('./views/game.js')],
  [/^\/bots$/, () => import('./views/bots.js')],
  [/^\/(analysis|editor)$/, () => import('./views/analysis.js')],
  [/^\/review\/([\w-]+)$/, () => import('./views/review.js')],
  [/^\/puzzles\/rush$/, () => import('./views/rush.js')],
  [/^\/puzzles\/battle$/, () => import('./views/battle.js')],
  [/^\/puzzles$/, () => import('./views/puzzles.js')],
  [/^\/learn(?:\/(coordinates|drills))?$/, () => import('./views/learn.js')],
  [/^\/archive$/, () => import('./views/archive.js')],
  [/^\/leaderboard$/, () => import('./views/leaderboard.js')],
  [/^\/settings$/, () => import('./views/settings.js')],
  [/^\/(?:@|profile)(?:\/([\w-]+))?$/, () => import('./views/profile.js')],
];

const NAV = [
  ['/', '🏠', 'Home'], ['/play', '♟', 'Play'], ['/bots', '🤖', 'Bots'], ['/puzzles', '🧩', 'Puzzles'], ['/learn', '🎓', 'Learn'],
  ['/analysis', '🔬', 'Analysis'], ['/archive', '📚', 'Games'], ['/leaderboard', '🏆', 'Leaders'], ['/settings', '⚙️', 'Settings'],
];

let cleanup = null, navToken = 0;

function renderSidebar() {
  const u = session.user;
  const path = location.pathname;
  const active = (href) => (href === '/' ? path === '/' : path === href || path.startsWith(href + '/') || (href === '/play' && (path.startsWith('/game/') || path === '/variants')) || (href === '/analysis' && (path === '/editor' || path.startsWith('/review/'))));
  mount(sidebar,
    h('a.brand', { href: '/' }, h('span.brand-mark', '♜'), h('span', 'Rookery')),
    h('nav.nav', NAV.map(([href, ico, label]) => h('a', { href, class: active(href) ? 'active' : '' }, h('span.ico', ico), h('span.t', label)))),
    h('.spacer'),
    h('.conn', { id: 'conn', class: socket.connected ? '' : 'off' }, h('i'), h('span', socket.connected ? 'Connected' : 'Reconnecting…')),
    u ? h('a.userchip', { href: `/@/${u.username}`, title: 'Your profile' },
      h('.avatar', u.username.slice(0, 1).toUpperCase()),
      h('.meta.grow', h('.name', u.username), h('.muted.small', u.isGuest ? 'Guest' : `Blitz ${session.ratings.blitz?.rating ?? 1200}`))) : null,
    u && u.isGuest ? h('button.btn.primary.sm', { style: { marginTop: '8px' }, onclick: () => authDialog('signup') }, 'Sign up / Log in') : null);
}

async function render() {
  const token = ++navToken;
  if (cleanup) { try { cleanup(); } catch (e) { console.error(e); } cleanup = null; }
  const path = location.pathname.replace(/\/+$/, '') || '/';
  renderSidebar();
  let match = null, loader = null;
  for (const [re, load] of ROUTES) { const m = re.exec(path); if (m) { match = m; loader = load; break; } }
  if (!loader) {
    mount(main, h('.page.narrow', h('.card.empty', h('h1', 'Page not found'), h('p.muted', 'That square is off the board.'), h('a.btn.primary', { href: '/' }, 'Back home'))));
    return;
  }
  try {
    const mod = await loader();
    if (token !== navToken) return;
    const root = h('div');
    mount(main, root);
    main.scrollTop = 0; window.scrollTo(0, 0);
    const c = await mod.default(root, match.slice(1), new URLSearchParams(location.search));
    if (token !== navToken) { if (typeof c === 'function') c(); return; }
    cleanup = typeof c === 'function' ? c : null;
  } catch (e) {
    console.error(e);
    if (token === navToken) mount(main, h('.page.narrow', h('.card.empty', h('h2', 'Something went wrong'), h('p.muted', e.message || String(e)), h('button.btn', { onclick: () => render() }, 'Try again'))));
  }
}

setNavigator((path, { replace = false } = {}) => {
  if (path === location.pathname + location.search) return render();
  history[replace ? 'replaceState' : 'pushState']({}, '', path);
  render();
});
window.addEventListener('popstate', render);
document.addEventListener('click', (e) => {
  if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
  const a = e.target.closest('a[href]');
  if (!a || a.target || a.hasAttribute('download') || a.origin !== location.origin || a.pathname.startsWith('/api/')) return;
  e.preventDefault();
  navigate(a.pathname + a.search);
});

// ---- authentication dialog ---------------------------------------------------------------
export function authDialog(mode = 'login') {
  modal(null, (close) => {
    const err = h('.banner.bad.hidden');
    const user = h('input.input', { name: 'username', autocomplete: 'username', placeholder: 'Username', maxlength: 20 });
    const pass = h('input.input', { name: 'password', type: 'password', autocomplete: mode === 'login' ? 'current-password' : 'new-password', placeholder: 'Password (8+ characters)' });
    const title = h('h2');
    const submit = h('button.btn.primary.big', { type: 'submit' });
    const swap = h('a.link', { href: '#' });
    const note = h('p.muted.small');
    const paint = () => {
      title.textContent = mode === 'login' ? 'Log in' : 'Create your account';
      submit.textContent = mode === 'login' ? 'Log in' : 'Sign up';
      swap.textContent = mode === 'login' ? 'New here? Create an account' : 'Already have an account? Log in';
      note.textContent = mode === 'signup' && session.user?.isGuest ? `Your guest games and ratings (${session.user.username}) move to the new account.` : '';
      pass.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
    };
    swap.onclick = (e) => { e.preventDefault(); mode = mode === 'login' ? 'signup' : 'login'; err.classList.add('hidden'); paint(); };
    paint();
    const form = h('form.col', {
      onsubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        try {
          await api.post(`/api/auth/${mode}`, { username: user.value.trim(), password: pass.value });
          location.reload();
        } catch (ex) { err.textContent = ex.message; err.classList.remove('hidden'); submit.disabled = false; }
      },
    }, title, err, h('label.field', 'Username', user), h('label.field', 'Password', pass), note, submit, h('.center', swap));
    setTimeout(() => user.focus(), 30);
    return form;
  });
}

export async function logout() {
  await api.post('/api/auth/logout').catch(() => {});
  location.href = '/';
}

export async function refreshMe() {
  const me = await api.get('/api/me');
  session.user = me.user; session.ratings = me.ratings;
  renderSidebar();
  return me;
}

// ---- boot -------------------------------------------------------------------------------------
async function boot() {
  let me;
  try { me = await api.get('/api/me'); }
  catch (e) {
    if (e.status !== 401) { mount(main, h('.boot', h('.boot-mark', '♜'), h('div', 'Cannot reach the Rookery server.'), h('button.btn', { onclick: () => location.reload() }, 'Retry'))); return; }
    me = await api.post('/api/auth/guest'); // zero-friction guest play
  }
  session.user = me.user; session.ratings = me.ratings;
  settings.hydrate(me.settings);

  socket.on('open', () => { const c = document.getElementById('conn'); if (c) { c.classList.remove('off'); c.lastChild.textContent = 'Connected'; } });
  socket.on('close', () => { const c = document.getElementById('conn'); if (c) { c.classList.add('off'); c.lastChild.textContent = 'Reconnecting…'; } });
  socket.on('seek:matched', (m) => navigate(`/game/${m.gameId}`));
  socket.on('challenge:accepted', (m) => { toast('Your friend accepted — game on!', 'ok'); navigate(`/game/${m.gameId}`); });
  socket.on('daily:turn', (m) => { if (!location.pathname.endsWith(m.gameId)) toast(`Your move against ${m.opponent} (daily game)`, '', 7000, () => navigate(`/game/${m.gameId}`)); });
  socket.on('error', (m) => toast(m.error || 'Server error', 'err'));
  socket.connect();
  window.addEventListener('pointerdown', preload, { once: true });
  await render();
}

window.rookery = { authDialog, logout, refreshMe };
boot();
