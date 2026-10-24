// Owns the running engine, applies saved options, and batches its output for the window.
const path = require('path');
const fs = require('fs');
const { app } = require('electron');
const { UciEngine } = require('./engine');
const { defaultThreads, defaultHash } = require('./defaults');

const FLUSH_MS = 70;
const RAW_FLUSH_MS = 120;

function builtinEnginePath() {
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', '..');
  return path.join(base, 'engines', 'stockfish', 'stockfish.exe');
}

class EngineManager {
  constructor(store, send) {
    this.store = store;
    this.send = send; // (channel, payload) => void
    this.engine = null;
    this.starting = null;
    this.activeSearchId = null;
    this.buf = null;
    this.flushTimer = null;
    this.rawBuf = [];
    this.rawTimer = null;
    this.state = { state: 'idle' };
  }

  get cfg() {
    const e = this.store.data.engine;
    return e.list.find((x) => x.id === e.selected) || e.list[0];
  }

  enginePath(cfg) {
    return cfg.builtin ? builtinEnginePath() : cfg.path;
  }

  computedDefaults() {
    return { Threads: defaultThreads(), Hash: defaultHash() };
  }

  overrides(cfg = this.cfg) {
    return { ...this.computedDefaults(), ...(this.store.data.engine.options[cfg.id] || {}) };
  }

  status(s) {
    this.state = { ...s };
    this.send('engine:status', this.state);
  }

  info() {
    const eng = this.engine;
    const cfg = this.cfg;
    const ov = this.overrides(cfg);
    return {
      ...this.state,
      id: cfg.id,
      configName: cfg.name,
      builtin: !!cfg.builtin,
      path: this.enginePath(cfg),
      name: eng?.id.name || cfg.name,
      author: eng?.id.author || '',
      options: (eng?.options || []).map((o) => {
        const key = Object.keys(ov).find((k) => k.toLowerCase() === o.name.toLowerCase());
        return { ...o, value: key !== undefined && ov[key] !== null ? ov[key] : o.default, overridden: key !== undefined };
      }),
      list: this.store.data.engine.list.map(({ id, name, builtin }) => ({ id, name, builtin: !!builtin })),
      selected: this.store.data.engine.selected,
    };
  }

  async ensure() {
    if (this.engine && this.engine.alive) return this.engine;
    if (this.starting) return this.starting;
    this.starting = this._start();
    try {
      return await this.starting;
    } finally {
      this.starting = null;
    }
  }

  async _start() {
    const cfg = this.cfg;
    const p = this.enginePath(cfg);
    this.status({ state: 'starting', name: cfg.name });
    if (!fs.existsSync(p)) {
      this.status({ state: 'error', name: cfg.name, message: `Engine file not found: ${p}` });
      throw new Error('engine missing');
    }
    const eng = new UciEngine(p);
    eng.on('raw', (line) => this._raw(line));
    eng.on('info', (searchId, info) => this._info(searchId, info));
    eng.on('bestmove', (searchId, best, ponder) => this._bestmove(searchId, best, ponder));
    eng.on('exit', ({ code, unexpected }) => {
      if (this.engine === eng) this.engine = null;
      if (unexpected) {
        this.status({ state: 'error', name: cfg.name, message: `Engine stopped unexpectedly (code ${code}). It will restart on the next analysis.` });
        if (this.activeSearchId !== null) {
          this.send('engine:bestmove', { searchId: this.activeSearchId, bestmove: null, error: true });
        }
      }
    });
    try {
      await eng.start();
      await this._applyOptions(eng, cfg);
    } catch (err) {
      eng.kill();
      this.status({ state: 'error', name: cfg.name, message: err.message });
      throw err;
    }
    this.engine = eng;
    this.status({ state: 'ready', name: eng.id.name || cfg.name, author: eng.id.author || '' });
    return eng;
  }

  async _applyOptions(eng, cfg) {
    for (const [name, value] of Object.entries(this.overrides(cfg))) {
      if (value === null || value === undefined || name === 'MultiPV') continue;
      const opt = eng.options.find((o) => o.name.toLowerCase() === name.toLowerCase());
      if (!opt || opt.type === 'button') continue;
      let v = value;
      if (opt.type === 'spin') v = Math.min(opt.max, Math.max(opt.min, Number(value)));
      eng.setOption(opt.name, v);
    }
    await eng.isReady();
  }

  async analyze(req) {
    this.activeSearchId = req.searchId;
    this.buf = { searchId: req.searchId, lines: {}, stats: {} };
    let eng;
    try {
      eng = await this.ensure();
    } catch (_) {
      this.send('engine:bestmove', { searchId: req.searchId, bestmove: null, error: true });
      return;
    }
    if (this.activeSearchId !== req.searchId) return; // superseded while starting
    if (this.state.state !== 'ready') this.status({ ...this.state, state: 'ready' });
    eng.analyze(req);
  }

  stop() {
    if (this.engine) this.engine.stop();
  }

  _info(searchId, info) {
    if (searchId !== this.activeSearchId || !this.buf) return;
    const b = this.buf;
    if (info.pv && info.pv.length && info.score) b.lines[info.multipv || 1] = info;
    for (const k of ['depth', 'seldepth', 'nodes', 'nps', 'time', 'hashfull', 'tbhits', 'currmove', 'currmovenumber']) {
      if (info[k] !== undefined) b.stats[k] = info[k];
    }
    if (info.string) b.stats.string = info.string;
    if (!this.flushTimer) this.flushTimer = setTimeout(() => this._flush(), FLUSH_MS);
  }

  _flush() {
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
    const b = this.buf;
    if (!b || b.searchId !== this.activeSearchId) return;
    const lines = Object.keys(b.lines)
      .map(Number)
      .sort((a, c) => a - c)
      .map((k) => b.lines[k]);
    this.send('engine:update', { searchId: b.searchId, lines, stats: b.stats });
  }

  _bestmove(searchId, bestmove, ponder) {
    if (searchId !== this.activeSearchId) return;
    this._flush();
    this.send('engine:bestmove', { searchId, bestmove, ponder });
  }

  _raw(line) {
    this.rawBuf.push(line);
    if (this.rawBuf.length > 600) this.rawBuf.splice(0, this.rawBuf.length - 600);
    if (!this.rawTimer) {
      this.rawTimer = setTimeout(() => {
        this.rawTimer = null;
        const lines = this.rawBuf;
        this.rawBuf = [];
        this.send('engine:raw', lines);
      }, RAW_FLUSH_MS);
    }
  }

  // Commands typed in the console. Searches started here are tracked so they
  // don't collide with the app's own searches.
  async sendRaw(cmd) {
    const eng = await this.ensure();
    if (/^quit\b/.test(cmd)) {
      this.shutdown();
      this.status({ state: 'idle', name: this.cfg.name, message: 'Engine stopped from the console' });
      return;
    }
    if (/^stop\b/.test(cmd)) {
      eng.stop();
      return;
    }
    if (/^(go|position|setoption|ucinewgame)\b/.test(cmd)) {
      this.activeSearchId = null;
      await eng.stopAndWait();
    }
    if (/^go\b/.test(cmd)) {
      eng.current = { searchId: 'console' };
      eng.searching = true;
      eng.stopSent = false;
    }
    eng.send(cmd);
  }

  async setOption(name, value) {
    const cfg = this.cfg;
    const all = { ...this.store.data.engine.options };
    all[cfg.id] = { ...(all[cfg.id] || {}), [name]: value };
    this.store.set({ engine: { options: all } });
    const eng = this.engine;
    if (eng && eng.alive) {
      await eng.stopAndWait();
      const opt = eng.options.find((o) => o.name.toLowerCase() === name.toLowerCase());
      if (opt) {
        if (opt.type === 'button') eng.setOption(opt.name);
        else eng.setOption(opt.name, value);
        await eng.isReady().catch(() => {});
      }
    }
    return this.info();
  }

  async pressButton(name) {
    const eng = await this.ensure();
    await eng.stopAndWait();
    eng.setOption(name);
    await eng.isReady().catch(() => {});
    return this.info();
  }

  async resetOptions() {
    const cfg = this.cfg;
    const all = { ...this.store.data.engine.options };
    delete all[cfg.id];
    this.store.data.engine.options = all;
    this.store.saveSoon();
    await this.restart();
    return this.info();
  }

  async restart() {
    this.shutdown();
    try {
      await this.ensure();
    } catch (_) { /* status already reported */ }
    return this.info();
  }

  async select(id) {
    if (!this.store.data.engine.list.some((e) => e.id === id)) return this.info();
    this.store.set({ engine: { selected: id } });
    return this.restart();
  }

  async probe(enginePath) {
    const eng = new UciEngine(enginePath);
    try {
      await eng.start(10000);
      const name = eng.id.name || path.basename(enginePath, path.extname(enginePath));
      return { name, author: eng.id.author || '' };
    } finally {
      eng.quit();
    }
  }

  async add(enginePath) {
    const { name } = await this.probe(enginePath);
    const id = 'engine-' + Date.now().toString(36);
    const list = [...this.store.data.engine.list, { id, name, path: enginePath }];
    this.store.set({ engine: { list, selected: id } });
    return this.restart();
  }

  async remove(id) {
    const e = this.store.data.engine;
    const target = e.list.find((x) => x.id === id);
    if (!target || target.builtin) return this.info();
    const list = e.list.filter((x) => x.id !== id);
    const options = { ...e.options };
    delete options[id];
    const selected = e.selected === id ? list[0].id : e.selected;
    this.store.data.engine = { ...e, list, options, selected };
    this.store.saveSoon();
    if (e.selected === id) return this.restart();
    return this.info();
  }

  shutdown() {
    if (this.engine) {
      this.engine.quit();
      this.engine = null;
    }
  }
}

module.exports = { EngineManager, builtinEnginePath };
