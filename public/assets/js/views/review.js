// Game Review: accuracy, move classifications, advantage graph, coach commentary,
// "Show follow-up" line playback and "Retry mistake" drills.
import { h, mount, toast, fmtEval } from '../lib/dom.js';
import { api } from '../lib/api.js';
import { Board } from '../lib/board.js';
import { EvalBar, fitBoard, clsIcon, evalGraph, CLS_LABEL, CLS_SYMBOL, winPct } from '../lib/ui.js';
import { playMove, play } from '../lib/sound.js';
import { Position, WHITE, parseSq } from '../chess/chess.js';
import { resultText } from '../lib/state.js';

const ORDER = ['brilliant', 'great', 'best', 'excellent', 'good', 'book', 'inaccuracy', 'mistake', 'miss', 'blunder'];
const KEY = new Set(['brilliant', 'great', 'mistake', 'miss', 'blunder', 'inaccuracy']);
const lm = (uci) => (uci[1] === '@' ? [parseSq(uci.slice(2, 4)), parseSq(uci.slice(2, 4))] : [parseSq(uci.slice(0, 2)), parseSq(uci.slice(2, 4))]);

export default async function reviewView(root, [id]) {
  let review = null, ply = 0, mode = 'game', timer = null, poll = null, dead = false, retry = null;
  const evalBar = new EvalBar();
  const boardHost = h('div');
  const side = h('.side-col');
  const layout = h('.game', evalBar.el, h('.board-col', boardHost), side);
  mount(root, layout);
  const unfit = fitBoard(layout, { extra: 40 });
  const board = new Board(boardHost, { viewOnly: true, onMove: (m) => retryMove(m) });
  board.set(Position.start());

  // ---- load / start / poll ------------------------------------------------------------------
  let game = null;
  try { ({ game } = await api.get(`/api/games/${id}`)); } catch (e) {
    mount(side, h('.card.empty', h('h2', 'Game not found'), h('p.muted', e.message), h('a.btn.primary', { href: '/archive' }, 'Go to your games')));
    return () => { unfit(); board.destroy(); };
  }
  board.setOrientation(game.you === 'b' ? 'b' : 'w');
  evalBar.setOrientation(board.orientation);

  async function check(startIfNeeded) {
    let r = await api.get(`/api/review/${id}`);
    if (r.status === 'none' && startIfNeeded) r = await api.post(`/api/review/${id}`);
    if (dead) return;
    if (r.status === 'done') { review = r.review; ply = 0; show(false); return paint(); }
    if (r.status === 'error') return mount(side, h('.card.empty', h('h2', 'Review unavailable'), h('p.muted', r.error), h('a.btn', { href: `/game/${id}` }, 'Back to the game')));
    const pct = Math.round((r.progress || 0) * 100);
    mount(side, h('.card.col', h('h2', '🔍 Analysing your game…'), h('p.muted', r.queued ? 'Waiting for a free engine…' : 'Stockfish is checking every move for accuracy, mistakes and missed chances.'),
      h('.progress', h('i', { style: { width: pct + '%' } })), h('.muted.small', `${pct}%`)));
    poll = setTimeout(() => check(false).catch(() => {}), 700);
  }

  // ---- board ------------------------------------------------------------------------------------
  function show(animate = true) {
    clearTimeout(timer);
    mode = 'game'; retry = null;
    board.setViewOnly(true);
    board.setMovable({ color: null });
    board.setAutoShapes([]);
    board.setMarks([]);
    if (ply === 0) {
      board.set(Position.fromFen(review.startFen, review.variant), { animate });
      board.setBadge(null);
      evalBar.update(review.startEval);
    } else {
      const m = review.moves[ply - 1];
      board.set(Position.fromFen(m.fen, review.variant), { lastMove: lm(m.uci), animate });
      board.setBadge({ sq: lm(m.uci)[1], cls: m.cls, text: CLS_SYMBOL[m.cls] });
      evalBar.update(m.eval);
    }
  }

  function goto(n, animate = true) {
    ply = Math.max(0, Math.min(review.moves.length, n));
    show(animate);
    paint();
  }

  // plays a line of UCI moves on the board, one move every 800 ms
  function playLine(fen, ucis, label) {
    clearTimeout(timer);
    mode = 'line';
    board.setBadge(null);
    board.setAutoShapes([]);
    let pos = Position.fromFen(fen, review.variant), i = 0;
    board.set(pos, { animate: false });
    const step = () => {
      if (mode !== 'line' || i >= ucis.length) return;
      const m = pos.parseUci(ucis[i]);
      if (!m) return;
      playMove({ san: pos.san(m), captured: m.captured, promo: m.promo }, true);
      pos = pos.after(m);
      board.set(pos, { lastMove: [m.from >= 0 ? m.from : m.to, m.to] });
      i++;
      timer = setTimeout(step, 800);
    };
    timer = setTimeout(step, 350);
    paint(label);
  }

  // ---- retry mistake -------------------------------------------------------------------------------
  function startRetry() {
    const m = review.moves[ply - 1];
    clearTimeout(timer);
    mode = 'retry';
    retry = { move: m, tries: 0, solved: false, message: `Find a better move for ${m.color === 'w' ? 'White' : 'Black'} than ${m.san}.` };
    board.setBadge(null);
    board.setAutoShapes([]);
    board.setMarks([]);
    board.set(Position.fromFen(m.fenBefore, review.variant), { animate: true });
    board.setViewOnly(false);
    board.setMovable({ color: m.color });
    paint();
  }

  async function retryMove(mv) {
    if (mode !== 'retry' || !retry || retry.solved) return;
    const m = retry.move;
    const pos = Position.fromFen(m.fenBefore, review.variant);
    const uci = pos.uci(mv), san = pos.san(mv);
    const next = pos.after(mv);
    board.set(next, { lastMove: [mv.from >= 0 ? mv.from : mv.to, mv.to] });
    board.setViewOnly(true);
    retry.tries++;
    const bestCp = m.lines[0] ? (m.lines[0].mate != null ? (m.lines[0].mate > 0 ? 100000 : -100000) : m.lines[0].cp) : 0;
    let verdict = null;
    const known = m.lines.find((l) => l.uci === uci);
    if (uci === m.uci) verdict = { ok: false, text: `${san} is the move from the game — look for something stronger.` };
    else if (known) {
      const cp = known.mate != null ? (known.mate > 0 ? 100000 : -100000) : known.cp;
      const loss = winPct(bestCp) - winPct(cp);
      verdict = loss < 3 ? { ok: true, text: uci === m.best?.uci ? `Correct! ${san} is the best move.` : `${san} is also a strong move. The engine's first choice was ${m.best.san}.` } : null;
    }
    if (!verdict) {
      paint('Checking your move…');
      try {
        const r = await api.post('/api/eval', { fen: next.fen(), variant: review.variant });
        let cp;
        if (r.over) cp = r.over.winner == null ? 0 : 100000;
        else { const l = r.lines[0]; cp = -(l.mate != null ? (l.mate > 0 ? 100000 : -100000) : l.cp); }
        const loss = winPct(bestCp) - winPct(cp);
        verdict = loss < 3 ? { ok: true, text: `${san} works too — nicely found. The engine preferred ${m.best ? m.best.san : 'another move'}.` }
          : { ok: false, text: `${san} is not it${loss >= 10 ? ' — that loses ground' : ''}. Try again.` };
      } catch (e) { verdict = { ok: false, text: e.message }; }
    }
    if (mode !== 'retry') return;
    retry.message = verdict.text;
    if (verdict.ok) { retry.solved = true; play('puzzle-solve'); board.setMarks([{ sq: mv.to, cls: 'good' }]); }
    else {
      play('illegal');
      board.setMarks([{ sq: mv.to, cls: 'bad' }]);
      timer = setTimeout(() => { if (mode === 'retry' && !retry.solved) { board.setMarks([]); board.set(pos, { animate: true }); board.setViewOnly(false); board.setMovable({ color: m.color }); } }, 900);
    }
    paint();
  }

  // ---- side panel -------------------------------------------------------------------------------------
  function paint(lineLabel = null) {
    const r = review;
    const cur = ply > 0 ? r.moves[ply - 1] : null;
    const summary = h('.panel', { style: { flex: 'none' } },
      h('.panel-head', h('span', '🔍 Game Review'), h('span.muted.small', resultText({ status: 'finished', result: r.result, reason: r.reason }))),
      h('.panel-body',
        h('.acc', h('div', h('.v', r.white.accuracy.toFixed(1)), h('.small', h('b', r.white.name || 'White'), r.white.estimatedRating ? h('span.muted', ` · played like ${r.white.estimatedRating}`) : null)),
          h('span.muted.small', 'Accuracy'), h('div', h('.v.b', r.black.accuracy.toFixed(1)), h('.small', h('b', r.black.name || 'Black'), r.black.estimatedRating ? h('span.muted', ` · played like ${r.black.estimatedRating}`) : null))),
        h('table.cls-table', { style: { marginTop: '8px' } }, ORDER.filter((c) => r.white.counts[c] + r.black.counts[c] > 0 || ['best', 'mistake', 'blunder'].includes(c)).map((c) => h('tr',
          h('td', { style: { fontWeight: 700, width: '36px' } }, String(r.white.counts[c])), h('td.l', h('.row.gap-s', { style: { justifyContent: 'center' } }, clsIcon(c), h('span', CLS_LABEL[c]))), h('td', { style: { fontWeight: 700, width: '36px' } }, String(r.black.counts[c])))))));
    const graph = evalGraph(r.graph, r.moves.map((m) => ({ ply: m.ply, cls: m.cls })), ply, (p) => goto(p));

    let coach;
    if (mode === 'retry' && retry) {
      coach = h('.coach', h('.face', '🎯'), h('.bubble', h('b', retry.solved ? 'Well done!' : 'Retry the move'), h('div', retry.message),
        h('.row.wrap.gap-s', { style: { marginTop: '8px' } },
          retry.solved ? null : h('button.btn.sm', { onclick: () => { const b = retry.move.best; if (b) board.setMarks([{ sq: lm(b.uci)[0], cls: 'hint' }]); } }, '💡 Hint'),
          retry.solved ? null : h('button.btn.sm', { onclick: () => { const b = retry.move.best; if (b) { board.set(Position.fromFen(retry.move.fenBefore, r.variant)); board.setAutoShapes([{ from: lm(b.uci)[0], to: lm(b.uci)[1], color: 'engine' }]); retry.message = `The best move was ${b.san}.`; retry.solved = true; paint(); } } }, 'Show answer'),
          h('button.btn.sm.primary', { onclick: () => { show(false); paint(); } }, 'Back to the game'))));
    } else if (!cur) {
      coach = h('.coach', h('.face', '🎓'), h('.bubble', h('b', 'Coach'), h('div', r.summary), h('.muted.small', { style: { marginTop: '6px' } }, `Analysed by ${r.engine}${r.depth ? ` to depth ${r.depth}` : ''}. Step through with → or jump between key moments.`)));
    } else {
      const bad = ['inaccuracy', 'mistake', 'blunder', 'miss'].includes(cur.cls);
      const notBest = cur.best && cur.best.uci !== cur.uci;
      coach = h('.coach', h('.face', '🎓'), h('.bubble',
        h('b', clsIcon(cur.cls), `${Math.ceil(cur.ply / 2)}${cur.color === 'w' ? '.' : '…'} ${cur.san}`, h('span.muted', { style: { fontWeight: 500 } }, ` ${CLS_LABEL[cur.cls]} · ${fmtEval(cur.eval.cp, cur.eval.mate)}`)),
        h('div', lineLabel || cur.comment),
        h('.row.wrap.gap-s', { style: { marginTop: '8px' } },
          mode === 'line' ? h('button.btn.sm.primary', { onclick: () => { show(false); paint(); } }, '↩ Back to the game') : null,
          cur.followUp.uci.length ? h('button.btn.sm', { title: 'Play out what happens next', onclick: () => playLine(cur.fen, cur.followUp.uci.slice(0, 8), `Follow-up: ${cur.followUp.san.slice(0, 8).join(' ')}`) }, '▶ Show follow-up') : null,
          notBest && cur.bestLine.uci.length ? h('button.btn.sm', { onclick: () => playLine(cur.fenBefore, cur.bestLine.uci.slice(0, 8), `Best was ${cur.best.san}: ${cur.bestLine.san.slice(0, 8).join(' ')}`) }, `★ Best: ${cur.best.san}`) : null,
          (bad || (notBest && cur.cls !== 'book')) ? h('button.btn.sm', { onclick: startRetry }, bad ? '↻ Retry mistake' : '↻ Retry') : null)));
    }

    const list = h('.review-moves');
    r.moves.forEach((m, i) => {
      if (i % 2 === 0) list.append(h('.n', `${i / 2 + 1}.`));
      list.append(h('.m', { class: i + 1 === ply ? 'cur' : '', onclick: () => goto(i + 1) }, clsIcon(m.cls), m.san));
    });
    const nextKey = () => { for (let i = ply; i < r.moves.length; i++) if (KEY.has(r.moves[i].cls) && i + 1 !== ply) return goto(i + 1); toast('No more key moments'); };
    const prevKey = () => { for (let i = ply - 2; i >= 0; i--) if (KEY.has(r.moves[i].cls)) return goto(i + 1); goto(0); };
    const movesPanel = h('.panel.fill', h('.panel-body.grow', graph, h('div', { style: { margin: '10px 0' } }, coach), list),
      h('.controls',
        h('button.btn.icon', { onclick: () => goto(0), title: 'Start' }, '⏮'), h('button.btn.icon', { onclick: () => goto(ply - 1), title: 'Previous (←)' }, '◀'),
        h('button.btn.icon', { onclick: () => goto(ply + 1), title: 'Next (→)' }, '▶'), h('button.btn.icon', { onclick: () => goto(r.moves.length), title: 'End' }, '⏭'),
        h('button.btn.icon', { onclick: () => { board.flip(); evalBar.setOrientation(board.orientation); if (mode === 'game') show(false); }, title: 'Flip' }, '⇅'),
        h('button.btn', { onclick: prevKey }, '◁ Key'), h('button.btn.primary', { onclick: nextKey }, 'Next key moment ▷'),
        h('a.btn', { href: `/analysis?game=${id}&ply=${ply}` }, '🔬 Analysis')));
    mount(side, summary, movesPanel);
    const active = list.querySelector('.m.cur');
    if (active) active.scrollIntoView({ block: 'nearest' });
  }

  const onKey = (e) => {
    if (!review || e.target.matches('input, textarea')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); goto(ply - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); goto(ply + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); goto(0); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); goto(review.moves.length); }
  };
  window.addEventListener('keydown', onKey);

  try { await check(true); } catch (e) { mount(side, h('.card.empty', h('h2', 'Review unavailable'), h('p.muted', e.message))); }

  return () => { dead = true; clearTimeout(timer); clearTimeout(poll); window.removeEventListener('keydown', onKey); unfit(); board.destroy(); };
}
