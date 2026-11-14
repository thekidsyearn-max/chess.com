// Bounded Stockfish UCI process pool.
//  * at most `maxProcesses` (hard cap 2) engine processes, spawned lazily
//  * every process: Hash 32 MB, Threads 1
//  * jobs run through a single async FIFO queue; idle processes are reaped
import { spawn } from 'node:child_process';
import { config } from './config.js';

const MATE_CP = 100_000;
export const scoreToCp = (l) => (l.mate != null ? (l.mate > 0 ? MATE_CP - l.mate * 100 : -MATE_CP - l.mate * 100) : l.cp ?? 0);

class Engine {
  constructor(pool, id) {
    this.pool = pool;
    this.id = id;
    this.proc = null;
    this.ready = false;
    this.dead = false;
    this.job = null;
    this.options = new Map();
    this.current = new Map();
    this.buf = '';
    this.onLine = null;
    this.idleTimer = null;
    this.name = 'Stockfish';
  }

  start() {
    return new Promise((resolve, reject) => {
      let settled = false;
      const fail = (err) => { if (!settled) { settled = true; reject(err); } this._die(err); };
      try {
        this.proc = spawn(this.pool.path, [], { stdio: ['pipe', 'pipe', 'ignore'] });
      } catch (e) { fail(e); return; }
      this.proc.on('error', fail);
      this.proc.on('exit', (code) => fail(new Error('stockfish exited with code ' + code)));
      this.proc.stdin.on('error', () => {});
      this.proc.stdout.setEncoding('utf8');
      this.proc.stdout.on('data', (d) => this._data(d));
      const timer = setTimeout(() => fail(new Error('stockfish handshake timed out')), 15_000);
      this.onLine = (line) => {
        if (line.startsWith('id name ')) this.name = line.slice(8).trim();
        else if (line.startsWith('option name ')) {
          const m = /^option name (.+?) type (\w+)(?: default (\S*))?(?: min (-?\d+))?(?: max (-?\d+))?/.exec(line);
          if (m) this.options.set(m[1], { type: m[2], min: m[4] != null ? +m[4] : null, max: m[5] != null ? +m[5] : null });
        } else if (line === 'uciok') {
          this.setOpt('Hash', this.pool.hashMb);
          this.setOpt('Threads', this.pool.threads);
          this.send('isready');
        } else if (line === 'readyok') {
          clearTimeout(timer);
          this.ready = true;
          this.onLine = (l) => this._jobLine(l);
          settled = true;
          resolve(this);
        }
      };
      this.send('uci');
    });
  }

  send(line) { if (this.proc && !this.dead) this.proc.stdin.write(line + '\n'); }

  setOpt(name, value) {
    const def = this.options.get(name);
    if (!def) return false; // option not offered by this Stockfish build
    let v = value;
    if (def.type === 'spin') v = Math.round(Math.max(def.min ?? -Infinity, Math.min(def.max ?? Infinity, Number(value))));
    v = String(v);
    if (this.current.get(name) === v) return true;
    this.current.set(name, v);
    this.send(`setoption name ${name} value ${v}`);
    return true;
  }

  _data(chunk) {
    this.buf += chunk;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const line = this.buf.slice(0, i).trim();
      this.buf = this.buf.slice(i + 1);
      if (line && this.onLine) this.onLine(line);
    }
  }

  run(job) {
    clearTimeout(this.idleTimer);
    this.job = job;
    job.engine = this;
    job.startedAt = Date.now();
    const o = job.opts;
    this.setOpt('MultiPV', o.multipv || 1);
    this.setOpt('UCI_Chess960', o.chess960 ? 'true' : 'false');
    this.setOpt('UCI_LimitStrength', o.limitStrength ? 'true' : 'false');
    if (o.limitStrength && o.elo) this.setOpt('UCI_Elo', o.elo);
    this.setOpt('Skill Level', o.skill ?? 20);
    if (o.contempt != null) this.setOpt('Contempt', o.contempt);
    this.setOpt('Move Overhead', o.moveOverhead ?? 10);
    if (o.newGame) this.send('ucinewgame');
    this.send(`position fen ${o.fen}${o.moves && o.moves.length ? ' moves ' + o.moves.join(' ') : ''}`);
    const go = ['go'];
    if (o.depth) go.push('depth', o.depth);
    if (o.nodes) go.push('nodes', o.nodes);
    if (o.movetime) go.push('movetime', o.movetime);
    if (go.length === 1) go.push('depth', 12);
    if (o.searchmoves && o.searchmoves.length) go.push('searchmoves', ...o.searchmoves);
    this.send(go.join(' '));
    const hard = (o.movetime || 0) + (o.hardTimeoutMs || 20_000);
    job.timer = setTimeout(() => this.send('stop'), hard);
    job.killTimer = setTimeout(() => this._die(new Error('stockfish stopped responding')), hard + 5_000);
    if (job.cancelled) this.send('stop');
  }

  _jobLine(line) {
    const job = this.job;
    if (!job) return;
    if (line.startsWith('info ') && line.includes(' pv ')) {
      const t = line.split(' ');
      const info = { multipv: 1 };
      for (let i = 1; i < t.length; i++) {
        switch (t[i]) {
          case 'depth': info.depth = +t[++i]; break;
          case 'seldepth': info.seldepth = +t[++i]; break;
          case 'multipv': info.multipv = +t[++i]; break;
          case 'nodes': info.nodes = +t[++i]; break;
          case 'nps': info.nps = +t[++i]; break;
          case 'time': info.time = +t[++i]; break;
          case 'score': {
            const kind = t[++i], val = +t[++i];
            if (kind === 'mate') info.mate = val; else info.cp = val;
            if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') info.bound = t[++i];
            break;
          }
          case 'pv': info.pv = t.slice(i + 1); i = t.length; break;
          default: break;
        }
      }
      if (!info.pv || !info.pv.length || info.bound) return;
      job.lines[info.multipv - 1] = info;
      if (job.opts.onInfo) { try { job.opts.onInfo(job.lines.filter(Boolean), info); } catch { /* listener error */ } }
    } else if (line.startsWith('bestmove')) {
      const parts = line.split(' ');
      this._finish({ bestmove: parts[1] && parts[1] !== '(none)' ? parts[1] : null, ponder: parts[3] || null });
    }
  }

  _finish(extra) {
    const job = this.job;
    if (!job) return;
    this.job = null;
    clearTimeout(job.timer);
    clearTimeout(job.killTimer);
    const lines = job.lines.filter(Boolean);
    job.resolve({ ...extra, lines, cancelled: !!job.cancelled, engine: this.name, ms: Date.now() - job.startedAt });
    this.idleTimer = setTimeout(() => { if (!this.job) this._die(null); }, this.pool.idleKillMs);
    this.pool._pump();
  }

  _die(err) {
    if (this.dead) return;
    this.dead = true;
    this.ready = false;
    clearTimeout(this.idleTimer);
    const job = this.job;
    this.job = null;
    if (job) { clearTimeout(job.timer); clearTimeout(job.killTimer); job.reject(err || new Error('stockfish terminated')); }
    try { this.proc?.stdin.end('quit\n'); } catch { /* already closed */ }
    const p = this.proc;
    if (p) setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* gone */ } }, 500).unref();
    this.pool._remove(this);
  }
}

export class StockfishPool {
  constructor(opts = config.stockfish) {
    this.path = opts.path;
    this.max = Math.min(2, opts.maxProcesses || 2);
    this.hashMb = Math.min(32, opts.hashMb || 32);
    this.threads = 1;
    this.idleKillMs = opts.idleKillMs || 90_000;
    this.engines = [];
    this.starting = 0;
    this.queue = [];
    this.nextId = 1;
    this.engineName = null;
    this.failures = 0;
    this.completed = 0;
  }

  get available() { return !!this.path && this.failures < 5; }

  /**
   * Queue a search. opts: { fen, moves?, multipv?, depth?, nodes?, movetime?, chess960?, limitStrength?, elo?, skill?,
   *   contempt?, moveOverhead?, searchmoves?, onInfo?, preemptible?, newGame? }
   * Resolves { bestmove, ponder, lines: [{multipv, depth, cp|mate, pv, nodes, nps}], cancelled }.
   * Scores are from the side to move. The returned promise has a .cancel() method.
   */
  analyse(opts) {
    let job;
    const promise = new Promise((resolve, reject) => {
      job = { opts, resolve, reject, lines: [], cancelled: false, engine: null, queuedAt: Date.now() };
    });
    promise.cancel = () => {
      if (job.cancelled) return;
      job.cancelled = true;
      const i = this.queue.indexOf(job);
      if (i >= 0) { this.queue.splice(i, 1); job.resolve({ bestmove: null, ponder: null, lines: [], cancelled: true }); }
      else if (job.engine && job.engine.job === job) job.engine.send('stop');
    };
    if (!this.available) { job.reject(new Error('Stockfish is not available')); return promise; }
    this.queue.push(job);
    this._pump();
    return promise;
  }

  _pump() {
    while (this.queue.length) {
      const idle = this.engines.find((e) => e.ready && !e.job);
      if (idle) { idle.run(this.queue.shift()); continue; }
      if (this.engines.length + this.starting < this.max) { this._spawn(); }
      else this._preempt();
      break;
    }
  }

  // A long-running interactive analysis yields to waiting jobs.
  _preempt() {
    let victim = null;
    for (const e of this.engines) {
      const j = e.job;
      if (j && j.opts.preemptible && !j.cancelled && Date.now() - j.startedAt > 700 && (!victim || j.startedAt < victim.job.startedAt)) victim = e;
    }
    if (victim) { victim.job.preempted = true; victim.send('stop'); }
  }

  _spawn() {
    this.starting++;
    const e = new Engine(this, this.nextId++);
    e.start().then(() => {
      this.starting--;
      this.failures = 0;
      this.engineName = e.name;
      this.engines.push(e);
      this._pump();
    }).catch((err) => {
      this.starting--;
      this.failures++;
      if (this.engines.length + this.starting === 0) {
        // nothing can serve the queue: fail waiting jobs instead of hanging
        for (const j of this.queue.splice(0)) j.reject(err);
      }
    });
  }

  _remove(engine) {
    const i = this.engines.indexOf(engine);
    if (i >= 0) this.engines.splice(i, 1);
    if (this.queue.length) this._pump();
  }

  stats() {
    return {
      available: this.available, path: this.path, engine: this.engineName, processes: this.engines.length + this.starting,
      busy: this.engines.filter((e) => e.job).length, queued: this.queue.length, maxProcesses: this.max, hashMb: this.hashMb, threads: this.threads,
      pids: this.engines.map((e) => e.proc?.pid).filter(Boolean),
    };
  }

  shutdown() {
    for (const j of this.queue.splice(0)) j.resolve({ bestmove: null, ponder: null, lines: [], cancelled: true });
    for (const e of [...this.engines]) e._die(null);
  }
}

export const stockfish = new StockfishPool();
