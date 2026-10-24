import { screenWatcher } from './screen-watcher.js';

const api = window.api;
const $ = (id) => document.getElementById(id);

let sourcesList = [];

export function renderScreenTab(container, S, onSettingChange) {
  const sw = S.screenWatch || {};
  const isWatching = screenWatcher.isWatching();
  const st = screenWatcher.state;

  container.innerHTML = `
    <div class="card screen-status-card">
      <div class="screen-status-header">
        <div class="screen-pulse-dot ${isWatching ? 'active' : ''}"></div>
        <div class="screen-status-title">
          <div class="screen-status-main">${isWatching ? 'Watching Screen' : 'Screen Watch Stopped'}</div>
          <div class="screen-status-sub">${st.boardFound ? `Board detected (${st.confidence}% confidence)` : (isWatching ? 'Scanning for chessboard on screen…' : 'Press Play or Start to watch your screen')}</div>
        </div>
      </div>

      <div class="btn-row" style="margin-top: 12px;">
        <button class="btn ${isWatching ? 'danger' : 'primary'}" id="btnToggleWatchTab">
          <svg><use href="#i-${isWatching ? 'stop' : 'scan'}"/></svg>
          <span>${isWatching ? 'Stop Watching' : 'Start Watching'}</span>
        </button>
        <button class="btn" id="btnScanNowTab" title="Take a one-time screenshot and read the board">
          <svg><use href="#i-scan"/></svg>
          <span>Scan Once</span>
        </button>
      </div>

      ${st.lastFen ? `
        <div class="field-row" style="margin-top: 10px;">
          <input class="input mono small" readonly value="${st.lastFen}" title="Last detected FEN from screen" />
          <button class="ib small" id="btnCopyDetectedFen" title="Copy FEN"><svg><use href="#i-copy"/></svg></button>
        </div>
      ` : ''}

      <div class="screen-metrics">
        <div class="metric"><span class="m-k">Checks</span><span class="m-v">${st.checks}</span></div>
        <div class="metric"><span class="m-k">Scan time</span><span class="m-v">${st.lastCheckMs ? st.lastCheckMs + ' ms' : '—'}</span></div>
        <div class="metric"><span class="m-k">Confidence</span><span class="m-v">${st.confidence ? st.confidence + '%' : '—'}</span></div>
        <div class="metric"><span class="m-k">Perspective</span><span class="m-v">${st.orientation || '—'}</span></div>
      </div>
    </div>

    <div class="card" style="margin-top: 12px;">
      <div class="card-title">Board Calibration & Mouse Precision</div>
      <div class="text-sub" style="font-size: 11.5px; line-height: 1.45; opacity: 0.85; margin-bottom: 8px;">
        Lock the exact chessboard position on your screen so the mouse clicks 100% dead-center on any screen resolution or monitor:
      </div>

      <div class="screen-metrics" style="margin-bottom: 10px;">
        <div class="metric"><span class="m-k">Status</span><span class="m-v">${sw.calibratedBoard ? 'Locked (Manual)' : 'Auto (AI detection)'}</span></div>
        <div class="metric"><span class="m-k">Board size</span><span class="m-v">${sw.calibratedBoard ? `${sw.calibratedBoard.width}×${sw.calibratedBoard.height}` : (st.corners ? `${st.corners.x1 - st.corners.x0}×${st.corners.y1 - st.corners.y0}` : '—')}</span></div>
        <div class="metric"><span class="m-k">Origin</span><span class="m-v">${sw.calibratedBoard ? `${sw.calibratedBoard.x0}, ${sw.calibratedBoard.y0}` : (st.corners ? `${st.corners.x0}, ${st.corners.y0}` : '—')}</span></div>
      </div>

      <div class="btn-row" style="gap: 6px; flex-wrap: wrap;">
        <button class="btn primary small" id="btnOpenCalibFrame" title="Open an adjustable 8x8 frame to drag over your chessboard">
          <svg><use href="#i-expand"/></svg>
          <span>Drag Frame Over Board</span>
        </button>
        <button class="btn small" id="btnTestClickSquare" title="Moves your mouse to square e4 (Center) so you can verify alignment">
          <svg><use href="#i-bolt"/></svg>
          <span>Test Move (e4)</span>
        </button>
        <button class="btn small" id="btnTestClickA8" title="Moves your mouse to square a8 (Top-Left)">
          <span>Test a8</span>
        </button>
        <button class="btn small" id="btnTestClickH1" title="Moves your mouse to square h1 (Bottom-Right)">
          <span>Test h1</span>
        </button>
        ${sw.calibratedBoard ? `
          <button class="btn small danger" id="btnClearCalib" title="Reset to automatic AI detection">
            <span>Reset</span>
          </button>
        ` : ''}
      </div>
    </div>

    <div class="card" style="margin-top: 12px;">
      <div class="card-title">Screen Source & Capture</div>
      <div class="field">
        <label>Capture source</label>
        <select class="input" id="swSourceSelect">
          <option value="">Auto (Primary Display)</option>
          ${sourcesList.map((s) => `<option value="${s.id}" ${s.id === sw.sourceId ? 'selected' : ''}>${s.name}</option>`).join('')}
        </select>
      </div>

      <div class="field">
        <label>Scan interval: <span id="swIntervalVal">${sw.interval || 600} ms</span></label>
        <input type="range" class="range" id="swInterval" min="250" max="2000" step="50" value="${sw.interval || 600}" />
        <div class="field-hint">Lower = faster reaction to moves; Higher = less CPU usage.</div>
      </div>

      <div class="check-col" style="margin-top: 8px;">
        <label class="check">
          <input type="checkbox" id="swPlayTriggers" ${sw.playButtonTriggersWatch !== false ? 'checked' : ''} />
          Play button starts screen checking
        </label>
        <label class="check">
          <input type="checkbox" id="swAutoAnalyze" ${sw.autoAnalyze !== false ? 'checked' : ''} />
          Auto-calculate best moves on new positions
        </label>
        <label class="check">
          <input type="checkbox" id="swAutoOrientation" ${sw.autoOrientation !== false ? 'checked' : ''} />
          Auto-detect board orientation (White/Black view)
        </label>
        <label class="check">
          <input type="checkbox" id="swSound" ${sw.soundOnUpdate !== false ? 'checked' : ''} />
          Play move sound when screen position updates
        </label>
      </div>
    </div>

    <div class="card" style="margin-top: 12px;">
      <div class="card-title">How it works</div>
      <div class="text-sub" style="font-size: 12px; line-height: 1.5; opacity: 0.85;">
        Cheeseee uses a local neural network to scan your screen or window in real-time. It automatically spots digital chessboards on <b>Chess.com</b>, <b>Lichess</b>, desktop chess apps, video streams, or diagrams, reads every piece with high confidence, updates your board, and runs Stockfish instantly.
      </div>
    </div>
  `;

  // Bind events
  $('btnToggleWatchTab').onclick = () => {
    screenWatcher.toggle(S.screenWatch);
  };

  $('btnScanNowTab').onclick = async () => {
    const btn = $('btnScanNowTab');
    btn.disabled = true;
    try {
      const res = await screenWatcher.scanOnce(S.screenWatch);
      if (res && res.placement) {
        if (window.onScreenPositionDetected) {
          window.onScreenPositionDetected(res);
        }
      }
    } finally {
      btn.disabled = false;
    }
  };

  const copyBtn = $('btnCopyDetectedFen');
  if (copyBtn && st.lastFen) {
    copyBtn.onclick = () => {
      api.clipboard.write(st.lastFen);
    };
  }

  $('swSourceSelect').onchange = (e) => {
    onSettingChange('screenWatch.sourceId', e.target.value);
    if (screenWatcher.isWatching()) {
      screenWatcher.stop();
      screenWatcher.start({ ...sw, sourceId: e.target.value });
    }
  };

  const intervalEl = $('swInterval');
  intervalEl.oninput = (e) => {
    $('swIntervalVal').textContent = `${e.target.value} ms`;
  };
  intervalEl.onchange = (e) => {
    onSettingChange('screenWatch.interval', Number(e.target.value));
    if (screenWatcher.isWatching()) {
      screenWatcher.stop();
      screenWatcher.start({ ...sw, interval: Number(e.target.value) });
    }
  };

  $('swPlayTriggers').onchange = (e) => {
    onSettingChange('screenWatch.playButtonTriggersWatch', e.target.checked);
  };

  $('swAutoAnalyze').onchange = (e) => {
    onSettingChange('screenWatch.autoAnalyze', e.target.checked);
  };

  $('swAutoOrientation').onchange = (e) => {
    onSettingChange('screenWatch.autoOrientation', e.target.checked);
  };

  $('swSound').onchange = (e) => {
    onSettingChange('screenWatch.soundOnUpdate', e.target.checked);
  };

  const btnCalib = $('btnOpenCalibFrame');
  if (btnCalib) {
    btnCalib.onclick = () => {
      api.screen.openCalibration();
    };
  }

  const btnTest = $('btnTestClickSquare');
  if (btnTest) {
    btnTest.onclick = () => {
      window.__cheeseee?.testClickSquare?.('e4');
    };
  }

  const btnTestA8 = $('btnTestClickA8');
  if (btnTestA8) {
    btnTestA8.onclick = () => {
      window.__cheeseee?.testClickSquare?.('a8');
    };
  }

  const btnTestH1 = $('btnTestClickH1');
  if (btnTestH1) {
    btnTestH1.onclick = () => {
      window.__cheeseee?.testClickSquare?.('h1');
    };
  }

  const btnClear = $('btnClearCalib');
  if (btnClear) {
    btnClear.onclick = () => {
      api.screen.clearCalibration();
    };
  }
}

export async function refreshScreenSources() {
  if (api?.screen?.getSources) {
    try {
      sourcesList = await api.screen.getSources();
    } catch (_) {
      sourcesList = [];
    }
  }
}
