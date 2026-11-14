// User preferences: localStorage first (instant), synced to the account in SQLite.
import { api } from './api.js';

export const BOARD_THEMES = [
  ['slate', 'Tournament Blue', '#dfe6ee', '#6f8fb0'], ['meadow', 'Meadow Green', '#ecefd4', '#6f9a58'], ['walnut', 'Walnut Wood', '#e8cfa6', '#a26b3f'],
  ['obsidian', 'Obsidian Dark', '#7d8591', '#363c46'], ['icy', 'Icy Sea', '#e3f1f6', '#7fb3c8'], ['newspaper', 'Newspaper', '#f3f3f0', '#a9a9a4'],
  ['coral', 'Coral', '#fde4d6', '#e2836d'], ['emerald', 'Emerald', '#d8efe0', '#2f8f6b'], ['plum', 'Plum', '#eadff0', '#8a6aa8'], ['sand', 'Sandstone', '#f2e6c9', '#c8a66b'],
];
export const PIECE_SETS = [['modern', 'Modern'], ['classic', 'Classic Staunton'], ['wood', 'Wood'], ['minimal', 'Minimalist']];
export const ANIMATION = { instant: 0, fast: 90, normal: 180, slow: 340 };

const DEFAULTS = {
  boardTheme: 'slate', pieceSet: 'modern', coords: 'inside', animation: 'normal', autoQueen: true, confirmMove: false,
  soundTheme: 'wood', volume: 0.7, uiTheme: 'dark', showLegal: true, highlightLast: true, premoves: true, evalBar: true,
};
const KEY = 'rookery.settings';
const subs = new Set();
let state = { ...DEFAULTS };
try { state = { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { /* corrupted */ }
let syncTimer = null, canSync = false;

function apply() {
  const root = document.documentElement;
  root.dataset.ui = state.uiTheme;
  root.dataset.board = state.boardTheme;
  root.dataset.pieces = state.pieceSet;
  root.style.setProperty('--anim', (ANIMATION[state.animation] ?? 180) + 'ms');
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.content = state.uiTheme === 'light' ? '#f3f0e9' : state.uiTheme === 'amoled' ? '#000000' : '#14171f';
}

export const settings = {
  get: (k) => state[k],
  all: () => ({ ...state }),
  set(patch) {
    state = { ...state, ...patch };
    try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage full */ }
    apply();
    for (const fn of subs) fn(state, patch);
    if (canSync) { clearTimeout(syncTimer); syncTimer = setTimeout(() => api.put('/api/me/settings', state).catch(() => {}), 600); }
  },
  // merge the account's saved settings (server wins on first load of a session)
  hydrate(server) {
    canSync = true;
    if (server && Object.keys(server).length) {
      state = { ...state, ...server };
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* ignore */ }
      apply();
      for (const fn of subs) fn(state, server);
    } else api.put('/api/me/settings', state).catch(() => {});
  },
  subscribe(fn) { subs.add(fn); return () => subs.delete(fn); },
  animMs: () => ANIMATION[state.animation] ?? 180,
};
apply();

export const pieceUrl = (code, set = state.pieceSet) => `/pieces/${set}/${code}.svg`;
