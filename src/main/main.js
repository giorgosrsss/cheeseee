const {
  app, BrowserWindow, ipcMain, globalShortcut, Tray, Menu, screen, dialog, clipboard, nativeImage,
  desktopCapturer, session, systemPreferences,
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { SettingsStore, deepMerge } = require('./settings');
const { EngineManager } = require('./engine-manager');
const { movePieceOnScreen, stopClicker, getCursorPos } = require('./mouse-automation');
const { createScreenAccess } = require('./screen-access');

const ROOT = path.join(__dirname, '..', '..');
const IS_MAC = process.platform === 'darwin';
const ICON = path.join(ROOT, 'assets', process.platform === 'win32' ? 'icon.ico' : 'icon.png');
const smokeIdx = process.argv.indexOf('--smoke');
const SMOKE_SCRIPT = smokeIdx > -1 ? process.argv[smokeIdx + 1] : null;

if (!SMOKE_SCRIPT && !app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

if (process.platform === 'win32') app.setAppUserModelId('com.cheeseee.overlay');

let win = null;
let tray = null;
let store = null;
let engines = null;
let quitting = false;
let preferredScreenSourceId = null;
const runtime = { clickThrough: false, failedHotkeys: [] };

// Every screen capture checks this first (see screen-access.js).
const screenAccess = createScreenAccess({
  isMac: IS_MAC,
  getStatus: () => systemPreferences.getMediaAccessStatus('screen'),
  probe: () => desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 16, height: 16 } }),
});
const canCaptureScreen = async () => (await screenAccess()) === 'granted';

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}

// ---------- window ----------

function onScreen(b) {
  return screen.getAllDisplays().some(({ workArea: a }) => b.x < a.x + a.width - 40 && b.x + b.width > a.x + 40
    && b.y < a.y + a.height - 40 && b.y + 30 > a.y);
}

function initialBounds() {
  const w = store.data.window;
  const compact = store.data.overlay.compact;
  const width = compact ? w.compactWidth : w.width;
  const height = compact ? w.compactHeight : w.height;
  const area = screen.getPrimaryDisplay().workArea;
  let b = { x: w.x, y: w.y, width, height };
  if (b.x === null || b.y === null || !onScreen(b)) {
    b = { width, height, x: area.x + area.width - width - 24, y: area.y + Math.max(0, Math.round((area.height - height) / 2)) };
  }
  b.height = Math.min(b.height, area.height);
  return b;
}

function setupDisplayMediaHandler() {
  if (!session.defaultSession) return;
  session.defaultSession.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      if (!(await canCaptureScreen())) return callback({});
      const sources = await desktopCapturer.getSources({ types: ['screen', 'window'] });
      let chosen = null;
      if (preferredScreenSourceId) {
        chosen = sources.find((s) => s.id === preferredScreenSourceId);
      }
      if (!chosen) {
        chosen = sources.find((s) => s.id.startsWith('screen:')) || sources[0];
      }
      if (chosen) callback({ video: chosen });
      else callback({});
    } catch (err) {
      console.error('Display media request handler error:', err);
      callback({});
    }
  });
}

function createWindow() {
  const b = initialBounds();
  win = new BrowserWindow({
    ...b,
    minWidth: 300,
    minHeight: 80,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: 'Cheeseee',
    icon: ICON,
    alwaysOnTop: store.data.overlay.alwaysOnTop,
    skipTaskbar: store.data.overlay.skipTaskbar,
    webPreferences: {
      preload: path.join(ROOT, 'src', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
      spellcheck: false,
    },
  });

  win.loadFile(path.join(ROOT, 'dist', 'index.html'));

  win.once('ready-to-show', () => {
    applyWindowSettings();
    if (!store.data.overlay.startHidden || SMOKE_SCRIPT) win.showInactive();
    if (SMOKE_SCRIPT) runSmoke();
  });

  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(store.data.overlay.zoom);
  });

  let saveTimer = null;
  const saveBounds = () => {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (!win || win.isDestroyed() || win.isMinimized()) return;
      const { x, y, width, height } = win.getBounds();
      const patch = { x, y };
      if (store.data.overlay.compact) Object.assign(patch, { compactWidth: width, compactHeight: height });
      else Object.assign(patch, { width, height });
      store.set({ window: patch });
    }, 400);
  };
  win.on('move', saveBounds);
  win.on('resize', saveBounds);

  win.on('close', (e) => {
    if (!quitting && store.data.overlay.closeToTray && tray) {
      e.preventDefault();
      win.hide();
    }
  });
  win.on('closed', () => { win = null; });

  // Keep links out of the overlay.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
}

function applyWindowSettings() {
  if (!win) return;
  const o = store.data.overlay;
  win.setAlwaysOnTop(!!o.alwaysOnTop, o.topLevel || 'floating');
  win.setSkipTaskbar(!!o.skipTaskbar);
  win.setMovable(!o.lockPosition);
  if (runtime.clickThrough) win.setIgnoreMouseEvents(true, { forward: true });
  else win.setIgnoreMouseEvents(false);
  const opacity = runtime.clickThrough ? Math.min(o.opacity, o.ghostOpacity) : o.opacity;
  win.setOpacity(Math.max(0.1, Math.min(1, opacity)));
  win.webContents.setZoomFactor(o.zoom || 1);
  try {
    app.setLoginItemSettings({
      openAtLogin: !!o.startWithWindows,
      path: process.execPath,
      args: app.isPackaged ? [] : [path.resolve(ROOT)],
    });
  } catch (_) { /* not supported in this environment */ }
  if (IS_MAC) applyMacWindowSettings(o);
  updateTray();
}

// macOS has a Dock instead of a taskbar, and a window only floats over fullscreen
// apps when the app has no Dock icon. Only act on changes, since Dock calls are slow.
const macState = { dockHidden: false, overFullscreen: false };
function applyMacWindowSettings(o) {
  const overFullscreen = !!o.alwaysOnTop && o.topLevel === 'screen-saver';
  const hideDock = !!o.skipTaskbar || overFullscreen;
  if (hideDock !== macState.dockHidden) {
    macState.dockHidden = hideDock;
    if (hideDock) app.dock.hide();
    else Promise.resolve(app.dock.show()).catch(() => {});
  }
  if (overFullscreen !== macState.overFullscreen) {
    macState.overFullscreen = overFullscreen;
    win.setVisibleOnAllWorkspaces(overFullscreen, { visibleOnFullScreen: overFullscreen, skipTransformProcessType: true });
  }
}

// Without an Edit menu, Cmd+C / Cmd+V don't work in text fields on macOS.
// Electron's default menu would also add Cmd+R, which reloads the whole interface.
function setupMacMenu() {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    { role: 'appMenu' },
    { role: 'editMenu' },
    { role: 'windowMenu' },
  ]));
}

function sendWindowState() {
  send('window:state', {
    clickThrough: runtime.clickThrough,
    compact: !!store.data.overlay.compact,
    visible: !!(win && win.isVisible()),
    failedHotkeys: runtime.failedHotkeys,
  });
}

function setCompact(on) {
  if (!win) return;
  const cur = win.getBounds();
  const { x, y } = cur;
  if (on && !store.data.overlay.compact) store.set({ window: { width: cur.width, height: cur.height } });
  if (!on && store.data.overlay.compact) store.set({ window: { compactWidth: cur.width, compactHeight: cur.height } });
  const w = store.data.window;
  store.set({ overlay: { compact: on } });
  if (on) win.setBounds({ x, y, width: w.compactWidth, height: w.compactHeight });
  else {
    const area = screen.getDisplayMatching(win.getBounds()).workArea;
    const height = Math.min(w.height, area.height);
    const ny = Math.min(y, area.y + area.height - height);
    win.setBounds({ x, y: Math.max(area.y, ny), width: w.width, height });
  }
  send('settings:changed', store.data);
  sendWindowState();
  updateTray();
}

function setClickThrough(on) {
  runtime.clickThrough = !!on;
  applyWindowSettings();
  sendWindowState();
}

function toggleVisible() {
  if (!win) return;
  if (win.isVisible()) win.hide();
  else {
    win.showInactive();
    win.moveTop();
  }
  sendWindowState();
  updateTray();
}

function resetPosition() {
  if (!win) return;
  const area = screen.getPrimaryDisplay().workArea;
  const { width } = win.getBounds();
  const height = Math.min(win.getBounds().height, area.height);
  win.setBounds({ x: area.x + area.width - width - 24, y: area.y + 24, width, height });
  win.show();
}

function setOverlay(patch) {
  store.set({ overlay: patch });
  applyWindowSettings();
  send('settings:changed', store.data);
}

// ---------- tray ----------

function updateTray() {
  if (!tray) return;
  const o = store.data.overlay;
  const menu = Menu.buildFromTemplate([
    { label: win && win.isVisible() ? 'Hide overlay' : 'Show overlay', click: toggleVisible },
    { type: 'separator' },
    { label: 'Watch screen (auto-detect)', click: () => send('hotkey', 'watchScreen') },
    { label: 'Analyze position', click: () => send('hotkey', 'analyze') },
    { label: 'Stop engine', click: () => send('hotkey', 'stop') },
    { type: 'separator' },
    { label: 'Click-through (ghost) mode', type: 'checkbox', checked: runtime.clickThrough, click: (i) => setClickThrough(i.checked) },
    { label: 'Compact mode', type: 'checkbox', checked: !!o.compact, click: (i) => setCompact(i.checked) },
    { label: 'Always on top', type: 'checkbox', checked: !!o.alwaysOnTop, click: (i) => setOverlay({ alwaysOnTop: i.checked }) },
    { label: 'Lock position', type: 'checkbox', checked: !!o.lockPosition, click: (i) => setOverlay({ lockPosition: i.checked }) },
    { label: 'Move window back on screen', click: resetPosition },
    { type: 'separator' },
    { label: 'Quit Cheeseee', click: () => { quitting = true; app.quit(); } },
  ]);
  tray.setContextMenu(menu);
}

function trayImage() {
  if (!IS_MAC) return nativeImage.createFromPath(ICON);
  // The menu bar wants an 18pt icon, plus a 2x version for Retina screens.
  const src = nativeImage.createFromPath(path.join(ROOT, 'assets', 'icon.png'));
  const img = nativeImage.createEmpty();
  for (const scaleFactor of [1, 2]) {
    const px = 18 * scaleFactor;
    img.addRepresentation({ scaleFactor, buffer: src.resize({ width: px, height: px, quality: 'best' }).toPNG() });
  }
  return img;
}

function createTray() {
  try {
    tray = new Tray(trayImage());
    tray.setToolTip('Cheeseee chess overlay');
    tray.on('click', toggleVisible);
    updateTray();
  } catch (err) {
    console.error('Tray unavailable:', err);
    tray = null;
  }
}

// ---------- hotkeys ----------

const MAIN_ACTIONS = {
  toggleVisible,
  clickThrough: () => setClickThrough(!runtime.clickThrough),
  compact: () => setCompact(!store.data.overlay.compact),
  alwaysOnTop: () => setOverlay({ alwaysOnTop: !store.data.overlay.alwaysOnTop }),
  opacityUp: () => setOverlay({ opacity: Math.min(1, Math.round((store.data.overlay.opacity + 0.1) * 10) / 10) }),
  opacityDown: () => setOverlay({ opacity: Math.max(0.2, Math.round((store.data.overlay.opacity - 0.1) * 10) / 10) }),
};

function registerHotkeys() {
  globalShortcut.unregisterAll();
  const failed = [];
  for (const [action, accel] of Object.entries(store.data.hotkeys)) {
    if (!accel) continue;
    const handler = MAIN_ACTIONS[action] || (() => send('hotkey', action));
    try {
      if (!globalShortcut.register(accel, handler)) failed.push(action);
    } catch (_) {
      failed.push(action);
    }
  }
  runtime.failedHotkeys = failed;
  sendWindowState();
  return failed;
}

let calibWin = null;

function openCalibrationWindow() {
  if (calibWin && !calibWin.isDestroyed()) {
    calibWin.focus();
    return;
  }
  const defaultBounds = store.data.screenWatch?.calibratedBoard || { x: 300, y: 150, width: 640, height: 640 };
  calibWin = new BrowserWindow({
    x: defaultBounds.x || 300,
    y: defaultBounds.y || 150,
    width: defaultBounds.width || 640,
    height: (defaultBounds.height || 640) + 40,
    minWidth: 200,
    minHeight: 200,
    frame: true,
    title: 'Cheeseee — Drag & Resize over your Chessboard',
    alwaysOnTop: true,
    skipTaskbar: false,
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, '..', 'preload.js'),
    },
  });

  calibWin.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <title>Cheeseee — Drag & Resize over your Chessboard</title>
      <style>
        * { box-sizing: border-box; margin: 0; padding: 0; user-select: none; }
        html, body {
          width: 100%; height: 100%;
          background: rgba(10, 10, 14, 0.5);
          overflow: hidden;
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
          display: flex; flex-direction: column;
        }
        .banner {
          height: 38px;
          background: rgba(16, 185, 129, 0.95);
          color: #022c22;
          display: flex; align-items: center; justify-content: space-between;
          padding: 0 12px;
          font-size: 12px; font-weight: 700;
          flex: none;
          box-shadow: 0 2px 8px rgba(0,0,0,0.3);
        }
        .btn-save {
          background: #022c22;
          color: #fff;
          border: none;
          border-radius: 4px;
          padding: 5px 14px;
          font-size: 11.5px;
          font-weight: 800;
          cursor: pointer;
          transition: transform 0.1s, background 0.15s;
        }
        .btn-save:hover { background: #064e3b; transform: scale(1.03); }
        .grid-wrap {
          flex: 1; min-height: 0;
          display: flex;
          position: relative;
          border: 3px solid #10b981;
          box-shadow: inset 0 0 20px rgba(16, 185, 129, 0.3);
        }
        .grid {
          width: 100%; height: 100%;
          display: grid;
          grid-template-columns: repeat(8, 1fr);
          grid-template-rows: repeat(8, 1fr);
          pointer-events: none;
        }
        .cell {
          border: 1px dashed rgba(16, 185, 129, 0.35);
        }
        .cell:nth-child(even) {
          background: rgba(16, 185, 129, 0.05);
        }
      </style>
    </head>
    <body>
      <div class="banner">
        <span>Resize & drag this window to match your chessboard</span>
        <button class="btn-save" id="btnSave">✓ Save & Lock Calibration</button>
      </div>
      <div class="grid-wrap" id="gridWrap">
        <div class="grid">
          ${Array(64).fill('<div class="cell"></div>').join('')}
        </div>
      </div>
      <script>
        document.getElementById('btnSave').onclick = async () => {
          const btn = document.getElementById('btnSave');
          btn.disabled = true;
          btn.textContent = 'Saving...';
          try {
            await window.api.screen.saveCalibrationCurrentWindow();
          } finally {
            window.close();
          }
        };
      </script>
    </body>
    </html>
  `)}`);
}

// ---------- IPC ----------

function registerIpc() {
  ipcMain.handle('settings:get', () => store.data);
  ipcMain.handle('settings:set', (_e, patch) => {
    const before = store.data;
    store.set(patch);
    if (patch.overlay) applyWindowSettings();
    if (patch.overlay && 'compact' in patch.overlay && patch.overlay.compact !== before.overlay.compact) {
      setCompact(patch.overlay.compact);
    }
    if (patch.hotkeys) registerHotkeys();
    return store.data;
  });
  ipcMain.handle('settings:reset', () => {
    store.reset();
    applyWindowSettings();
    registerHotkeys();
    engines.restart();
    return store.data;
  });
  ipcMain.handle('settings:export', async () => {
    const r = await dialog.showSaveDialog(win, {
      title: 'Export settings', defaultPath: 'cheeseee-settings.json', filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, JSON.stringify(store.data, null, 2));
    return true;
  });
  ipcMain.handle('settings:import', async () => {
    const r = await dialog.showOpenDialog(win, { title: 'Import settings', filters: [{ name: 'JSON', extensions: ['json'] }], properties: ['openFile'] });
    if (r.canceled || !r.filePaths[0]) return null;
    const data = JSON.parse(fs.readFileSync(r.filePaths[0], 'utf8'));
    store.replace(deepMerge(store.data, data));
    applyWindowSettings();
    registerHotkeys();
    engines.restart();
    return store.data;
  });

  ipcMain.handle('engine:info', () => engines.info());
  ipcMain.handle('engine:start', async () => {
    try { await engines.ensure(); } catch (_) { /* status sent */ }
    return engines.info();
  });
  ipcMain.on('engine:analyze', (_e, req) => { engines.analyze(req); });
  ipcMain.on('engine:stop', () => engines.stop());
  ipcMain.handle('engine:restart', () => engines.restart());
  ipcMain.handle('engine:select', (_e, id) => engines.select(id));
  ipcMain.handle('engine:setOption', (_e, { name, value }) => engines.setOption(name, value));
  ipcMain.handle('engine:button', (_e, name) => engines.pressButton(name));
  ipcMain.handle('engine:resetOptions', () => engines.resetOptions());
  ipcMain.handle('engine:remove', (_e, id) => engines.remove(id));
  ipcMain.handle('engine:add', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Choose a UCI chess engine',
      // Mac engines have no file extension, so don't filter there.
      ...(IS_MAC ? {} : { filters: [{ name: 'Programs', extensions: ['exe'] }, { name: 'All files', extensions: ['*'] }] }),
      properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return { canceled: true };
    try {
      return await engines.add(r.filePaths[0]);
    } catch (err) {
      return { error: err.message };
    }
  });
  ipcMain.handle('engine:send', async (_e, cmd) => {
    try { await engines.sendRaw(String(cmd)); } catch (_) { /* status sent */ }
  });

  ipcMain.handle('screen:access', () => screenAccess());

  ipcMain.handle('screen:sources', async () => {
    try {
      if (!(await canCaptureScreen())) return [];
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 320, height: 180 },
        fetchWindowIcons: true,
      });
      return sources.map((s) => ({
        id: s.id,
        name: s.name,
        display_id: s.display_id,
        thumbnail: s.thumbnail.toDataURL(),
      }));
    } catch (err) {
      console.error('Failed to get screen sources:', err);
      return [];
    }
  });

  ipcMain.handle('screen:setPreferredSource', (_e, id) => {
    preferredScreenSourceId = id || null;
    return true;
  });

  ipcMain.handle('screen:captureSnapshot', async (_e, sourceId) => {
    try {
      if (!(await canCaptureScreen())) return null;
      const primary = screen.getPrimaryDisplay();
      const scale = primary.scaleFactor || 1;
      const width = Math.round(primary.bounds.width * scale);
      const height = Math.round(primary.bounds.height * scale);
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width, height },
      });
      const chosen = sourceId
        ? sources.find((s) => s.id === sourceId)
        : sources.find((s) => s.id.startsWith('screen:')) || sources[0];
      if (!chosen) return null;
      return chosen.thumbnail.toDataURL();
    } catch (err) {
      console.error('Capture snapshot error:', err);
      return null;
    }
  });

  ipcMain.handle('screen:movePiece', async (_e, data) => {
    try {
      const { fromX, fromY, toX, toY, method, restoreCursor, delayMs, promotion, sourceWidth, sourceHeight, isCalibrated } = data;

      let realFromX, realFromY, realToX, realToY;
      if (isCalibrated) {
        realFromX = Math.round(fromX);
        realFromY = Math.round(fromY);
        realToX = Math.round(toX);
        realToY = Math.round(toY);
      } else {
        const primary = screen.getPrimaryDisplay();
        const scale = primary.scaleFactor || 1;
        const physW = Math.round(primary.bounds.width * scale);
        const physH = Math.round(primary.bounds.height * scale);

        const scaleX = sourceWidth ? physW / sourceWidth : 1;
        const scaleY = sourceHeight ? physH / sourceHeight : 1;

        realFromX = Math.round(fromX * scaleX);
        realFromY = Math.round(fromY * scaleY);
        realToX = Math.round(toX * scaleX);
        realToY = Math.round(toY * scaleY);
      }

      const wasClickThrough = runtime.clickThrough;
      if (!wasClickThrough && win) {
        win.setIgnoreMouseEvents(true, { forward: true });
      }

      const ok = await movePieceOnScreen({
        fromX: realFromX,
        fromY: realFromY,
        toX: realToX,
        toY: realToY,
        method: method || store.data.analysis?.mouseMethod || 'click',
        restoreCursor: restoreCursor !== false,
        delayMs: delayMs || 70,
        promotion,
      });

      if (!wasClickThrough && win) {
        setTimeout(() => {
          if (!runtime.clickThrough && win && !win.isDestroyed()) {
            win.setIgnoreMouseEvents(false);
          }
        }, 180);
      }

      return ok;
    } catch (err) {
      console.error('screen:movePiece error:', err);
      return false;
    }
  });

  ipcMain.handle('screen:getCursorPos', () => getCursorPos());

  ipcMain.handle('screen:openCalibration', () => {
    openCalibrationWindow();
    return true;
  });

  ipcMain.handle('screen:saveCalibrationCurrentWindow', (event) => {
    const senderWin = BrowserWindow.fromWebContents(event.sender) || calibWin;
    if (!senderWin) return null;
    const bounds = senderWin.getContentBounds();
    const boardBounds = {
      x: bounds.x,
      y: bounds.y + 38,
      width: bounds.width,
      height: bounds.height - 38,
      x0: bounds.x,
      y0: bounds.y + 38,
      x1: bounds.x + bounds.width,
      y1: bounds.y + bounds.height,
    };
    store.set({ screenWatch: { calibratedBoard: boardBounds } });
    if (win && !win.isDestroyed()) {
      win.webContents.send('settings:changed', store.data);
    }
    return boardBounds;
  });

  ipcMain.handle('screen:saveCalibratedBoard', (_e, bounds) => {
    store.set({ screenWatch: { calibratedBoard: bounds } });
    if (win && !win.isDestroyed()) {
      win.webContents.send('settings:changed', store.data);
    }
    return true;
  });

  ipcMain.handle('screen:clearCalibration', () => {
    store.set({ screenWatch: { calibratedBoard: null } });
    if (win && !win.isDestroyed()) {
      win.webContents.send('settings:changed', store.data);
    }
    return true;
  });

  ipcMain.on('window:minimize', () => win && win.minimize());
  ipcMain.on('window:hide', () => {
    if (!win) return;
    if (store.data.overlay.closeToTray && tray) win.hide();
    else { quitting = true; app.quit(); }
  });
  ipcMain.on('window:quit', () => { quitting = true; app.quit(); });
  ipcMain.on('window:compact', (_e, on) => setCompact(on === undefined ? !store.data.overlay.compact : !!on));
  ipcMain.on('window:clickThrough', (_e, on) => setClickThrough(on === undefined ? !runtime.clickThrough : !!on));
  ipcMain.on('window:resetPosition', resetPosition);
  ipcMain.on('window:setSize', (_e, { width, height }) => {
    if (!win) return;
    const b = win.getBounds();
    win.setBounds({ x: b.x, y: b.y, width: Math.max(300, Math.round(width)), height: Math.max(80, Math.round(height)) });
  });
  ipcMain.handle('window:getBounds', (event) => {
    const sender = BrowserWindow.fromWebContents(event.sender) || win;
    return sender ? sender.getBounds() : null;
  });
  ipcMain.handle('window:state', () => ({
    clickThrough: runtime.clickThrough, compact: !!store.data.overlay.compact, failedHotkeys: runtime.failedHotkeys,
  }));

  ipcMain.handle('clipboard:read', () => clipboard.readText());
  ipcMain.handle('clipboard:readImage', () => {
    const img = clipboard.readImage();
    return img.isEmpty() ? null : img.toDataURL();
  });
  ipcMain.on('clipboard:write', (_e, text) => clipboard.writeText(String(text)));

  ipcMain.handle('file:openPgn', async () => {
    const r = await dialog.showOpenDialog(win, {
      title: 'Open PGN or FEN', filters: [{ name: 'Chess files', extensions: ['pgn', 'fen', 'txt'] }], properties: ['openFile'],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return fs.readFileSync(r.filePaths[0], 'utf8');
  });
  ipcMain.handle('file:savePgn', async (_e, text) => {
    const r = await dialog.showSaveDialog(win, { title: 'Save PGN', defaultPath: 'game.pgn', filters: [{ name: 'PGN', extensions: ['pgn'] }] });
    if (r.canceled || !r.filePath) return false;
    fs.writeFileSync(r.filePath, text);
    return true;
  });
  ipcMain.handle('dialog:pickFolder', async (_e, title) => {
    const r = await dialog.showOpenDialog(win, { title: title || 'Choose folder', properties: ['openDirectory'] });
    return r.canceled ? null : r.filePaths[0];
  });

  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    cores: os.cpus().length,
    memoryMb: Math.round(os.totalmem() / 1048576),
    cpu: os.cpus()[0]?.model?.trim() || '',
  }));
}

// ---------- dev smoke test (only with --smoke <script>) ----------

function runSmoke() {
  const script = require(path.resolve(SMOKE_SCRIPT));
  const ctx = {
    win,
    store,
    engines,
    eval: (code) => win.webContents.executeJavaScript(code, true),
    wait: (ms) => new Promise((r) => setTimeout(r, ms)),
    capture: async (file) => {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(file, img.toPNG());
      return file;
    },
    setCompact,
    setClickThrough,
  };
  Promise.resolve(script(ctx))
    .catch((err) => console.error('SMOKE FAILED:', err))
    .finally(() => { quitting = true; app.quit(); });
}

// ---------- startup ----------

app.on('second-instance', () => {
  if (!win) return;
  win.show();
  win.moveTop();
});

app.whenReady().then(() => {
  const userData = SMOKE_SCRIPT ? path.join(os.tmpdir(), 'cheeseee-smoke') : app.getPath('userData');
  store = new SettingsStore(path.join(userData, 'settings.json'));
  engines = new EngineManager(store, send);
  if (IS_MAC) {
    setupMacMenu();
    if (!app.isPackaged) app.dock.setIcon(path.join(ROOT, 'assets', 'icon.png'));
  }
  setupDisplayMediaHandler();
  registerIpc();
  createWindow();
  if (!SMOKE_SCRIPT) createTray();
  registerHotkeys();
  engines.ensure().catch(() => {});
});

app.on('before-quit', () => {
  quitting = true;
  store && store.saveNow();
  engines && engines.shutdown();
});

app.on('will-quit', () => {
  stopClicker();
  globalShortcut.unregisterAll();
});
app.on('window-all-closed', () => app.quit());

// macOS: clicking the Dock icon brings a hidden overlay back.
app.on('activate', () => {
  if (!win || win.isVisible()) return;
  win.show();
  sendWindowState();
  updateTray();
});
