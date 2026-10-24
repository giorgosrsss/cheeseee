const { contextBridge, ipcRenderer } = require('electron');

const on = (channel) => (cb) => {
  const listener = (_e, payload) => cb(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('api', {
  platform: process.platform,
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
    reset: () => ipcRenderer.invoke('settings:reset'),
    exportFile: () => ipcRenderer.invoke('settings:export'),
    importFile: () => ipcRenderer.invoke('settings:import'),
    onChanged: on('settings:changed'),
  },
  engine: {
    info: () => ipcRenderer.invoke('engine:info'),
    start: () => ipcRenderer.invoke('engine:start'),
    analyze: (req) => ipcRenderer.send('engine:analyze', req),
    stop: () => ipcRenderer.send('engine:stop'),
    restart: () => ipcRenderer.invoke('engine:restart'),
    select: (id) => ipcRenderer.invoke('engine:select', id),
    add: () => ipcRenderer.invoke('engine:add'),
    remove: (id) => ipcRenderer.invoke('engine:remove', id),
    setOption: (name, value) => ipcRenderer.invoke('engine:setOption', { name, value }),
    pressButton: (name) => ipcRenderer.invoke('engine:button', name),
    resetOptions: () => ipcRenderer.invoke('engine:resetOptions'),
    sendRaw: (cmd) => ipcRenderer.invoke('engine:send', cmd),
    onStatus: on('engine:status'),
    onUpdate: on('engine:update'),
    onBestMove: on('engine:bestmove'),
    onRaw: on('engine:raw'),
  },
  screen: {
    getSources: () => ipcRenderer.invoke('screen:sources'),
    setPreferredSource: (id) => ipcRenderer.invoke('screen:setPreferredSource', id),
    captureSnapshot: (sourceId) => ipcRenderer.invoke('screen:captureSnapshot', sourceId),
    movePiece: (data) => ipcRenderer.invoke('screen:movePiece', data),
    getCursorPos: () => ipcRenderer.invoke('screen:getCursorPos'),
    openCalibration: () => ipcRenderer.invoke('screen:openCalibration'),
    saveCalibratedBoard: (bounds) => ipcRenderer.invoke('screen:saveCalibratedBoard', bounds),
    saveCalibrationCurrentWindow: () => ipcRenderer.invoke('screen:saveCalibrationCurrentWindow'),
    clearCalibration: () => ipcRenderer.invoke('screen:clearCalibration'),
  },
  win: {
    minimize: () => ipcRenderer.send('window:minimize'),
    hide: () => ipcRenderer.send('window:hide'),
    quit: () => ipcRenderer.send('window:quit'),
    compact: (on) => ipcRenderer.send('window:compact', on),
    clickThrough: (on) => ipcRenderer.send('window:clickThrough', on),
    resetPosition: () => ipcRenderer.send('window:resetPosition'),
    setSize: (width, height) => ipcRenderer.send('window:setSize', { width, height }),
    getBounds: () => ipcRenderer.invoke('window:getBounds'),
    state: () => ipcRenderer.invoke('window:state'),
    onState: on('window:state'),
  },
  clipboard: {
    read: () => ipcRenderer.invoke('clipboard:read'),
    readImage: () => ipcRenderer.invoke('clipboard:readImage'),
    write: (text) => ipcRenderer.send('clipboard:write', text),
  },
  files: {
    openPgn: () => ipcRenderer.invoke('file:openPgn'),
    savePgn: (text) => ipcRenderer.invoke('file:savePgn', text),
    pickFolder: (title) => ipcRenderer.invoke('dialog:pickFolder', title),
  },
  app: { info: () => ipcRenderer.invoke('app:info') },
  onHotkey: on('hotkey'),
});
