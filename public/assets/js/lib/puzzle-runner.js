// Drives one puzzle on a Board: checks the solver's moves, plays the opponent's replies,
// and reports the outcome. Shared by rated puzzles, Puzzle Rush and Puzzle Battle.
import { Position, WHITE, parseSq } from '../chess/chess.js';
import { playMove, play } from './sound.js';

const lastOf = (uci) => (uci && uci[1] !== '@' ? [parseSq(uci.slice(0, 2)), parseSq(uci.slice(2, 4))] : uci ? [parseSq(uci.slice(2, 4)), parseSq(uci.slice(2, 4))] : null);

export class PuzzleRunner {
  /** hooks: onSolved(played), onFailed(played, wrongUci), onStep(index) */
  constructor(board, hooks = {}) {
    this.board = board;
    this.hooks = hooks;
    this.puzzle = null;
    this.timer = null;
    board.opts.onMove = (m) => this.userMove(m);
  }

  load(puzzle, { animateIn = true } = {}) {
    clearTimeout(this.timer);
    this.puzzle = puzzle;
    this.index = 0;
    this.played = [];
    this.done = false;
    this.hinted = 0;
    this.pos = Position.fromFen(puzzle.fen, 'standard');
    this.solver = this.pos.turn === WHITE ? 'w' : 'b';
    this.board.setOrientation(this.solver);
    this.board.setMarks([]);
    this.board.setAutoShapes([]);
    this.board.set(this.pos, { lastMove: lastOf(puzzle.lastMove), animate: animateIn });
    this.board.setViewOnly(false);
    this.board.setMovable({ color: this.solver });
  }

  get solverMoves() { return Math.ceil(this.puzzle.moves.length / 2); }
  get expected() { return this.puzzle.moves[this.index]; }

  userMove(m) {
    if (this.done || !this.puzzle) return;
    const uci = this.pos.uci(m);
    const next = this.pos.after(m);
    this.played.push(uci);
    const want = this.pos.parseUci(this.expected);
    const o = next.outcome();
    const correct = m === want || (want && m.from === want.from && m.to === want.to && m.promo === want.promo) || (o && o.reason === 'checkmate');
    this.board.setMarks([]);
    this.board.setAutoShapes([]);
    if (!correct) {
      this.done = true;
      this.board.set(next, { lastMove: [m.from >= 0 ? m.from : m.to, m.to] });
      this.board.setMarks([{ sq: m.to, cls: 'bad' }]);
      this.board.setViewOnly(true);
      play('illegal');
      if (this.hooks.onFailed) this.hooks.onFailed(this.played, uci);
      return;
    }
    playMove({ san: this.pos.san(m), captured: m.captured, promo: m.promo }, true);
    this.pos = next;
    this.board.set(next, { lastMove: [m.from >= 0 ? m.from : m.to, m.to] });
    this.index++;
    if (this.index >= this.puzzle.moves.length || (o && o.reason === 'checkmate')) {
      this.done = true;
      this.board.setMarks([{ sq: m.to, cls: 'good' }]);
      this.board.setViewOnly(true);
      if (this.hooks.onSolved) this.hooks.onSolved(this.played);
      return;
    }
    if (this.hooks.onStep) this.hooks.onStep(this.index);
    // opponent's reply
    this.board.setMovable({ color: null });
    this.timer = setTimeout(() => {
      const reply = this.pos.parseUci(this.expected);
      if (!reply) return;
      playMove({ san: this.pos.san(reply), captured: reply.captured, promo: reply.promo }, false);
      this.pos = this.pos.after(reply);
      this.index++;
      this.board.set(this.pos, { lastMove: [reply.from >= 0 ? reply.from : reply.to, reply.to] });
      this.board.setMovable({ color: this.solver });
    }, 380);
  }

  // first call highlights the piece, second call shows the move
  hint() {
    if (this.done || !this.puzzle) return 0;
    const m = this.pos.parseUci(this.expected);
    if (!m) return 0;
    this.hinted = Math.min(2, this.hinted + 1);
    if (this.hinted === 1) this.board.setMarks([{ sq: m.from >= 0 ? m.from : m.to, cls: 'hint' }]);
    else { this.board.setMarks([{ sq: m.from, cls: 'hint' }, { sq: m.to, cls: 'hint' }]); this.board.setAutoShapes([{ from: m.from, to: m.to, color: 'hint' }]); }
    return this.hinted;
  }

  // plays out the remaining solution (after a failure or on request)
  showSolution(fromStart = true) {
    clearTimeout(this.timer);
    if (fromStart) { this.pos = Position.fromFen(this.puzzle.fen, 'standard'); this.index = 0; this.board.set(this.pos, { lastMove: lastOf(this.puzzle.lastMove), animate: false }); }
    this.done = true;
    this.board.setMarks([]);
    this.board.setAutoShapes([]);
    this.board.setViewOnly(true);
    const step = () => {
      if (this.index >= this.puzzle.moves.length) return;
      const m = this.pos.parseUci(this.puzzle.moves[this.index]);
      if (!m) return;
      playMove({ san: this.pos.san(m), captured: m.captured, promo: m.promo }, this.index % 2 === 0);
      this.pos = this.pos.after(m);
      this.index++;
      this.board.set(this.pos, { lastMove: [m.from >= 0 ? m.from : m.to, m.to] });
      this.timer = setTimeout(step, 750);
    };
    this.timer = setTimeout(step, 400);
  }

  stop() { clearTimeout(this.timer); this.done = true; this.board.setViewOnly(true); }
  destroy() { clearTimeout(this.timer); }
}
