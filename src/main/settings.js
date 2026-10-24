const fs = require('fs');
const path = require('path');
const { defaults } = require('./defaults');

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function deepMerge(base, patch) {
  const out = { ...base };
  for (const [k, v] of Object.entries(patch || {})) {
    if (isObj(v) && isObj(base[k])) out[k] = deepMerge(base[k], v);
    else out[k] = v;
  }
  return out;
}

class SettingsStore {
  constructor(file) {
    this.file = file;
    this.data = deepMerge(defaults(), this._read());
    this._timer = null;
  }

  _read() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (_) {
      return {};
    }
  }

  set(patch) {
    this.data = deepMerge(this.data, patch);
    this.saveSoon();
    return this.data;
  }

  replace(data) {
    this.data = deepMerge(defaults(), data || {});
    this.saveSoon();
    return this.data;
  }

  reset() {
    this.data = defaults();
    this.saveSoon();
    return this.data;
  }

  saveSoon() {
    clearTimeout(this._timer);
    this._timer = setTimeout(() => this.saveNow(), 300);
  }

  saveNow() {
    clearTimeout(this._timer);
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = this.file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.error('Could not save settings:', err);
    }
  }
}

module.exports = { SettingsStore, deepMerge };
