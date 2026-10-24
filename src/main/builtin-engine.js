// File name of the bundled Stockfish binary for each OS, inside engines/stockfish/.
// Used by the app and by the build scripts, so it must not require Electron.
const BUILTIN_ENGINE_FILES = {
  win32: 'stockfish.exe',
  darwin: 'stockfish-macos',
};

function builtinEngineFile(platform = process.platform) {
  return BUILTIN_ENGINE_FILES[platform] || null;
}

module.exports = { BUILTIN_ENGINE_FILES, builtinEngineFile };
