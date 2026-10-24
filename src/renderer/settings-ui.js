// Builds the Settings tab from a list of options.
import { h, icon, getPath } from './dom.js';
import { BOARD_THEMES, ACCENTS } from './themes.js';
import { formatMs } from './format.js';

const IS_MAC = window.api?.platform === 'darwin';

const TIME_STEPS = [100, 250, 500, 750, 1000, 1500, 2000, 3000, 4000, 5000, 7000, 10000, 15000, 20000, 30000, 45000, 60000, 120000];
const NODE_STEPS = [10000, 50000, 100000, 250000, 500000, 1e6, 2e6, 5e6, 1e7, 2e7, 5e7, 1e8, 5e8];

const HOTKEY_LABELS = {
  toggleVisible: ['Show / hide overlay', 'Works from any app'],
  clickThrough: ['Click-through mode', 'Mouse passes through the overlay'],
  analyze: ['Analyze', 'Start a new search'],
  stop: ['Stop engine', ''],
  playBest: ['Play best move', 'On the overlay board'],
  watchScreen: ['Watch screen (auto-detect)', 'Start or stop watching your screen for moves'],
  compact: ['Compact mode', 'Shrink to a small best-move bar'],
  flip: ['Flip board', ''],
  pasteFen: ['Paste FEN / PGN', 'Loads what is on the clipboard'],
  undo: ['Take back a move', ''],
  opacityUp: ['More opaque', '+10% window opacity'],
  opacityDown: ['More transparent', '−10% window opacity'],
  alwaysOnTop: ['Toggle always on top', ''],
};

function nodesLabel(n) {
  if (n >= 1e6) return `${n / 1e6}M nodes`;
  return `${n / 1e3}k nodes`;
}

export function renderSettings(root, ctx) {
  const { S, set } = ctx;
  const val = (path) => getPath(S, path);

  const row = (label, control, desc, { stack = false } = {}) => h('div', { class: `s-row${stack ? ' stack' : ''}` },
    h('div', { class: 's-label' }, label),
    h('div', { class: 's-control' }, control),
    desc ? h('div', { class: 's-desc' }, desc) : null);

  const toggle = (path, label, desc) => {
    const input = h('input', { type: 'checkbox' });
    input.checked = !!val(path);
    input.addEventListener('change', () => set(path, input.checked));
    return row(label, h('label', { class: 'toggle' }, input, h('span')), desc);
  };

  const seg = (path, label, options, desc, { stack = false } = {}) => {
    const cur = val(path);
    const el = h('div', { class: 'seg' }, options.map(([v, text]) => h('button', {
      class: v === cur ? 'active' : '',
      onclick: () => set(path, v),
    }, text)));
    return row(label, el, desc, { stack });
  };

  // Slider over a list of allowed values (or min..max).
  const range = (path, label, { min, max, step = 1, values, fmt = (v) => v, live = false }, desc) => {
    const cur = val(path);
    const steps = values || null;
    const input = h('input', { type: 'range' });
    if (steps) {
      input.min = 0;
      input.max = steps.length - 1;
      input.step = 1;
      const idx = steps.indexOf(cur);
      input.value = idx > -1 ? idx : 0;
    } else {
      input.min = min;
      input.max = max;
      input.step = step;
      input.value = cur;
    }
    const readout = h('span', { class: 'range-val' }, fmt(cur));
    const update = (commit) => {
      const v = steps ? steps[Number(input.value)] : Number(input.value);
      readout.textContent = fmt(v);
      if (commit) set(path, v);
    };
    input.addEventListener('input', () => update(live));
    input.addEventListener('change', () => update(true));
    return row(label, h('div', { class: 'range-wrap' }, input, readout), desc);
  };

  const colorSwatches = (path, label, colors, desc) => {
    const cur = val(path);
    const rowEl = h('div', { class: 'swatches' }, colors.map((c) => {
      const b = h('button', {
        class: `swatch${c.toLowerCase() === (cur || '').toLowerCase() ? ' active' : ''}`,
        style: `background: ${c}`,
        title: c,
        onclick: () => set(path, c),
      });
      return b;
    }));
    return row(label, rowEl, desc);
  };

  const section = (title, iconName, ...rows) => h('div', { class: 's-section' },
    h('div', { class: 's-head' }, icon(iconName), title),
    h('div', { class: 's-card' }, rows));

  // ---- analysis
  const mode = val('analysis.mode');
  const modeControl = seg('analysis.mode', 'Search limit', [
    ['time', 'Time'], ['depth', 'Depth'], ['nodes', 'Nodes'], ['infinite', 'Infinite'],
  ]);
  const limitRow = mode === 'time'
    ? range('analysis.movetime', 'Time limit', { values: TIME_STEPS, fmt: formatMs })
    : mode === 'depth'
      ? range('analysis.depth', 'Max depth', { min: 4, max: 64, fmt: (v) => `${v} plies` })
      : mode === 'nodes'
        ? range('analysis.nodes', 'Node budget', { values: NODE_STEPS, fmt: nodesLabel })
        : row('Limit', h('span', { class: 'faint' }, 'Search runs until you press Stop.'));

  const analysis = section('Analysis', 'lines',
    modeControl,
    limitRow,
    range('analysis.multipv', 'Best lines (Multi-PV)', { min: 1, max: 8, fmt: (v) => `${v} line${v === 1 ? '' : 's'}` },
      'More lines give alternative moves; 1 line searches the deepest.'),
    toggle('analysis.autoAnalyze', 'Auto-analyze', 'Start computing as soon as the board changes.'),
    seg('analysis.analyzeFor', 'Calculate for', [
      ['both', 'Both'], ['white', 'White only'], ['black', 'Black only'],
    ], 'Only start auto-analysis when it is this side’s turn.'),
    seg('analysis.myColor', 'Player color (I play)', [
      ['white', 'White'], ['black', 'Black'],
    ], 'Your chosen color — autoplay and default board perspective follow this.'),
    seg('analysis.enginePlays', 'Engine plays on board', [
      ['none', 'Off'], ['white', 'White'], ['black', 'Black'], ['both', 'Both'],
    ], 'Let the engine make its best move automatically on the overlay board.'),
    val('analysis.enginePlays') !== 'none'
      ? range('analysis.autoPlayDelay', 'Move delay', { min: 0, max: 2000, step: 50, fmt: formatMs }, 'Delay before the engine makes its move.')
      : null,
    toggle('analysis.screenClick', 'Move pieces on screen', 'Physically click and move pieces on your screen’s chessboard.'),
    toggle('analysis.stopOnGameOver', 'Stop on game over', 'Automatically stop autoplay whenever a win, loss, checkmate, or draw occurs.'),
    val('analysis.screenClick')
      ? seg('analysis.mouseMethod', 'Mouse move method', [
          ['click', 'Click-Click'], ['drag', 'Drag & drop'],
        ], 'Click-click is fastest and most reliable; drag & drop moves smoothly across.')
      : null,
  );

  // ---- display
  const display = section('Display & Eval', 'bolt',
    toggle('display.evalBar', 'Evaluation bar', 'Thin bar on the left showing current win chance.'),
    seg('display.arrows', 'Best move arrows', [
      ['off', 'Off'], ['best', 'Best only'], ['all', 'All lines'],
    ]),
    val('display.arrows') === 'all'
      ? range('display.maxArrows', 'Max arrows', { min: 1, max: 8 })
      : null,
    toggle('display.showReply', 'Expected reply arrow', 'Faint arrow showing what the engine expects the opponent to play.'),
    toggle('display.arrowLabels', 'Score badges on arrows', 'Show +0.8, -1.2, #3 on each arrow head.'),
    range('display.arrowOpacity', 'Arrow opacity', { min: 0.2, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` }),
    seg('display.scoreFormat', 'Score format', [
      ['pawns', 'Pawns (+1.25)'], ['winpct', 'Win % (62%)'],
    ]),
    seg('display.perspective', 'Perspective', [
      ['white', "White's view"], ['side', 'Side to move'],
    ], 'Whether positive scores always mean White is winning or the player whose turn it is.'),
    seg('display.notation', 'Move notation', [
      ['san', 'Nf3'], ['figurine', '♘f3'], ['uci', 'g1f3'],
    ]),
    toggle('display.showStats', 'Search stats', 'Show depth, NPS (nodes/sec), nodes searched, and hash fill.'),
    toggle('display.showWdl', 'Win / draw / loss chances', 'Show estimated W/D/L percentages if the engine supports them.'),
  );

  // ---- board
  const curTheme = val('board.theme');
  const themeButtons = Object.entries(BOARD_THEMES).map(([k, t]) => h('button', {
    class: `theme-btn${k === curTheme ? ' active' : ''}`,
    onclick: () => set('board.theme', k),
  },
  h('div', { class: 'theme-preview', style: `background: linear-gradient(135deg, ${t.light} 50%, ${t.dark} 50%)` }),
  h('span', null, t.name)));

  const board = section('Board', 'edit',
    row('Board colors', h('div', { class: 'theme-grid' }, themeButtons)),
    curTheme === 'custom' ? h('div', { class: 's-card nested' },
      colorSwatches('board.customLight', 'Light square', ['#f0d9b5', '#e8dcc0', '#dee3e6', '#ffffff', '#e0e4cd', '#dcd9d0']),
      colorSwatches('board.customDark', 'Dark square', ['#b58863', '#8a6f55', '#8ca2ad', '#70a2a3', '#769656', '#5d7e5d']),
    ) : null,
    seg('board.coords', 'Coordinates', [
      ['edge', 'Edge'], ['squares', 'Every square'], ['off', 'Hidden'],
    ]),
    seg('board.orientation', 'Default orientation', [
      ['white', 'White'], ['black', 'Black'],
    ], 'Initial side at the bottom of the board.'),
    toggle('board.autoFlip', 'Auto-flip to side to move', 'Flips the board automatically on every turn.'),
    toggle('board.sounds', 'Sound effects', 'Play a click on moves, captures, checks and game over.'),
    val('board.sounds')
      ? range('board.volume', 'Volume', { min: 0.05, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` })
      : null,
    range('board.animation', 'Move animation', { values: [0, 80, 140, 180, 250, 400], fmt: (v) => (v === 0 ? 'Instant' : `${v} ms`) }),
    toggle('board.lastMove', 'Highlight last move'),
    toggle('board.check', 'Highlight check'),
    toggle('board.legalDots', 'Show legal move dots'),
    toggle('board.autoQueen', 'Auto-promote to Queen', 'Promote automatically without asking.'),
    range('board.maxSize', 'Maximum board size', { min: 200, max: 1000, step: 20, fmt: (v) => (v >= 1000 ? 'No limit' : `${v} px`) },
      'Keeps the board small even if the overlay window is enlarged.'),
  );

  // ---- overlay
  const overlay = section('Overlay & Window', 'pin',
    toggle('overlay.alwaysOnTop', 'Always on top', 'Float above browser and other apps.'),
    seg('overlay.topLevel', 'Above fullscreen games', [
      ['floating', 'Normal'], ['screen-saver', 'Aggressive'],
    ], IS_MAC
      ? 'Aggressive keeps the overlay above fullscreen apps. macOS only allows this while the Dock icon is hidden.'
      : 'Screen-saver level keeps the overlay above borderless-fullscreen games and apps.'),
    range('overlay.opacity', 'Window opacity', { min: 0.2, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
      `Fades the whole overlay. Hotkeys: ${S.hotkeys.opacityUp || '-'} / ${S.hotkeys.opacityDown || '-'}`),
    range('overlay.panelOpacity', 'Background tint', { min: 0.2, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
      'How dark the overlay background is (the board and text stay sharp).'),
    range('overlay.ghostOpacity', 'Click-through opacity', { min: 0.1, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
      `In click-through mode your mouse goes "through" the overlay to the app behind. Toggle with ${S.hotkeys.clickThrough || 'the tray menu'} or the ghost button.`),
    seg('overlay.theme', 'Interface theme', [
      ['dark', 'Dark'], ['light', 'Light'],
    ]),
    colorSwatches('overlay.accent', 'Accent color', ACCENTS),
    range('overlay.zoom', 'Interface scale', { values: [0.8, 0.9, 1, 1.1, 1.25, 1.5], fmt: (v) => `${Math.round(v * 100)}%` }),
    toggle('overlay.lockPosition', 'Lock position and size', 'Prevents dragging or resizing the overlay window accidentally.'),
    IS_MAC
      ? toggle('overlay.closeToTray', 'Close hides to menu bar', 'Closing the window keeps Cheeseee running in the menu bar. Use its menu → Quit, or Cmd+Q, to exit.')
      : toggle('overlay.closeToTray', 'Close hides to tray', 'Closing the window keeps Cheeseee running in the system tray. Use tray → Quit to exit.'),
    IS_MAC
      ? toggle('overlay.skipTaskbar', 'Hide from Dock', 'Shows only in the menu bar.')
      : toggle('overlay.skipTaskbar', 'Hide from taskbar', 'Shows only in the system tray (near the clock).'),
    toggle('overlay.startWithWindows', IS_MAC ? 'Open at login' : 'Start with Windows'),
    toggle('overlay.startHidden', 'Start hidden to tray'),
    row('Lost the window?', h('button', { class: 'btn small', onclick: ctx.actions.resetPosition }, 'Move back on screen')),
  );

  // ---- hotkeys
  const hotkeyRows = Object.keys(HOTKEY_LABELS).map((action) => {
    const [name, sub] = HOTKEY_LABELS[action];
    const failed = (ctx.failedHotkeys || []).includes(action);
    const btn = h('button', { class: `hk-key${failed ? ' failed' : ''}`, title: failed ? 'Another app already uses this combination' : 'Click, then press a key combination' },
      S.hotkeys[action] || 'Not set');
    btn.addEventListener('click', () => recordHotkey(btn, (accel) => set(`hotkeys.${action}`, accel)));
    const clear = h('button', { class: 'ib', title: 'Clear', onclick: () => set(`hotkeys.${action}`, '') }, icon('close'));
    return h('div', { class: 'hk' }, h('div', { class: 'hk-name' }, name, sub ? h('small', null, sub) : null), btn, clear);
  });
  const hotkeys = h('div', { class: 's-section' },
    h('div', { class: 's-head' }, icon('keys'), 'Global hotkeys'),
    h('div', { class: 's-card' }, hotkeyRows,
      h('div', { class: 's-row' }, h('div', { class: 's-desc' },
        'These work even when another app is focused. Red means another program already owns that combination. In the overlay itself: Space analyze · A play best · F flip · E edit · R reset · K clear · ←/→ moves · 1–8 lines · Ctrl+V paste · M compact.'))));

  // ---- data
  const data = section('Settings file', 'save',
    row('Back up or move settings', h('div', { class: 'btn-row' },
      h('button', { class: 'btn small', onclick: ctx.actions.exportSettings }, 'Export'),
      h('button', { class: 'btn small', onclick: ctx.actions.importSettings }, 'Import'),
      h('button', { class: 'btn small danger', onclick: ctx.actions.resetSettings }, 'Reset all'))),
  );

  root.replaceChildren(analysis, display, board, overlay, hotkeys, data);
}

function recordHotkey(btn, done) {
  const prev = btn.textContent;
  btn.classList.add('recording');
  btn.textContent = 'Press keys…';
  const onKey = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.key === 'Escape') return finish(null);
    const accel = toAccelerator(e);
    if (accel) finish(accel);
  };
  const finish = (accel) => {
    window.removeEventListener('keydown', onKey, true);
    btn.removeEventListener('blur', onBlur);
    btn.classList.remove('recording');
    btn.textContent = accel || prev;
    if (accel) done(accel);
  };
  const onBlur = () => finish(null);
  window.addEventListener('keydown', onKey, true);
  btn.addEventListener('blur', onBlur);
}

function toAccelerator(e) {
  const k = e.key;
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph'].includes(k)) return null;
  let key = null;
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(k)) key = k;
  else if (/^Key[A-Z]$/.test(e.code)) key = e.code.slice(3);
  else if (/^Digit[0-9]$/.test(e.code)) key = e.code.slice(5);
  else if (/^Numpad[0-9]$/.test(e.code)) key = 'num' + e.code.slice(6);
  else {
    const map = {
      ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right', ' ': 'Space', Enter: 'Enter',
      Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete', Insert: 'Insert', Home: 'Home', End: 'End',
      PageUp: 'PageUp', PageDown: 'PageDown',
    };
    const codeMap = { Equal: '=', Minus: '-', BracketLeft: '[', BracketRight: ']', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/', Backslash: '\\', Backquote: '`' };
    key = map[k] || codeMap[e.code] || null;
  }
  if (!key) return null;
  const mods = [];
  if (e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  if (e.metaKey) mods.push('Super');
  if (!mods.length && !/^F\d+$/.test(key)) return null;
  return [...mods, key].join('+');
}
