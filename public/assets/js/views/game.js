// Live game screen: humans, bots, drills, spectating and finished games.
import { h, mount, clear, toast, fmtClock, fmtDuration, confirmDialog, copyText } from '../lib/dom.js';
import { socket } from '../lib/socket.js';
import { settings, pieceUrl } from '../lib/settings.js';
import { Board } from '../lib/board.js';
import { EvalBar, renderMoves, captured, fitBoard, avatar, clsIcon } from '../lib/ui.js';
import { play, playMove } from '../lib/sound.js';
import { session, navigate, VARIANT_NAMES, resultText, REASONS } from '../lib/state.js';
import { Game, Position, WHITE, BLACK, parseSq, QUEEN, ROOK, BISHOP, KNIGHT, PAWN } from '../chess/chess.js';

const LETTER = ' PNBRQK';

export default async function gameView(root, [id]) {
  let game = null; // last full state from the server
  let g = null; // local replica of the game (rules engine)
  let viewPly = null; // null = following the live position
  let me = null; // 'w' | 'b' | null (spectator)
  let pending = null; // move awaiting confirmation
  let hint = null, hintStage = 0;
  let lowTimeWarned = false, gameOverShown = false, tick = null;
  const offs = [];

  const evalBar = new EvalBar();
  const boardHost = h('div');
  const topBar = h('.playerbar'), bottomBar = h('.playerbar');
  const notice = h('div');
  const movesEl = h('.moves');
  const controls = h('.controls');
  const chatLog = h('.chat');
  const chatInput = h('input.input', { placeholder: 'Say something…', maxlength: 200 });
  const header = h('.panel-head');
  const infoEl = h('div');
  const chatPanel = h('.panel', { style: { flex: '0 0 190px' } },
    h('.panel-head', 'Chat'), h('.panel-body.grow', chatLog),
    h('form.chat-in', { onsubmit: (e) => { e.preventDefault(); const t = chatInput.value.trim(); if (t) socket.send({ t: 'game:chat', id, text: t }); chatInput.value = ''; } }, chatInput, h('button.btn.sm', { type: 'submit' }, 'Send')));
  const layout = h('.game',
    evalBar.el,
    h('.board-col', topBar, boardHost, bottomBar, notice),
    h('.side-col', h('.panel.fill', header, infoEl, h('.panel-body.grow', movesEl), controls), chatPanel));
  layout.style.setProperty('--eval-offset', '52px');
  mount(root, layout);
  const unfit = fitBoard(layout, { extra: 40 });

  const board = new Board(boardHost, { onMove: userMove });

  // ---- helpers ---------------------------------------------------------------------------
  const live = () => viewPly === null;
  const curPly = () => (live() ? g.ply : viewPly);
  const posAt = (ply) => (ply === g.ply ? g.pos : Position.fromFen(ply === 0 ? g.startFen : g.moves[ply - 1].fen, g.variant));
  const lastMoveAt = (ply) => {
    if (ply === 0) return null;
    const u = g.moves[ply - 1].uci;
    if (u[1] === '@') { const s = parseSq(u.slice(2, 4)); return [s, s]; }
    return [parseSq(u.slice(0, 2)), parseSq(u.slice(2, 4))];
  };
  const playing = () => game && game.status === 'playing';
  const myTurn = () => playing() && me && (g.turn === WHITE ? 'w' : 'b') === me;
  const orientation = () => board.orientation;

  function sync(animate = true) {
    const ply = curPly();
    board.set(posAt(ply), { lastMove: lastMoveAt(ply), animate, keepPremoves: live() });
    board.setViewOnly(!live() || !playing() || !me || !!pending);
    board.setMovable({ color: playing() && me && live() && !pending ? me : null, premove: true });
    renderBars();
    renderMoveList();
  }

  function renderMoveList() {
    renderMoves(movesEl, g.moves, curPly(), (ply) => goto(ply), g.startPly);
  }

  function goto(ply) {
    ply = Math.max(0, Math.min(g.ply, ply));
    viewPly = ply === g.ply ? null : ply;
    board.cancelPremoves();
    sync(true);
    renderControls();
    if (live() && myTurn()) board.playPremove();
  }

  // ---- clocks ------------------------------------------------------------------------------
  function remaining(color) {
    const c = game.clocks;
    const base = color === 'w' ? c.w : c.b;
    const turn = g.turn === WHITE ? 'w' : 'b';
    if (!c.running || turn !== color || !playing()) return base;
    return base - (socket.serverNow() - c.turnStarted);
  }

  function clockEl(color) {
    if (game.tc.untimed) return null;
    if (game.tc.days) {
      const turn = g.turn === WHITE ? 'w' : 'b';
      const left = game.clocks.deadline ? game.clocks.deadline - socket.serverNow() : null;
      return h('.clock.daily', { class: playing() && turn === color ? 'run' : '' }, playing() && turn === color && left != null ? fmtDuration(left) + ' left' : `${game.tc.days} day${game.tc.days > 1 ? 's' : ''}/move`);
    }
    return h('.clock', { dataset: { clock: color } }, fmtClock(remaining(color)));
  }

  function paintClocks() {
    if (!game || game.tc.untimed || game.tc.days) return;
    const turn = g.turn === WHITE ? 'w' : 'b';
    for (const el of layout.querySelectorAll('[data-clock]')) {
      const color = el.dataset.clock, rem = Math.max(0, remaining(color));
      el.textContent = fmtClock(rem);
      const running = playing() && game.clocks.running && turn === color;
      el.classList.toggle('run', running && rem >= 10_000);
      el.classList.toggle('low', running && rem < 10_000);
      if (running && color === me && rem < 10_000 && rem > 0 && !lowTimeWarned) { lowTimeWarned = true; play('tenseconds'); }
    }
  }

  // ---- player bars --------------------------------------------------------------------------
  function pocketEl(color, pos) {
    if (!pos.pockets) return null;
    const c = color === 'w' ? WHITE : BLACK;
    const mine = me === color && playing() && live();
    return h('.pocket', [QUEEN, ROOK, BISHOP, KNIGHT, PAWN].map((t) => {
      const n = pos.pockets[c][t];
      const el = h('.pp', { class: n ? '' : 'zero', style: { backgroundImage: `url(${pieceUrl(color + LETTER[t])})` }, title: `${n} in pocket` }, n > 1 ? h('b', String(n)) : null);
      if (mine && n) {
        el.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          board.selectDrop(t);
          board.startExternalDrag(t | (c << 3), e, (sq) => { if (sq >= 0) board.tryMove({ drop: t }, sq, true); });
        });
      }
      return el;
    }));
  }

  function bar(el, color) {
    const p = color === 'w' ? game.white : game.black;
    const pos = posAt(curPly());
    const cap = captured(pos);
    const adv = color === 'w' ? cap.diff : -cap.diff;
    const idx = color === 'w' ? 0 : 1;
    const offline = playing() && !p.isBot && !game.presence[idx] && !game.tc.days;
    const diff = p.diff != null ? h('span', { class: p.diff >= 0 ? 'pos' : 'neg' }, ` ${p.diff >= 0 ? '+' : ''}${p.diff}`) : null;
    mount(el,
      avatar(p.name, { bot: p.isBot ? p : null }),
      h('.who',
        h('b', p.isBot || !p.id ? p.name : h('a', { href: `/@/${p.name}` }, p.name), p.rating ? h('span.muted', { style: { fontWeight: 500 } }, ` (${p.rating})`) : null, diff),
        h('.cap', g.variant === 'crazyhouse' ? null : (color === 'w' ? cap.w : cap.b), adv > 0 && g.variant !== 'crazyhouse' ? h('span', `+${adv}`) : null,
          pos.checks ? h('span.checks', `✚ ${pos.checks[idx]}/3 checks`) : null, offline ? h('span.dot-off', '● disconnected') : null)),
      pocketEl(color, pos),
      clockEl(color));
  }

  function renderBars() {
    const bottom = orientation();
    bar(bottomBar, bottom);
    bar(topBar, bottom === 'w' ? 'b' : 'w');
    paintClocks();
  }

  // ---- header / info ----------------------------------------------------------------------------
  function renderHeader() {
    const bits = [VARIANT_NAMES[game.variant]];
    if (!game.tc.untimed) bits.push(game.tc.label);
    bits.push(game.drill ? 'Drill' : game.bot ? 'vs Computer' : game.rated ? 'Rated' : 'Casual');
    mount(header, h('span', bits.join(' · ')), h('span.muted.small', game.spectators ? `👁 ${game.spectators}` : ''));
    const parts = [];
    if (game.opening) parts.push(h('.muted.small', { style: { padding: '6px 12px 0' } }, `${game.opening.code} ${game.opening.name}`));
    if (game.drill) parts.push(h('.banner.accent', { style: { margin: '8px' } }, h('b', game.drill.name), h('div.small', game.drill.description), h('ul.small.muted', { style: { margin: '6px 0 0', paddingLeft: '18px' } }, game.drill.tips.map((t) => h('li', t)))));
    mount(infoEl, parts);
  }

  // ---- controls -----------------------------------------------------------------------------------
  function renderControls() {
    clear(controls);
    const nav = h('.row.gap-s', { style: { width: '100%' } },
      h('button.btn.icon.grow', { title: 'First move', onclick: () => goto(0) }, '⏮'),
      h('button.btn.icon.grow', { title: 'Previous (←)', onclick: () => goto(curPly() - 1) }, '◀'),
      h('button.btn.icon.grow', { title: 'Next (→)', onclick: () => goto(curPly() + 1) }, '▶'),
      h('button.btn.icon.grow', { title: 'Latest', onclick: () => goto(g.ply) }, '⏭'),
      h('button.btn.icon.grow', { title: 'Flip board (F)', onclick: flip }, '⇅'));
    controls.append(nav);
    if (pending) {
      controls.append(h('button.btn.primary', { onclick: confirmPending }, '✓ Confirm move'), h('button.btn', { onclick: cancelPending }, '✕ Cancel'));
      return;
    }
    if (playing() && me) {
      const oppOffer = game.drawOffer && game.drawOffer !== me;
      if (game.bot) {
        if (game.bot.takebacks) controls.append(h('button.btn', { onclick: () => socket.send({ t: 'game:takeback', id }), disabled: g.moves.length < 1 }, '↩ Takeback'));
        if (game.bot.hints) controls.append(h('button.btn', { onclick: askHint, disabled: !myTurn() }, hintStage === 1 ? '💡 Show move' : '💡 Hint'));
      }
      if (oppOffer) controls.append(h('button.btn.primary', { onclick: () => socket.send({ t: 'game:draw', id, action: 'accept' }) }, 'Accept draw'), h('button.btn', { onclick: () => socket.send({ t: 'game:draw', id, action: 'decline' }) }, 'Decline'));
      else if (!game.drill) controls.append(h('button.btn', { disabled: game.drawOffer === me, onclick: () => socket.send({ t: 'game:draw', id, action: 'offer' }) }, game.drawOffer === me ? 'Draw offered' : '½ Draw'));
      if (g.ply < 2 && !game.drill) controls.append(h('button.btn', { onclick: () => socket.send({ t: 'game:abort', id }) }, 'Abort'));
      else controls.append(h('button.btn.danger', { onclick: async () => { if (await confirmDialog('Resign?', game.drill ? 'Give up on this drill?' : 'Your opponent will be awarded the win.', 'Resign')) socket.send({ t: 'game:resign', id }); } }, '⚑ Resign'));
    } else if (game.status !== 'playing') {
      if (me && !game.archived) controls.append(h('button.btn.primary', { onclick: () => socket.send({ t: 'game:rematch', id }) }, game.drill ? '↻ Try again' : game.rematchOffered ? 'Accept rematch' : '↻ Rematch'));
      if (game.status === 'finished' && g.ply >= 2 && !game.drill) controls.append(h('a.btn', { href: `/review/${id}` }, '🔍 Game Review'));
      controls.append(h('a.btn', { href: `/analysis?game=${id}&ply=${curPly()}` }, '🔬 Analysis'));
      if (g.ply) controls.append(h('a.btn', { href: `/api/games/${id}/pgn`, download: `rookery-${id}.pgn` }, '⬇ PGN'));
      controls.append(h('a.btn', { href: game.drill ? '/learn/drills' : game.bot ? '/bots' : '/play' }, game.drill ? 'All drills' : 'New game'));
    } else {
      controls.append(h('button.btn', { onclick: async () => { await copyText(location.href); toast('Link copied', 'ok'); } }, '🔗 Share'));
    }
  }

  function flip() { board.flip(); evalBar.setOrientation(board.orientation); renderBars(); }

  // ---- notices under the board --------------------------------------------------------------------
  function showNotice(node) { mount(notice, node || null); }

  function showResult() {
    const d = game.drill && game.drill.outcome;
    if (d) {
      showNotice(h('.banner', { class: d.success ? 'good' : 'bad' }, h('b', d.success ? `${'★'.repeat(d.stars)}${'☆'.repeat(3 - d.stars)} Drill complete!` : 'Not this time'),
        h('div', d.text), d.success ? h('.small.muted', `${d.moves} moves (par ${d.par})${d.hints ? ` · ${d.hints} hint${d.hints > 1 ? 's' : ''}` : ''}`) : null));
      return;
    }
    const mine = me ? (me === 'w' ? game.white : game.black) : null;
    let headline = resultText(game);
    if (me && game.status === 'finished') {
      const won = (game.result === '1-0' && me === 'w') || (game.result === '0-1' && me === 'b');
      headline = game.result === '1/2-1/2' ? `Draw ${REASONS[game.reason] || ''}` : `${won ? 'You won' : 'You lost'} ${REASONS[game.reason] || ''}`;
    }
    showNotice(h('.banner.accent.result-card', h('.big', headline),
      mine && mine.diff != null ? h('div', 'Rating ', h('b', String((mine.rating || 0) + mine.diff)), ' ', h('span.diff', { class: mine.diff >= 0 ? 'pos' : 'neg' }, `(${mine.diff >= 0 ? '+' : ''}${mine.diff})`)) : null));
  }

  // ---- chat ------------------------------------------------------------------------------------------
  function addChat(m) {
    chatLog.append(h('.msg', { class: m.bot ? 'from-bot' : m.sys ? 'sys' : '' }, m.sys ? null : h('b', m.from), m.text));
    chatLog.parentElement.scrollTop = chatLog.parentElement.scrollHeight;
  }

  // ---- moves -----------------------------------------------------------------------------------------
  function userMove(move, meta) {
    if (!myTurn() || !live()) return;
    hint = null; hintStage = 0; board.setAutoShapes([]); board.setMarks([]);
    if (settings.get('confirmMove') && !meta.premove) {
      const next = g.pos.after(move);
      pending = { move, uci: g.pos.uci(move) };
      board.set(next, { lastMove: move.from >= 0 ? [move.from, move.to] : [move.to, move.to] });
      board.setViewOnly(true);
      renderControls();
      return;
    }
    sendMove(move);
  }

  function sendMove(move) {
    const rec = g.play(move);
    if (!rec) return;
    socket.send({ t: 'game:move', id, uci: rec.uci });
    // optimistic clock handover until the server confirms
    if (game.clocks.running || g.ply >= 1) {
      const c = game.clocks, mineKey = me;
      if (c.running) c[mineKey] = Math.max(0, c[mineKey] - (socket.serverNow() - c.turnStarted)) + (game.tc.inc || 0);
      c.turnStarted = socket.serverNow();
      c.running = !game.tc.untimed && !game.tc.days;
    }
    playMove(rec, true);
    if (g.variant === 'atomic' && rec.captured) board.boom(rec.to);
    showNotice(null);
    sync(true);
    renderControls();
  }

  function confirmPending() { const p = pending; pending = null; sendMove(p.move); }
  function cancelPending() { pending = null; sync(false); renderControls(); }

  function askHint() {
    if (hint && hint.ply === g.ply) {
      if (hintStage === 1) {
        hintStage = 2;
        board.setAutoShapes([{ from: hint.from, to: hint.to, color: 'hint' }]);
        showNotice(h('.feedback', '💡', h('span', `The engine suggests ${hint.san}.`)));
        renderControls();
      }
      return;
    }
    socket.send({ t: 'game:hint', id });
  }

  // ---- server events ---------------------------------------------------------------------------------
  function applyState(state, { takeback = false } = {}) {
    const first = !game;
    game = state;
    me = state.you;
    g = Game.fromMoves({ variant: state.variant, fen: state.startFen, moves: state.moves.map((m) => m.uci) });
    pending = null; hint = null; hintStage = 0;
    if (first) {
      board.setOrientation(me === 'b' ? 'b' : 'w');
      evalBar.setOrientation(board.orientation);
      clear(chatLog);
      for (const m of state.chat) addChat(m);
      if (state.status === 'playing' && g.ply === 0) play('game-start');
      document.title = `${state.white.name} vs ${state.black.name} · Rookery`;
    }
    if (takeback) { viewPly = null; board.setAutoShapes([]); board.setMarks([]); showNotice(null); }
    const showEval = !!state.eval || state.status !== 'playing' || (state.bot && state.bot.evalBar) || !me;
    layout.classList.toggle('no-eval', !showEval);
    evalBar.el.classList.toggle('hidden', !showEval);
    if (state.eval) evalBar.update(state.eval);
    chatPanel.classList.toggle('hidden', !me && !state.chat.length);
    chatInput.disabled = !me || !!state.archived;
    lowTimeWarned = false;
    renderHeader();
    sync(!first);
    renderControls();
    if (state.status !== 'playing') { showResult(); gameOverShown = true; }
    else if (state.drawOffer && state.drawOffer !== me && me) showNotice(h('.banner.accent', 'Your opponent offers a draw.'));
  }

  offs.push(socket.on('game:state', (m) => { if (m.game.id === id) applyState(m.game, { takeback: !!m.takeback }); }));

  offs.push(socket.on('game:move', (m) => {
    if (m.id !== id || !g) return;
    game.clocks = m.clocks;
    game.opening = m.opening || game.opening;
    game.drawOffer = m.drawOffer;
    if (m.ply === g.ply + 1) {
      const rec = g.play(m.uci);
      if (!rec || rec.fen !== m.fen) return socket.send({ t: 'game:join', id }); // out of sync: reload the state
      const mine = me && rec.color === (me === 'w' ? WHITE : BLACK);
      playMove(rec, mine);
      if (g.variant === 'atomic' && rec.captured && live()) board.boom(rec.to);
      if (live()) { sync(true); if (myTurn()) board.playPremove(); }
      else renderMoveList();
    } else if (m.ply > g.ply + 1 || (g.moves[m.ply - 1] && g.moves[m.ply - 1].uci !== m.uci)) {
      return socket.send({ t: 'game:join', id });
    }
    lowTimeWarned = remaining(me || 'w') < 10_000;
    renderHeader();
    renderBars();
    renderControls();
  }));

  offs.push(socket.on('game:reject', (m) => {
    if (m.id !== id) return;
    play('illegal');
    toast(m.error || 'Move rejected', 'err');
    socket.send({ t: 'game:join', id });
  }));

  offs.push(socket.on('game:end', (m) => {
    if (m.id !== id || !game) return;
    game.status = m.status; game.result = m.result; game.reason = m.reason; game.clocks = m.clocks; game.opening = m.opening || game.opening; game.drawOffer = null;
    if (m.diffs) { game.white.diff = m.diffs.white.diff; game.black.diff = m.diffs.black.diff; }
    if (m.drill && game.drill) game.drill.outcome = m.drill;
    pending = null;
    board.cancelPremoves();
    layout.classList.remove('no-eval'); evalBar.el.classList.remove('hidden');
    if (!gameOverShown) { play(game.drill && m.drill && m.drill.success ? 'puzzle-solve' : 'game-end'); gameOverShown = true; }
    renderHeader(); sync(false); renderControls(); showResult();
    window.rookery.refreshMe().catch(() => {});
  }));

  offs.push(socket.on('game:draw', (m) => {
    if (m.id !== id || !game) return;
    game.drawOffer = m.offer || null;
    if (m.declined) { toast('Draw offer declined'); showNotice(null); }
    else if (m.offer && m.offer !== me && me) { showNotice(h('.banner.accent', 'Your opponent offers a draw.')); play('premove'); }
    renderControls();
  }));
  offs.push(socket.on('game:chat', (m) => { if (m.id === id) addChat(m.msg); }));
  offs.push(socket.on('game:presence', (m) => {
    if (m.id !== id || !game) return;
    game.presence[m.color === 'w' ? 0 : 1] = m.connected;
    if (!m.connected && m.color !== me) addChat({ sys: true, text: `Opponent disconnected — ${Math.round(m.graceMs / 1000)}s to reconnect.` });
    renderBars();
  }));
  offs.push(socket.on('game:spectators', (m) => { if (m.id === id && game) { game.spectators = m.n; renderHeader(); } }));
  offs.push(socket.on('game:eval', (m) => {
    if (m.id !== id || !game) return;
    layout.classList.remove('no-eval'); evalBar.el.classList.remove('hidden');
    evalBar.update({ cp: m.cp, mate: m.mate });
  }));
  offs.push(socket.on('game:feedback', (m) => {
    if (m.id !== id) return;
    showNotice(h('.feedback', clsIcon(m.cls), h('span', m.text)));
  }));
  offs.push(socket.on('game:hint', (m) => {
    if (m.id !== id || !g || m.ply !== g.ply) return;
    hint = { ply: m.ply, from: parseSq(m.uci.slice(0, 2)), to: parseSq(m.uci.slice(2, 4)), san: m.san, drop: m.uci[1] === '@' };
    if (hint.drop) { hint.from = hint.to; }
    hintStage = 1;
    board.setMarks([{ sq: hint.from, cls: 'hint' }]);
    showNotice(h('.feedback', '💡', h('span', hint.drop ? `Think about a drop on ${m.uci.slice(2, 4)}.` : `Look at your ${m.piece}. ${m.coach || ''}`)));
    renderControls();
  }));
  offs.push(socket.on('game:rematch', (m) => {
    if (m.id !== id) return;
    if (m.gameId) return navigate(`/game/${m.gameId}`);
    if (m.offer && m.offer !== me) { game.rematchOffered = true; toast('Your opponent wants a rematch'); renderControls(); }
    else if (m.offer) toast('Rematch offered');
  }));
  offs.push(socket.on('game:error', (m) => { if (m.id === id) { toast(m.error, 'err'); if (!game) mount(root, h('.page.narrow', h('.card.empty', h('h2', m.error), h('a.btn.primary', { href: '/play' }, 'Back to play')))); } }));
  offs.push(socket.on('open', () => socket.send({ t: 'game:join', id })));

  const onKey = (e) => {
    if (!g || e.target.matches('input, textarea')) return;
    if (e.key === 'ArrowLeft') { e.preventDefault(); goto(curPly() - 1); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); goto(curPly() + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); goto(0); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); goto(g.ply); }
    else if (e.key === 'f' || e.key === 'F') flip();
  };
  window.addEventListener('keydown', onKey);
  tick = setInterval(() => { if (game && g) paintClocks(); }, 100);
  socket.send({ t: 'game:join', id });

  return () => {
    clearInterval(tick);
    window.removeEventListener('keydown', onKey);
    for (const off of offs) off();
    socket.send({ t: 'game:leave', id });
    unfit();
    board.destroy();
    document.title = 'Rookery';
  };
}
