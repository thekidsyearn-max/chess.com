// Analysis board: engine lines, variation tree, opening explorer, board editor, PGN/FEN I/O.
import { h, mount, clear, toast, fmtEval, debounce, copyText, download } from '../lib/dom.js';
import { api, qs } from '../lib/api.js';
import { socket } from '../lib/socket.js';
import { pieceUrl } from '../lib/settings.js';
import { Board } from '../lib/board.js';
import { EvalBar, fitBoard, seg } from '../lib/ui.js';
import { playMove } from '../lib/sound.js';
import { Tree } from '../lib/tree.js';
import { navigate, VARIANT_NAMES } from '../lib/state.js';
import { Position, WHITE, BLACK, VARIANTS, START_FEN, parseSq, sqName, PAWN, KING, ROOK } from '../chess/chess.js';
import { NAG_SYMBOL } from '../chess/pgn.js';

const AUTOSAVE = 'rookery.analysis';
const NAGS = [[3, '!!'], [1, '!'], [5, '!?'], [6, '?!'], [2, '?'], [4, '??']];

export default async function analysisView(root, [routeName], query) {
  let tree = new Tree('standard');
  let tab = routeName === 'editor' ? 'editor' : 'moves';
  let engineOn = localStorage.getItem('rookery.engine') !== 'off';
  let multipv = parseInt(localStorage.getItem('rookery.multipv') || '3', 10);
  let reqId = 0, lines = [], engineMeta = {};
  const offs = [];

  const evalBar = new EvalBar();
  const boardHost = h('div');
  const status = h('.muted.small', { style: { minHeight: '20px' } });
  const engineBox = h('div'), tabBody = h('.panel-body.grow');
  const tabsEl = h('.tabs');
  const layout = h('.game',
    evalBar.el,
    h('.board-col', boardHost, status),
    h('.side-col', h('.panel', { style: { flex: 'none', maxHeight: '44%' } }, engineBox), h('.panel.fill', tabsEl, tabBody)));
  mount(root, layout);
  const unfit = fitBoard(layout, { extra: 40 });
  const board = new Board(boardHost, { onMove: (m) => { const rec = tree.add(m); if (rec) { playMove(rec, true); changed(); } } });

  // ---- loading ---------------------------------------------------------------------------
  function load(next) { tree = next; ed.dirty = false; changed(true); }

  async function loadFromQuery() {
    const variant = VARIANTS.includes(query.get('variant')) ? query.get('variant') : 'standard';
    if (query.get('game')) {
      const { game } = await api.get(`/api/games/${query.get('game')}`);
      const t = Tree.fromMoves(game.variant, game.startFen, game.moves.map((m) => m.uci));
      t.headers = { White: game.white.name, Black: game.black.name, Result: game.result || '*' };
      const ply = parseInt(query.get('ply') || '', 10);
      t.start();
      const line = t.mainline();
      if (Number.isFinite(ply) && ply > 0) t.goto(line[Math.min(ply, line.length) - 1]); else t.end();
      board.setOrientation(game.you === 'b' ? 'b' : 'w');
      evalBar.setOrientation(board.orientation);
      return load(t);
    }
    if (query.get('fen')) {
      try { return load(new Tree(variant, query.get('fen'))); } catch { toast('That FEN could not be read.', 'err'); }
    }
    if (query.get('pgn')) { const r = Tree.fromPgn(query.get('pgn')); if (r.count || !r.error) return load(r.tree); }
    try {
      const saved = localStorage.getItem(AUTOSAVE);
      if (saved && routeName !== 'editor') { const r = Tree.fromPgn(saved); if (r.count) { r.tree.end(); return load(r.tree); } }
    } catch { /* corrupted autosave */ }
    load(new Tree(variant));
  }

  const autosave = debounce(() => { try { localStorage.setItem(AUTOSAVE, tree.toPgn()); } catch { /* quota */ } }, 500);

  // ---- position changed ----------------------------------------------------------------------
  function changed(fresh = false) {
    const pos = tree.pos();
    const n = tree.cur;
    board.set(pos, { lastMove: n.parent ? (n.flag === 5 ? [n.to, n.to] : [n.from, n.to]) : null, animate: !fresh });
    board.setMovable({ color: tab === 'editor' ? null : 'both' });
    board.setAutoShapes([]);
    const o = pos.outcome();
    status.textContent = o ? (o.winner === null ? `Draw — ${o.reason}` : `${o.winner === WHITE ? 'White' : 'Black'} wins — ${o.reason}`) : `${pos.turn === WHITE ? 'White' : 'Black'} to move · ${VARIANT_NAMES[tree.variant]}`;
    lines = [];
    paintEngine();
    if (tab === 'moves') paintMoves(); else if (tab === 'explorer') paintExplorer(); else if (tab === 'io') paintIo();
    requestEngine();
    autosave();
  }

  // ---- engine ----------------------------------------------------------------------------------
  const requestEngine = debounce(() => {
    reqId++;
    if (!engineOn || tab === 'editor') { socket.send({ t: 'analysis:stop' }); return; }
    socket.send({ t: 'analysis:start', reqId, fen: tree.cur.fen, variant: tree.variant, multipv });
  }, 140);

  function paintEngine() {
    const pos = tree.pos();
    const sign = pos.turn === WHITE ? 1 : -1;
    const top = lines[0];
    if (top) evalBar.update({ cp: top.cp != null ? sign * top.cp : null, mate: top.mate != null ? sign * top.mate : null });
    else { const o = pos.outcome(); if (o) evalBar.update(o.winner === null ? { cp: 0 } : { mate: o.winner === WHITE ? 'W' : 'B' }); }
    const head = h('.panel-head',
      h('label.switch', { style: { padding: 0, gap: '8px' } }, h('input', { type: 'checkbox', checked: engineOn, onchange: (e) => { engineOn = e.target.checked; localStorage.setItem('rookery.engine', engineOn ? 'on' : 'off'); lines = []; paintEngine(); requestEngine(); } }), h('span', engineMeta.source === 'lite' ? 'Built-in engine' : 'Stockfish')),
      h('span.muted.small.mono', engineOn && top ? `depth ${top.depth || '–'}${top.nps ? ` · ${(top.nps / 1000).toFixed(0)}k n/s` : ''}${engineMeta.done ? ' ✓' : ''}` : ''),
      h('select.input', { style: { width: 'auto', padding: '3px 6px' }, title: 'Number of lines (MultiPV)', onchange: (e) => { multipv = +e.target.value; localStorage.setItem('rookery.multipv', String(multipv)); lines = []; requestEngine(); } },
        [1, 2, 3, 4, 5].map((k) => h('option', { value: k, selected: k === multipv }, `${k} line${k > 1 ? 's' : ''}`))));
    const body = h('.panel-body');
    if (!engineOn) body.append(h('.muted.small', 'Engine is off.'));
    else if (!lines.length) body.append(h('.muted.small', pos.outcome() ? 'Game over.' : 'Thinking…'));
    else {
      const shapes = [];
      lines.forEach((l, i) => {
        const sans = [];
        let p = pos;
        for (const u of l.pv) { const m = p.parseUci(u); if (!m) break; sans.push((p.turn === WHITE ? `${p.full}.` : sans.length ? '' : `${p.full}…`) + p.san(m)); p = p.after(m); }
        const cpW = l.cp != null ? sign * l.cp : null, mateW = l.mate != null ? sign * l.mate : null;
        const first = pos.parseUci(l.pv[0]);
        if (first) shapes.push({ from: first.from >= 0 ? first.from : first.to, to: first.flag === 3 || first.flag === 4 ? pos.castleKingTo(first) : first.to, color: i === 0 ? 'engine' : 'alt', opacity: i === 0 ? 0.8 : 0.45, width: i === 0 ? 0.17 : 0.11 });
        body.append(h('.engine-line', { title: 'Play this line', onclick: () => { let added = false; for (const u of l.pv.slice(0, 1)) added = !!tree.add(u) || added; if (added) changed(); } },
          h('span.sc', { class: (mateW != null ? mateW < 0 : cpW < 0) ? 'neg' : '' }, fmtEval(cpW, mateW)), h('span.pv', sans.join(' '))));
      });
      board.setAutoShapes(shapes);
    }
    mount(engineBox, head, body);
  }

  offs.push(socket.on('analysis:info', (m) => {
    if (m.reqId !== reqId) return;
    if (m.error) { lines = []; status.textContent = m.error; return paintEngine(); }
    lines = m.lines || [];
    engineMeta = { source: m.source, done: m.done };
    paintEngine();
  }));
  offs.push(socket.on('open', () => requestEngine()));

  // ---- tabs --------------------------------------------------------------------------------------
  function paintTabs() {
    mount(tabsEl, [['moves', 'Moves'], ['explorer', 'Explorer'], ['editor', 'Editor'], ['io', 'PGN / FEN']].map(([id, label]) => h('button', { class: tab === id ? 'on' : '', onclick: () => setTab(id) }, label)));
  }
  function setTab(id) {
    if (tab === 'editor' && id !== 'editor') leaveEditor();
    tab = id;
    paintTabs();
    if (id === 'editor') enterEditor();
    else { board.free = false; changed(true); }
  }

  // ---- move tree -----------------------------------------------------------------------------------
  function moveSpan(n, forceNum) {
    const white = n.ply % 2 === 1;
    const num = white ? `${(n.ply + 1) / 2}.` : forceNum ? `${n.ply / 2}…` : '';
    const nag = n.nags.map((g) => NAG_SYMBOL[g] || '').join('');
    return h('span.mv', { class: n === tree.cur ? 'cur' : '', dataset: { id: n.id }, onclick: () => { tree.goto(n); changed(); } }, num ? h('span.num', num) : null, n.san + nag);
  }

  function renderLine(node, container, forceNum) {
    // walks down from `node` (a move node), rendering siblings of each step as variations
    let n = node, force = forceNum;
    while (n) {
      container.append(moveSpan(n, force), ' ');
      force = false;
      if (n.comment) { container.append(h('span.cm', n.comment), ' '); force = true; }
      const sibs = n.parent.children;
      if (sibs[0] === n && sibs.length > 1) {
        for (const alt of sibs.slice(1)) {
          const blockEl = h('span.var.varblock');
          blockEl.append('(');
          renderLine(alt, blockEl, true);
          blockEl.append(')');
          container.append(blockEl);
        }
        force = true;
      }
      n = n.children[0];
    }
  }

  function paintMoves() {
    const treeEl = h('.tree');
    if (tree.root.comment) treeEl.append(h('span.cm', tree.root.comment), ' ');
    if (tree.root.children[0]) renderLine(tree.root.children[0], treeEl, true);
    else treeEl.append(h('.muted', 'Make a move on the board, or load a game from the PGN tab.'));
    const n = tree.cur;
    const comment = h('textarea.input', { placeholder: n.parent ? `Comment on ${n.san}…` : 'Comment on the starting position…', style: { minHeight: '54px', fontFamily: 'inherit' }, value: n.comment,
      oninput: debounce((e) => { n.comment = e.target.value.trim(); autosave(); }, 300), onblur: () => paintMoves() });
    const tools = h('.col', { style: { marginTop: '10px', borderTop: '1px solid var(--line)', paddingTop: '10px' } },
      h('.row.wrap.gap-s',
        h('button.btn.sm.icon', { onclick: () => { tree.start(); changed(); } }, '⏮'), h('button.btn.sm.icon', { onclick: () => { tree.back(); changed(); } }, '◀'),
        h('button.btn.sm.icon', { onclick: () => { tree.forward(); changed(); } }, '▶'), h('button.btn.sm.icon', { onclick: () => { tree.end(); changed(); } }, '⏭'),
        h('button.btn.sm.icon', { title: 'Flip board', onclick: () => { board.flip(); evalBar.setOrientation(board.orientation); } }, '⇅'),
        n.parent ? NAGS.map(([code, sym]) => h('button.btn.sm', { class: n.nags.includes(code) ? 'on' : '', title: 'Annotate', onclick: () => { n.nags = n.nags.includes(code) ? [] : [code]; paintMoves(); autosave(); } }, sym)) : null),
      comment,
      n.parent ? h('.row.wrap.gap-s',
        h('button.btn.sm', { onclick: () => { if (tree.promote(n)) { paintMoves(); autosave(); } else toast('Already the main line'); } }, '⬆ Promote variation'),
        h('button.btn.sm.danger', { onclick: () => { tree.remove(n); changed(); } }, '🗑 Delete from here')) : null,
      h('.row.wrap.gap-s',
        h('button.btn.sm', { onclick: () => { load(new Tree(tree.variant)); } }, 'New board'),
        h('button.btn.sm', { onclick: async () => { try { const r = await api.post('/api/bots/play', { botId: 'stockfish-max', color: tree.pos().turn === WHITE ? 'white' : 'black', variant: tree.variant, fen: tree.cur.fen, tc: 'none' }); navigate(`/game/${r.gameId}`); } catch (e) { toast(e.message, 'err'); } } }, '🤖 Play from here')));
    mount(tabBody, treeEl, tools);
    const cur = treeEl.querySelector('.mv.cur');
    if (cur) { const top = cur.offsetTop - tabBody.offsetTop; if (top < tabBody.scrollTop || top > tabBody.scrollTop + tabBody.clientHeight - 60) tabBody.scrollTop = Math.max(0, top - 60); }
  }

  // ---- explorer --------------------------------------------------------------------------------------
  let explorerSeq = 0;
  async function paintExplorer() {
    const seq = ++explorerSeq;
    mount(tabBody, h('.muted.small', 'Loading…'));
    let data;
    try { data = await api.get('/api/explorer' + qs({ fen: tree.cur.fen, variant: tree.variant })); } catch (e) { if (seq === explorerSeq) mount(tabBody, h('.muted', e.message)); return; }
    if (seq !== explorerSeq || tab !== 'explorer') return;
    const rows = data.moves.map((m) => {
      const t = Math.max(1, m.games);
      const pct = (v) => Math.round((v / t) * 100);
      return h('.explorer-row', { onclick: () => { if (tree.add(m.uci)) changed(); }, title: m.name || '' },
        h('b', m.san), h('span.muted.small', m.games ? String(m.games) : 'book'),
        m.games ? h('.wdl', pct(m.white) ? h('span.w', { style: { width: pct(m.white) + '%' } }, pct(m.white) >= 12 ? pct(m.white) + '%' : '') : null,
          pct(m.draws) ? h('span.d', { style: { width: pct(m.draws) + '%' } }, pct(m.draws) >= 12 ? pct(m.draws) + '%' : '') : null,
          pct(m.black) ? h('span.b', { style: { width: pct(m.black) + '%' } }, pct(m.black) >= 12 ? pct(m.black) + '%' : '') : null)
          : h('span.muted.small', { style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, m.name ? `${m.eco} ${m.name}` : ''));
    });
    mount(tabBody,
      data.opening ? h('.banner', { style: { marginBottom: '8px' } }, h('b', data.opening.code), ' ', data.opening.name) : null,
      h('.explorer-row.muted.small', { style: { cursor: 'default', fontWeight: 700 } }, h('span', 'Move'), h('span', 'Games'), h('span', 'White / Draw / Black')),
      rows.length ? rows : h('.empty', 'No games or book moves from this position yet.'),
      data.total.games ? h('.muted.small', { style: { marginTop: '8px' } }, `${data.total.games} game${data.total.games > 1 ? 's' : ''} in the local database reach this position.`) : null,
      h('.muted.small', { style: { marginTop: '6px' } }, 'Statistics come from every game archived on this server, merged with the built-in ECO encyclopedia.'));
  }

  // ---- PGN / FEN --------------------------------------------------------------------------------------
  function paintIo() {
    const pgn = tree.toPgn();
    const input = h('textarea.input', { placeholder: 'Paste a PGN or a FEN here…', style: { minHeight: '110px' } });
    const out = h('textarea.input', { readonly: true, value: pgn, style: { minHeight: '120px' } });
    const variantSel = h('select.input', { style: { width: 'auto' } }, VARIANTS.map((v) => h('option', { value: v, selected: v === tree.variant }, VARIANT_NAMES[v])));
    mount(tabBody, h('.col',
      h('label.field', 'Current position (FEN)', h('.row', h('input.input.mono', { readonly: true, value: tree.cur.fen, onclick: (e) => e.target.select() }), h('button.btn.sm', { onclick: async () => { await copyText(tree.cur.fen); toast('FEN copied', 'ok'); } }, 'Copy'))),
      h('label.field', 'Export PGN', out),
      h('.row.wrap.gap-s', h('button.btn.sm', { onclick: async () => { await copyText(pgn); toast('PGN copied', 'ok'); } }, 'Copy PGN'), h('button.btn.sm', { onclick: () => download('rookery-analysis.pgn', pgn, 'application/x-chess-pgn') }, '⬇ Download'),
        h('button.btn.sm', { onclick: async () => { try { const r = await api.post('/api/games/import', { pgn }); navigate(`/review/${r.id}`); } catch (e) { toast(e.message, 'err'); } } }, '🔍 Review this game')),
      h('label.field', 'Import', input),
      h('.row.wrap.gap-s', h('span.muted.small', 'Variant'), variantSel,
        h('button.btn.sm.primary', { onclick: () => {
          const text = input.value.trim();
          if (!text) return;
          const looksFen = /^[pnbrqkPNBRQK1-8~/[\]]+\s+[wb]\b/.test(text) && !text.includes('\n');
          try {
            if (looksFen) { const t = new Tree(variantSel.value, text); const bad = t.pos().validate(); if (bad) return toast(bad, 'err'); load(t); toast('Position loaded', 'ok'); setTab('moves'); return; }
            const r = Tree.fromPgn(text, variantSel.value);
            if (!r.count && r.error) return toast(r.error, 'err');
            r.tree.start();
            load(r.tree);
            toast(r.error ? `Loaded ${r.count} moves. ${r.error}` : `Loaded ${r.count} moves`, r.error ? '' : 'ok');
            setTab('moves');
          } catch (e) { toast('Could not read that: ' + e.message, 'err'); }
        } }, 'Load'))));
  }

  // ---- board editor ---------------------------------------------------------------------------------------
  const ed = { pos: null, brush: null, dirty: false };
  const PALETTE = ['wK', 'wQ', 'wR', 'wB', 'wN', 'wP', 'bK', 'bQ', 'bR', 'bB', 'bN', 'bP'];
  const codeOf = (name) => ' PNBRQK'.indexOf(name[1]) | ((name[0] === 'b' ? 1 : 0) << 3);

  function enterEditor() {
    ed.pos = tree.pos().clone();
    ed.brush = null;
    board.free = true;
    board.opts.onFreeMove = (from, to) => {
      const p = ed.pos.board[from];
      ed.pos.board[from] = 0;
      if (to >= 0) ed.pos.board[to] = p;
      editorChanged();
    };
    board.opts.onSquareClick = (sq) => {
      if (ed.brush === 'erase') ed.pos.board[sq] = 0;
      else if (ed.brush) ed.pos.board[sq] = ed.pos.board[sq] === codeOf(ed.brush) ? 0 : codeOf(ed.brush);
      else return;
      editorChanged();
    };
    socket.send({ t: 'analysis:stop' });
    editorChanged(true);
  }
  function leaveEditor() { board.free = false; board.opts.onFreeMove = null; board.opts.onSquareClick = null; }

  function editorFen() {
    const p = ed.pos;
    p.kings = [-1, -1];
    for (let s = 0; s < 64; s++) if ((p.board[s] & 7) === KING) p.kings[p.board[s] >> 3] = s;
    // drop castling rights that no longer match the pieces
    for (let i = 0; i < 4; i++) {
      const r = p.castle[i], color = i >> 1;
      if (r >= 0 && (p.board[r] !== (ROOK | (color << 3)) || p.kings[color] < 0 || (p.kings[color] >> 3) !== (color === WHITE ? 0 : 7))) p.castle[i] = -1;
    }
    if (p.ep >= 0) {
      const behind = p.ep + (p.turn === WHITE ? -8 : 8);
      if ((p.ep >> 3) !== (p.turn === WHITE ? 5 : 2) || p.board[behind] !== (PAWN | ((p.turn ^ 1) << 3)) || p.board[p.ep]) p.ep = -1;
    }
    p._legal = null;
    return p.fen();
  }

  function editorChanged(fresh = false) {
    const fen = editorFen();
    board.set(ed.pos, { animate: false });
    board.setMovable({ color: null });
    board.setAutoShapes([]);
    lines = [];
    mount(engineBox, h('.panel-head', 'Board editor'), h('.panel-body.muted.small', 'Drag pieces to move them, drag them off the board to remove them, or pick a piece below and click squares.'));
    const p = ed.pos;
    const err = (() => { try { return Position.fromFen(fen, tree.variant).validate(); } catch (e) { return e.message; } })();
    status.textContent = err ? `⚠ ${err}` : 'Position is valid.';
    const right = (i, label) => {
      const color = i >> 1, home = color === WHITE ? 0 : 56, kOk = p.kings[color] === home + 4;
      const rookSq = home + (i % 2 === 0 ? 7 : 0), ok = kOk && p.board[rookSq] === (ROOK | (color << 3));
      return h('label.row.gap-s', { style: { opacity: ok ? 1 : 0.45 } }, h('input', { type: 'checkbox', checked: p.castle[i] >= 0, disabled: !ok, onchange: (e) => { p.castle[i] = e.target.checked ? rookSq : -1; editorChanged(); } }), label);
    };
    const epOptions = [];
    for (let f = 0; f < 8; f++) {
      const sq = (p.turn === WHITE ? 40 : 16) + f, behind = sq + (p.turn === WHITE ? -8 : 8);
      if (!p.board[sq] && p.board[behind] === (PAWN | ((p.turn ^ 1) << 3))) epOptions.push(sq);
    }
    const fenInput = h('input.input.mono', { value: fen, onchange: (e) => { try { const np = Position.fromFen(e.target.value.trim(), tree.variant); ed.pos = np; editorChanged(); } catch (ex) { toast('Invalid FEN: ' + ex.message, 'err'); e.target.value = fen; } } });
    mount(tabBody, h('.col',
      h('.palette', PALETTE.map((name) => h('.pp', { class: ed.brush === name ? 'on' : '', title: name, style: { backgroundImage: `url(${pieceUrl(name)})`, touchAction: 'none' },
        onpointerdown: (e) => { e.preventDefault(); ed.brush = ed.brush === name ? null : name; board.startExternalDrag(codeOf(name), e, (sq) => { if (sq >= 0) { ed.pos.board[sq] = codeOf(name); ed.brush = name; editorChanged(); } }); paintBrush(); } }))),
      h('.row.wrap.gap-s',
        h('button.btn.sm', { class: ed.brush === 'erase' ? 'on' : '', onclick: () => { ed.brush = ed.brush === 'erase' ? null : 'erase'; editorChanged(); } }, '🧽 Eraser'),
        h('button.btn.sm', { onclick: () => { ed.pos = Position.start(tree.variant === 'chess960' ? 'standard' : tree.variant); editorChanged(); } }, 'Starting position'),
        h('button.btn.sm', { onclick: () => { ed.pos.board.fill(0); ed.pos.castle = [-1, -1, -1, -1]; ed.pos.ep = -1; editorChanged(); } }, 'Clear board'),
        h('button.btn.sm', { onclick: () => { board.flip(); evalBar.setOrientation(board.orientation); } }, '⇅ Flip')),
      h('label.field', 'Side to move', seg([['w', 'White'], ['b', 'Black']], p.turn === WHITE ? 'w' : 'b', (v) => { p.turn = v === 'w' ? WHITE : BLACK; p.ep = -1; editorChanged(); })),
      h('.field', 'Castling rights', h('.row.wrap', { style: { color: 'var(--text)', fontWeight: 500 } }, right(0, 'White O-O'), right(1, 'White O-O-O'), right(2, 'Black O-O'), right(3, 'Black O-O-O'))),
      h('label.field', 'En passant square', h('select.input', { onchange: (e) => { p.ep = +e.target.value; editorChanged(); } }, h('option', { value: -1 }, '— none —'), epOptions.map((s) => h('option', { value: s, selected: p.ep === s }, sqName(s))))),
      h('label.field', 'FEN', fenInput),
      h('.row.wrap.gap-s',
        h('button.btn.sm', { onclick: async () => { await copyText(fen); toast('FEN copied', 'ok'); } }, 'Copy FEN'),
        h('button.btn.primary', { disabled: !!err, onclick: () => { tab = 'moves'; leaveEditor(); paintTabs(); load(new Tree(tree.variant, fen)); } }, 'Analyse this position'),
        h('button.btn', { disabled: !!err, onclick: async () => { try { const r = await api.post('/api/bots/play', { botId: 'stockfish-max', color: p.turn === WHITE ? 'white' : 'black', variant: tree.variant, fen, tc: 'none' }); navigate(`/game/${r.gameId}`); } catch (e) { toast(e.message, 'err'); } } }, '🤖 Play it out'))));
    function paintBrush() { for (const el of tabBody.querySelectorAll('.palette .pp')) el.classList.toggle('on', el.title === ed.brush); }
    if (!fresh) ed.dirty = true;
  }

  // ---- keys -----------------------------------------------------------------------------------------------
  const onKey = (e) => {
    if (e.target.matches('input, textarea, select') || tab === 'editor') return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); tree.back(); changed(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); tree.forward(); changed(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); tree.start(); changed(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); tree.end(); changed(); }
    else if (e.key === 'f' || e.key === 'F') { board.flip(); evalBar.setOrientation(board.orientation); }
  };
  window.addEventListener('keydown', onKey);

  paintTabs();
  await loadFromQuery();
  if (tab === 'editor') enterEditor();

  return () => {
    window.removeEventListener('keydown', onKey);
    for (const off of offs) off();
    socket.send({ t: 'analysis:stop' });
    unfit();
    board.destroy();
  };
}
