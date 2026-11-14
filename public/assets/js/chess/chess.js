// Rookery rules engine — isomorphic ES module (browser + Node).
// FIDE-complete standard chess plus Chess960, King of the Hill, Three-Check,
// Crazyhouse and Atomic. Copy-make legality, Zobrist hashing, SAN/UCI/FEN.

export const WHITE = 0, BLACK = 1;
export const PAWN = 1, KNIGHT = 2, BISHOP = 3, ROOK = 4, QUEEN = 5, KING = 6;
export const VARIANTS = ['standard', 'chess960', 'koth', 'threecheck', 'crazyhouse', 'atomic'];
export const VARIANT_NAMES = {
  standard: 'Standard', chess960: 'Chess960', koth: 'King of the Hill',
  threecheck: 'Three-Check', crazyhouse: 'Crazyhouse', atomic: 'Atomic',
};
export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const F_NORMAL = 0, F_DOUBLE = 1, F_EP = 2, F_CASTLE_K = 3, F_CASTLE_Q = 4, F_DROP = 5;
export const PIECE_VALUE = [0, 100, 320, 330, 500, 900, 0];

const FILES = 'abcdefgh';
const LETTERS = ['', 'P', 'N', 'B', 'R', 'Q', 'K'];
const LOWER = ' pnbrqk';

export const fileOf = (s) => s & 7;
export const rankOf = (s) => s >> 3;
export const sqName = (s) => FILES[s & 7] + ((s >> 3) + 1);
export const parseSq = (n) => {
  if (!n || n.length < 2) return -1;
  const f = n.charCodeAt(0) - 97, r = n.charCodeAt(1) - 49;
  return f >= 0 && f < 8 && r >= 0 && r < 8 ? r * 8 + f : -1;
};
export const colorOf = (p) => p >> 3;
export const typeOf = (p) => p & 7;
export const pieceChar = (p) => {
  const c = LOWER[p & 7];
  return (p >> 3) === WHITE ? c.toUpperCase() : c;
};
export const isLightSquare = (s) => ((s & 7) + (s >> 3)) % 2 === 1;

// ---- precomputed geometry ---------------------------------------------------
const KNIGHT_T = [], KING_T = [], RAYS = [];
const DIRS = [[0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]];
for (let s = 0; s < 64; s++) {
  const f = s & 7, r = s >> 3;
  KNIGHT_T[s] = [];
  for (const [df, dr] of [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]]) {
    const ff = f + df, rr = r + dr;
    if (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) KNIGHT_T[s].push(rr * 8 + ff);
  }
  KING_T[s] = [];
  RAYS[s] = [];
  for (const [df, dr] of DIRS) {
    const ray = [];
    let ff = f + df, rr = r + dr;
    if (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) KING_T[s].push(rr * 8 + ff);
    while (ff >= 0 && ff < 8 && rr >= 0 && rr < 8) { ray.push(rr * 8 + ff); ff += df; rr += dr; }
    RAYS[s].push(ray);
  }
}
export const KING_NEIGHBORS = KING_T;
export const KNIGHT_TARGETS = KNIGHT_T;
export const SLIDE_RAYS = RAYS;
const adjacent = (a, b) => Math.max(Math.abs((a & 7) - (b & 7)), Math.abs((a >> 3) - (b >> 3))) === 1;
const CENTER = new Set([27, 28, 35, 36]);

// ---- Zobrist tables (deterministic) ----------------------------------------
function prng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (t ^ (t >>> 14)) | 0;
  };
}
const zr = prng(0x51ed270b);
const ztable = (n) => { const t = new Int32Array(n * 2); for (let i = 0; i < n * 2; i++) t[i] = zr(); return t; };
const ZP = ztable(15 * 64), ZT = ztable(1), ZC = ztable(32), ZE = ztable(8), ZK = ztable(2 * 7 * 17), ZX = ztable(8);

const mk = (from, to, piece, captured, promo, flag) => ({ from, to, piece, captured, promo, flag });

export class Position {
  constructor(variant = 'standard') {
    this.variant = VARIANTS.includes(variant) ? variant : 'standard';
    this.board = new Uint8Array(64);
    this.turn = WHITE;
    this.castle = [-1, -1, -1, -1]; // rook squares for [wK, wQ, bK, bQ]
    this.ep = -1;
    this.half = 0;
    this.full = 1;
    this.kings = [-1, -1];
    const zh = this.variant === 'crazyhouse';
    this.pockets = zh ? [new Uint8Array(7), new Uint8Array(7)] : null;
    this.promoted = zh ? new Uint8Array(64) : null;
    this.checks = this.variant === 'threecheck' ? [0, 0] : null;
    this._legal = null;
  }

  static start(variant = 'standard', chess960Id = 518) {
    if (variant === 'chess960') return Position.fromFen(chess960Fen(chess960Id), 'chess960');
    let fen = START_FEN;
    if (variant === 'crazyhouse') fen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR[] w KQkq - 0 1';
    if (variant === 'threecheck') fen = START_FEN + ' +0+0';
    return Position.fromFen(fen, variant);
  }

  static fromFen(fen, variant = 'standard') {
    const pos = new Position(variant);
    const parts = String(fen).trim().split(/\s+/);
    let boardPart = parts[0] || '';
    let pocket = null;
    const br = boardPart.indexOf('[');
    if (br >= 0) {
      const end = boardPart.indexOf(']');
      pocket = boardPart.slice(br + 1, end < 0 ? undefined : end);
      boardPart = boardPart.slice(0, br);
    }
    const rows = boardPart.split('/');
    if (rows.length === 9) pocket = rows.pop();
    if (rows.length !== 8) throw new Error('Invalid FEN: expected 8 ranks');
    for (let i = 0; i < 8; i++) {
      const r = 7 - i;
      let f = 0;
      for (const ch of rows[i]) {
        if (ch >= '1' && ch <= '8') f += +ch;
        else if (ch === '~') { if (pos.promoted && f > 0) pos.promoted[r * 8 + f - 1] = 1; }
        else {
          const t = LOWER.indexOf(ch.toLowerCase());
          if (t < 1 || f > 7) throw new Error('Invalid FEN: bad piece placement');
          const color = ch === ch.toLowerCase() ? BLACK : WHITE;
          pos.board[r * 8 + f] = t | (color << 3);
          if (t === KING) pos.kings[color] = r * 8 + f;
          f++;
        }
      }
      if (f !== 8) throw new Error('Invalid FEN: rank ' + (r + 1) + ' has wrong width');
    }
    if (pocket && pos.pockets) {
      for (const ch of pocket) {
        const t = LOWER.indexOf(ch.toLowerCase());
        if (t >= PAWN && t <= QUEEN) pos.pockets[ch === ch.toLowerCase() ? BLACK : WHITE][t]++;
      }
    }
    pos.turn = parts[1] === 'b' ? BLACK : WHITE;
    for (const ch of parts[2] || '-') {
      if (ch === '-') continue;
      const color = ch === ch.toUpperCase() ? WHITE : BLACK;
      const base = color === WHITE ? 0 : 56, k = pos.kings[color];
      if (k < 0 || (k >> 3) !== (base >> 3)) continue;
      const rook = ROOK | (color << 3), lc = ch.toLowerCase();
      let rsq = -1;
      if (lc === 'k') { for (let s = base + 7; s > k; s--) if (pos.board[s] === rook) { rsq = s; break; } }
      else if (lc === 'q') { for (let s = base; s < k; s++) if (pos.board[s] === rook) { rsq = s; break; } }
      else if (lc >= 'a' && lc <= 'h') { const s = base + lc.charCodeAt(0) - 97; if (pos.board[s] === rook) rsq = s; }
      if (rsq < 0) continue;
      if (pos.variant !== 'chess960' && ((k & 7) !== 4 || (rsq & 7) !== (rsq > k ? 7 : 0))) continue;
      pos.castle[color * 2 + (rsq > k ? 0 : 1)] = rsq;
    }
    const epSq = parseSq(parts[3] || '-');
    if (epSq >= 0) {
      const them = pos.turn ^ 1;
      const pawnSq = epSq + (pos.turn === WHITE ? -8 : 8);
      const mine = PAWN | (pos.turn << 3);
      const f = pawnSq & 7;
      const rankOk = (epSq >> 3) === (pos.turn === WHITE ? 5 : 2);
      if (rankOk && pos.board[pawnSq] === (PAWN | (them << 3)) && !pos.board[epSq] &&
        ((f > 0 && pos.board[pawnSq - 1] === mine) || (f < 7 && pos.board[pawnSq + 1] === mine))) pos.ep = epSq;
    }
    const nums = [];
    for (let i = 4; i < parts.length; i++) {
      let m;
      if ((m = /^\+(\d)\+(\d)$/.exec(parts[i]))) { if (pos.checks) pos.checks = [+m[1], +m[2]]; }
      else if ((m = /^(\d)\+(\d)$/.exec(parts[i]))) { if (pos.checks) pos.checks = [Math.max(0, 3 - +m[1]), Math.max(0, 3 - +m[2])]; }
      else if (/^\d+$/.test(parts[i])) nums.push(parseInt(parts[i], 10));
    }
    pos.half = nums[0] || 0;
    pos.full = Math.max(1, nums[1] || 1);
    return pos;
  }

  clone() {
    const p = Object.create(Position.prototype);
    p.variant = this.variant;
    p.board = this.board.slice();
    p.turn = this.turn;
    p.castle = this.castle.slice();
    p.ep = this.ep;
    p.half = this.half;
    p.full = this.full;
    p.kings = [this.kings[0], this.kings[1]];
    p.pockets = this.pockets ? [this.pockets[0].slice(), this.pockets[1].slice()] : null;
    p.promoted = this.promoted ? this.promoted.slice() : null;
    p.checks = this.checks ? [this.checks[0], this.checks[1]] : null;
    p._legal = null;
    return p;
  }

  boardFen() {
    let out = '';
    for (let r = 7; r >= 0; r--) {
      let empty = 0;
      for (let f = 0; f < 8; f++) {
        const p = this.board[r * 8 + f];
        if (!p) { empty++; continue; }
        if (empty) { out += empty; empty = 0; }
        out += pieceChar(p);
        if (this.promoted && this.promoted[r * 8 + f]) out += '~';
      }
      if (empty) out += empty;
      if (r) out += '/';
    }
    if (this.pockets) {
      let pk = '';
      for (let c = 0; c < 2; c++) for (let t = QUEEN; t >= PAWN; t--) {
        const ch = c === WHITE ? LETTERS[t] : LOWER[t];
        pk += ch.repeat(this.pockets[c][t]);
      }
      out += '[' + pk + ']';
    }
    return out;
  }

  castleFen() {
    let c = '';
    const names = 'KQkq';
    for (let i = 0; i < 4; i++) {
      if (this.castle[i] < 0) continue;
      if (this.variant === 'chess960') { const ch = FILES[this.castle[i] & 7]; c += i < 2 ? ch.toUpperCase() : ch; }
      else c += names[i];
    }
    return c || '-';
  }

  fen() {
    let s = `${this.boardFen()} ${this.turn === WHITE ? 'w' : 'b'} ${this.castleFen()} ${this.ep >= 0 ? sqName(this.ep) : '-'} ${this.half} ${this.full}`;
    if (this.checks) s += ` +${this.checks[0]}+${this.checks[1]}`;
    return s;
  }

  // Standard-chess view of the position (for engines that only speak chess).
  engineFen() {
    const save = [this.pockets, this.promoted, this.checks];
    this.pockets = null; this.promoted = null; this.checks = null;
    const s = this.fen();
    [this.pockets, this.promoted, this.checks] = save;
    return s;
  }

  hash() {
    let hi = 0, lo = 0;
    const b = this.board;
    for (let s = 0; s < 64; s++) { const p = b[s]; if (p) { const i = (p * 64 + s) * 2; hi ^= ZP[i]; lo ^= ZP[i + 1]; } }
    if (this.turn) { hi ^= ZT[0]; lo ^= ZT[1]; }
    for (let i = 0; i < 4; i++) if (this.castle[i] >= 0) { const j = (i * 8 + (this.castle[i] & 7)) * 2; hi ^= ZC[j]; lo ^= ZC[j + 1]; }
    if (this.ep >= 0) { const j = (this.ep & 7) * 2; hi ^= ZE[j]; lo ^= ZE[j + 1]; }
    if (this.pockets) for (let c = 0; c < 2; c++) for (let t = PAWN; t <= QUEEN; t++) {
      const n = this.pockets[c][t];
      if (n) { const j = ((c * 7 + t) * 17 + Math.min(n, 16)) * 2; hi ^= ZK[j]; lo ^= ZK[j + 1]; }
    }
    if (this.checks) for (let c = 0; c < 2; c++) { const j = (c * 4 + Math.min(this.checks[c], 3)) * 2; hi ^= ZX[j]; lo ^= ZX[j + 1]; }
    return ((hi >>> 0) & 0x1fffff) * 4294967296 + (lo >>> 0);
  }

  isAttacked(s, by) {
    const b = this.board, f = s & 7, r = s >> 3;
    if (by === WHITE) {
      if (r > 0) { if (f > 0 && b[s - 9] === 1) return true; if (f < 7 && b[s - 7] === 1) return true; }
    } else if (r < 7) { if (f > 0 && b[s + 7] === 9) return true; if (f < 7 && b[s + 9] === 9) return true; }
    const kn = KNIGHT | (by << 3);
    for (const t of KNIGHT_T[s]) if (b[t] === kn) return true;
    if (this.variant !== 'atomic') { const kg = KING | (by << 3); for (const t of KING_T[s]) if (b[t] === kg) return true; }
    const rays = RAYS[s];
    for (let d = 0; d < 8; d++) {
      for (const t of rays[d]) {
        const p = b[t];
        if (!p) continue;
        if ((p >> 3) === by) { const ty = p & 7; if (ty === QUEEN || (d < 4 ? ty === ROOK : ty === BISHOP)) return true; }
        break;
      }
    }
    return false;
  }

  // Squares holding pieces of `by` that attack square s (no x-rays).
  attackers(s, by) {
    const out = [], b = this.board, f = s & 7, r = s >> 3;
    if (by === WHITE) {
      if (r > 0) { if (f > 0 && b[s - 9] === 1) out.push(s - 9); if (f < 7 && b[s - 7] === 1) out.push(s - 7); }
    } else if (r < 7) { if (f > 0 && b[s + 7] === 9) out.push(s + 7); if (f < 7 && b[s + 9] === 9) out.push(s + 9); }
    const kn = KNIGHT | (by << 3), kg = KING | (by << 3);
    for (const t of KNIGHT_T[s]) if (b[t] === kn) out.push(t);
    for (const t of KING_T[s]) if (b[t] === kg) out.push(t);
    for (let d = 0; d < 8; d++) {
      for (const t of RAYS[s][d]) {
        const p = b[t];
        if (!p) continue;
        if ((p >> 3) === by) { const ty = p & 7; if (ty === QUEEN || (d < 4 ? ty === ROOK : ty === BISHOP)) out.push(t); }
        break;
      }
    }
    return out;
  }

  inCheck(color = this.turn) {
    const k = this.kings[color];
    if (k < 0) return false;
    if (this.variant === 'atomic') {
      const ok = this.kings[color ^ 1];
      if (ok < 0 || adjacent(k, ok)) return false;
    }
    return this.isAttacked(k, color ^ 1);
  }

  castleTargets(color, flag) {
    const base = color === WHITE ? 0 : 56;
    return flag === F_CASTLE_K ? [base + 6, base + 5] : [base + 2, base + 3];
  }

  pseudoMoves() {
    const out = [], b = this.board, us = this.turn, them = us ^ 1, atomic = this.variant === 'atomic';
    for (let s = 0; s < 64; s++) {
      const p = b[s];
      if (!p || (p >> 3) !== us) continue;
      const t = p & 7;
      if (t === PAWN) {
        const dir = us === WHITE ? 8 : -8, one = s + dir;
        if (one < 0 || one > 63) continue;
        const promoRank = us === WHITE ? 7 : 0, startRank = us === WHITE ? 1 : 6, f = s & 7;
        if (!b[one]) {
          if ((one >> 3) === promoRank) for (let pr = QUEEN; pr >= KNIGHT; pr--) out.push(mk(s, one, PAWN, 0, pr, F_NORMAL));
          else {
            out.push(mk(s, one, PAWN, 0, 0, F_NORMAL));
            if ((s >> 3) === startRank && !b[one + dir]) out.push(mk(s, one + dir, PAWN, 0, 0, F_DOUBLE));
          }
        }
        for (let df = -1; df <= 1; df += 2) {
          const ff = f + df;
          if (ff < 0 || ff > 7) continue;
          const to = one + df, q = b[to];
          if (q) {
            if ((q >> 3) !== them) continue;
            if ((to >> 3) === promoRank) for (let pr = QUEEN; pr >= KNIGHT; pr--) out.push(mk(s, to, PAWN, q & 7, pr, F_NORMAL));
            else out.push(mk(s, to, PAWN, q & 7, 0, F_NORMAL));
          } else if (to === this.ep) out.push(mk(s, to, PAWN, PAWN, 0, F_EP));
        }
      } else if (t === KNIGHT) {
        for (const to of KNIGHT_T[s]) { const q = b[to]; if (!q) out.push(mk(s, to, KNIGHT, 0, 0, 0)); else if ((q >> 3) === them) out.push(mk(s, to, KNIGHT, q & 7, 0, 0)); }
      } else if (t === KING) {
        for (const to of KING_T[s]) { const q = b[to]; if (!q) out.push(mk(s, to, KING, 0, 0, 0)); else if ((q >> 3) === them && !atomic) out.push(mk(s, to, KING, q & 7, 0, 0)); }
      } else {
        const d0 = t === BISHOP ? 4 : 0, d1 = t === ROOK ? 4 : 8, rays = RAYS[s];
        for (let d = d0; d < d1; d++) for (const to of rays[d]) {
          const q = b[to];
          if (!q) out.push(mk(s, to, t, 0, 0, 0));
          else { if ((q >> 3) === them) out.push(mk(s, to, t, q & 7, 0, 0)); break; }
        }
      }
    }
    // castling (generalised for Chess960; king "captures" own rook internally)
    const k = this.kings[us];
    if (k >= 0) for (let side = 0; side < 2; side++) {
      const rsq = this.castle[us * 2 + side];
      if (rsq < 0) continue;
      const flag = side === 0 ? F_CASTLE_K : F_CASTLE_Q;
      const [kTo, rTo] = this.castleTargets(us, flag);
      let ok = true;
      for (let s = Math.min(k, kTo); s <= Math.max(k, kTo) && ok; s++) if (s !== k && s !== rsq && b[s]) ok = false;
      for (let s = Math.min(rsq, rTo); s <= Math.max(rsq, rTo) && ok; s++) if (s !== k && s !== rsq && b[s]) ok = false;
      if (!ok) continue;
      const kp = b[k];
      b[k] = 0;
      for (let s = Math.min(k, kTo); s <= Math.max(k, kTo) && ok; s++) if (this.isAttacked(s, them)) ok = false;
      b[k] = kp;
      if (ok) out.push(mk(k, rsq, KING, 0, 0, flag));
    }
    if (this.pockets) {
      const pk = this.pockets[us];
      for (let t = PAWN; t <= QUEEN; t++) {
        if (!pk[t]) continue;
        for (let s = 0; s < 64; s++) {
          if (b[s]) continue;
          if (t === PAWN && ((s >> 3) === 0 || (s >> 3) === 7)) continue;
          out.push(mk(-1, s, t, 0, 0, F_DROP));
        }
      }
    }
    return out;
  }

  _clearCastleAt(s) {
    const c = this.castle;
    if (c[0] === s) c[0] = -1;
    if (c[1] === s) c[1] = -1;
    if (c[2] === s) c[2] = -1;
    if (c[3] === s) c[3] = -1;
  }

  // Applies a (pseudo-)legal move in place.
  play(m) {
    const b = this.board, us = this.turn, them = us ^ 1;
    const { from, to, flag } = m;
    this._legal = null;
    this.ep = -1;
    this.half++;
    if (flag === F_DROP) {
      b[to] = m.piece | (us << 3);
      this.pockets[us][m.piece]--;
      this.promoted[to] = 0;
      this.half = 0;
    } else if (flag === F_CASTLE_K || flag === F_CASTLE_Q) {
      const [kTo, rTo] = this.castleTargets(us, flag);
      b[from] = 0; b[to] = 0;
      b[kTo] = KING | (us << 3);
      b[rTo] = ROOK | (us << 3);
      this.kings[us] = kTo;
      this.castle[us * 2] = -1; this.castle[us * 2 + 1] = -1;
      if (this.promoted) { this.promoted[from] = 0; this.promoted[to] = 0; this.promoted[kTo] = 0; this.promoted[rTo] = 0; }
    } else {
      const piece = b[from], type = piece & 7;
      let capSq = -1;
      if (flag === F_EP) capSq = to + (us === WHITE ? -8 : 8);
      else if (b[to]) capSq = to;
      if (type === PAWN || capSq >= 0) this.half = 0;
      if (capSq >= 0) {
        if (this.pockets) { this.pockets[us][this.promoted[capSq] ? PAWN : (b[capSq] & 7)]++; this.promoted[capSq] = 0; }
        if ((b[capSq] & 7) === KING) this.kings[them] = -1;
        b[capSq] = 0;
        this._clearCastleAt(capSq);
      }
      b[from] = 0;
      if (this.variant === 'atomic' && capSq >= 0) {
        if (type === KING) this.kings[us] = -1;
        for (const n of KING_T[to]) {
          const q = b[n];
          if (q && (q & 7) !== PAWN) {
            if ((q & 7) === KING) this.kings[q >> 3] = -1;
            b[n] = 0;
            this._clearCastleAt(n);
          }
        }
      } else {
        b[to] = m.promo ? (m.promo | (us << 3)) : piece;
        if (this.promoted) { this.promoted[to] = m.promo ? 1 : this.promoted[from]; this.promoted[from] = 0; }
        if (type === KING) { this.kings[us] = to; this.castle[us * 2] = -1; this.castle[us * 2 + 1] = -1; }
        if (flag === F_DOUBLE) {
          const f = to & 7, ep = them === WHITE ? 1 : 9;
          if ((f > 0 && b[to - 1] === ep) || (f < 7 && b[to + 1] === ep)) this.ep = (from + to) >> 1;
        }
      }
      this._clearCastleAt(from);
    }
    this.turn = them;
    if (us === BLACK) this.full++;
    if (this.checks && this.inCheck()) this.checks[us]++;
    return this;
  }

  // After `us` has just moved: is the resulting position legal for `us`?
  safeFor(us) {
    const k = this.kings[us];
    if (k < 0) return false;
    const them = us ^ 1;
    if (this.variant === 'atomic') {
      const ok = this.kings[them];
      if (ok < 0 || adjacent(k, ok)) return true;
    }
    return !this.isAttacked(k, them);
  }

  moves() {
    if (this._legal) return this._legal;
    const out = [];
    if (this.variantWinner() < 0) {
      const us = this.turn;
      for (const m of this.pseudoMoves()) {
        const c = this.clone();
        c.play(m);
        if (c.safeFor(us)) out.push(m);
      }
    }
    return (this._legal = out);
  }

  after(m) { const c = this.clone(); c.play(m); return c; }

  variantWinner() {
    const v = this.variant;
    if (v === 'atomic') { if (this.kings[WHITE] < 0) return BLACK; if (this.kings[BLACK] < 0) return WHITE; }
    else if (v === 'koth') { if (CENTER.has(this.kings[WHITE])) return WHITE; if (CENTER.has(this.kings[BLACK])) return BLACK; }
    else if (v === 'threecheck') { if (this.checks[WHITE] >= 3) return WHITE; if (this.checks[BLACK] >= 3) return BLACK; }
    return -1;
  }

  materialCount() {
    const n = [new Uint8Array(7), new Uint8Array(7)];
    const light = [0, 0], dark = [0, 0];
    for (let s = 0; s < 64; s++) {
      const p = this.board[s];
      if (!p) continue;
      n[p >> 3][p & 7]++;
      if ((p & 7) === BISHOP) { if (isLightSquare(s)) light[p >> 3]++; else dark[p >> 3]++; }
    }
    return { n, light, dark };
  }

  insufficientMaterial() {
    const v = this.variant;
    if (v === 'crazyhouse' || v === 'koth') return false;
    const { n, light, dark } = this.materialCount();
    const heavy = (c) => n[c][PAWN] + n[c][ROOK] + n[c][QUEEN];
    if (heavy(WHITE) + heavy(BLACK) > 0) return false;
    const minors = n[0][KNIGHT] + n[0][BISHOP] + n[1][KNIGHT] + n[1][BISHOP];
    if (minors === 0) return true;
    if (v === 'threecheck' || v === 'atomic') return false;
    if (minors === 1) return true;
    if (n[0][KNIGHT] + n[1][KNIGHT] === 0) return light[0] + light[1] === 0 || dark[0] + dark[1] === 0;
    return false;
  }

  // Can `color` still theoretically win (used for flag falls)?
  canWin(color) {
    const v = this.variant;
    if (v === 'crazyhouse' || v === 'koth') return true;
    const { n } = this.materialCount();
    const own = n[color], opp = n[color ^ 1];
    const nonKing = own[PAWN] + own[KNIGHT] + own[BISHOP] + own[ROOK] + own[QUEEN];
    if (v === 'threecheck' || v === 'atomic') return nonKing > 0;
    if (own[PAWN] + own[ROOK] + own[QUEEN] > 0) return true;
    const minors = own[KNIGHT] + own[BISHOP];
    if (minors === 0) return false;
    const oppNonKing = opp[PAWN] + opp[KNIGHT] + opp[BISHOP] + opp[ROOK] + opp[QUEEN];
    if (minors === 1) return own[KNIGHT] === 1 ? opp[PAWN] + opp[KNIGHT] + opp[BISHOP] + opp[ROOK] > 0 : opp[PAWN] + opp[KNIGHT] > 0;
    if (own[BISHOP] === 0 && own[KNIGHT] === 2) return oppNonKing > 0;
    return true;
  }

  outcome() {
    const vw = this.variantWinner();
    if (vw >= 0) return { winner: vw, reason: this.variant === 'atomic' ? 'explosion' : this.variant === 'koth' ? 'hill' : 'threecheck' };
    if (this.moves().length === 0) return this.inCheck() ? { winner: this.turn ^ 1, reason: 'checkmate' } : { winner: null, reason: 'stalemate' };
    if (this.insufficientMaterial()) return { winner: null, reason: 'insufficient' };
    if (this.half >= 100) return { winner: null, reason: 'fifty' };
    return null;
  }

  validate() {
    const { n } = this.materialCount();
    if (n[0][KING] !== 1 || n[1][KING] !== 1) return 'Each side needs exactly one king.';
    for (let f = 0; f < 8; f++) if ((this.board[f] & 7) === PAWN || (this.board[56 + f] & 7) === PAWN) return 'Pawns cannot stand on the first or last rank.';
    if (this.variant === 'atomic' && adjacent(this.kings[0], this.kings[1])) return null;
    if (this.isAttacked(this.kings[this.turn ^ 1], this.turn) && this.variant !== 'atomic') return 'The side not to move is in check.';
    return null;
  }

  uci(m) {
    if (m.flag === F_DROP) return LETTERS[m.piece] + '@' + sqName(m.to);
    if (m.flag === F_CASTLE_K || m.flag === F_CASTLE_Q) {
      if (this.variant === 'chess960') return sqName(m.from) + sqName(m.to);
      return sqName(m.from) + sqName(this.castleTargets(m.from >> 3 === 0 ? WHITE : BLACK, m.flag)[0]);
    }
    return sqName(m.from) + sqName(m.to) + (m.promo ? LOWER[m.promo] : '');
  }

  // Square the UI should treat as the king's destination for a castle move.
  castleKingTo(m) { return this.castleTargets(m.from >> 3 === 0 ? WHITE : BLACK, m.flag)[0]; }

  parseUci(u) {
    if (!u || u.length < 4) return null;
    const legal = this.moves();
    if (u[1] === '@') {
      const t = 'PNBRQ'.indexOf(u[0].toUpperCase()) + 1, to = parseSq(u.slice(2, 4));
      return legal.find((m) => m.flag === F_DROP && m.piece === t && m.to === to) || null;
    }
    const from = parseSq(u.slice(0, 2)), to = parseSq(u.slice(2, 4));
    const promo = u.length > 4 ? Math.max(0, LOWER.indexOf(u[4].toLowerCase())) : 0;
    let alt = null;
    for (const m of legal) {
      if (m.from !== from || m.flag === F_DROP) continue;
      if (m.flag === F_CASTLE_K || m.flag === F_CASTLE_Q) {
        if (m.to === to) return m;
        const kTo = this.castleKingTo(m);
        if (kTo === to && (this.variant !== 'chess960' || Math.abs((from & 7) - (kTo & 7)) >= 2)) alt = m;
      } else if (m.to === to && m.promo === promo) return m;
    }
    return alt;
  }

  sanBase(m) {
    if (m.flag === F_CASTLE_K) return 'O-O';
    if (m.flag === F_CASTLE_Q) return 'O-O-O';
    if (m.flag === F_DROP) return (m.piece === PAWN ? '' : LETTERS[m.piece]) + '@' + sqName(m.to);
    let s = '';
    if (m.piece !== PAWN) {
      s = LETTERS[m.piece];
      const others = this.moves().filter((o) => o.piece === m.piece && o.to === m.to && o.from !== m.from && o.flag < F_CASTLE_K);
      if (others.length) {
        const sameFile = others.some((o) => (o.from & 7) === (m.from & 7));
        const sameRank = others.some((o) => (o.from >> 3) === (m.from >> 3));
        if (!sameFile) s += FILES[m.from & 7];
        else if (!sameRank) s += (m.from >> 3) + 1;
        else s += sqName(m.from);
      }
    }
    if (m.captured) { if (m.piece === PAWN) s += FILES[m.from & 7]; s += 'x'; }
    s += sqName(m.to);
    if (m.promo) s += '=' + LETTERS[m.promo];
    return s;
  }

  san(m) {
    const next = this.after(m);
    const out = next.outcome();
    let suffix = '';
    if (out && out.winner !== null) suffix = '#';
    else if (next.inCheck()) suffix = '+';
    return this.sanBase(m) + suffix;
  }

  parseSan(text) {
    let s = String(text).trim().replace(/[+#!?]+$/g, '').replace(/^0-0-0$/, 'O-O-O').replace(/^0-0$/, 'O-O').replace(/\s*e\.p\.$/, '');
    const legal = this.moves();
    if (s === 'O-O' || s === 'O-O-O') {
      const flag = s === 'O-O' ? F_CASTLE_K : F_CASTLE_Q;
      return legal.find((m) => m.flag === flag) || null;
    }
    let m = /^([PNBRQ])?@([a-h][1-8])$/.exec(s);
    if (m) {
      const t = m[1] ? LETTERS.indexOf(m[1]) : PAWN, to = parseSq(m[2]);
      return legal.find((x) => x.flag === F_DROP && x.piece === t && x.to === to) || null;
    }
    m = /^([NBRQK])?([a-h])?([1-8])?[x:-]?([a-h][1-8])(?:=?([NBRQnbrq]))?$/.exec(s);
    if (!m) return null;
    const type = m[1] ? LETTERS.indexOf(m[1]) : PAWN;
    const to = parseSq(m[4]);
    const ff = m[2] ? m[2].charCodeAt(0) - 97 : -1, fr = m[3] ? +m[3] - 1 : -1;
    const promo = m[5] ? LETTERS.indexOf(m[5].toUpperCase()) : 0;
    const cands = legal.filter((x) => x.flag < F_CASTLE_K && x.piece === type && x.to === to && x.promo === promo &&
      (ff < 0 || (x.from & 7) === ff) && (fr < 0 || (x.from >> 3) === fr));
    if (cands.length === 1) return cands[0];
    if (cands.length > 1 && type === PAWN && ff < 0) return cands.find((x) => (x.from & 7) === (to & 7)) || null;
    return null;
  }

  // Static exchange evaluation of the capture sequence on `sq` started by `byColor`
  // (positive = side `byColor` wins material). Used by coach/review heuristics.
  see(sq, byColor) {
    const gain = (pos, color) => {
      const atk = pos.attackers(sq, color);
      if (!atk.length || !pos.board[sq]) return 0;
      let best = -1, bestV = 1e9;
      for (const a of atk) {
        const v = (pos.board[a] & 7) === KING ? 10000 : PIECE_VALUE[pos.board[a] & 7];
        if (v < bestV) { bestV = v; best = a; }
      }
      const victim = PIECE_VALUE[pos.board[sq] & 7];
      const next = pos.clone();
      if ((next.board[best] & 7) === KING && next.attackers(sq, color ^ 1).length) return 0;
      next.board[sq] = next.board[best];
      next.board[best] = 0;
      return Math.max(0, victim - gain(next, color ^ 1));
    };
    return gain(this, byColor);
  }
}

export function chess960Backrank(id) {
  const r = new Array(8).fill('');
  let n = ((id % 960) + 960) % 960;
  r[[1, 3, 5, 7][n % 4]] = 'b'; n = Math.floor(n / 4);
  r[[0, 2, 4, 6][n % 4]] = 'b'; n = Math.floor(n / 4);
  const empties = () => r.map((x, i) => (x ? -1 : i)).filter((i) => i >= 0);
  r[empties()[n % 6]] = 'q'; n = Math.floor(n / 6);
  const kn = [[0, 1], [0, 2], [0, 3], [0, 4], [1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]][n];
  const e = empties();
  r[e[kn[0]]] = 'n'; r[e[kn[1]]] = 'n';
  const rest = empties();
  r[rest[0]] = 'r'; r[rest[1]] = 'k'; r[rest[2]] = 'r';
  return r.join('');
}

export function chess960Fen(id) {
  const back = chess960Backrank(id);
  const files = [...back].map((c, i) => (c === 'r' ? FILES[i] : '')).filter(Boolean);
  const rights = files[1].toUpperCase() + files[0].toUpperCase() + files[1] + files[0];
  return `${back}/pppppppp/8/8/8/8/PPPPPPPP/${back.toUpperCase()} w ${rights} - 0 1`;
}

const REASON_TEXT = {
  checkmate: 'checkmate', stalemate: 'stalemate', insufficient: 'insufficient material', fifty: 'the 50-move rule',
  repetition: 'threefold repetition', explosion: 'king explosion', hill: 'reaching the hill', threecheck: 'three checks',
  resign: 'resignation', timeout: 'timeout', abandon: 'abandonment', agreement: 'agreement', aborted: 'abort',
  'timeout-insufficient': 'timeout vs insufficient material',
};
export const reasonText = (r) => REASON_TEXT[r] || r || '';

// A played game: start position, move records and repetition tracking.
export class Game {
  constructor({ variant = 'standard', fen = null, chess960Id = null } = {}) {
    this.variant = VARIANTS.includes(variant) ? variant : 'standard';
    this.chess960Id = chess960Id;
    this.pos = fen ? Position.fromFen(fen, this.variant) : Position.start(this.variant, chess960Id ?? 518);
    this.startFen = this.pos.fen();
    this.startPly = (this.pos.full - 1) * 2 + (this.pos.turn === BLACK ? 1 : 0);
    this.moves = [];
    this.counts = new Map();
    this._count(this.pos.hash(), 1);
  }

  _count(h, d) { const n = (this.counts.get(h) || 0) + d; if (n <= 0) this.counts.delete(h); else this.counts.set(h, n); }

  get ply() { return this.moves.length; }
  get turn() { return this.pos.turn; }
  get fen() { return this.pos.fen(); }

  // Accepts a UCI string, SAN string or move object. Returns the move record or null.
  play(input) {
    let m = null;
    if (typeof input === 'string') m = this.pos.parseUci(input) || this.pos.parseSan(input);
    else if (input) m = this.pos.moves().find((x) => x.from === input.from && x.to === input.to && x.promo === (input.promo || 0) && x.flag === input.flag && x.piece === input.piece) || null;
    if (!m) return null;
    const uci = this.pos.uci(m), san = this.pos.san(m);
    const color = this.pos.turn;
    this.pos.play(m);
    const hash = this.pos.hash();
    this._count(hash, 1);
    const rec = { uci, san, fen: this.pos.fen(), hash, color, piece: m.piece, captured: m.captured, promo: m.promo, flag: m.flag, from: m.from, to: m.to };
    this.moves.push(rec);
    return rec;
  }

  undo() {
    const rec = this.moves.pop();
    if (!rec) return null;
    this._count(rec.hash, -1);
    const prevFen = this.moves.length ? this.moves[this.moves.length - 1].fen : this.startFen;
    this.pos = Position.fromFen(prevFen, this.variant);
    return rec;
  }

  repetitions() { return this.counts.get(this.pos.hash()) || 0; }

  status() {
    const o = this.pos.outcome();
    if (o) return { over: true, winner: o.winner, reason: o.reason, result: o.winner === null ? '1/2-1/2' : o.winner === WHITE ? '1-0' : '0-1' };
    if (this.repetitions() >= 3) return { over: true, winner: null, reason: 'repetition', result: '1/2-1/2' };
    return { over: false, winner: null, reason: null, result: '*' };
  }

  uciMoves() { return this.moves.map((m) => m.uci); }

  moveText(result = '*') {
    const parts = [];
    let ply = this.startPly;
    this.moves.forEach((m, i) => {
      if (ply % 2 === 0) parts.push(`${ply / 2 + 1}.`);
      else if (i === 0) parts.push(`${(ply - 1) / 2 + 1}...`);
      parts.push(m.san);
      ply++;
    });
    parts.push(result);
    const lines = [];
    let line = '';
    for (const p of parts) {
      if (line.length + p.length + 1 > 80) { lines.push(line); line = p; }
      else line = line ? line + ' ' + p : p;
    }
    if (line) lines.push(line);
    return lines.join('\n');
  }

  pgn(headers = {}) {
    const h = { Event: 'Rookery game', Site: 'Rookery', Date: '????.??.??', Round: '-', White: 'White', Black: 'Black', Result: '*', ...headers };
    if (this.variant !== 'standard') h.Variant = VARIANT_NAMES[this.variant];
    if (this.startFen !== Position.start(this.variant === 'chess960' ? 'standard' : this.variant).fen()) { h.SetUp = '1'; h.FEN = this.startFen; }
    const head = Object.entries(h).filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([k, v]) => `[${k} "${String(v).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`).join('\n');
    return `${head}\n\n${this.moveText(h.Result)}\n`;
  }

  static fromMoves({ variant = 'standard', fen = null, moves = [] }) {
    const g = new Game({ variant, fen });
    for (const u of moves) if (u && !g.play(u)) break;
    return g;
  }
}

export function variantFromName(name) {
  const n = String(name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!n || n === 'standard' || n === 'chess' || n === 'fromposition') return 'standard';
  if (n.includes('960') || n.includes('fischer')) return 'chess960';
  if (n.includes('hill') || n === 'koth') return 'koth';
  if (n.includes('check')) return 'threecheck';
  if (n.includes('crazy') || n === 'zh') return 'crazyhouse';
  if (n.includes('atomic')) return 'atomic';
  return 'standard';
}
