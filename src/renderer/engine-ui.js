// Builds the Engine tab from the options the running engine reports.
import { h, icon } from './dom.js';

const COMMON = ['Threads', 'Hash', 'Skill Level', 'UCI_LimitStrength', 'UCI_Elo', 'SyzygyPath', 'UCI_ShowWDL', 'Move Overhead'];
const HIDDEN = ['MultiPV', 'UCI_Chess960', 'Ponder', 'UCI_AnalyseMode'];
const HASH_STEPS = [16, 32, 64, 128, 256, 512, 1024, 2048, 4096, 8192, 16384, 32768];

const NICE = {
  Threads: ['CPU threads', 'How many CPU threads the engine uses. More is faster; leave a couple free for other apps.'],
  Hash: ['Memory (hash)', 'Memory for remembering positions it has already searched. More helps long searches.'],
  'Skill Level': ['Skill level', '0 is weakest, 20 is full strength. Only used when "Limit strength" is off.'],
  UCI_LimitStrength: ['Limit strength', 'Play at a target rating instead of full strength.'],
  UCI_Elo: ['Target rating (Elo)', 'Used when "Limit strength" is on.'],
  SyzygyPath: ['Endgame tablebases', 'Folder with Syzygy tablebase files (.rtbw/.rtbz) for perfect endgame play. Leave empty if you have none.'],
  UCI_ShowWDL: ['Report win/draw/loss', 'Turn on to see W/D/L chances (also in Settings → Display).'],
  'Move Overhead': ['Move overhead', 'Safety margin in ms. Only matters for timed games.'],
};

export function renderEngineTab(root, ctx) {
  const { info } = ctx;
  if (!info) {
    root.replaceChildren(h('div', { class: 'empty' }, 'Loading engine…'));
    return;
  }

  const byName = Object.fromEntries((info.options || []).map((o) => [o.name, o]));
  const hasStrength = byName.UCI_LimitStrength && byName.UCI_Elo;
  const cores = ctx.appInfo?.cores || 8;
  const memMb = ctx.appInfo?.memoryMb || 8192;

  // ---- header
  const select = h('select', { class: 'select' }, info.list.map((e) => h('option', { value: e.id, selected: e.id === info.selected }, e.name)));
  select.addEventListener('change', () => ctx.select(select.value));
  const stateText = { ready: 'Ready', starting: 'Starting…', error: 'Error', idle: 'Idle' }[info.state] || info.state;
  const head = h('div', { class: 's-section' },
    h('div', { class: 's-head' }, icon('cpu'), 'Engine'),
    h('div', { class: 's-card' },
      h('div', { class: 'engine-head' },
        h('div', { class: 'meta' },
          h('div', { class: 'title' }, info.name || info.configName),
          h('div', { class: 'sub', title: info.path }, `${stateText}${info.author ? ' · ' + info.author : ''}`)),
        h('button', { class: 'btn small', onclick: ctx.restart, title: 'Restart the engine process' }, icon('reset'), 'Restart')),
      info.state === 'error' && info.message ? h('div', { class: 'err' }, info.message) : null,
      h('div', { class: 's-row' },
        h('div', { class: 's-label' }, 'Active engine'),
        h('div', { class: 's-control' }, select),
        h('div', { class: 's-desc' }, 'Any UCI engine works: Stockfish builds, Leela (lc0), Komodo Dragon, Berserk, Ethereal and more. Download the .exe, then add it here.')),
      h('div', { class: 's-row' },
        h('div', { class: 'btn-row' },
          h('button', { class: 'btn small', onclick: ctx.add }, icon('plus'), 'Add engine…'),
          !info.builtin ? h('button', { class: 'btn small danger', onclick: () => ctx.remove(info.selected) }, icon('trash'), 'Remove from list') : null,
          h('button', { class: 'btn small', onclick: ctx.resetOptions }, 'Reset options')))));

  // ---- common options
  const commonRows = [];
  const threads = byName.Threads;
  if (threads) {
    commonRows.push(slider(threads, { min: 1, max: Math.min(threads.max, cores * 2), fmt: (v) => `${v} of ${cores}` }, ctx));
  }
  const hash = byName.Hash;
  if (hash) {
    const steps = HASH_STEPS.filter((s) => s >= hash.min && s <= Math.min(hash.max, memMb / 2));
    commonRows.push(slider(hash, { values: steps, fmt: (v) => (v >= 1024 ? `${v / 1024} GB` : `${v} MB`) }, ctx));
  }
  if (hasStrength) {
    commonRows.push(toggleRow(byName.UCI_LimitStrength, ctx));
    if (byName.UCI_LimitStrength.value) {
      commonRows.push(slider(byName.UCI_Elo, { min: byName.UCI_Elo.min, max: byName.UCI_Elo.max, step: 10, fmt: (v) => `${v} Elo` }, ctx));
    }
  }
  if (byName['Skill Level'] && !(hasStrength && byName.UCI_LimitStrength.value)) {
    const sl = byName['Skill Level'];
    commonRows.push(slider(sl, { min: sl.min, max: sl.max, fmt: (v) => (v >= sl.max ? `${v} (full)` : String(v)) }, ctx));
  }
  if (byName.UCI_ShowWDL) commonRows.push(toggleRow(byName.UCI_ShowWDL, ctx));
  if (byName.SyzygyPath) commonRows.push(folderRow(byName.SyzygyPath, ctx));

  const common = commonRows.length ? h('div', { class: 's-section' },
    h('div', { class: 's-head' }, icon('gear'), 'Strength & speed'),
    h('div', { class: 's-card' }, commonRows)) : null;

  // ---- every other option
  const rest = (info.options || []).filter((o) => !COMMON.includes(o.name) && !HIDDEN.includes(o.name));
  const all = rest.length ? h('div', { class: 's-section' },
    h('details', { class: 's-card' },
      h('summary', null, `All engine options (${rest.length})`),
      rest.map((o) => genericRow(o, ctx)))) : null;

  // ---- machine info
  const machine = ctx.appInfo ? h('div', { class: 's-section' },
    h('div', { class: 's-head' }, icon('cpu'), 'This PC'),
    h('div', { class: 's-card' },
      h('div', { class: 's-row' }, h('div', { class: 's-label' }, ctx.appInfo.cpu || 'CPU'),
        h('div', { class: 's-control' }, `${cores} threads · ${Math.round(memMb / 1024)} GB RAM`)))) : null;

  root.replaceChildren(head, common, all, machine);
}

function labelFor(o) {
  return NICE[o.name] || [o.name, ''];
}

function slider(o, { min, max, step = 1, values, fmt = (v) => v }, ctx) {
  const [label, desc] = labelFor(o);
  const cur = Number(o.value);
  const input = h('input', { type: 'range' });
  if (values) {
    input.min = 0;
    input.max = values.length - 1;
    let idx = values.findIndex((v) => v >= cur);
    if (idx < 0) idx = values.length - 1;
    input.value = idx;
  } else {
    input.min = min;
    input.max = max;
    input.step = step;
    input.value = cur;
  }
  const read = () => (values ? values[Number(input.value)] : Number(input.value));
  const out = h('span', { class: 's-val' }, fmt(cur));
  input.addEventListener('input', () => { out.textContent = fmt(read()); });
  input.addEventListener('change', () => ctx.setOption(o.name, read()));
  return h('div', { class: 's-row stack' },
    h('div', { class: 's-label' }, label),
    h('div', { class: 'range-wrap' }, input, out),
    desc ? h('div', { class: 's-desc' }, desc) : null);
}

function toggleRow(o, ctx) {
  const [label, desc] = labelFor(o);
  const input = h('input', { type: 'checkbox' });
  input.checked = o.value === true || o.value === 'true';
  input.addEventListener('change', () => ctx.setOption(o.name, input.checked));
  return h('div', { class: 's-row' },
    h('div', { class: 's-label' }, label),
    h('div', { class: 's-control' }, h('label', { class: 'toggle' }, input, h('span'))),
    desc ? h('div', { class: 's-desc' }, desc) : null);
}

function folderRow(o, ctx) {
  const [label, desc] = labelFor(o);
  const input = h('input', { class: 'input mono', value: o.value || '', placeholder: 'No folder', spellcheck: 'false' });
  input.addEventListener('change', () => ctx.setOption(o.name, input.value.trim()));
  const pick = h('button', {
    class: 'btn small',
    onclick: async () => {
      const dir = await ctx.pickFolder('Choose your Syzygy tablebase folder');
      if (dir) { input.value = dir; ctx.setOption(o.name, dir); }
    },
  }, 'Browse…');
  return h('div', { class: 's-row stack' },
    h('div', { class: 's-label' }, label),
    h('div', { class: 'field-row', style: { margin: 0 } }, input, pick),
    desc ? h('div', { class: 's-desc' }, desc) : null);
}

function genericRow(o, ctx) {
  const [label, desc] = labelFor(o);
  let control;
  if (o.type === 'check') {
    const input = h('input', { type: 'checkbox' });
    input.checked = o.value === true || o.value === 'true';
    input.addEventListener('change', () => ctx.setOption(o.name, input.checked));
    control = h('label', { class: 'toggle' }, input, h('span'));
  } else if (o.type === 'spin') {
    const input = h('input', { type: 'number', class: 'numin', min: o.min, max: o.max, value: o.value });
    input.addEventListener('change', () => {
      const v = Math.min(o.max, Math.max(o.min, Math.round(Number(input.value) || o.default)));
      input.value = v;
      ctx.setOption(o.name, v);
    });
    control = h('div', { class: 's-control' }, input, h('span', { class: 's-desc', style: { gridColumn: 'auto' } }, `${o.min}–${o.max}`));
  } else if (o.type === 'combo') {
    const sel = h('select', { class: 'select' }, (o.vars || []).map((v) => h('option', { value: v, selected: v === o.value }, v)));
    sel.addEventListener('change', () => ctx.setOption(o.name, sel.value));
    control = sel;
  } else if (o.type === 'button') {
    control = h('button', { class: 'btn small', onclick: () => ctx.pressButton(o.name) }, 'Run');
  } else {
    const input = h('input', { class: 'input mono', value: o.value ?? '', spellcheck: 'false', style: { width: '200px' } });
    input.addEventListener('change', () => ctx.setOption(o.name, input.value));
    control = input;
  }
  const defText = o.type === 'button' ? '' : `Default: ${o.default === '' ? 'empty' : String(o.default)}`;
  return h('div', { class: 's-row' },
    h('div', { class: 's-label', title: o.name }, label),
    h('div', { class: 's-control' }, control),
    h('div', { class: 's-desc' }, [desc, defText].filter(Boolean).join(' · ')));
}
