import { Chessground } from 'chessground';
import {
  GameModel, START_FEN, EMPTY_KINGS_FEN, positionProblem, sanitizeFen, castlingFromFen, makeChess, analyzeMoveBetweenPlacements, inferTurnFromPlacement,
} from './game.js';
import * as F from './format.js';
import { boardColors, boardSvg, contrastText, ARROW_COLORS, REPLY_COLOR } from './themes.js';
import { playSound } from './sound.js';
import { renderSettings } from './settings-ui.js';
import { renderEngineTab } from './engine-ui.js';
import { screenWatcher } from './screen-watcher.js';
import { renderScreenTab, refreshScreenSources } from './screen-ui.js';
import { patchFor } from './dom.js';

const api = window.api;
const $ = (id) => document.getElementById(id);
const ROLES = ['king', 'queen', 'rook', 'bishop', 'knight', 'pawn'];
const PROMO_ROLES = [['q', 'queen'], ['r', 'rook'], ['b', 'bishop'], ['n', 'knight']];

let S = null;
let cg = null;
const game = new GameModel();

const st = {
  mode: 'play', // 'play' | 'edit'
  orientation: 'white',
  searchId: 0,
  searching: false,
  search: null,
  lines: [],
  stats: {},
  bestmove: null,
  engine: { state: 'starting' },
  engineInfo: null,
  editTurn: 'w',
  editCastling: { K: true, Q: true, k: true, q: true },
  editDirty: false,
  clickThrough: false,
  compact: false,
  failedHotkeys: [],
  boardSize: 0,
  appInfo: null,
  consoleLines: [],
  renderQueued: false,
  timers: {},
};

// ---------------------------------------------------------------- helpers

function colorName(c) { return c === 'b' ? 'black' : 'white'; }

function toast(text, kind = '') {
  const el = $('toast');
  el.textContent = text;
  el.className = `toast show ${kind}`;
  clearTimeout(st.timers.toast);
  st.timers.toast = setTimeout(() => { el.className = `toast ${kind}`; }, kind === 'error' ? 3200 : 1700);
}

async function setSetting(path, value, { quiet = false } = {}) {
  const before = S;
  S = await api.settings.set(patchFor(path, value));
  onSettingsChanged(path, before, quiet);
  return S;
}

function viewScore(score, turn) {
  return F.viewScore(score, turn, S.display.perspective);
}

function moveLabel(san, uci) {
  if (S.display.notation === 'uci') return uci;
  if (S.display.notation === 'figurine') return F.figurine(san);
  return san;
}

// ---------------------------------------------------------------- theme + layout

function applyTheme() {
  const root = document.documentElement;
  const app = $('app');
  const o = S.overlay;
  root.style.setProperty('--accent', o.accent);
  root.style.setProperty('--accent-ink', contrastText(o.accent).startsWith('rgba(40') ? '#10140f' : '#ffffff');
  root.style.setProperty('--panel-alpha', String(o.panelOpacity));
  const { light, dark } = boardColors(S);
  root.style.setProperty('--board-bg', boardSvg(light, dark));
  root.style.setProperty('--coord-on-light', contrastText(light));
  root.style.setProperty('--coord-on-dark', contrastText(dark));
  app.classList.toggle('theme-light', o.theme === 'light');
  app.classList.toggle('no-evalbar', !S.display.evalBar);
  app.classList.toggle('locked', !!o.lockPosition);
  app.classList.toggle('compact', !!o.compact);
  app.classList.toggle('editing', st.mode === 'edit');
  app.classList.toggle('ghost', st.clickThrough);
  $('ghostKey').textContent = S.hotkeys.clickThrough || 'the tray menu';
  $('btnPin').classList.toggle('on', !!o.alwaysOnTop);
  $('btnGhost').classList.toggle('on', st.clickThrough);
  $('btnCompact').classList.toggle('on', !!o.compact);
}

function layoutBoard() {
  if (S.overlay.compact) return;
  const app = $('app');
  const W = app.clientWidth;
  const H = app.clientHeight;
  const wide = W >= 780;
  const top = document.querySelector('.titlebar').offsetHeight + $('bestbar').offsetHeight;
  const evalW = S.display.evalBar ? 20 : 0;
  let extra = 36; // toolbar
  if (!$('editPanel').hidden) extra += $('editPanel').offsetHeight + 4;
  if (!$('statusLine').hidden) extra += $('statusLine').offsetHeight + 4;
  const spares = st.mode === 'edit' ? 2 * (0.82 / 8) : 0;
  const sparesGap = st.mode === 'edit' ? 8 : 0;
  let size;
  if (wide) {
    size = Math.min((H - top - extra - 24 - sparesGap) / (1 + spares), W * 0.6 - evalW - 20);
  } else {
    const minPanel = 240;
    size = Math.min(W - 20 - evalW, (H - top - extra - 14 - minPanel - sparesGap) / (1 + spares));
  }
  if (S.board.maxSize < 1000) size = Math.min(size, S.board.maxSize);
  size = Math.max(120, Math.floor(size / 8) * 8);
  if (size !== st.boardSize) {
    st.boardSize = size;
    document.documentElement.style.setProperty('--board-size', `${size}px`);
  }
}

// ---------------------------------------------------------------- board

function brushes() {
  const op = S.display.arrowOpacity;
  const b = {};
  ARROW_COLORS.forEach((color, i) => {
    b[`a${i}`] = { key: `a${i}`, color, opacity: Math.max(0.35, op - i * 0.12), lineWidth: 12 };
  });
  b.reply = { key: 'reply', color: REPLY_COLOR, opacity: Math.min(0.75, op * 0.7), lineWidth: 8 };
  return b;
}

function boardConfig() {
  const editing = st.mode === 'edit';
  const turnColor = colorName(editing ? st.editTurn : game.turn);
  const gs = editing ? { over: false } : game.gameState();
  const last = game.lastMove;
  return {
    fen: game.fen,
    orientation: st.orientation,
    turnColor,
    check: !editing && S.board.check && gs.check ? turnColor : false,
    lastMove: !editing && last && S.board.lastMove ? [last.from, last.to] : undefined,
    animation: { enabled: S.board.animation > 0, duration: S.board.animation },
    highlight: { lastMove: S.board.lastMove, check: S.board.check },
    movable: editing
      ? { free: true, color: 'both', showDests: false, dests: new Map() }
      : { free: false, color: gs.over ? undefined : turnColor, dests: game.legalDests(), showDests: S.board.legalDots },
    draggable: { enabled: true, showGhost: true, deleteOnDropOff: editing },
    drawable: { enabled: !editing, visible: true },
  };
}

function createBoard() {
  if (cg) cg.destroy();
  const el = $('board');
  el.innerHTML = '';
  cg = Chessground(el, {
    ...boardConfig(),
    coordinates: S.board.coords !== 'off',
    coordinatesOnSquares: S.board.coords === 'squares',
    autoCastle: true,
    premovable: { enabled: false },
    selectable: { enabled: true },
    disableContextMenu: true,
    drawable: { enabled: st.mode !== 'edit', visible: true, eraseOnClick: true, brushes: brushes(), defaultSnapToValidMove: true },
    events: { change: onBoardChange },
  });
  cg.set({ movable: { events: { after: onUserMove } } });
  updateArrows();
}

function syncBoard() {
  if (!cg) return;
  cg.set(boardConfig());
  updateArrows();
}

function onBoardChange() {
  if (st.mode !== 'edit') return;
  onEditChange();
}

function onUserMove(orig, dest) {
  if (st.mode === 'edit') return;
  if (game.isPromotion(orig, dest)) {
    if (S.board.autoQueen) doMove({ from: orig, to: dest, promotion: 'q' });
    else askPromotion(orig, dest);
    return;
  }
  doMove({ from: orig, to: dest });
}

function askPromotion(from, to) {
  const promo = $('promo');
  const color = colorName(game.turn);
  promo.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'promo-card cg-wrap';
  for (const [letter, role] of PROMO_ROLES) {
    const p = document.createElement('piece');
    p.className = `${role} ${color}`;
    p.title = role;
    p.addEventListener('click', (e) => {
      e.stopPropagation();
      promo.hidden = true;
      doMove({ from, to, promotion: letter });
    });
    card.appendChild(p);
  }
  promo.appendChild(card);
  promo.hidden = false;
  promo.onclick = () => { promo.hidden = true; syncBoard(); };
}

function doMove(m, { silent = false } = {}) {
  const rec = game.play(m);
  if (!rec) {
    syncBoard();
    return null;
  }
  afterPositionChange({ moved: silent ? null : rec });
  return rec;
}

function moveSound(rec) {
  if (!S.board.sounds || !rec) return;
  const gs = game.gameState();
  if (gs.over) playSound('end', S.board.volume);
  else if (rec.check) playSound('check', S.board.volume);
  else if (rec.captured) playSound('capture', S.board.volume);
  else playSound('move', S.board.volume);
}

function afterPositionChange({ moved = null, keepAnalysis = false } = {}) {
  clearTimeout(st.timers.autoPlay);
  $('promo').hidden = true;
  if (S.board.autoFlip && st.mode === 'play') {
    const want = colorName(game.turn);
    if (want !== st.orientation) st.orientation = want;
  }
  syncBoard();
  moveSound(moved);
  if (!keepAnalysis) {
    cancelAnalysis();
    if (!checkGameOverAndStop()) {
      maybeAutoAnalyze();
    }
  }
  renderAll();
}

// ---------------------------------------------------------------- edit mode

function renderSpares() {
  const topColor = st.orientation === 'white' ? 'black' : 'white';
  const bottomColor = topColor === 'white' ? 'black' : 'white';
  for (const [id, color] of [['sparesTop', topColor], ['sparesBottom', bottomColor]]) {
    const el = $(id);
    el.className = 'spares cg-wrap';
    el.innerHTML = '';
    for (const role of ROLES) {
      const p = document.createElement('piece');
      p.className = `${role} ${color}`;
      p.title = `Drag ${color} ${role} onto the board`;
      const start = (e) => {
        if (e.button !== undefined && e.button !== 0) return;
        e.preventDefault();
        cg.dragNewPiece({ role, color }, e, true);
      };
      p.addEventListener('mousedown', start);
      p.addEventListener('touchstart', start, { passive: false });
      el.appendChild(p);
    }
  }
}

function enterEdit() {
  if (st.mode === 'edit') return;
  cancelAnalysis();
  st.mode = 'edit';
  st.editTurn = game.turn;
  st.editCastling = castlingFromFen(game.fen);
  st.editDirty = false;
  renderSpares();
  applyTheme();
  syncBoard();
  renderEditPanel();
  renderAll();
  maybeAutoAnalyze();
}

function exitEdit() {
  if (st.mode !== 'edit') return;
  st.mode = 'play';
  applyTheme();
  afterPositionChange({});
}

function editFen() {
  return sanitizeFen(cg.getFen(), st.editTurn, st.editCastling);
}

function onEditChange() {
  const fen = editFen();
  if (fen !== game.fen) {
    game.reset(fen);
    st.editDirty = true;
  }
  renderEditPanel();
  cancelAnalysis();
  clearTimeout(st.timers.edit);
  st.timers.edit = setTimeout(() => maybeAutoAnalyze(), 200);
  renderAll();
}

function renderEditPanel() {
  const panel = $('editPanel');
  panel.hidden = st.mode !== 'edit';
  if (panel.hidden) return;
  panel.querySelectorAll('#editTurn button').forEach((b) => b.classList.toggle('active', b.dataset.v === st.editTurn));
  const possible = castlingFromFen(sanitizeFen(cg.getFen(), st.editTurn, { K: true, Q: true, k: true, q: true }));
  panel.querySelectorAll('#editCastling input').forEach((inp) => {
    const c = inp.dataset.c;
    inp.checked = !!st.editCastling[c] && possible[c];
    inp.disabled = !possible[c];
    inp.parentElement.style.opacity = possible[c] ? '' : '0.45';
  });
}

function setPosition(fen, { edit = null } = {}) {
  game.reset(fen);
  if (edit === true) {
    if (st.mode !== 'edit') enterEdit();
    st.editTurn = game.turn;
    st.editCastling = castlingFromFen(fen);
    syncBoard();
    renderEditPanel();
    cancelAnalysis();
    maybeAutoAnalyze();
    renderAll();
    return;
  }
  if (edit === false && st.mode === 'edit') {
    st.mode = 'play';
    applyTheme();
  }
  if (st.mode === 'edit') {
    st.editTurn = game.turn;
    st.editCastling = castlingFromFen(fen);
    renderEditPanel();
  }
  afterPositionChange({});
}

// ---------------------------------------------------------------- analysis

function limits() {
  const a = S.analysis;
  return { mode: a.mode, movetime: a.movetime, depth: a.depth, nodes: a.nodes };
}

function blockedReason() {
  const problem = positionProblem(game.fen);
  if (problem) return problem;
  if (st.mode !== 'edit') {
    const gs = game.gameState();
    if (gs.over) return gs.text;
  }
  return null;
}

function enginePlaysTurn() {
  const p = S.analysis.enginePlays;
  return st.mode === 'play' && (p === 'both' || p === colorName(game.turn));
}

function shouldAutoAnalyze() {
  if (enginePlaysTurn()) return true;
  if (!S.analysis.autoAnalyze) return false;
  const f = S.analysis.analyzeFor;
  return f === 'both' || f === colorName(st.mode === 'edit' ? st.editTurn : game.turn);
}

function maybeAutoAnalyze() {
  clearTimeout(st.timers.analyze);
  if (!shouldAutoAnalyze() || blockedReason()) return;
  st.timers.analyze = setTimeout(() => startAnalysis(), 90);
}

function startAnalysis() {
  clearTimeout(st.timers.analyze);
  if (blockedReason()) {
    cancelAnalysis();
    renderAll();
    return false;
  }
  st.searchId += 1;
  st.searching = true;
  st.lines = [];
  st.stats = {};
  st.bestmove = null;
  st.search = {
    id: st.searchId,
    fen: game.fen,
    turn: game.turn,
    startedAt: performance.now(),
    limits: limits(),
  };
  api.engine.analyze({
    searchId: st.searchId,
    fen: game.rootFen,
    moves: game.uciMoves(),
    limits: st.search.limits,
    multipv: S.analysis.multipv,
  });
  startProgressTimer();
  renderAll();
  return true;
}

function stopAnalysis() {
  if (st.searching) api.engine.stop();
}

function cancelAnalysis() {
  clearTimeout(st.timers.analyze);
  clearTimeout(st.timers.autoPlay);
  if (st.searching) api.engine.stop();
  st.searchId += 1;
  st.searching = false;
  st.search = null;
  st.lines = [];
  st.stats = {};
  st.bestmove = null;
  updateArrows();
}

function toggleAnalysis() {
  if (st.searching) stopAnalysis();
  else startAnalysis();
}

function currentResultValid() {
  return st.search && st.search.fen === game.fen;
}

function bestUci() {
  if (!currentResultValid()) return null;
  return st.bestmove || st.lines[0]?.pv?.[0] || null;
}

function toggleScreenWatch() {
  const willWatch = !screenWatcher.isWatching();
  if (willWatch) {
    toast('Starting screen watcher…');
    screenWatcher.start(S.screenWatch || {});
  } else {
    toast('Screen watcher stopped');
    screenWatcher.stop();
  }
  renderBest();
}

function playBest() {
  const uci = bestUci();
  if (!uci) {
    toast('No best move yet — press Analyze first');
    return;
  }
  if (st.mode === 'edit') {
    st.mode = 'play';
    applyTheme();
  }
  const rec = game.playUci(uci);
  if (rec) afterPositionChange({ moved: rec });
}

async function toggleAutoplay() {
  const currentlyOn = S.analysis?.enginePlays && S.analysis.enginePlays !== 'none';
  if (currentlyOn) {
    clearTimeout(st.timers.autoPlay);
    await setSetting('analysis.enginePlays', 'none');
    toast('Autoplay: Off');
  } else {
    const myColor = S.analysis?.myColor || 'white';
    await setSetting('analysis.enginePlays', myColor);
    toast(`Autoplay: ON (${myColor === 'white' ? 'White' : 'Black'})`);
    if (st.mode === 'edit') {
      st.mode = 'play';
      applyTheme();
    }
    if (enginePlaysTurn()) {
      if (st.bestmove && currentResultValid()) {
        maybeEnginePlays();
      } else {
        startAnalysis();
      }
    }
  }
  renderBest();
  if (document.querySelector('.tab-body.active')?.dataset.tab === 'settings') refreshSettingsTab();
}

async function setMyColor(color) {
  if (color !== 'white' && color !== 'black') return;
  const autoplayOn = S.analysis?.enginePlays && S.analysis.enginePlays !== 'none';

  await setSetting('analysis.myColor', color);
  st.orientation = color;
  if (cg) cg.set({ orientation: color });
  await setSetting('board.orientation', color);

  if (autoplayOn) {
    await setSetting('analysis.enginePlays', color);
    toast(`Playing as ${color === 'white' ? 'White' : 'Black'} · Autoplay updated`);
    if (enginePlaysTurn()) {
      if (st.bestmove && currentResultValid()) maybeEnginePlays();
      else startAnalysis();
    }
  } else {
    toast(`Playing as ${color === 'white' ? 'White' : 'Black'} · Board flipped`);
  }

  renderAll();
  if (document.querySelector('.tab-body.active')?.dataset.tab === 'settings') refreshSettingsTab();
}

function onScreenPositionDetected({ placement, orientation, confidence, fen, reliable }) {
  const currentPlacement = game.fen.split(' ')[0];
  if (placement === currentPlacement) return;

  if (S.screenWatch?.autoOrientation !== false && orientation && orientation !== st.orientation) {
    st.orientation = orientation;
    applyTheme();
  }

  // Square-by-square diff memory: understands what moved and whose turn is next
  const diff = analyzeMoveBetweenPlacements(currentPlacement, placement, game.turn);

  if (diff && (diff.type === 'move' || diff.type === 'capture' || diff.type === 'castle')) {
    if (game.turn !== diff.moverColor) {
      game.setTurn(diff.moverColor);
    }
    const rec = game.playUci(diff.uci);
    if (rec) {
      afterPositionChange({ moved: rec });
      toast(`Move: ${rec.san} · ${diff.nextTurn === 'w' ? 'White' : 'Black'} to play`);
      if (S.screenWatch?.autoAnalyze !== false) maybeAutoAnalyze();
      if (document.querySelector('.tab-body.active')?.dataset.tab === 'screen') refreshScreenTab();
      return;
    }
  }

  // Legal move check on current board
  const chess = game.chess();
  let matchingMove = null;
  for (const m of chess.moves({ verbose: true })) {
    const clone = makeChess(game.fen);
    clone.move(m);
    if (clone.fen().split(' ')[0] === placement) {
      matchingMove = m;
      break;
    }
  }

  if (matchingMove) {
    const rec = game.play(matchingMove);
    if (rec) {
      afterPositionChange({ moved: rec });
      toast(`Move: ${rec.san} · ${game.turn === 'w' ? 'White' : 'Black'} to play`);
    }
  } else {
    // Multi-move update or mid-game sync
    const turn = diff?.nextTurn || inferTurnFromPlacement(placement);
    const newFen = `${placement} ${turn} - - 0 1`;
    game.reset(newFen);
    afterPositionChange({});
    toast(`Board updated · ${turn === 'w' ? 'White' : 'Black'} to play`);
  }

  if (S.screenWatch?.autoAnalyze !== false) {
    maybeAutoAnalyze();
  }

  if (document.querySelector('.tab-body.active')?.dataset.tab === 'screen') {
    refreshScreenTab();
  }
}

function squareToScreenCoords(square, corners, orientation) {
  if (!corners || !square || square.length < 2) return null;
  const { x0, y0, x1, y1 } = corners;
  const bw = x1 - x0;
  const bh = y1 - y0;
  if (bw <= 0 || bh <= 0) return null;
  const sqW = bw / 8;
  const sqH = bh / 8;

  const file = square.charCodeAt(0) - 97; // 'a'->0, 'h'->7
  const rank = parseInt(square[1], 10);   // 1 to 8
  if (file < 0 || file > 7 || rank < 1 || rank > 8) return null;

  let col, row;
  if (orientation === 'black') {
    col = 7 - file;
    row = rank - 1;
  } else {
    // white orientation
    col = file;
    row = 8 - rank;
  }

  return {
    x: x0 + (col + 0.5) * sqW,
    y: y0 + (row + 0.5) * sqH,
  };
}

function uciMoveToScreenCoords(uci, corners, orientation) {
  if (!uci || uci.length < 4 || !corners) return null;
  const fromSquare = uci.slice(0, 2);
  const toSquare = uci.slice(2, 4);
  const from = squareToScreenCoords(fromSquare, corners, orientation);
  const to = squareToScreenCoords(toSquare, corners, orientation);
  if (!from || !to) return null;
  return {
    fromSquare,
    toSquare,
    fromX: from.x,
    fromY: from.y,
    toX: to.x,
    toY: to.y,
    promotion: uci[4] || null,
  };
}

function getEffectiveBoardCorners() {
  const calib = S.screenWatch?.calibratedBoard;
  if (calib && calib.x0 !== undefined && calib.x1 !== undefined) {
    return {
      corners: {
        x0: calib.x0,
        y0: calib.y0,
        x1: calib.x1,
        y1: calib.y1,
      },
      isCalibrated: true,
    };
  }
  const sw = screenWatcher.state;
  if (sw.boardFound && sw.corners) {
    return {
      corners: sw.corners,
      isCalibrated: false,
    };
  }
  return null;
}

async function testClickSquare(square = 'e4') {
  const effective = getEffectiveBoardCorners();
  if (!effective) {
    toast('Board not calibrated yet! Opening frame — drag it over your board & Save.', 'error');
    if (api.screen?.openCalibration) {
      api.screen.openCalibration();
    }
    return false;
  }
  const sw = screenWatcher.state;
  const orientation = sw.orientation || st.orientation || 'white';
  const pos = squareToScreenCoords(square, effective.corners, orientation);
  if (!pos) {
    toast(`Could not calculate coordinates for ${square}`, 'error');
    return false;
  }
  toast(`Moving mouse to square ${square}...`);
  const ok = await api.screen.movePiece({
    fromX: pos.x,
    fromY: pos.y,
    toX: pos.x,
    toY: pos.y,
    method: 'click',
    restoreCursor: false, // Don't restore cursor so user sees exactly where it landed!
    isCalibrated: effective.isCalibrated,
    sourceWidth: sw.sourceWidth,
    sourceHeight: sw.sourceHeight,
  });
  if (ok) {
    toast(`Mouse moved to square ${square}! Check if it landed directly in the center.`);
  } else {
    toast(`Could not move mouse to ${square}`, 'error');
  }
  return ok;
}

function checkGameOverAndStop() {
  if (S.analysis?.stopOnGameOver === false) return false;
  const gs = game.gameState();
  if (gs && gs.over) {
    if (S.analysis?.enginePlays && S.analysis.enginePlays !== 'none') {
      clearTimeout(st.timers.autoPlay);
      setSetting('analysis.enginePlays', 'none');
      const myColor = S.analysis?.myColor || 'white';
      const isWin = (gs.text?.includes('White wins') && myColor === 'white') ||
                    (gs.text?.includes('Black wins') && myColor === 'black');
      const isLoss = (gs.text?.includes('White wins') && myColor === 'black') ||
                     (gs.text?.includes('Black wins') && myColor === 'white');
      let msg = gs.text || 'Game over';
      if (isWin) msg = `Victory! ${msg}`;
      else if (isLoss) msg = `Defeat — ${msg}`;
      toast(`${msg} · Autoplay stopped`, isLoss ? 'error' : '');
      renderBest();
      return true;
    }
  }
  return false;
}

function maybeEnginePlays() {
  if (!enginePlaysTurn() || !st.bestmove || !currentResultValid()) return;
  if (game.cursor !== game.moves.length) return;
  if (checkGameOverAndStop()) return;

  const fen = game.fen;
  const uci = st.bestmove;
  clearTimeout(st.timers.autoPlay);
  st.timers.autoPlay = setTimeout(async () => {
    if (game.fen !== fen || st.mode !== 'play') return;
    if (checkGameOverAndStop()) return;

    // Physical screen click if enabled
    if (S.analysis?.screenClick !== false) {
      const effective = getEffectiveBoardCorners();
      if (!effective) {
        toast('Autoplay paused: board not calibrated or detected! Drag frame over board & save.', 'error');
        return;
      }

      const sw = screenWatcher.state;
      const orientation = sw.orientation || st.orientation || 'white';
      const coords = uciMoveToScreenCoords(uci, effective.corners, orientation);
      if (!coords) {
        toast(`Could not calculate coordinates for move ${uci}`, 'error');
        return;
      }

      if (api.screen?.movePiece) {
        // Pause screen watcher to avoid scanning the piece mid-animation
        if (screenWatcher.pause) screenWatcher.pause(1000);
        try {
          const ok = await api.screen.movePiece({
            ...coords,
            method: S.analysis?.mouseMethod || 'click',
            sourceWidth: sw.sourceWidth,
            sourceHeight: sw.sourceHeight,
            isCalibrated: effective.isCalibrated,
            restoreCursor: S.analysis?.restoreCursor ?? false,
            delayMs: 70,
          });
          if (!ok) {
            toast(`Physical mouse move failed for ${uci}`, 'error');
            return;
          }
          // Small delay so web DOM registers the release event
          await new Promise((r) => setTimeout(r, 140));
        } catch (e) {
          console.warn('Physical screen click failed:', e);
          toast(`Physical screen click error: ${e.message}`, 'error');
          return;
        }
      }
    }

    const rec = game.playUci(uci);
    if (rec) {
      afterPositionChange({ moved: rec });
      toast(`Autoplay moved: ${rec.san}`);
      checkGameOverAndStop();
    }
  }, S.analysis.autoPlayDelay);
}

function startProgressTimer() {
  clearInterval(st.timers.progress);
  st.timers.progress = setInterval(() => {
    if (!st.searching) {
      clearInterval(st.timers.progress);
      renderProgress();
      return;
    }
    renderProgress();
  }, 100);
}

// ---------------------------------------------------------------- arrows

function updateArrows() {
  if (!cg) return;
  const shapes = [];
  if (S.display.arrows !== 'off' && st.mode !== 'edit' && currentResultValid()) {
    const lines = st.lines.slice(0, S.display.arrows === 'best' ? 1 : S.display.maxArrows);
    if (!lines.length && st.bestmove) lines.push({ pv: [st.bestmove] });
    const multi = lines.length > 1;
    lines.forEach((l, i) => {
      const u = l.pv?.[0];
      if (!u) return;
      const shape = {
        orig: u.slice(0, 2),
        dest: u.slice(2, 4),
        brush: `a${i % ARROW_COLORS.length}`,
        modifiers: { lineWidth: i === 0 ? 14 : Math.max(6, 11 - i * 2) },
      };
      if (S.display.arrowLabels && multi && l.score) {
        shape.label = { text: F.shortScore(viewScore(l.score, st.search.turn)) };
      }
      shapes.push(shape);
    });
    const reply = lines[0]?.pv?.[1];
    if (S.display.showReply && reply) {
      shapes.push({ orig: reply.slice(0, 2), dest: reply.slice(2, 4), brush: 'reply', modifiers: { lineWidth: 7 } });
    }
  }
  cg.setAutoShapes(shapes);
}

// ---------------------------------------------------------------- rendering

function scheduleRender() {
  if (st.renderQueued) return;
  st.renderQueued = true;
  requestAnimationFrame(() => {
    st.renderQueued = false;
    renderAnalysis();
  });
}

function renderAll() {
  renderEditPanel();
  renderAnalysis();
  renderMoves();
  renderStatus();
  renderToolbar();
  layoutBoard();
}

function renderAnalysis() {
  renderBest();
  renderEvalBar();
  renderLines();
  renderStats();
  renderProgress();
  updateArrows();
  renderEnginePill();
}

function bestInfo() {
  const valid = currentResultValid();
  const line = valid ? st.lines[0] : null;
  const uci = bestUci();
  let san = null;
  if (uci) {
    const mv = F.pvMoves(game.fen, [uci], 1)[0];
    san = mv ? moveLabel(mv.san, uci) : uci;
  }
  const score = line ? viewScore(line.score, st.search.turn) : null;
  return { uci, san, score, line };
}

function renderBest() {
  const { san, score, line } = bestInfo();
  const blocked = blockedReason();
  const turnName = st.mode === 'edit' ? colorName(st.editTurn) : colorName(game.turn);

  // Turn Pill
  const turnPill = $('turnPill');
  if (turnPill) {
    const turnTxt = $('turnText');
    const turnDot = $('turnDot');
    if (turnTxt) turnTxt.textContent = `${turnName === 'white' ? 'White' : 'Black'} to play`;
    if (turnDot) turnDot.classList.toggle('black', turnName === 'black');
  }

  $('bestLabel').textContent = `Best move · ${turnName[0].toUpperCase()}${turnName.slice(1)} to play`;
  $('bestMove').textContent = san || (st.searching ? '…' : '—');

  // Rating out of 10 badge
  const ratingBadge = $('bestRatingBadge');
  const cRating = $('cRating');
  if (san && score && !blocked) {
    if (ratingBadge) {
      ratingBadge.textContent = '10/10 ★';
      ratingBadge.style.display = 'inline-flex';
      ratingBadge.className = 'rating-badge best';
      ratingBadge.title = 'Top engine choice (rated 10/10)';
    }
    if (cRating) {
      cRating.textContent = '10/10';
      cRating.style.display = 'inline-flex';
    }
  } else {
    if (ratingBadge) ratingBadge.style.display = 'none';
    if (cRating) cRating.style.display = 'none';
  }

  const evalEl = $('bestEval');
  evalEl.textContent = score ? F.formatScore(score, S.display.scoreFormat) : '';
  evalEl.className = `best-eval ${score ? F.scoreClass(score) : ''}`;
  evalEl.style.display = score ? '' : 'none';

  let meta;
  if (blocked) meta = blocked;
  else if (line || st.searching) {
    const s = st.stats;
    const parts = [];
    if (s.depth) parts.push(`Depth ${s.depth}${s.seldepth ? '/' + s.seldepth : ''}`);
    if (s.nps) parts.push(F.formatNps(s.nps));
    if (s.time !== undefined) parts.push(F.formatMs(s.time));
    if (!st.searching && st.bestmove) parts.push('done');
    meta = parts.join(' · ') || 'Thinking…';
  } else if (st.engine.state === 'error') meta = st.engine.message || 'Engine error';
  else meta = S.analysis.autoAnalyze ? 'Move a piece or press Analyze' : 'Press Analyze (Space) to calculate';
  $('bestMeta').textContent = meta;

  const isWatching = screenWatcher.isWatching();
  if (isWatching && !st.searching && !line) {
    const swSt = screenWatcher.state;
    meta = swSt.boardFound
      ? `Screen active (${swSt.confidence}% confidence) · Stockfish ready`
      : 'Watching screen · Scanning for chessboard…';
    $('bestMeta').textContent = meta;
  }

  const btn = $('btnAnalyze');
  btn.innerHTML = st.searching
    ? '<svg><use href="#i-stop"/></svg><span>Stop</span>'
    : '<svg><use href="#i-play"/></svg><span>Analyze</span>';
  btn.disabled = !!blocked;

  const btnWatch = $('btnWatchScreen');
  if (btnWatch) {
    btnWatch.classList.toggle('watching', isWatching);
    btnWatch.innerHTML = isWatching
      ? '<svg><use href="#i-scan"/></svg><span>Watching…</span>'
      : '<svg><use href="#i-scan"/></svg><span>Watch Screen</span>';
  }

  const btnAutoplay = $('btnAutoplay');
  const cAutoplay = $('cAutoplay');
  const autoplayOn = S.analysis?.enginePlays && S.analysis.enginePlays !== 'none';
  const myColor = S.analysis?.myColor || 'white';
  const myColorName = myColor === 'white' ? 'White' : 'Black';

  if (btnAutoplay) {
    btnAutoplay.classList.toggle('autoplay-on', !!autoplayOn);
    const txt = $('autoplayBtnText');
    if (txt) {
      txt.textContent = autoplayOn ? `Autoplay: ${myColorName}` : 'Autoplay: Off';
    }
    btnAutoplay.title = autoplayOn
      ? `Autoplay is ON for ${myColorName} — click to turn Off (A)`
      : `Turn Autoplay ON for ${myColorName} (A)`;
  }

  if (cAutoplay) {
    cAutoplay.classList.toggle('autoplay-on', !!autoplayOn);
    cAutoplay.title = autoplayOn ? `Autoplay: ON (${myColorName})` : 'Autoplay: Off';
  }

  const btnWhite = $('btnColorWhite');
  const btnBlack = $('btnColorBlack');
  if (btnWhite) btnWhite.classList.toggle('active', myColor === 'white');
  if (btnBlack) btnBlack.classList.toggle('active', myColor === 'black');

  const btnPlay = $('btnPlayBest');
  if (btnPlay) {
    btnPlay.classList.toggle('watching', isWatching);
    btnPlay.title = isWatching ? 'Stop watching screen' : 'Watch screen & update automatically';
    btnPlay.innerHTML = isWatching
      ? '<svg><use href="#i-scan"/></svg><span>Watching…</span>'
      : '<svg><use href="#i-bolt"/></svg><span>Play</span>';
  }
  $('app').classList.toggle('searching', st.searching);

  // compact view mirrors this
  $('cMove').textContent = san || (st.searching ? '…' : '—');
  const cEval = $('cEval');
  cEval.textContent = score ? F.formatScore(score, S.display.scoreFormat) : '';
  cEval.className = `compact-eval ${score ? F.scoreClass(score) : ''}`;
  cEval.style.display = score ? '' : 'none';
  $('cMeta').textContent = blocked || (st.stats.depth ? `d${st.stats.depth}` : (st.searching ? 'thinking' : (isWatching ? 'watching' : '')));
  $('cAnalyze').innerHTML = st.searching ? '<svg><use href="#i-stop"/></svg>' : '<svg><use href="#i-play"/></svg>';
  const cWatch = $('cWatch');
  if (cWatch) {
    cWatch.classList.toggle('watching', isWatching);
    cWatch.title = isWatching ? 'Stop watching screen' : 'Watch screen (auto-detect)';
  }
}

function renderEvalBar() {
  const bar = $('evalbar');
  const line = currentResultValid() ? st.lines[0] : null;
  const ws = line ? F.whiteScore(line.score, st.search.turn) : null;
  const pct = ws ? F.scoreToWinPct(ws) : 50;
  bar.classList.toggle('flipped', st.orientation === 'black');
  $('evalFill').style.height = `${pct}%`;
  const txt = $('evalText');
  txt.textContent = ws ? F.shortScore(ws).replace('+', '') : '';
  const whiteBetter = pct >= 50;
  const atTop = (st.orientation === 'white') !== whiteBetter;
  txt.classList.toggle('top', atTop);
  txt.style.color = whiteBetter ? '#222' : '#ddd';
}

function renderLines() {
  const el = $('lines');
  if (!currentResultValid() || !st.lines.length) {
    const blocked = blockedReason();
    let msg;
    if (blocked) msg = blocked;
    else if (st.searching) msg = 'Thinking…';
    else if (st.engine.state === 'error') msg = st.engine.message || 'The engine could not start.';
    else msg = 'Press <kbd>Space</kbd> or <b>Analyze</b> to see the best lines.<br>Drag pieces to play moves, or press <kbd>E</kbd> to set up any position.';
    el.innerHTML = `<div class="empty">${msg}</div>`;
    return;
  }
  const fen = st.search.fen;
  const startNum = F.moveNumberOf(fen);
  const html = st.lines.map((l, i) => {
    const s = viewScore(l.score, st.search.turn);
    const moves = F.pvMoves(fen, l.pv, S.display.pvLength);
    let num = startNum;
    const parts = [];
    moves.forEach((m, j) => {
      if (m.color === 'w') parts.push(`<span class="num">${num}.</span>`);
      else if (j === 0) parts.push(`<span class="num">${num}…</span>`);
      parts.push(`<span class="mv${j === 0 ? ' first' : ''}" data-line="${i}" data-idx="${j}">${F.escapeHtml(moveLabel(m.san, m.uci))}</span>`);
      if (m.color === 'b') num++;
    });
    const bestScore = viewScore(st.lines[0]?.score, st.search.turn);
    const rating = F.rateMoveOutOf10(s, bestScore);
    const ratingCls = F.ratingClass(rating);
    const bound = l.score.bound ? (l.score.bound === 'lowerbound' ? '≥' : '≤') : '';
    const color = S.display.arrows === 'all' && i < S.display.maxArrows ? ARROW_COLORS[i % ARROW_COLORS.length] : 'transparent';
    return `<div class="line" style="--arrow:${color}"><span class="rating-badge line-rating ${ratingCls}" title="Move quality score out of 10">${rating}</span><div class="score ${F.scoreClass(s)}">${bound}${F.formatScore(s, S.display.scoreFormat)}</div><div class="pv">${parts.join(' ')}<span class="depth">d${l.depth}</span></div></div>`;
  }).join('');
  el.innerHTML = html;
}

function renderStats() {
  const el = $('stats');
  if (!S.display.showStats || !currentResultValid()) {
    el.innerHTML = '';
    return;
  }
  const s = st.stats;
  const parts = [
    `Depth <b>${s.depth ?? '–'}</b>${s.seldepth ? '/' + s.seldepth : ''}`,
    `Nodes <b>${F.formatNodes(s.nodes)}</b>`,
    `Speed <b>${F.formatNps(s.nps)}</b>`,
    `Time <b>${s.time !== undefined ? F.formatMs(s.time) : '–'}</b>`,
  ];
  if (s.hashfull !== undefined) parts.push(`Hash <b>${(s.hashfull / 10).toFixed(0)}%</b>`);
  if (s.tbhits) parts.push(`TB <b>${F.formatNodes(s.tbhits)}</b>`);
  let wdl = '';
  const line = st.lines[0];
  if (S.display.showWdl && line?.wdl) {
    let [w, d, l] = line.wdl;
    if (S.display.perspective === 'white' && st.search.turn === 'b') [w, l] = [l, w];
    parts.push(`W/D/L <b>${(w / 10).toFixed(0)}/${(d / 10).toFixed(0)}/${(l / 10).toFixed(0)}%</b>`);
    wdl = `<div class="wdl"><span style="width:${w / 10}%"></span><span style="width:${d / 10}%"></span><span style="width:${l / 10}%"></span></div>`;
  }
  el.innerHTML = parts.map((p) => `<span>${p}</span>`).join('') + wdl;
}

function renderProgress() {
  const fill = $('progressFill');
  if (!st.searching || !st.search) {
    fill.classList.remove('indeterminate');
    fill.style.width = st.bestmove && currentResultValid() ? '100%' : '0';
    fill.style.opacity = st.bestmove ? '0.35' : '1';
    return;
  }
  fill.style.opacity = '1';
  const l = st.search.limits;
  let pct = null;
  if (l.mode === 'time') pct = Math.min(1, (performance.now() - st.search.startedAt) / l.movetime);
  else if (l.mode === 'depth' && st.stats.depth) pct = Math.min(1, st.stats.depth / l.depth);
  else if (l.mode === 'nodes' && st.stats.nodes) pct = Math.min(1, st.stats.nodes / l.nodes);
  if (pct === null) {
    fill.classList.add('indeterminate');
  } else {
    fill.classList.remove('indeterminate');
    fill.style.width = `${(pct * 100).toFixed(1)}%`;
  }
}

function renderEnginePill() {
  const pill = $('enginePill');
  const state = st.engine.state === 'ready' && st.searching ? 'searching' : st.engine.state;
  pill.dataset.state = state;
  const name = st.engine.name || 'Engine';
  $('engineName').textContent = st.engine.state === 'starting' ? `Starting ${name}…`
    : st.engine.state === 'error' ? `${name}: error` : name;
  pill.title = st.engine.message || `${name}${st.engine.author ? ' by ' + st.engine.author : ''} — click for engine settings`;
}

function renderMoves() {
  const el = $('movelist');
  const fenInput = $('fenInput');
  if (document.activeElement !== fenInput) fenInput.value = game.fen;
  if (!game.moves.length) {
    el.innerHTML = '<div class="empty" style="grid-column:1/-1">No moves yet. Moves you make on the board show up here.</div>';
    return;
  }
  const rootTurn = game.rootFen.split(' ')[1];
  let num = F.moveNumberOf(game.rootFen);
  const cells = [];
  let i = 0;
  if (rootTurn === 'b') {
    cells.push(`<div class="n">${num}.</div><div class="m blank">…</div>`);
    cells.push(cellFor(0));
    i = 1;
    num++;
  }
  for (; i < game.moves.length; i += 2) {
    cells.push(`<div class="n">${num}.</div>`);
    cells.push(cellFor(i));
    cells.push(i + 1 < game.moves.length ? cellFor(i + 1) : '<div class="m blank"></div>');
    num++;
  }
  el.innerHTML = cells.join('');
  const cur = el.querySelector('.m.cur');
  if (cur) cur.scrollIntoView({ block: 'nearest' });

  function cellFor(idx) {
    const m = game.moves[idx];
    return `<div class="m${game.cursor === idx + 1 ? ' cur' : ''}" data-ply="${idx + 1}">${F.escapeHtml(moveLabel(m.san, m.uci))}</div>`;
  }
}

function renderStatus() {
  const el = $('statusLine');
  const problem = positionProblem(game.fen);
  let text = null;
  let info = false;
  if (problem) text = `Can't analyze: ${problem}`;
  else if (st.mode !== 'edit') {
    const gs = game.gameState();
    if (gs.over) { text = gs.text; info = true; }
  }
  const wasHidden = el.hidden;
  el.hidden = !text;
  el.textContent = text || '';
  el.className = `status-line${info ? ' info' : ''}`;
  if (wasHidden !== el.hidden) layoutBoard();
}

function renderToolbar() {
  $('btnFirst').disabled = game.cursor === 0;
  $('btnPrev').disabled = game.cursor === 0;
  $('btnNext').disabled = game.cursor >= game.moves.length;
  $('btnLast').disabled = game.cursor >= game.moves.length;
  $('btnEdit').classList.toggle('on', st.mode === 'edit');
}

// ---------------------------------------------------------------- tabs

function selectTab(tab) {
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-body').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  if (S.ui.tab !== tab) setSetting('ui.tab', tab, { quiet: true });
  if (tab === 'screen') refreshScreenTab();
  if (tab === 'settings') refreshSettingsTab();
  if (tab === 'engine') refreshEngineTab();
  if (tab === 'console') renderConsole(true);
}

async function refreshScreenTab() {
  renderScreenTab($('screenBody'), S, setSetting);
  await refreshScreenSources();
  if (document.querySelector('.tab-body.active')?.dataset.tab === 'screen') {
    renderScreenTab($('screenBody'), S, setSetting);
  }
}

function refreshSettingsTab() {
  const body = $('settingsBody');
  const scroll = body.scrollTop;
  renderSettings(body, {
    S,
    set: setSetting,
    failedHotkeys: st.failedHotkeys,
    actions: {
      resetPosition: () => api.win.resetPosition(),
      size: (w, hgt) => api.win.setSize(w, hgt),
      exportSettings: async () => { if (await api.settings.exportFile()) toast('Settings exported'); },
      importSettings: async () => {
        const s = await api.settings.importFile();
        if (s) { S = s; fullRefresh(); toast('Settings imported'); }
      },
      resetSettings: async () => {
        if (!confirm('Reset every setting to its default?')) return;
        S = await api.settings.reset();
        st.orientation = S.board.orientation;
        fullRefresh();
        toast('Settings reset');
      },
    },
  });
  body.scrollTop = scroll;
}

async function refreshEngineTab(info) {
  if (info) st.engineInfo = info;
  else st.engineInfo = await api.engine.info();
  const body = $('engineBody');
  const scroll = body.scrollTop;
  renderEngineTab(body, {
    info: st.engineInfo,
    appInfo: st.appInfo,
    setOption: async (name, value) => {
      const wasSearching = st.searching;
      const res = await api.engine.setOption(name, value);
      refreshEngineTab(res);
      if (wasSearching) startAnalysis();
      else maybeAutoAnalyze();
    },
    pressButton: async (name) => {
      const res = await api.engine.pressButton(name);
      refreshEngineTab(res);
      toast(`${name} done`);
    },
    select: async (id) => {
      cancelAnalysis();
      const res = await api.engine.select(id);
      refreshEngineTab(res);
      S = await api.settings.get();
      maybeAutoAnalyze();
    },
    add: async () => {
      const res = await api.engine.add();
      if (res?.error) { toast(res.error, 'error'); return; }
      if (res?.canceled) return;
      cancelAnalysis();
      S = await api.settings.get();
      refreshEngineTab(res);
      toast(`Added ${res.name}`);
      maybeAutoAnalyze();
    },
    remove: async (id) => {
      if (!confirm('Remove this engine from the list? (The file stays on disk.)')) return;
      cancelAnalysis();
      const res = await api.engine.remove(id);
      S = await api.settings.get();
      refreshEngineTab(res);
    },
    restart: async () => {
      cancelAnalysis();
      const res = await api.engine.restart();
      refreshEngineTab(res);
      toast('Engine restarted');
      maybeAutoAnalyze();
    },
    resetOptions: async () => {
      cancelAnalysis();
      const res = await api.engine.resetOptions();
      refreshEngineTab(res);
      toast('Engine options reset');
      maybeAutoAnalyze();
    },
    pickFolder: (title) => api.files.pickFolder(title),
  });
  body.scrollTop = scroll;
}

// ---------------------------------------------------------------- console

function onRawLines(lines) {
  if ($('consolePause').checked) return;
  st.consoleLines.push(...lines);
  if (st.consoleLines.length > 2000) st.consoleLines.splice(0, st.consoleLines.length - 2000);
  if (document.querySelector('.tab-body.active')?.dataset.tab === 'console') renderConsole();
}

function renderConsole(force = false) {
  const el = $('console');
  const showInfo = $('consoleInfo').checked;
  const atBottom = force || el.scrollHeight - el.scrollTop - el.clientHeight < 30;
  const lines = st.consoleLines.filter((l) => showInfo || !/^<info (depth|currmove)/.test(l)).slice(-800);
  el.innerHTML = lines.map((l) => {
    const cls = l[0] === '>' ? 'out' : l.startsWith('<bestmove') ? 'best' : 'in';
    return `<span class="${cls}">${F.escapeHtml(l)}</span>`;
  }).join('\n');
  if (atBottom) el.scrollTop = el.scrollHeight;
}

// ---------------------------------------------------------------- import / export

function looksLikeFen(text) {
  const first = text.trim().split(/\s+/)[0] || '';
  return /^([pnbrqkPNBRQK1-8]+\/){7}[pnbrqkPNBRQK1-8]+$/.test(first);
}

function normalizeFen(text) {
  const parts = text.trim().split(/\s+/);
  const defaults = ['', 'w', '-', '-', '0', '1'];
  for (let i = parts.length; i < 6; i++) parts.push(defaults[i]);
  return parts.slice(0, 6).join(' ');
}

function loadText(text) {
  const t = (text || '').trim();
  if (!t) { toast('Nothing to load'); return false; }
  if (looksLikeFen(t)) {
    const fen = normalizeFen(t);
    const problem = positionProblem(fen);
    setPosition(fen, { edit: problem ? true : false });
    toast(problem ? 'Position loaded in edit mode — fix it to analyze' : 'Position loaded');
    return true;
  }
  try {
    const g = new GameModel().loadPgn(t);
    if (!g.moves.length && g.rootFen === START_FEN) throw new Error('no moves');
    if (st.mode === 'edit') { st.mode = 'play'; applyTheme(); }
    game.rootFen = g.rootFen;
    game.moves = g.moves;
    game.cursor = g.cursor;
    game.headers = g.headers;
    afterPositionChange({});
    toast(`Game loaded · ${g.moves.length} moves`);
    return true;
  } catch (_) {
    toast("Couldn't read that as a FEN or PGN", 'error');
    return false;
  }
}

async function pasteFromClipboard() {
  const text = await api.clipboard.read();
  if (text && text.trim()) {
    if (loadText(text)) return;
  }
  if (api.clipboard.readImage) {
    const dataUrl = await api.clipboard.readImage();
    if (dataUrl) {
      toast('Scanning image from clipboard…');
      const img = new Image();
      img.onload = async () => {
        const res = await screenWatcher.scanImage(img);
        if (res && res.placement) {
          onScreenPositionDetected(res);
        } else {
          toast('No chessboard found in clipboard image', 'error');
        }
      };
      img.src = dataUrl;
      return;
    }
  }
  if (!text || !text.trim()) {
    toast('Clipboard is empty');
  }
}

function copyFen() {
  api.clipboard.write(game.fen);
  toast('FEN copied');
}

// ---------------------------------------------------------------- settings changes

function onSettingsChanged(path, before, quiet) {
  applyTheme();
  const top = path.split('.')[0];
  if (path === 'board.coords') createBoard();
  else if (path === 'display.arrowOpacity') { cg.set({ drawable: { brushes: brushes() } }); cg.setAutoShapes([]); }
  if (top === 'board' || top === 'display') syncBoard();
  if (path === 'board.orientation') { st.orientation = S.board.orientation; syncBoard(); renderSpares(); }
  if (path === 'display.showWdl' && S.display.showWdl) {
    const has = st.engineInfo?.options?.some((o) => o.name === 'UCI_ShowWDL');
    if (has) api.engine.setOption('UCI_ShowWDL', true).then((info) => { st.engineInfo = info; if (st.searching) startAnalysis(); });
    else toast('This engine does not report win/draw/loss');
  }
  if (top === 'analysis') {
    const restartKeys = ['analysis.mode', 'analysis.movetime', 'analysis.depth', 'analysis.nodes', 'analysis.multipv'];
    if (restartKeys.includes(path) && st.searching) startAnalysis();
    else if (!st.searching) maybeAutoAnalyze();
  }
  if (path === 'overlay.zoom' || path === 'overlay.compact' || path === 'board.maxSize') setTimeout(layoutBoard, 50);
  renderAll();
  if (!quiet && document.querySelector('.tab-body.active')?.dataset.tab === 'settings') {
    const active = document.activeElement;
    if (!(active && active.type === 'range')) refreshSettingsTab();
  }
}

function fullRefresh() {
  applyTheme();
  createBoard();
  renderSpares();
  renderEditPanel();
  renderAll();
  refreshSettingsTab();
}

// ---------------------------------------------------------------- events

function navigate(fn) {
  if (st.mode === 'edit') return;
  if (fn()) afterPositionChange({ moved: null });
}

function bindUi() {
  $('btnPin').onclick = () => setSetting('overlay.alwaysOnTop', !S.overlay.alwaysOnTop);
  $('btnGhost').onclick = () => api.win.clickThrough(true);
  $('btnCompact').onclick = () => api.win.compact();
  $('btnMin').onclick = () => api.win.minimize();
  $('btnClose').onclick = () => api.win.hide();
  $('enginePill').onclick = () => selectTab('engine');
  const turnPillBtn = $('turnPill');
  if (turnPillBtn) {
    turnPillBtn.onclick = () => {
      const next = game.turn === 'w' ? 'b' : 'w';
      game.setTurn(next);
      afterPositionChange({});
      toast(`Turn switched: ${next === 'w' ? 'White' : 'Black'} to play`);
    };
  }

  $('btnAnalyze').onclick = toggleAnalysis;
  const btnPlayBest = $('btnPlayBest');
  if (btnPlayBest) btnPlayBest.onclick = playBest;

  const btnAutoplay = $('btnAutoplay');
  if (btnAutoplay) btnAutoplay.onclick = toggleAutoplay;
  const cAutoplay = $('cAutoplay');
  if (cAutoplay) cAutoplay.onclick = toggleAutoplay;

  const btnWhite = $('btnColorWhite');
  if (btnWhite) btnWhite.onclick = () => setMyColor('white');
  const btnBlack = $('btnColorBlack');
  if (btnBlack) btnBlack.onclick = () => setMyColor('black');

  $('btnWatchScreen').onclick = toggleScreenWatch;
  const cWatch = $('cWatch');
  if (cWatch) cWatch.onclick = toggleScreenWatch;
  $('cAnalyze').onclick = toggleAnalysis;
  $('cExpand').onclick = () => api.win.compact(false);
  $('cClose').onclick = () => api.win.hide();

  $('btnFirst').onclick = () => navigate(() => game.toStart());
  $('btnPrev').onclick = () => navigate(() => game.back());
  $('btnNext').onclick = () => navigate(() => game.forward());
  $('btnLast').onclick = () => navigate(() => game.toEnd());
  $('btnFlip').onclick = flip;
  $('btnEdit').onclick = () => (st.mode === 'edit' ? exitEdit() : enterEdit());
  $('btnReset').onclick = () => setPosition(START_FEN, { edit: st.mode === 'edit' ? true : false });
  $('btnClear').onclick = () => setPosition(EMPTY_KINGS_FEN, { edit: true });
  $('btnPaste').onclick = pasteFromClipboard;
  $('btnCopyFen').onclick = copyFen;
  $('btnEditDone').onclick = exitEdit;

  $('editTurn').addEventListener('click', (e) => {
    const v = e.target.closest('button')?.dataset.v;
    if (!v) return;
    st.editTurn = v;
    onEditChange();
    syncBoard();
  });
  $('editCastling').addEventListener('change', (e) => {
    const c = e.target.dataset.c;
    if (!c) return;
    st.editCastling = { ...st.editCastling, [c]: e.target.checked };
    onEditChange();
  });

  // Right-click removes a piece while editing.
  $('board').addEventListener('mousedown', (e) => {
    if (st.mode !== 'edit' || e.button !== 2) return;
    const key = cg.getKeyAtDomPos([e.clientX, e.clientY]);
    if (key && cg.state.pieces.get(key)) {
      e.preventDefault();
      e.stopPropagation();
      cg.setPieces(new Map([[key, undefined]]));
      onEditChange();
    }
  }, true);

  $('tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('button')?.dataset.tab;
    if (tab) selectTab(tab);
  });

  $('lines').addEventListener('click', (e) => {
    const mv = e.target.closest('.mv');
    if (!mv || !currentResultValid()) return;
    const line = st.lines[Number(mv.dataset.line)];
    const idx = Number(mv.dataset.idx);
    if (!line) return;
    if (st.mode === 'edit') { st.mode = 'play'; applyTheme(); }
    let last = null;
    for (const uci of line.pv.slice(0, idx + 1)) {
      const rec = game.playUci(uci);
      if (!rec) break;
      last = rec;
    }
    if (last) afterPositionChange({ moved: last });
  });

  $('movelist').addEventListener('click', (e) => {
    const m = e.target.closest('.m[data-ply]');
    if (m) navigate(() => game.goto(Number(m.dataset.ply)));
  });

  const fenInput = $('fenInput');
  fenInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { loadText(fenInput.value); fenInput.blur(); }
    if (e.key === 'Escape') { fenInput.value = game.fen; fenInput.blur(); }
  });
  $('btnFenCopy').onclick = copyFen;
  $('btnPgnCopy').onclick = () => { api.clipboard.write(game.pgn()); toast('PGN copied'); };
  $('btnPgnSave').onclick = async () => { if (await api.files.savePgn(game.pgn())) toast('PGN saved'); };
  $('btnPgnOpen').onclick = async () => { const t = await api.files.openPgn(); if (t) loadText(t); };
  $('btnImport').onclick = openImport;
  $('importCancel').onclick = () => { $('importModal').hidden = true; };
  $('importOk').onclick = () => { if (loadText($('importText').value)) $('importModal').hidden = true; };

  $('consoleClear').onclick = () => { st.consoleLines = []; renderConsole(true); };
  $('consoleInfo').onchange = () => renderConsole(true);
  const sendConsole = () => {
    const inp = $('consoleInput');
    const cmd = inp.value.trim();
    if (!cmd) return;
    api.engine.sendRaw(cmd);
    inp.value = '';
  };
  $('consoleSend').onclick = sendConsole;
  $('consoleInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendConsole(); });

  bindGrip();
  window.addEventListener('keydown', onKey);
  new ResizeObserver(() => layoutBoard()).observe($('app'));
}

function openImport() {
  $('importModal').hidden = false;
  $('importText').value = '';
  setTimeout(() => $('importText').focus(), 30);
}

function flip() {
  st.orientation = st.orientation === 'white' ? 'black' : 'white';
  setSetting('board.orientation', st.orientation, { quiet: true });
}

function bindGrip() {
  const grip = $('grip');
  let start = null;
  let raf = 0;
  grip.addEventListener('pointerdown', async (e) => {
    grip.setPointerCapture(e.pointerId);
    const b = await api.win.getBounds();
    start = { x: e.screenX, y: e.screenY, w: b.width, h: b.height };
  });
  grip.addEventListener('pointermove', (e) => {
    if (!start) return;
    const z = S.overlay.zoom || 1;
    const w = start.w + (e.screenX - start.x) * z;
    const hgt = start.h + (e.screenY - start.y) * z;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => api.win.setSize(w, hgt));
  });
  const end = () => { start = null; };
  grip.addEventListener('pointerup', end);
  grip.addEventListener('pointercancel', end);
}

function onKey(e) {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
  if (!$('importModal').hidden) {
    if (e.key === 'Escape') $('importModal').hidden = true;
    return;
  }
  const ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteFromClipboard(); return; }
  if (ctrl && e.key.toLowerCase() === 'c' && !String(window.getSelection())) { e.preventDefault(); copyFen(); return; }
  if (ctrl && e.key.toLowerCase() === 'z') { e.preventDefault(); navigate(() => game.back()); return; }
  if (ctrl && e.key.toLowerCase() === 'y') { e.preventDefault(); navigate(() => game.forward()); return; }
  if (ctrl || e.altKey) return;
  switch (e.key) {
    case ' ': case 'Enter': e.preventDefault(); toggleAnalysis(); break;
    case 'Escape': if (!$('promo').hidden) { $('promo').hidden = true; syncBoard(); } else stopAnalysis(); break;
    case 'ArrowLeft': e.preventDefault(); navigate(() => (e.shiftKey ? game.toStart() : game.back())); break;
    case 'ArrowRight': e.preventDefault(); navigate(() => (e.shiftKey ? game.toEnd() : game.forward())); break;
    case 'Home': navigate(() => game.toStart()); break;
    case 'End': navigate(() => game.toEnd()); break;
    case 'a': case 'A': toggleAutoplay(); break;
    case 'f': case 'F': flip(); break;
    case 'e': case 'E': (st.mode === 'edit' ? exitEdit() : enterEdit()); break;
    case 'r': case 'R': $('btnReset').click(); break;
    case 'k': case 'K': $('btnClear').click(); break;
    case 'm': case 'M': api.win.compact(); break;
    case 'i': case 'I': openImport(); break;
    case 't': case 'T':
      if (st.mode === 'edit') { st.editTurn = st.editTurn === 'w' ? 'b' : 'w'; onEditChange(); syncBoard(); }
      break;
    case 'w': case 'W': if (st.mode === 'edit') { st.editTurn = 'w'; onEditChange(); syncBoard(); } break;
    case 'b': case 'B': if (st.mode === 'edit') { st.editTurn = 'b'; onEditChange(); syncBoard(); } break;
    default:
      if (/^[1-8]$/.test(e.key)) { setSetting('analysis.multipv', Number(e.key)); toast(`${e.key} line${e.key === '1' ? '' : 's'}`); }
  }
}

function onHotkey(action) {
  switch (action) {
    case 'analyze': startAnalysis(); break;
    case 'stop': stopAnalysis(); break;
    case 'playBest': toggleAutoplay(); break;
    case 'watchScreen': toggleScreenWatch(); break;
    case 'flip': flip(); break;
    case 'pasteFen': pasteFromClipboard(); break;
    case 'undo': navigate(() => game.back()); break;
    default: break;
  }
}

function applyWindowState(ws) {
  if (!ws) return;
  st.clickThrough = !!ws.clickThrough;
  const failed = ws.failedHotkeys || [];
  if (failed.length && failed.join() !== st.failedHotkeys.join()) {
    toast(`Some hotkeys are taken by other apps: ${failed.join(', ')}`, 'error');
  }
  st.failedHotkeys = failed;
  applyTheme();
  setTimeout(layoutBoard, 30);
}

function bindEngine() {
  api.engine.onStatus((s) => {
    st.engine = s;
    renderAnalysis();
    if (s.state === 'ready' && document.querySelector('.tab-body.active')?.dataset.tab === 'engine') refreshEngineTab();
  });
  api.engine.onUpdate((msg) => {
    if (!st.search || msg.searchId !== st.search.id) return;
    st.lines = msg.lines;
    st.stats = msg.stats;
    scheduleRender();
  });
  api.engine.onBestMove((msg) => {
    if (!st.search || msg.searchId !== st.search.id) return;
    st.searching = false;
    st.bestmove = msg.bestmove && msg.bestmove !== '(none)' ? msg.bestmove : null;
    if (msg.error) toast(st.engine.message || 'Engine error', 'error');
    renderAnalysis();
    maybeEnginePlays();
  });
  api.engine.onRaw(onRawLines);
  api.onHotkey(onHotkey);
  api.win.onState(applyWindowState);
  api.settings.onChanged((s) => {
    S = s;
    applyTheme();
    renderAll();
    setTimeout(layoutBoard, 40);
    if (document.querySelector('.tab-body.active')?.dataset.tab === 'settings') refreshSettingsTab();
  });
}

// ---------------------------------------------------------------- start

async function init() {
  S = await api.settings.get();
  st.appInfo = await api.app.info();
  st.orientation = S.board.orientation;
  applyTheme();
  createBoard();
  renderSpares();
  bindUi();
  bindEngine();
  screenWatcher.onPosition(onScreenPositionDetected);
  screenWatcher.onError((err) => {
    toast(err.short || err.message, 'error');
    renderBest();
  });
  screenWatcher.onStatus(() => {
    renderBest();
    if (document.querySelector('.tab-body.active')?.dataset.tab === 'screen') {
      refreshScreenTab();
    }
  });
  window.onScreenPositionDetected = onScreenPositionDetected;
  applyWindowState(await api.win.state());
  selectTab(S.ui.tab || 'lines');
  renderAll();
  setTimeout(layoutBoard, 0);
  const info = await api.engine.start();
  st.engineInfo = info;
  st.engine = { state: info.state, name: info.name, author: info.author, message: info.message };
  renderAnalysis();
  maybeAutoAnalyze();
}

// Exposed for the dev smoke test.
window.__cheeseee = {
  game, st, get S() { return S; }, get cg() { return cg; },
  startAnalysis, stopAnalysis, playBest, toggleAutoplay, setMyColor, toggleScreenWatch, onScreenPositionDetected, screenWatcher, loadText, doMove, onUserMove, afterPositionChange, enterEdit, exitEdit, setPosition, selectTab, setSetting, flip,
  squareToScreenCoords, uciMoveToScreenCoords, checkGameOverAndStop, getEffectiveBoardCorners, testClickSquare,
};

init().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<pre style="color:#f88;padding:12px">${F.escapeHtml(err.stack || err)}</pre>`);
});
