// Shared widgets: evaluation bar, move list, captured material, charts.
import { h, clear, fmtEval } from './dom.js';
import { PAWN, KNIGHT, BISHOP, ROOK, QUEEN, PIECE_VALUE } from '../chess/chess.js';

export const winPct = (cp) => 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * Math.max(-10000, Math.min(10000, cp)))) - 1);
export const whiteShare = (ev) => {
  if (!ev) return 50;
  if (ev.mate === 'W') return 100;
  if (ev.mate === 'B') return 0;
  if (ev.mate != null) return ev.mate > 0 ? 100 : 0;
  return winPct(ev.cp ?? 0);
};

export class EvalBar {
  constructor() {
    this.fill = h('.w', { style: { height: '50%' } });
    this.top = h('.num.hi');
    this.bot = h('.num.lo');
    this.el = h('.evalbar', { title: 'Engine evaluation' }, this.fill, this.top, this.bot);
    this.orientation = 'w';
  }
  setOrientation(o) { this.orientation = o; this.el.classList.toggle('flip', o === 'b'); if (this.last) this.update(this.last); }
  update(ev) {
    this.last = ev;
    const share = whiteShare(ev);
    this.fill.style.height = Math.max(3, Math.min(97, share)) + '%';
    const text = ev ? fmtEval(ev.cp, ev.mate).replace('+', '').replace('-', '') : '';
    const whiteBetter = share >= 50;
    // the number sits at the end of the side that is ahead
    const whiteAtBottom = this.orientation === 'w';
    this.top.textContent = whiteBetter === whiteAtBottom ? '' : text;
    this.bot.textContent = whiteBetter === whiteAtBottom ? text : '';
  }
}

// Two-column move list. moves: [{ san }]. Calls onPick(ply) with ply = number of moves played.
export function renderMoves(el, moves, cur, onPick, startPly = 0) {
  clear(el);
  let row = 0;
  const cells = [];
  if (startPly % 2 === 1 && moves.length) { el.append(h('.n', `${(startPly + 1) / 2}.`), h('.m', { style: { cursor: 'default' } }, '…')); row++; }
  moves.forEach((m, i) => {
    const ply = startPly + i;
    if (ply % 2 === 0) el.append(h('.n', `${ply / 2 + 1}.`));
    const c = h('.m', { class: i + 1 === cur ? 'cur' : '', onclick: () => onPick(i + 1) }, m.san);
    cells.push(c);
    el.append(c);
  });
  const active = cells[cur - 1];
  if (active && el.parentElement) {
    const box = el.parentElement, top = active.offsetTop - box.offsetTop;
    if (top < box.scrollTop || top > box.scrollTop + box.clientHeight - 30) box.scrollTop = Math.max(0, top - box.clientHeight / 2);
  }
  return row;
}

const GLYPH = { [PAWN]: '♟', [KNIGHT]: '♞', [BISHOP]: '♝', [ROOK]: '♜', [QUEEN]: '♛' };
// Pieces each side has captured, derived from what is missing from the board.
export function captured(pos) {
  const start = { [PAWN]: 8, [KNIGHT]: 2, [BISHOP]: 2, [ROOK]: 2, [QUEEN]: 1 };
  const n = [{ ...start }, { ...start }];
  const mat = [0, 0];
  for (let s = 0; s < 64; s++) {
    const p = pos.board[s];
    if (!p || (p & 7) === 6) continue;
    n[p >> 3][p & 7]--;
    mat[p >> 3] += PIECE_VALUE[p & 7];
  }
  const list = (c) => { let out = ''; for (const t of [QUEEN, ROOK, BISHOP, KNIGHT, PAWN]) out += GLYPH[t].repeat(Math.max(0, n[c][t])); return out; };
  const diff = Math.round((mat[0] - mat[1]) / 100);
  // white's captures are the missing black pieces
  return { w: list(1), b: list(0), diff };
}

export const CLS_SYMBOL = { brilliant: '!!', great: '!', best: '★', excellent: '✓', good: '✓', book: '≡', inaccuracy: '?!', mistake: '?', blunder: '??', miss: '✕', forced: '→' };
export const CLS_LABEL = { brilliant: 'Brilliant', great: 'Great Move', best: 'Best', excellent: 'Excellent', good: 'Good', book: 'Book', inaccuracy: 'Inaccuracy', mistake: 'Mistake', blunder: 'Blunder', miss: 'Miss', forced: 'Forced' };
export const clsIcon = (cls) => h('span.cls', { class: cls, title: CLS_LABEL[cls] || cls }, CLS_SYMBOL[cls] || '');

const svgEl = (tag, attrs = {}) => { const e = document.createElementNS('http://www.w3.org/2000/svg', tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };

// Advantage graph for Game Review. graph: white win% per ply (index 0 = start). onPick(ply).
export function evalGraph(graph, marks, cur, onPick) {
  const W = 600, H = 100, n = Math.max(1, graph.length - 1);
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, preserveAspectRatio: 'none', class: 'graph' });
  const x = (i) => (i / n) * W, y = (wp) => H - (wp / 100) * H;
  let d = `M0,${H} `;
  graph.forEach((wp, i) => { d += `L${x(i).toFixed(1)},${y(wp).toFixed(1)} `; });
  d += `L${W},${H} Z`;
  svg.append(svgEl('path', { d, fill: '#f2f2ee' }));
  svg.append(svgEl('line', { x1: 0, y1: H / 2, x2: W, y2: H / 2, stroke: 'rgba(128,128,128,.55)', 'stroke-width': 1, 'vector-effect': 'non-scaling-stroke' }));
  const COLOR = { blunder: '#e0534a', mistake: '#e69a4c', miss: '#ec6f5f', brilliant: '#26c2a3', great: '#5b8bd9' };
  for (const m of marks) if (COLOR[m.cls]) svg.append(svgEl('circle', { cx: x(m.ply), cy: y(graph[m.ply]), r: 3.2, fill: COLOR[m.cls], stroke: '#1c1f24', 'stroke-width': 0.8 }));
  const cursor = svgEl('line', { x1: x(cur), y1: 0, x2: x(cur), y2: H, stroke: '#f2a541', 'stroke-width': 2, 'vector-effect': 'non-scaling-stroke' });
  svg.append(cursor);
  svg.addEventListener('click', (e) => {
    const r = svg.getBoundingClientRect();
    onPick(Math.max(0, Math.min(n, Math.round(((e.clientX - r.left) / r.width) * n))));
  });
  svg.setCursor = (ply) => { cursor.setAttribute('x1', x(ply)); cursor.setAttribute('x2', x(ply)); };
  return svg;
}

// Rating progression chart. points: [{ r, t }]
export function ratingChart(points) {
  const W = 640, H = 220, padL = 44, padR = 12, padT = 12, padB = 24;
  const svg = svgEl('svg', { viewBox: `0 0 ${W} ${H}`, class: 'chart' });
  if (!points.length) {
    const t = svgEl('text', { x: W / 2, y: H / 2, 'text-anchor': 'middle', fill: 'currentColor', opacity: 0.5, 'font-size': 14 });
    t.textContent = 'No rated games yet';
    svg.append(t);
    return svg;
  }
  const rs = points.map((p) => p.r);
  let lo = Math.min(...rs), hi = Math.max(...rs);
  const pad = Math.max(20, (hi - lo) * 0.12);
  lo = Math.floor((lo - pad) / 50) * 50; hi = Math.ceil((hi + pad) / 50) * 50;
  const n = Math.max(1, points.length - 1);
  const x = (i) => padL + (i / n) * (W - padL - padR), y = (r) => padT + (1 - (r - lo) / (hi - lo)) * (H - padT - padB);
  const steps = 4;
  for (let i = 0; i <= steps; i++) {
    const r = lo + ((hi - lo) * i) / steps;
    svg.append(svgEl('line', { x1: padL, y1: y(r), x2: W - padR, y2: y(r), stroke: 'currentColor', opacity: 0.12 }));
    const t = svgEl('text', { x: padL - 6, y: y(r) + 4, 'text-anchor': 'end', fill: 'currentColor', opacity: 0.6, 'font-size': 11 });
    t.textContent = Math.round(r);
    svg.append(t);
  }
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.r).toFixed(1)}`).join(' ');
  svg.append(svgEl('path', { d: `${line} L${x(n)},${H - padB} L${x(0)},${H - padB} Z`, fill: 'var(--accent)', opacity: 0.14 }));
  svg.append(svgEl('path', { d: line, fill: 'none', stroke: 'var(--accent)', 'stroke-width': 2.2, 'stroke-linejoin': 'round' }));
  if (points.length <= 60) points.forEach((p, i) => svg.append(svgEl('circle', { cx: x(i), cy: y(p.r), r: 2.6, fill: 'var(--accent)' })));
  const first = svgEl('text', { x: padL, y: H - 6, fill: 'currentColor', opacity: 0.6, 'font-size': 11 });
  first.textContent = new Date(points[0].t).toLocaleDateString();
  const last = svgEl('text', { x: W - padR, y: H - 6, 'text-anchor': 'end', fill: 'currentColor', opacity: 0.6, 'font-size': 11 });
  last.textContent = new Date(points[points.length - 1].t).toLocaleDateString();
  svg.append(first, last);
  return svg;
}

// Sizes the board to fit the viewport: sets --board-size on the layout element.
export function fitBoard(layout, { side = 380, extra = 0 } = {}) {
  const apply = () => {
    const wide = window.innerWidth > 1080;
    const availW = layout.clientWidth - (wide ? side + 14 + extra : 0);
    const availH = window.innerHeight - (wide ? 150 : 210);
    const size = Math.max(260, Math.min(availW, wide ? availH : Math.min(availW, Math.max(availH, 320)), 920));
    layout.style.setProperty('--board-size', Math.floor(size) + 'px');
  };
  apply();
  window.addEventListener('resize', apply);
  return () => window.removeEventListener('resize', apply);
}

export const avatar = (name, { bot = null, size = '' } = {}) => (bot
  ? h('.avatar.is-bot', { class: size, style: { background: bot.tint || 'var(--panel-3)' } }, bot.emoji || '🤖')
  : h('.avatar', { class: size }, String(name || '?').slice(0, 1).toUpperCase()));

export const seg = (options, value, onChange) => {
  const el = h('.seg');
  const paint = (v) => { for (const b of el.children) b.classList.toggle('on', b.dataset.v === String(v)); };
  for (const [v, label] of options) el.append(h('button', { type: 'button', dataset: { v }, onclick: () => { paint(v); onChange(v); } }, label));
  paint(value);
  el.setValue = paint;
  return el;
};

export const toggle = (label, checked, onChange, hint = '') => h('label.switch', h('span', label, hint ? h('div.muted.small', hint) : null), h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }));
