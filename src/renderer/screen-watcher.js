import { createRecognizer, resolveOrientation, placementToFen, inferCastling } from '@scoriiu/fenshot';

const api = window.api;

let recognizer = null;
let active = false;
let mediaStream = null;
let videoEl = null;
let offscreenCanvas = null;
let loopTimer = null;
let checking = false;

const state = {
  active: false,
  state: 'idle', // 'idle' | 'starting' | 'watching' | 'error'
  lastPlacement: null,
  lastFen: null,
  confidence: 0,
  orientation: 'white',
  corners: null,
  boardFound: false,
  checks: 0,
  lastCheckMs: 0,
  error: null,
  mode: 'stream', // 'stream' | 'snapshot'
};

const listeners = {
  onPosition: [],
  onStatus: [],
  onError: [],
};

function getRecognizer() {
  if (!recognizer) {
    recognizer = createRecognizer({
      modelUrl: './model/chess-tiles-v2.onnx',
      wasmPaths: './ort/',
    });
    try {
      recognizer.warmUp();
    } catch (_) {}
  }
  return recognizer;
}

function notifyStatus() {
  const snapshot = { ...state };
  for (const fn of listeners.onStatus) {
    try { fn(snapshot); } catch (e) { console.error('Status listener error:', e); }
  }
}

function notifyPosition(data) {
  for (const fn of listeners.onPosition) {
    try { fn(data); } catch (e) { console.error('Position listener error:', e); }
  }
}

function notifyError(err) {
  state.error = err.message || String(err);
  state.state = 'error';
  notifyStatus();
  for (const fn of listeners.onError) {
    try { fn(err); } catch (e) { console.error('Error listener error:', e); }
  }
}

// Only macOS ever says no here (see src/main/screen-access.js).
const MAC_PERMISSION_HELP = 'macOS is blocking screen capture. In System Settings → Privacy & Security → '
  + 'Screen Recording, turn on Cheeseee (or Terminal, if you started it with npm start), then quit and reopen Cheeseee.';

// Check before capturing: on macOS, each capture attempt without permission re-opens the system prompt.
async function hasScreenAccess() {
  const access = api?.screen?.access ? await api.screen.access() : 'granted';
  if (access === 'granted') return true;
  notifyError(Object.assign(new Error(MAC_PERMISSION_HELP), { short: 'macOS needs Screen Recording permission. See the Screen tab.' }));
  return false;
}

function getCanvas(w, h) {
  if (!offscreenCanvas) {
    offscreenCanvas = document.createElement('canvas');
  }
  if (offscreenCanvas.width !== w || offscreenCanvas.height !== h) {
    offscreenCanvas.width = w;
    offscreenCanvas.height = h;
  }
  return offscreenCanvas;
}

async function captureSnapshotImage(sourceId) {
  if (!api?.screen?.captureSnapshot) return null;
  const dataUrl = await api.screen.captureSnapshot(sourceId);
  if (!dataUrl) return null;
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = dataUrl;
  });
}

async function step(settings = {}) {
  if (!active || checking) return;
  if (state.pausedUntil && performance.now() < state.pausedUntil) return;
  checking = true;
  const start = performance.now();

  try {
    const rec = getRecognizer();
    let source = null;
    let offsetX = 0;
    let offsetY = 0;

    if (state.mode === 'stream' && videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
      const vw = videoEl.videoWidth;
      const vh = videoEl.videoHeight;
      state.sourceWidth = vw;
      state.sourceHeight = vh;
      const canvas = getCanvas(vw, vh);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(videoEl, 0, 0, vw, vh);

      if (settings.region) {
        const r = settings.region;
        const rx = Math.round(r.x * vw);
        const ry = Math.round(r.y * vh);
        const rw = Math.round(r.width * vw);
        const rh = Math.round(r.height * vh);
        offsetX = rx;
        offsetY = ry;
        const cropCanvas = document.createElement('canvas');
        cropCanvas.width = rw;
        cropCanvas.height = rh;
        const cropCtx = cropCanvas.getContext('2d');
        cropCtx.drawImage(canvas, rx, ry, rw, rh, 0, 0, rw, rh);
        source = cropCanvas;
      } else {
        source = canvas;
      }
    } else {
      // Fallback: capture snapshot via IPC
      const img = await captureSnapshotImage(settings.sourceId);
      if (img) {
        state.mode = 'snapshot';
        state.sourceWidth = img.naturalWidth || img.width || 0;
        state.sourceHeight = img.naturalHeight || img.height || 0;
        source = img;
      }
    }

    if (source) {
      state.checks += 1;
      const res = await rec.recognize(source);

      if (res && res.placement) {
        state.boardFound = true;
        state.confidence = Math.round(res.meanConfidence * 100);
        const rawCorners = res.corners;
        const absCorners = rawCorners ? {
          x0: rawCorners.x0 + offsetX,
          y0: rawCorners.y0 + offsetY,
          x1: rawCorners.x1 + offsetX,
          y1: rawCorners.y1 + offsetY,
        } : null;
        state.corners = absCorners;

        const { placement: orientedPlacement, orientation } = resolveOrientation(res.placement);
        state.orientation = orientation;

        const changed = orientedPlacement !== state.lastPlacement;
        if (changed) {
          state.lastPlacement = orientedPlacement;
          // Inferred castling from piece positions
          const castling = inferCastling(orientedPlacement);
          const fen = placementToFen(orientedPlacement, 'w'); // Default turn, app can match legal move
          state.lastFen = fen;

          notifyPosition({
            placement: orientedPlacement,
            rawPlacement: res.placement,
            orientation,
            confidence: res.meanConfidence,
            corners: absCorners,
            reliable: res.reliable,
            castling,
            fen,
          });
        }
      } else {
        state.boardFound = false;
      }
    }
  } catch (err) {
    console.warn('Screen check iteration error:', err);
  } finally {
    state.lastCheckMs = Math.round(performance.now() - start);
    checking = false;
    notifyStatus();
  }
}

export const screenWatcher = {
  get state() {
    return { ...state };
  },

  isWatching() {
    return active;
  },

  onPosition(fn) {
    listeners.onPosition.push(fn);
    return () => {
      listeners.onPosition = listeners.onPosition.filter((f) => f !== fn);
    };
  },

  onStatus(fn) {
    listeners.onStatus.push(fn);
    return () => {
      listeners.onStatus = listeners.onStatus.filter((f) => f !== fn);
    };
  },

  onError(fn) {
    listeners.onError.push(fn);
    return () => {
      listeners.onError = listeners.onError.filter((f) => f !== fn);
    };
  },

  async start(settings = {}) {
    if (active) return;
    if (!(await hasScreenAccess())) return;
    state.state = 'starting';
    state.error = null;
    notifyStatus();

    try {
      getRecognizer();

      if (settings.sourceId && api?.screen?.setPreferredSource) {
        await api.screen.setPreferredSource(settings.sourceId);
      }

      // Attempt live screen video stream
      try {
        if (navigator.mediaDevices?.getDisplayMedia) {
          mediaStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
              displaySurface: 'monitor',
              frameRate: { ideal: 5, max: 15 },
            },
            audio: false,
          });

          if (!videoEl) {
            videoEl = document.createElement('video');
            videoEl.muted = true;
            videoEl.playsInline = true;
            videoEl.autoplay = true;
            videoEl.style.display = 'none';
            document.body.appendChild(videoEl);
          }

          videoEl.srcObject = mediaStream;
          await videoEl.play().catch(() => {});

          const [track] = mediaStream.getVideoTracks();
          if (track) {
            track.onended = () => {
              this.stop();
            };
          }
          state.mode = 'stream';
        } else {
          state.mode = 'snapshot';
        }
      } catch (streamErr) {
        console.warn('getDisplayMedia unavailable or rejected, using snapshot fallback:', streamErr.message);
        state.mode = 'snapshot';
      }

      active = true;
      state.active = true;
      state.state = 'watching';
      notifyStatus();

      const intervalMs = Math.max(250, Number(settings.interval) || 600);
      clearInterval(loopTimer);
      loopTimer = setInterval(() => step(settings), intervalMs);

      // Trigger first check immediately
      step(settings);
    } catch (err) {
      this.stop();
      notifyError(err);
    }
  },

  stop() {
    active = false;
    state.active = false;
    state.state = 'idle';
    clearInterval(loopTimer);
    loopTimer = null;
    checking = false;

    if (mediaStream) {
      try {
        for (const track of mediaStream.getTracks()) track.stop();
      } catch (_) {}
      mediaStream = null;
    }
    if (videoEl) {
      try {
        videoEl.pause();
        videoEl.srcObject = null;
      } catch (_) {}
    }
    notifyStatus();
  },

  pause(ms = 700) {
    state.pausedUntil = performance.now() + ms;
  },

  toggle(settings = {}) {
    if (active) this.stop();
    else this.start(settings);
    return active;
  },

  async scanImage(imgSource) {
    const rec = getRecognizer();
    const res = await rec.recognize(imgSource);
    if (!res || !res.placement) return null;
    const { placement, orientation } = resolveOrientation(res.placement);
    const fen = placementToFen(placement, 'w');
    return {
      placement,
      orientation,
      fen,
      confidence: res.meanConfidence,
      reliable: res.reliable,
      corners: res.corners,
    };
  },

  async scanOnce(settings = {}) {
    const rec = getRecognizer();
    let img = null;
    if (videoEl && videoEl.readyState >= 2 && videoEl.videoWidth > 0) {
      const vw = videoEl.videoWidth;
      const vh = videoEl.videoHeight;
      const canvas = getCanvas(vw, vh);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(videoEl, 0, 0, vw, vh);
      img = canvas;
    } else {
      if (!(await hasScreenAccess())) return null;
      img = await captureSnapshotImage(settings.sourceId);
    }
    if (!img) return null;
    return this.scanImage(img);
  },
};
