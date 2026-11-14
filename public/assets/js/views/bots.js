// Bot roster and game setup.
import { h, mount, toast } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { seg, toggle } from '../lib/ui.js';
import { navigate, VARIANT_NAMES } from '../lib/state.js';

const STYLE_NAMES = {
  chaotic: 'Chaotic', gentle: 'Gentle', pawnPusher: 'Pawn pusher', checkHappy: 'Check-happy', trader: 'Trades everything', defensive: 'Defensive', trickster: 'Knight tricks',
  queenRaider: 'Early queen raids', solid: 'Solid', gambiteer: 'Gambits', attacker: 'King attacker', grinder: 'Endgame grinder', tactician: 'Tactician',
  hypermodern: 'Hypermodern', universal: 'Universal', positional: 'Positional', engine: 'Full engine',
};

export default async function botsView(root) {
  const { tiers, bots, engine } = await api.get('/api/bots');
  const saved = JSON.parse(localStorage.getItem('rookery.bot') || '{}');
  const s = { botId: bots.some((b) => b.id === saved.botId) ? saved.botId : 'juno', color: saved.color || 'random', variant: saved.variant || 'standard', tc: saved.tc || 'none',
    hints: saved.hints ?? true, takebacks: saved.takebacks ?? true, feedback: saved.feedback ?? true, evalBar: saved.evalBar ?? false };
  const save = () => localStorage.setItem('rookery.bot', JSON.stringify(s));
  const roster = h('div'), detail = h('div');

  function paintRoster() {
    mount(roster, tiers.map((tier) => h('div', { style: { marginBottom: '14px' } }, h('h3.muted', tier),
      h('.bot-grid', bots.filter((b) => b.tier === tier).map((b) => h('.botcard', { class: b.id === s.botId ? 'on' : '', onclick: () => { s.botId = b.id; save(); paintRoster(); paintDetail(); } },
        h('.face', { style: { background: b.color } }, b.emoji), h('b', b.name), h('small', String(b.elo))))))));
  }

  function paintDetail() {
    const b = bots.find((x) => x.id === s.botId);
    const sfOnly = s.variant === 'standard' || s.variant === 'chess960';
    mount(detail,
      h('.row', h('div', { style: { background: b.color, width: '64px', height: '64px', borderRadius: '50%', display: 'grid', placeItems: 'center', fontSize: '34px', flex: 'none' } }, b.emoji),
        h('div', h('h2', { style: { margin: 0 } }, b.name, ' ', h('span.tag.accent', String(b.elo))), h('.muted.small', `${b.tier} · ${STYLE_NAMES[b.style] || b.style}`))),
      h('p', { style: { marginTop: '10px' } }, b.tagline),
      h('label.field', 'I play as', seg([['white', 'White'], ['random', 'Random'], ['black', 'Black']], s.color, (v) => { s.color = v; save(); })),
      h('label.field', { style: { marginTop: '10px' } }, 'Variant', h('select.input', { onchange: (e) => { s.variant = e.target.value; save(); paintDetail(); } }, Object.entries(VARIANT_NAMES).map(([v, n]) => h('option', { value: v, selected: v === s.variant }, n)))),
      sfOnly ? null : h('p.muted.small', { style: { marginTop: '6px' } }, 'Stockfish only plays standard chess and Chess960, so this variant uses Rookery\'s built-in engine — strength tops out around club level.'),
      !engine && sfOnly ? h('p.muted.small', { style: { marginTop: '6px' } }, 'Stockfish is not installed on this server; bots are using the built-in engine.') : null,
      h('label.field', { style: { marginTop: '10px' } }, 'Time control', seg([['none', 'Untimed'], ['3+2', '3 | 2'], ['5+0', '5 min'], ['10+0', '10 min'], ['15+10', '15 | 10']], s.tc, (v) => { s.tc = v; save(); })),
      h('div', { style: { marginTop: '8px' } },
        toggle('Coach hints', s.hints, (v) => { s.hints = v; save(); }),
        toggle('Takebacks', s.takebacks, (v) => { s.takebacks = v; save(); }),
        toggle('Move feedback', s.feedback, (v) => { s.feedback = v; save(); }, 'Grades each of your moves as you play'),
        toggle('Evaluation bar', s.evalBar, (v) => { s.evalBar = v; save(); })),
      h('button.btn.primary.big', { style: { marginTop: '10px' }, onclick: async (e) => {
        e.target.disabled = true;
        try { const r = await api.post('/api/bots/play', s); navigate(`/game/${r.gameId}`); } catch (ex) { toast(ex.message, 'err'); e.target.disabled = false; }
      } }, `Play ${b.name}`));
  }

  mount(root, h('.page', h('.split',
    h('.card', h('h1', '🤖 Play a bot'), h('p.muted', 'Every bot is unlocked. Each has its own strength, style and things to say.'), roster),
    h('.card.sticky', detail))));
  paintRoster(); paintDetail();
}
