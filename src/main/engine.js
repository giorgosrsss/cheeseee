// Talks to any UCI chess engine (Stockfish by default) running as a child process.
const { spawn } = require('child_process');
const readline = require('readline');
const EventEmitter = require('events');
const path = require('path');

function parseOption(line) {
  const m = line.match(/^option name (.+?) type (\S+)(.*)$/);
  if (!m) return null;
  const opt = { name: m[1], type: m[2] };
  const parts = m[3].split(/ (default|min|max|var)(?= |$)/);
  for (let i = 1; i < parts.length; i += 2) {
    const key = parts[i];
    const value = (parts[i + 1] || '').trim();
    if (key === 'var') (opt.vars = opt.vars || []).push(value);
    else opt[key] = value;
  }
  if (opt.default === '<empty>') opt.default = '';
  if (opt.type === 'spin') {
    opt.default = Number(opt.default);
    opt.min = Number(opt.min);
    opt.max = Number(opt.max);
  } else if (opt.type === 'check') {
    opt.default = opt.default === 'true';
  }
  return opt;
}

function parseInfo(line) {
  const t = line.split(/\s+/);
  const info = {};
  for (let i = 1; i < t.length; i++) {
    const k = t[i];
    switch (k) {
      case 'depth': case 'seldepth': case 'multipv': case 'nodes': case 'nps':
      case 'time': case 'hashfull': case 'tbhits': case 'currmovenumber':
        info[k] = Number(t[++i]);
        break;
      case 'score': {
        const type = t[++i];
        const v = Number(t[++i]);
        info.score = type === 'mate' ? { mate: v } : { cp: v };
        if (t[i + 1] === 'lowerbound' || t[i + 1] === 'upperbound') info.score.bound = t[++i];
        break;
      }
      case 'wdl':
        info.wdl = [Number(t[i + 1]), Number(t[i + 2]), Number(t[i + 3])];
        i += 3;
        break;
      case 'currmove':
        info.currmove = t[++i];
        break;
      case 'pv':
        info.pv = t.slice(i + 1);
        i = t.length;
        break;
      case 'string':
        info.string = t.slice(i + 1).join(' ');
        i = t.length;
        break;
      case 'refutation': case 'currline':
        i = t.length;
        break;
      default:
        break;
    }
  }
  return info;
}

class UciEngine extends EventEmitter {
  constructor(enginePath) {
    super();
    this.path = enginePath;
    this.proc = null;
    this.alive = false;
    this.id = {};
    this.options = [];
    this.searching = false;
    this.stopSent = false;
    this.current = null; // the search the engine is running now
    this.pending = null; // the search to start once the current one stops
    this._waiters = [];
  }

  start(timeoutMs = 15000) {
    return new Promise((resolve, reject) => {
      let proc;
      try {
        proc = spawn(this.path, [], { cwd: path.dirname(this.path), windowsHide: true });
      } catch (err) {
        reject(err);
        return;
      }
      this.proc = proc;
      this.alive = true;
      proc.on('error', (err) => {
        this.alive = false;
        this._rejectWaiters(err);
        this.emit('error', err);
        reject(err);
      });
      proc.on('exit', (code, signal) => {
        const wasAlive = this.alive;
        this.alive = false;
        this.searching = false;
        this._rejectWaiters(new Error(`engine exited (${code ?? signal})`));
        this.emit('exit', { code, signal, unexpected: wasAlive && !this._quitting });
      });
      proc.stdin.on('error', () => {});
      readline.createInterface({ input: proc.stdout }).on('line', (l) => this._onLine(l));
      readline.createInterface({ input: proc.stderr }).on('line', (l) => this.emit('raw', '<' + l));

      this._waitFor((l) => l === 'uciok', timeoutMs)
        .then(() => resolve(this))
        .catch((err) => {
          this.kill();
          reject(new Error(`Not a UCI engine or it did not answer: ${err.message}`));
        });
      this.send('uci');
    });
  }

  send(cmd) {
    if (!this.proc || !this.alive) return;
    this.emit('raw', '>' + cmd);
    this.proc.stdin.write(cmd + '\n');
  }

  _waitFor(match, timeoutMs = 10000) {
    return new Promise((resolve, reject) => {
      const waiter = { match, resolve, reject };
      waiter.timer = setTimeout(() => {
        this._waiters = this._waiters.filter((w) => w !== waiter);
        reject(new Error('timed out'));
      }, timeoutMs);
      this._waiters.push(waiter);
    });
  }

  _rejectWaiters(err) {
    for (const w of this._waiters) {
      clearTimeout(w.timer);
      w.reject(err);
    }
    this._waiters = [];
  }

  _onLine(raw) {
    const line = raw.trim();
    if (!line) return;
    this.emit('raw', '<' + line);

    for (const w of [...this._waiters]) {
      if (w.match(line)) {
        clearTimeout(w.timer);
        this._waiters = this._waiters.filter((x) => x !== w);
        w.resolve(line);
      }
    }

    if (line.startsWith('info ')) {
      // Lines from a search we're replacing are stale, so skip them.
      if (this.current && !this.pending) this.emit('info', this.current.searchId, parseInfo(line));
    } else if (line.startsWith('bestmove')) {
      const [, best, , ponder] = line.split(/\s+/);
      const finished = this.current;
      this.current = null;
      this.searching = false;
      this.stopSent = false;
      if (finished) this.emit('bestmove', finished.searchId, best, ponder);
      if (this.pending) {
        const next = this.pending;
        this.pending = null;
        this._startSearch(next);
      } else {
        this.emit('idle');
      }
    } else if (line.startsWith('id name ')) {
      this.id.name = line.slice(8);
    } else if (line.startsWith('id author ')) {
      this.id.author = line.slice(10);
    } else if (line.startsWith('option ')) {
      const opt = parseOption(line);
      if (opt) this.options.push(opt);
    }
  }

  hasOption(name) {
    return this.options.some((o) => o.name.toLowerCase() === name.toLowerCase());
  }

  setOption(name, value) {
    if (value === undefined || value === null) this.send(`setoption name ${name}`);
    else this.send(`setoption name ${name} value ${value === '' ? '<empty>' : value}`);
  }

  async isReady(timeoutMs = 60000) {
    const p = this._waitFor((l) => l === 'readyok', timeoutMs);
    this.send('isready');
    return p;
  }

  // req: { searchId, fen, moves, limits: { mode, movetime, depth, nodes }, multipv }
  analyze(req) {
    if (this.searching) {
      this.pending = req;
      if (!this.stopSent) {
        this.stopSent = true;
        this.send('stop');
      }
      return;
    }
    this._startSearch(req);
  }

  _startSearch(req) {
    this.current = req;
    this.searching = true;
    this.stopSent = false;
    if (req.multipv && this.hasOption('MultiPV')) this.setOption('MultiPV', req.multipv);
    const moves = req.moves && req.moves.length ? ` moves ${req.moves.join(' ')}` : '';
    this.send(`position fen ${req.fen}${moves}`);
    const l = req.limits || {};
    let go = 'go infinite';
    if (l.mode === 'time') go = `go movetime ${Math.max(10, Math.round(l.movetime || 1000))}`;
    else if (l.mode === 'depth') go = `go depth ${Math.max(1, Math.round(l.depth || 20))}`;
    else if (l.mode === 'nodes') go = `go nodes ${Math.max(1, Math.round(l.nodes || 1e6))}`;
    this.send(go);
  }

  stop() {
    this.pending = null;
    if (this.searching && !this.stopSent) {
      this.stopSent = true;
      this.send('stop');
    }
  }

  stopAndWait() {
    this.pending = null;
    if (!this.searching) return Promise.resolve();
    const p = new Promise((resolve) => {
      const done = () => {
        this.off('exit', done);
        resolve();
      };
      this.once('idle', done);
      this.once('exit', done);
    });
    this.stop();
    return p;
  }

  quit() {
    if (!this.proc) return;
    this._quitting = true;
    try {
      if (this.searching) this.send('stop');
      this.send('quit');
    } catch (_) { /* ignore */ }
    const proc = this.proc;
    setTimeout(() => {
      try { if (proc.exitCode === null) proc.kill(); } catch (_) { /* ignore */ }
    }, 800);
  }

  kill() {
    this._quitting = true;
    try { this.proc && this.proc.kill(); } catch (_) { /* ignore */ }
  }
}

module.exports = { UciEngine, parseOption, parseInfo };
