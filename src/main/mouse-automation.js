const { app } = require('electron');
const path = require('path');
const fs = require('fs');
const child_process = require('child_process');

function getClickerPath() {
  const candidates = [
    path.join(__dirname, '..', '..', 'bin', 'mouse-clicker.exe'),
    path.join(__dirname, '..', '..', 'resources', 'bin', 'mouse-clicker.exe'),
    process.resourcesPath ? path.join(process.resourcesPath, 'bin', 'mouse-clicker.exe') : null,
    app?.getAppPath ? path.join(app.getAppPath(), 'bin', 'mouse-clicker.exe') : null,
    app?.getAppPath ? path.join(path.dirname(app.getAppPath()), 'bin', 'mouse-clicker.exe') : null,
  ].filter(Boolean);

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0] || path.join(__dirname, '..', '..', 'bin', 'mouse-clicker.exe');
}

function stopClicker() {
  // Stateless execution; nothing to kill, but clean up any stray processes
  try {
    child_process.exec('taskkill /F /IM mouse-clicker.exe >nul 2>&1');
  } catch (_) {}
}

function movePieceOnScreen({ fromX, fromY, toX, toY, method = 'reliable', restoreCursor = true, delayMs = 60, promotion = null }) {
  return new Promise((resolve) => {
    const exePath = getClickerPath();
    if (!fs.existsSync(exePath)) {
      console.warn('mouse-clicker.exe not found at', exePath);
      return resolve(false);
    }
    const fx = Math.round(fromX);
    const fy = Math.round(fromY);
    const tx = Math.round(toX);
    const ty = Math.round(toY);
    const restore = restoreCursor ? '1' : '0';

    child_process.execFile(
      exePath,
      [String(fx), String(fy), String(tx), String(ty), method, restore, String(delayMs)],
      { timeout: 4000, windowsHide: true },
      (err) => {
        if (err) {
          console.warn('Clicker execution error:', err.message);
          return resolve(false);
        }
        if (promotion) {
          // If promoting to Queen, click destination square again after modal opens
          setTimeout(() => {
            child_process.execFile(exePath, [String(tx), String(ty)], { timeout: 2000, windowsHide: true }, () => {});
          }, 120);
        }
        resolve(true);
      }
    );
  });
}

function getCursorPos() {
  const exePath = getClickerPath();
  if (fs.existsSync(exePath)) {
    try {
      const out = child_process.execFileSync(exePath, ['getpos'], { encoding: 'utf8', timeout: 2000 }).trim();
      const parts = out.split(' ');
      if (parts[0] === 'POS' && parts.length >= 3) {
        return { x: parseInt(parts[1], 10), y: parseInt(parts[2], 10) };
      }
    } catch (e) {
      console.warn('getCursorPos error:', e.message);
    }
  }
  return null;
}

module.exports = {
  movePieceOnScreen,
  stopClicker,
  getClickerPath,
  getCursorPos,
};
