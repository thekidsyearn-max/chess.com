// Game archive: searchable, filterable history with review and PGN download.
import { h, mount, toast, modal, timeAgo, debounce } from '../lib/dom.js';
import { api, qs } from '../lib/api.js';
import { miniBoard } from '../lib/board.js';
import { navigate, session, VARIANT_NAMES, SPEED_NAMES, SPEED_ICON, REASONS } from '../lib/state.js';

export default async function archiveView(root, _p, query) {
  const f = { user: query.get('user') || '', result: '', color: '', speed: '', variant: '', source: '', opening: '', opponent: '', page: 1 };
  const listEl = h('div'), pager = h('.pager');
  const who = f.user && f.user !== session.user.username ? f.user : null;
  const sel = (key, options) => h('select.input', { onchange: (e) => { f[key] = e.target.value; f.page = 1; load(); } }, options.map(([v, l]) => h('option', { value: v }, l)));
  const text = (key, ph) => h('input.input', { placeholder: ph, oninput: debounce((e) => { f[key] = e.target.value.trim(); f.page = 1; load(); }, 300) });

  function importDialog() {
    modal('Import a PGN', (close) => {
      const ta = h('textarea.input', { placeholder: '[White "..."]\n[Black "..."]\n\n1. e4 e5 2. Nf3 ...', style: { minHeight: '200px' } });
      return h('.col', h('p.muted', 'Paste any game to add it to your archive, then run a full Game Review on it.'), ta,
        h('button.btn.primary.big', { onclick: async (e) => { e.target.disabled = true; try { const r = await api.post('/api/games/import', { pgn: ta.value }); close(); navigate(`/review/${r.id}`); } catch (ex) { toast(ex.message, 'err'); e.target.disabled = false; } } }, 'Import and review'));
    }, { wide: true });
  }

  async function load() {
    mount(listEl, h('.empty', h('span.spinner')));
    let data;
    try { data = await api.get('/api/games' + qs(f)); } catch (e) { return mount(listEl, h('.empty', e.message)); }
    if (!data.games.length) { mount(listEl, h('.empty', 'No games match these filters.')); mount(pager); return; }
    mount(listEl, h('table.tbl', h('tr', h('th', ''), h('th', 'Players'), h('th', 'Result'), h('th', 'Opening'), h('th', 'Moves'), h('th', 'Date'), h('th', '')),
      data.games.map((g) => {
        const tag = g.outcome ? h('span.tag', { class: g.outcome === 'win' ? 'good' : g.outcome === 'loss' ? 'bad' : '' }, g.outcome === 'win' ? 'Won' : g.outcome === 'loss' ? 'Lost' : 'Draw') : h('span.tag', g.result);
        const player = (p, c) => h('div', { style: { fontWeight: g.color === c ? 700 : 500 } }, c === 'w' ? '○ ' : '● ', p.name, p.rating ? h('span.muted', ` (${p.rating})`) : null, p.diff != null ? h('span', { class: p.diff >= 0 ? 'pos' : 'neg' }, ` ${p.diff >= 0 ? '+' : ''}${p.diff}`) : null);
        return h('tr.click', { onclick: (e) => { if (!e.target.closest('a,button')) navigate(`/game/${g.id}`); } },
          h('td', { style: { width: '64px' } }, miniBoard(g.fen, g.color || 'w')),
          h('td', player(g.white, 'w'), player(g.black, 'b'), h('.muted.small', `${SPEED_ICON[g.speed] || ''} ${SPEED_NAMES[g.speed] || g.speed} · ${g.tc}${g.variant !== 'standard' ? ' · ' + VARIANT_NAMES[g.variant] : ''}${g.rated ? ' · rated' : ''}`)),
          h('td', tag, h('.muted.small', REASONS[g.reason] || '')),
          h('td.small', g.eco ? h('b', g.eco + ' ') : null, g.opening || h('span.muted', '—')),
          h('td', String(Math.ceil(g.ply / 2))),
          h('td.muted.small', timeAgo(g.createdAt)),
          h('td.right', h('.row.gap-s', { style: { justifyContent: 'flex-end' } }, h('a.btn.sm.primary', { href: `/review/${g.id}` }, g.reviewed ? '🔍 Review ✓' : '🔍 Review'), h('a.btn.sm', { href: `/api/games/${g.id}/pgn`, download: `rookery-${g.id}.pgn`, title: 'Download PGN' }, '⬇ PGN'))));
      })));
    mount(pager, h('button.btn.sm', { disabled: data.page <= 1, onclick: () => { f.page--; load(); } }, '← Newer'), h('span.muted.small', `Page ${data.page} of ${data.pages} · ${data.total} games`), h('button.btn.sm', { disabled: data.page >= data.pages, onclick: () => { f.page++; load(); } }, 'Older →'));
  }

  mount(root, h('.page',
    h('.row.between.wrap', h('h1', who ? `📚 ${who}'s games` : '📚 Your games'), who ? null : h('button.btn', { onclick: importDialog }, '📥 Import PGN')),
    h('.card', { style: { marginBottom: '12px' } }, h('.grid.c4',
      h('label.field', 'Result', sel('result', [['', 'Any result'], ['win', 'Wins'], ['loss', 'Losses'], ['draw', 'Draws']])),
      h('label.field', 'Colour', sel('color', [['', 'Either colour'], ['white', 'White'], ['black', 'Black']])),
      h('label.field', 'Time control', sel('speed', [['', 'Any speed'], ['bullet', 'Bullet'], ['blitz', 'Blitz'], ['rapid', 'Rapid'], ['daily', 'Daily'], ['unlimited', 'Untimed']])),
      h('label.field', 'Variant', sel('variant', [['', 'Any variant'], ...Object.entries(VARIANT_NAMES)])),
      h('label.field', 'Opponent type', sel('source', [['', 'Humans and bots'], ['human', 'Humans'], ['bot', 'Bots'], ['import', 'Imported PGNs']])),
      h('label.field', 'Opening', text('opening', 'e.g. Sicilian or B90')),
      h('label.field', 'Opponent', text('opponent', 'Name contains…')))),
    h('.card.flush', listEl), pager));
  await load();
}
