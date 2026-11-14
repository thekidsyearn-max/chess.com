// Interactive chessboard: DOM pieces with CSS-transform animation, click/drag moves,
// promotion picker, chained premoves, drops, right-click highlights and a <canvas>
// overlay for multi-colour arrows.
import {
  PAWN, KNIGHT, BISHOP, ROOK, QUEEN, KING, WHITE, F_CASTLE_K, F_CASTLE_Q, F_DROP,
  KING_NEIGHBORS, KNIGHT_TARGETS, SLIDE_RAYS,
} from '../chess/chess.js';
import { settings, pieceUrl } from './settings.js';
import { h } from './dom.js';
import { play } from './sound.js';

const LETTER = ' PNBRQK';
export const codeName = (p) => ((p >> 3) === WHITE ? 'w' : 'b') + LETTER[p & 7];
const SHAPE_COLORS = { red: '#e0453a', green: '#5fae4e', yellow: '#eaa521', blue: '#3f8fe0', engine: '#3f8fe0', hint: '#f2a541', alt: '#8a94a6' };
const MAX_PREMOVES = 5;

export class Board {
  constructor(container, opts = {}) {
    this.opts = opts;
    this.orientation = opts.orientation || 'w';
    this.pos = null;
    this.movable = { color: null, premove: false };
    this.viewOnly = !!opts.viewOnly;
    this.free = !!opts.free;
    this.selected = null; // square index or { drop: type }
    this.premoves = [];
    this.lastMove = null;
    this.customMarks = [];
    this.userArrows = [];
    this.userSquares = new Map();
    this.autoShapes = [];
    this.pieceEls = new Map();
    this.drag = null;
    this.badge = null;

    this.squaresEl = h('.squares');
    this.marksEl = h('.layer.marks');
    this.piecesEl = h('.layer.pieces');
    this.canvas = h('canvas.shapes');
    this.board = h('.board', { oncontextmenu: (e) => e.preventDefault() }, this.squaresEl, this.marksEl, this.piecesEl, this.canvas);
    this.ranksEl = h('.outer-coords.ranks');
    this.filesEl = h('.outer-coords.files');
    this.el = h('.board-wrap', this.ranksEl, this.board, this.filesEl);
    container.append(this.el);
    this.buildSquares();

    this.onDown = this.pointerDown.bind(this);
    this.onMove = this.pointerMove.bind(this);
    this.onUp = this.pointerUp.bind(this);
    this.board.addEventListener('pointerdown', this.onDown);
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    this.ro = new ResizeObserver(() => this.drawShapes());
    this.ro.observe(this.board);
    this.unsub = settings.subscribe((s, patch) => {
      if ('pieceSet' in patch) for (const o of this.pieceEls.values()) o.el.style.backgroundImage = `url(${pieceUrl(codeName(o.code))})`;
      if ('coords' in patch) this.applyCoords();
      if ('showLegal' in patch || 'highlightLast' in patch) this.renderMarks();
    });
    this.applyCoords();
  }

  destroy() {
    this.board.removeEventListener('pointerdown', this.onDown);
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    this.ro.disconnect();
    this.unsub();
    this.dropGhost();
    this.el.remove();
  }

  // ---- geometry ----------------------------------------------------------------------
  colRow(sq) { const f = sq & 7, r = sq >> 3; return this.orientation === 'w' ? [f, 7 - r] : [7 - f, r]; }
  place(el, sq) { const [c, r] = this.colRow(sq); el.style.transform = `translate(${c * 100}%, ${r * 100}%)`; }
  sqAt(x, y) {
    const b = this.board.getBoundingClientRect();
    if (x < b.left || y < b.top || x >= b.right || y >= b.bottom) return -1;
    const c = Math.min(7, Math.floor(((x - b.left) / b.width) * 8)), r = Math.min(7, Math.floor(((y - b.top) / b.height) * 8));
    return this.orientation === 'w' ? (7 - r) * 8 + c : r * 8 + (7 - c);
  }

  buildSquares() {
    this.squaresEl.textContent = '';
    this.ranksEl.textContent = '';
    this.filesEl.textContent = '';
    for (let row = 0; row < 8; row++) for (let col = 0; col < 8; col++) {
      const f = this.orientation === 'w' ? col : 7 - col, r = this.orientation === 'w' ? 7 - row : row;
      const sq = h('.sq', { class: (f + r) % 2 === 1 ? 'l' : 'd' });
      if (col === 0) sq.append(h('span.coord.rank', String(r + 1)));
      if (row === 7) sq.append(h('span.coord.file', 'abcdefgh'[f]));
      this.squaresEl.append(sq);
    }
    for (let i = 0; i < 8; i++) {
      this.ranksEl.append(h('span', String(this.orientation === 'w' ? 8 - i : i + 1)));
      this.filesEl.append(h('span', 'abcdefgh'[this.orientation === 'w' ? i : 7 - i]));
    }
  }

  applyCoords() {
    const mode = this.opts.coords || settings.get('coords');
    this.el.classList.toggle('coords-off', mode === 'off');
    this.el.classList.toggle('coords-outside', mode === 'outside');
  }

  setOrientation(o) {
    if (o === this.orientation) return;
    this.orientation = o;
    this.buildSquares();
    for (const [sq, obj] of this.pieceEls) { obj.el.style.transition = 'none'; this.place(obj.el, sq); }
    void this.board.offsetWidth;
    for (const obj of this.pieceEls.values()) obj.el.style.transition = '';
    this.renderMarks();
    this.drawShapes();
  }
  flip() { this.setOrientation(this.orientation === 'w' ? 'b' : 'w'); }

  // ---- state -------------------------------------------------------------------------
  /** Show a position. opts: { lastMove: [from, to], animate, keepPremoves } */
  set(pos, { lastMove = null, animate = true, keepPremoves = false } = {}) {
    this.pos = pos;
    this.lastMove = lastMove;
    this.selected = null;
    if (!keepPremoves) this.premoves = [];
    if (this.noAnimOnce) { animate = false; this.noAnimOnce = false; }
    this.closePromo();
    this.renderPieces(animate);
    this.renderMarks();
  }

  setMovable({ color = null, premove = false } = {}) { this.movable = { color, premove }; if (!color) { this.selected = null; this.premoves = []; } this.renderMarks(); }
  setViewOnly(v) { this.viewOnly = v; if (v) { this.selected = null; this.renderMarks(); } }
  setMarks(marks) { this.customMarks = marks || []; this.renderMarks(); }
  setAutoShapes(shapes) { this.autoShapes = shapes || []; this.drawShapes(); }
  clearShapes() { if (this.userArrows.length || this.userSquares.size) { this.userArrows = []; this.userSquares.clear(); this.drawShapes(); } }
  setBadge(b) {
    if (this.badgeEl) { this.badgeEl.remove(); this.badgeEl = null; }
    this.badge = b;
    if (!b) return;
    const [c, r] = this.colRow(b.sq);
    this.badgeEl = h('.badge.cls', { class: b.cls, style: { left: `${(c + 0.93) * 12.5}%`, top: `${(r + 0.1) * 12.5}%` } }, b.text || '');
    this.board.append(this.badgeEl);
  }

  turnColor() { return this.pos ? (this.pos.turn === WHITE ? 'w' : 'b') : null; }
  isTurn() { return !!this.pos && (this.movable.color === 'both' || this.movable.color === this.turnColor()); }
  ownsPiece(p) {
    if (!this.movable.color || !this.pos) return false;
    const c = (p >> 3) === WHITE ? 'w' : 'b';
    if (this.movable.color === 'both') return c === this.turnColor();
    if (c !== this.movable.color) return false;
    return this.isTurn() || (this.movable.premove && settings.get('premoves'));
  }

  // Board as displayed: the real position with queued premoves applied on top.
  displayBoard() {
    const b = this.pos.board.slice();
    for (const pm of this.premoves) {
      if (pm.drop) { b[pm.to] = pm.drop | ((this.movable.color === 'b' ? 1 : 0) << 3); continue; }
      const p = b[pm.from];
      if (!p) continue;
      b[pm.from] = 0;
      b[pm.to] = pm.promo ? (pm.promo | (p & 8)) : p;
      if ((p & 7) === KING && Math.abs((pm.to & 7) - (pm.from & 7)) === 2) {
        const rank = pm.from & 56, short = (pm.to & 7) > (pm.from & 7);
        const rf = short ? rank + 7 : rank, rt = short ? rank + 5 : rank + 3;
        if ((b[rf] & 7) === ROOK) { b[rt] = b[rf]; b[rf] = 0; }
      }
    }
    return b;
  }

  makePiece(code) {
    return h('.piece', { style: { backgroundImage: `url(${pieceUrl(codeName(code))})` } });
  }

  renderPieces(animate = true) {
    const target = this.displayBoard();
    const keep = new Map(), gone = [];
    for (const [sq, o] of this.pieceEls) { if (target[sq] === o.code) keep.set(sq, o); else gone.push([sq, o]); }
    const hintFrom = this.lastMove ? this.lastMove[0] : -1;
    const dist = (a, b) => Math.abs((a & 7) - (b & 7)) + Math.abs((a >> 3) - (b >> 3));
    const glide = (o, sq) => {
      if (!animate) o.el.style.transition = 'none';
      o.el.style.zIndex = 3;
      this.place(o.el, sq);
      if (!animate) { void o.el.offsetWidth; o.el.style.transition = ''; }
      setTimeout(() => { o.el.style.zIndex = ''; }, settings.animMs() + 30);
    };
    for (let sq = 0; sq < 64; sq++) {
      const code = target[sq];
      if (!code || keep.has(sq)) continue;
      let bi = -1, bd = 1e9;
      gone.forEach(([gsq, o], i) => { if (o.code === code) { const d = dist(gsq, sq) - (gsq === hintFrom ? 100 : 0); if (d < bd) { bd = d; bi = i; } } });
      if (bi < 0 && this.lastMove && sq === this.lastMove[1]) {
        // promotion: the pawn that left the from-square becomes the new piece
        bi = gone.findIndex(([gsq, o]) => gsq === hintFrom && (o.code & 7) === PAWN && (o.code & 8) === (code & 8));
        if (bi >= 0) { gone[bi][1].code = code; gone[bi][1].el.style.backgroundImage = `url(${pieceUrl(codeName(code))})`; }
      }
      if (bi >= 0) { const [, o] = gone.splice(bi, 1)[0]; glide(o, sq); keep.set(sq, o); continue; }
      const el = this.makePiece(code);
      el.style.transition = 'none';
      this.place(el, sq);
      this.piecesEl.append(el);
      void el.offsetWidth;
      el.style.transition = '';
      keep.set(sq, { el, code });
    }
    for (const [, o] of gone) { o.el.classList.add('fade'); setTimeout(() => o.el.remove(), 140); }
    this.pieceEls = keep;
  }

  addMark(sq, cls) { const m = h('.mark', { class: cls }); this.place(m, sq); this.marksEl.append(m); return m; }

  renderMarks() {
    this.marksEl.textContent = '';
    if (!this.pos) return;
    if (this.lastMove && settings.get('highlightLast')) for (const s of this.lastMove) if (s >= 0) this.addMark(s, 'last');
    if (this.pos.inCheck() && this.pos.kings[this.pos.turn] >= 0) this.addMark(this.pos.kings[this.pos.turn], 'check');
    this.premoves.forEach((pm, i) => { const cls = i % 2 === 0 ? 'pre-a' : 'pre-b'; if (!pm.drop) this.addMark(pm.from, cls); this.addMark(pm.to, cls); });
    for (const m of this.customMarks) this.addMark(m.sq, m.cls);
    if (this.selected != null) {
      if (typeof this.selected === 'number') this.addMark(this.selected, 'sel');
      if (settings.get('showLegal')) {
        const disp = this.displayBoard();
        for (const to of this.destsFor(this.selected)) this.addMark(to, disp[to] ? 'dest cap' : 'dest');
      }
    }
  }

  // explosion flash for atomic captures
  boom(sq) { const m = this.addMark(sq, 'boom'); setTimeout(() => m.remove(), 480); }

  // ---- move generation helpers ----------------------------------------------------------
  legalFrom(sel) {
    const legal = this.pos.moves();
    if (typeof sel === 'object') return legal.filter((m) => m.flag === F_DROP && m.piece === sel.drop);
    return legal.filter((m) => m.from === sel && m.flag !== F_DROP);
  }

  // squares a castle move can be played to (king's destination and/or the rook's square)
  castleSquares(m) {
    const kTo = this.pos.castleKingTo(m);
    if (this.pos.variant !== 'chess960') return [kTo, m.to];
    const clash = this.pos.moves().some((x) => x.from === m.from && x.to === kTo && x.flag !== F_CASTLE_K && x.flag !== F_CASTLE_Q);
    return clash || kTo === m.from ? [m.to] : [kTo, m.to];
  }

  premoveDests(sq) {
    const out = new Set(), b = this.displayBoard(), p = b[sq];
    if (!p) return out;
    const t = p & 7, white = (p >> 3) === WHITE;
    if (t === KNIGHT) for (const s of KNIGHT_TARGETS[sq]) out.add(s);
    else if (t === KING) {
      for (const s of KING_NEIGHBORS[sq]) out.add(s);
      const home = white ? 4 : 60;
      if (sq === home && this.pos.variant !== 'chess960') { out.add(home + 2); out.add(home - 2); }
    } else if (t === PAWN) {
      const dir = white ? 8 : -8, f = sq & 7, one = sq + dir;
      if (one >= 0 && one < 64) {
        out.add(one);
        if ((sq >> 3) === (white ? 1 : 6)) out.add(one + dir);
        if (f > 0) out.add(one - 1);
        if (f < 7) out.add(one + 1);
      }
    } else {
      const d0 = t === BISHOP ? 4 : 0, d1 = t === ROOK ? 4 : 8;
      for (let d = d0; d < d1; d++) for (const s of SLIDE_RAYS[sq][d]) out.add(s);
    }
    return out;
  }

  destsFor(sel) {
    if (this.isTurn()) {
      const out = new Set();
      for (const m of this.legalFrom(sel)) {
        if (m.flag === F_CASTLE_K || m.flag === F_CASTLE_Q) for (const s of this.castleSquares(m)) out.add(s);
        else out.add(m.to);
      }
      return out;
    }
    if (this.movable.premove && settings.get('premoves')) {
      if (typeof sel === 'object') { const out = new Set(), b = this.displayBoard(); for (let s = 0; s < 64; s++) if (!b[s] && !(sel.drop === PAWN && ((s >> 3) === 0 || (s >> 3) === 7))) out.add(s); return out; }
      return this.premoveDests(sel);
    }
    return new Set();
  }

  // ---- making moves ------------------------------------------------------------------------
  tryMove(sel, to, viaDrag = false) {
    if (!this.pos) return false;
    if (this.isTurn()) {
      const cands = this.legalFrom(sel).filter((m) => ((m.flag === F_CASTLE_K || m.flag === F_CASTLE_Q) ? this.castleSquares(m).includes(to) : m.to === to));
      if (!cands.length) return false;
      this.noAnimOnce = viaDrag;
      if (cands.some((m) => m.promo)) {
        if (settings.get('autoQueen') && this.pos.variant !== 'atomic') this.commit(cands.find((m) => m.promo === QUEEN));
        else this.openPromo(to, cands);
      } else this.commit(cands.find((m) => m.to === to) || cands[0]);
      return true;
    }
    if (this.movable.premove && settings.get('premoves')) {
      if (!this.destsFor(sel).has(to)) return false;
      if (this.premoves.length >= MAX_PREMOVES) { play('illegal'); return true; }
      if (typeof sel === 'object') this.premoves.push({ drop: sel.drop, to });
      else {
        const p = this.displayBoard()[sel];
        const promo = (p & 7) === PAWN && ((to >> 3) === 0 || (to >> 3) === 7) ? QUEEN : 0;
        this.premoves.push({ from: sel, to, promo });
      }
      this.selected = null;
      play('premove');
      this.renderPieces(!viaDrag);
      this.renderMarks();
      if (this.opts.onPremove) this.opts.onPremove(this.premoves.length);
      return true;
    }
    return false;
  }

  commit(move) {
    this.selected = null;
    this.closePromo();
    if (this.opts.onMove) this.opts.onMove(move, {});
    this.noAnimOnce = false;
  }

  /** Called by the view when it becomes the user's turn: plays the first queued premove if it is legal. */
  playPremove() {
    if (!this.premoves.length || !this.isTurn()) return false;
    const pm = this.premoves.shift();
    const legal = this.pos.moves();
    const m = pm.drop
      ? legal.find((x) => x.flag === F_DROP && x.piece === pm.drop && x.to === pm.to)
      : legal.find((x) => x.from === pm.from && x.flag !== F_DROP && (!x.promo || x.promo === (pm.promo || QUEEN))
          && ((x.flag === F_CASTLE_K || x.flag === F_CASTLE_Q) ? this.castleSquares(x).includes(pm.to) : x.to === pm.to));
    if (!m) { this.cancelPremoves(); return false; } // the position changed: the whole chain is void
    const rest = this.premoves;
    this.premoves = [];
    if (this.opts.onMove) this.opts.onMove(m, { premove: true });
    this.premoves = rest;
    if (rest.length) { this.renderPieces(false); this.renderMarks(); }
    return true;
  }

  cancelPremoves() {
    if (!this.premoves.length) return;
    this.premoves = [];
    this.renderPieces(false);
    this.renderMarks();
    if (this.opts.onPremove) this.opts.onPremove(0);
  }

  // pocket piece chosen for a drop (Crazyhouse)
  selectDrop(type) {
    this.selected = this.selected && this.selected.drop === type ? null : { drop: type };
    this.renderMarks();
  }

  openPromo(to, cands) {
    this.closePromo();
    const [c, r] = this.colRow(to);
    const color = this.pos.turn === WHITE ? 'w' : 'b';
    const box = h('.promo', { class: r === 0 ? '' : 'up', style: { left: `${c * 12.5}%`, [r === 0 ? 'top' : 'bottom']: '0' } },
      [QUEEN, KNIGHT, ROOK, BISHOP].map((t) => h('button', { title: LETTER[t], style: { backgroundImage: `url(${pieceUrl(color + LETTER[t])})` }, onclick: (e) => { e.stopPropagation(); this.commit(cands.find((m) => m.promo === t)); } })));
    const veil = h('.board-veil', { onpointerdown: (e) => { e.stopPropagation(); this.closePromo(); this.noAnimOnce = false; this.renderPieces(false); } });
    this.promoEls = [veil, box];
    this.board.append(veil, box);
  }
  closePromo() { if (this.promoEls) { for (const e of this.promoEls) e.remove(); this.promoEls = null; } }

  // ---- pointer input ---------------------------------------------------------------------------
  pointerDown(e) {
    if (!this.pos) return;
    const sq = this.sqAt(e.clientX, e.clientY);
    if (e.button === 2) {
      e.preventDefault();
      this.endDrag(false);
      if (this.premoves.length) this.cancelPremoves();
      this.selected = null;
      this.renderMarks();
      this.right = { sq, color: e.shiftKey ? 'green' : e.ctrlKey || e.metaKey ? 'yellow' : e.altKey ? 'blue' : 'red' };
      return;
    }
    if (e.button !== 0 || sq < 0) return;
    this.clearShapes();
    const disp = this.displayBoard(), p = disp[sq];
    if (this.free) {
      if (p) this.beginDrag(e, sq, p, true);
      else if (this.opts.onSquareClick) this.opts.onSquareClick(sq);
      return;
    }
    if (this.viewOnly) return;
    if (this.selected != null && !(typeof this.selected === 'number' && this.selected === sq)) {
      if (this.tryMove(this.selected, sq)) { e.preventDefault(); return; }
    }
    if (p && this.ownsPiece(p)) {
      const was = this.selected === sq;
      this.selected = sq;
      this.beginDrag(e, sq, p, false);
      this.drag.wasSelected = was;
      this.renderMarks();
      e.preventDefault();
    } else {
      this.selected = null;
      if (this.premoves.length) this.cancelPremoves();
      this.renderMarks();
    }
  }

  beginDrag(e, sq, code, free) {
    this.drag = { sq, code, x: e.clientX, y: e.clientY, moved: false, free, pointerId: e.pointerId };
  }

  ghost(code, x, y) {
    const size = this.board.getBoundingClientRect().width / 8;
    const g = h('.drag-piece', { style: { width: size + 'px', height: size + 'px', backgroundImage: `url(${pieceUrl(codeName(code))})`, left: x + 'px', top: y + 'px' } });
    document.body.append(g);
    return g;
  }
  dropGhost() { if (this.ghostEl) { this.ghostEl.remove(); this.ghostEl = null; } }

  pointerMove(e) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved) {
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) < 4) return;
      d.moved = true;
      this.ghostEl = this.ghost(d.code, e.clientX, e.clientY);
      const o = d.external ? null : this.pieceEls.get(d.sq);
      if (o) o.el.classList.add('ghosted');
    }
    this.ghostEl.style.left = e.clientX + 'px';
    this.ghostEl.style.top = e.clientY + 'px';
  }

  endDrag(apply, e) {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.dropGhost();
    const o = d.external ? null : this.pieceEls.get(d.sq);
    if (o) o.el.classList.remove('ghosted');
    if (!apply) return;
    const to = this.sqAt(e.clientX, e.clientY);
    if (d.external) { if (d.moved || to >= 0) d.onDrop(to); return; }
    if (d.free) {
      if (d.moved && to !== d.sq && this.opts.onFreeMove) this.opts.onFreeMove(d.sq, to);
      else if (!d.moved && this.opts.onSquareClick) this.opts.onSquareClick(d.sq);
      return;
    }
    if (d.moved) {
      if (to >= 0 && to !== d.sq && this.tryMove(d.sq, to, true)) return;
      this.selected = to === d.sq ? d.sq : null;
      this.renderMarks();
    } else if (d.wasSelected) { this.selected = null; this.renderMarks(); }
  }

  pointerUp(e) {
    if (this.right && (e.button === 2 || e.type === 'pointercancel')) {
      const { sq, color } = this.right;
      this.right = null;
      const to = this.sqAt(e.clientX, e.clientY);
      if (sq >= 0 && to >= 0 && e.type !== 'pointercancel') {
        if (to === sq) { if (this.userSquares.get(sq) === color) this.userSquares.delete(sq); else this.userSquares.set(sq, color); }
        else {
          const i = this.userArrows.findIndex((a) => a.from === sq && a.to === to);
          if (i >= 0 && this.userArrows[i].color === color) this.userArrows.splice(i, 1);
          else { if (i >= 0) this.userArrows.splice(i, 1); this.userArrows.push({ from: sq, to, color }); }
        }
        this.drawShapes();
      }
      return;
    }
    if (this.drag && (e.pointerId === this.drag.pointerId || this.drag.external)) this.endDrag(e.type !== 'pointercancel', e);
  }

  /** Drag a piece that is not on the board (pocket, editor palette). onDrop(square | -1). */
  startExternalDrag(code, e, onDrop) {
    this.drag = { sq: -1, code, x: e.clientX, y: e.clientY, moved: false, external: true, onDrop, pointerId: e.pointerId };
  }

  // ---- arrows & highlighted squares (canvas overlay) --------------------------------------------
  drawShapes() {
    const rect = this.board.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const size = Math.round(rect.width * dpr);
    if (!size) return;
    if (this.canvas.width !== size) { this.canvas.width = size; this.canvas.height = size; }
    const ctx = this.canvas.getContext('2d');
    ctx.clearRect(0, 0, size, size);
    const s = size / 8;
    const center = (sq) => { const [c, r] = this.colRow(sq); return [(c + 0.5) * s, (r + 0.5) * s]; };
    for (const [sq, color] of this.userSquares) {
      const [c, r] = this.colRow(sq);
      ctx.globalAlpha = 0.62;
      ctx.fillStyle = SHAPE_COLORS[color] || color;
      ctx.fillRect(c * s, r * s, s, s);
    }
    const arrow = (a) => {
      const [x1, y1] = center(a.from), [x2, y2] = center(a.to);
      const ang = Math.atan2(y2 - y1, x2 - x1), w = s * (a.width || 0.17), head = s * 0.42;
      const len = Math.hypot(x2 - x1, y2 - y1) - head * 0.9;
      ctx.globalAlpha = a.opacity ?? 0.82;
      ctx.fillStyle = SHAPE_COLORS[a.color] || a.color || SHAPE_COLORS.green;
      ctx.save();
      ctx.translate(x1, y1);
      ctx.rotate(ang);
      ctx.beginPath();
      const start = s * 0.3;
      ctx.moveTo(start, -w / 2); ctx.lineTo(len, -w / 2); ctx.lineTo(len, -head / 2); ctx.lineTo(len + head * 0.9, 0);
      ctx.lineTo(len, head / 2); ctx.lineTo(len, w / 2); ctx.lineTo(start, w / 2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    };
    for (const a of this.autoShapes) if (a.from >= 0 && a.to >= 0 && a.from !== a.to) arrow(a);
    for (const a of this.userArrows) arrow(a);
    ctx.globalAlpha = 1;
  }
}

// Static, non-interactive mini board for lists and previews.
export function miniBoard(fen, orientation = 'w') {
  const el = h('.miniboard');
  const rows = String(fen).split(' ')[0].replace(/\[.*\]/, '').split('/').slice(0, 8);
  const grid = [];
  for (const row of rows) {
    const line = [];
    for (const ch of row) { if (ch >= '1' && ch <= '8') for (let i = 0; i < +ch; i++) line.push(null); else if (ch !== '~') line.push(ch); }
    grid.push(line);
  }
  for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
    const rr = orientation === 'w' ? r : 7 - r, cc = orientation === 'w' ? c : 7 - c;
    const ch = grid[rr] ? grid[rr][cc] : null;
    const cell = h('i', { class: (rr + cc) % 2 === 0 ? 'l' : 'd' });
    if (ch) cell.style.backgroundImage = `url(${pieceUrl((ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase())})`;
    el.append(cell);
  }
  return el;
}
