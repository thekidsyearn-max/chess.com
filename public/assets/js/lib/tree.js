// Analysis move tree: nested variations, comments and NAGs, with PGN round-tripping.
import { Position, START_FEN, VARIANT_NAMES, variantFromName } from '../chess/chess.js';
import { parsePgn, writePgn } from '../chess/pgn.js';

let nextId = 1;

export class Tree {
  constructor(variant = 'standard', fen = null) {
    this.variant = variant;
    const pos = fen ? Position.fromFen(fen, variant) : Position.start(variant);
    this.startFen = pos.fen();
    this.root = { id: 0, parent: null, uci: null, san: null, fen: this.startFen, ply: (pos.full - 1) * 2 + pos.turn, children: [], comment: '', nags: [] };
    this.cur = this.root;
    this.headers = {};
  }

  pos(node = this.cur) { return Position.fromFen(node.fen, this.variant); }

  // Plays a move (move object, UCI or SAN) from `from`; reuses an existing child if present.
  add(input, from = this.cur, select = true) {
    const pos = this.pos(from);
    const m = typeof input === 'string' ? pos.parseUci(input) || pos.parseSan(input) : pos.moves().find((x) => x.from === input.from && x.to === input.to && x.promo === input.promo && x.flag === input.flag && x.piece === input.piece);
    if (!m) return null;
    const uci = pos.uci(m);
    let node = from.children.find((c) => c.uci === uci);
    if (!node) {
      const san = pos.san(m);
      const next = pos.after(m);
      node = { id: nextId++, parent: from, uci, san, fen: next.fen(), ply: from.ply + 1, children: [], comment: '', nags: [], from: m.from, to: m.to, flag: m.flag, captured: m.captured };
      from.children.push(node);
    }
    if (select) this.cur = node;
    return node;
  }

  goto(node) { if (node) this.cur = node; }
  back() { if (this.cur.parent) this.cur = this.cur.parent; }
  forward() { if (this.cur.children[0]) this.cur = this.cur.children[0]; }
  start() { this.cur = this.root; }
  end() { while (this.cur.children[0]) this.cur = this.cur.children[0]; }

  isAncestor(a, node) { for (let n = node; n; n = n.parent) if (n === a) return true; return false; }

  remove(node) {
    if (!node.parent) return;
    const p = node.parent;
    if (this.isAncestor(node, this.cur)) this.cur = p;
    p.children.splice(p.children.indexOf(node), 1);
  }

  // Moves the variation containing `node` one step towards the main line.
  promote(node) {
    for (let n = node; n.parent; n = n.parent) {
      const sibs = n.parent.children, i = sibs.indexOf(n);
      if (i > 0) { sibs.splice(i, 1); sibs.splice(i - 1, 0, n); return true; }
    }
    return false;
  }

  path(node = this.cur) { const out = []; for (let n = node; n.parent; n = n.parent) out.unshift(n); return out; }
  mainline() { const out = []; for (let n = this.root.children[0]; n; n = n.children[0]) out.push(n); return out; }

  toPgn(extraHeaders = {}) {
    const entry = (n) => ({ san: n.san, nags: n.nags, comment: n.comment, variations: [] });
    const build = (parent) => {
      if (!parent.children.length) return [];
      const [main, ...alts] = parent.children;
      const e = entry(main);
      e.variations = alts.map((a) => [entry(a), ...build(a)]);
      return [e, ...build(main)];
    };
    const headers = { ...this.headers, ...extraHeaders };
    if (this.variant !== 'standard') headers.Variant = VARIANT_NAMES[this.variant];
    const def = Position.start(this.variant === 'chess960' ? 'standard' : this.variant).fen();
    if (this.startFen !== def && this.startFen !== START_FEN) { headers.SetUp = '1'; headers.FEN = this.startFen; }
    if (this.root.comment && this.root.children[0]) { /* a comment before the first move */ }
    const moves = build(this.root);
    if (this.root.comment && moves[0]) moves[0].pre = this.root.comment;
    return writePgn(headers, moves, this.root.ply);
  }

  static fromPgn(text, fallbackVariant = 'standard') {
    const parsed = parsePgn(text);
    const variant = parsed.headers.Variant ? variantFromName(parsed.headers.Variant) : fallbackVariant;
    const tree = new Tree(variant, parsed.headers.FEN || null);
    tree.headers = { ...parsed.headers };
    delete tree.headers.FEN; delete tree.headers.SetUp; delete tree.headers.Variant;
    let bad = null, count = 0;
    const walk = (parent, list) => {
      let node = parent;
      for (const m of list) {
        const child = tree.add(m.san, node, false);
        if (!child) { bad = bad || m.san; return; }
        count++;
        if (m.comment) child.comment = m.comment;
        if (m.nags && m.nags.length) child.nags = [...new Set([...child.nags, ...m.nags])];
        if (m.pre && node === tree.root) tree.root.comment = m.pre;
        for (const v of m.variations || []) walk(node, v);
        node = child;
      }
    };
    walk(tree.root, parsed.moves);
    tree.cur = tree.root;
    return { tree, error: bad ? `Stopped at an unreadable move: ${bad}` : null, count };
  }

  static fromMoves(variant, fen, ucis) {
    const tree = new Tree(variant, fen);
    for (const u of ucis) if (!tree.add(u)) break;
    return tree;
  }
}
