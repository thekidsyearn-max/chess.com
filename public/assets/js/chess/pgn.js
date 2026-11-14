// PGN reader/writer with recursive variations, comments and NAGs.
// Tree shape: moves = [{ san, nags: number[], comment, pre, variations: [moves, ...] }]
// A variation attached to a move is an alternative to that move.

const SUFFIX_NAG = { '!': 1, '?': 2, '!!': 3, '??': 4, '!?': 5, '?!': 6 };
export const NAG_SYMBOL = { 1: '!', 2: '?', 3: '!!', 4: '??', 5: '!?', 6: '?!', 10: '=', 13: '∞', 14: '⩲', 15: '⩱', 16: '±', 17: '∓', 18: '+−', 19: '−+' };
const RESULTS = new Set(['1-0', '0-1', '1/2-1/2', '*']);

export function parsePgn(text) {
  const src = String(text || '').replace(/\r/g, '');
  const headers = {};
  let i = 0;
  const n = src.length;
  // headers
  while (i < n) {
    while (i < n && /\s/.test(src[i])) i++;
    if (src[i] !== '[') break;
    const end = src.indexOf(']', i);
    if (end < 0) break;
    const m = /^\[\s*([A-Za-z0-9_]+)\s+"((?:[^"\\]|\\.)*)"\s*$/.exec(src.slice(i, end));
    if (m) headers[m[1]] = m[2].replace(/\\(.)/g, '$1');
    i = end + 1;
  }
  const root = [];
  let cur = root, last = null, pending = '', result = headers.Result || '*';
  const stack = [];
  const addComment = (c) => {
    c = c.trim().replace(/\s+/g, ' ');
    if (!c) return;
    if (last) last.comment = last.comment ? last.comment + ' ' + c : c;
    else pending = pending ? pending + ' ' + c : c;
  };
  while (i < n) {
    const ch = src[i];
    if (/\s/.test(ch)) { i++; continue; }
    if (ch === '{') { const e = src.indexOf('}', i); addComment(src.slice(i + 1, e < 0 ? n : e)); i = e < 0 ? n : e + 1; continue; }
    if (ch === ';') { const e = src.indexOf('\n', i); addComment(src.slice(i + 1, e < 0 ? n : e)); i = e < 0 ? n : e + 1; continue; }
    if (ch === '%' && (i === 0 || src[i - 1] === '\n')) { const e = src.indexOf('\n', i); i = e < 0 ? n : e + 1; continue; }
    if (ch === '(') {
      if (last) { stack.push({ cur, last }); const v = []; last.variations.push(v); cur = v; last = null; }
      else stack.push(null);
      i++; continue;
    }
    if (ch === ')') {
      const top = stack.pop();
      if (top) { cur = top.cur; last = top.last; }
      i++; continue;
    }
    if (ch === '$') { const m = /^\$(\d+)/.exec(src.slice(i)); if (m) { if (last) last.nags.push(+m[1]); i += m[0].length; continue; } i++; continue; }
    if (ch === '[' && stack.length === 0 && root.length) break; // next game
    let j = i;
    while (j < n && !/[\s{}();]/.test(src[j])) j++;
    let tok = src.slice(i, j);
    i = j;
    if (RESULTS.has(tok)) { if (stack.length === 0) result = tok; continue; }
    tok = tok.replace(/^\d+\.+/, '');
    if (!tok || /^\.+$/.test(tok)) continue;
    if (/^[!?]+$/.test(tok)) { if (last && SUFFIX_NAG[tok]) last.nags.push(SUFFIX_NAG[tok]); continue; }
    const m = /^(.*?)([!?]{1,2})?$/.exec(tok);
    const node = { san: m[1], nags: [], comment: '', pre: '', variations: [] };
    if (m[2] && SUFFIX_NAG[m[2]]) node.nags.push(SUFFIX_NAG[m[2]]);
    if (pending) { node.pre = pending; pending = ''; }
    cur.push(node);
    last = node;
  }
  return { headers, moves: root, result };
}

export const mainline = (moves) => moves.map((m) => m.san);

function nagText(nags) {
  let s = '', rest = '';
  for (const g of nags || []) { if (g >= 1 && g <= 6 && !s) s = NAG_SYMBOL[g]; else rest += ' $' + g; }
  return s + rest;
}

function writeMoves(list, ply) {
  const out = [];
  let force = true;
  for (const node of list) {
    if (node.pre) out.push(`{${node.pre}}`);
    if (ply % 2 === 0) out.push(`${ply / 2 + 1}.`);
    else if (force) out.push(`${(ply - 1) / 2 + 1}...`);
    force = false;
    out.push(node.san + nagText(node.nags));
    if (node.comment) { out.push(`{${node.comment.replace(/}/g, ')')}}`); force = true; }
    for (const v of node.variations || []) { out.push('(' + writeMoves(v, ply) + ')'); force = true; }
    ply++;
  }
  return out.join(' ');
}

export function writePgn(headers, moves, startPly = 0) {
  const h = { Event: '?', Site: 'Rookery', Date: '????.??.??', Round: '-', White: '?', Black: '?', Result: '*', ...headers };
  const head = Object.entries(h).filter(([, v]) => v !== undefined && v !== null && v !== '')
    .map(([k, v]) => `[${k} "${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`).join('\n');
  const body = (writeMoves(moves, startPly) + ' ' + h.Result).trim();
  const lines = [];
  let line = '';
  for (const w of body.split(' ')) {
    if (line.length + w.length + 1 > 80) { lines.push(line); line = w; }
    else line = line ? line + ' ' + w : w;
  }
  if (line) lines.push(line);
  return `${head}\n\n${lines.join('\n')}\n`;
}
