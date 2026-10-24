const os = require('os');

function defaultThreads() {
  const cores = os.cpus().length || 2;
  return Math.max(1, cores - 2);
}

function defaultHash() {
  const totalMb = os.totalmem() / (1024 * 1024);
  if (totalMb >= 32000) return 1024;
  if (totalMb >= 16000) return 512;
  if (totalMb >= 8000) return 256;
  return 128;
}

function defaults() {
  return {
    version: 1,
    window: {
      x: null,
      y: null,
      width: 460,
      height: 860,
      compactWidth: 400,
      compactHeight: 92,
    },
    overlay: {
      alwaysOnTop: true,
      topLevel: 'floating', // 'floating' | 'screen-saver' (stays above fullscreen apps)
      opacity: 1,
      panelOpacity: 0.9,
      ghostOpacity: 0.6,
      skipTaskbar: false,
      compact: false,
      lockPosition: false,
      zoom: 1,
      theme: 'dark',
      accent: '#6fbf73',
      closeToTray: true,
      startWithWindows: false,
      startHidden: false,
    },
    analysis: {
      mode: 'time', // 'time' | 'depth' | 'nodes' | 'infinite'
      movetime: 3000,
      depth: 24,
      nodes: 5000000,
      multipv: 3,
      autoAnalyze: true,
      analyzeFor: 'both', // 'both' | 'white' | 'black'
      myColor: 'white', // 'white' | 'black'
      enginePlays: 'none', // 'none' | 'white' | 'black' | 'both'
      autoPlayDelay: 400,
      screenClick: true, // physically click moves on external screen board
      mouseMethod: 'click', // 'click' | 'drag'
      stopOnGameOver: true, // auto-stop autoplay when game is won/lost/drawn
    },
    display: {
      arrows: 'all', // 'off' | 'best' | 'all'
      maxArrows: 3,
      showReply: true,
      arrowLabels: true,
      arrowOpacity: 0.85,
      evalBar: true,
      scoreFormat: 'pawns', // 'pawns' | 'winpct'
      perspective: 'white', // 'white' | 'side'
      notation: 'san', // 'san' | 'figurine' | 'uci'
      pvLength: 12,
      showStats: true,
      showWdl: false,
    },
    board: {
      theme: 'ncm',
      maxSize: 1000, // 1000 = as big as fits
      customLight: '#e8dcc0',
      customDark: '#8a6f55',
      coords: 'edge', // 'edge' | 'squares' | 'off'
      orientation: 'white',
      autoFlip: false,
      lastMove: true,
      check: true,
      legalDots: true,
      animation: 180,
      autoQueen: false,
      sounds: true,
      volume: 0.5,
    },
    engine: {
      selected: 'stockfish',
      list: [{ id: 'stockfish', name: 'Stockfish 19', builtin: true, path: '' }],
      options: {},
    },
    screenWatch: {
      enabled: false,
      interval: 600,
      sourceId: '',
      autoAnalyze: true,
      autoOrientation: true,
      playButtonTriggersWatch: true,
      soundOnUpdate: true,
      region: null,
    },
    hotkeys: {
      toggleVisible: 'Ctrl+Alt+H',
      clickThrough: 'Ctrl+Alt+T',
      analyze: 'Ctrl+Alt+A',
      stop: 'Ctrl+Alt+S',
      playBest: 'Ctrl+Alt+P',
      watchScreen: 'Ctrl+Alt+W',
      compact: 'Ctrl+Alt+M',
      flip: 'Ctrl+Alt+F',
      pasteFen: 'Ctrl+Alt+V',
      undo: 'Ctrl+Alt+Z',
      opacityUp: 'Ctrl+Alt+=',
      opacityDown: 'Ctrl+Alt+-',
      alwaysOnTop: '',
    },
    ui: {
      tab: 'lines',
      console: false,
    },
  };
}

module.exports = { defaults, defaultThreads, defaultHash };
