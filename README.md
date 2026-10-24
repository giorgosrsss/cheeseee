# Cheeseee

A desktop take on [nextchessmove.com](https://nextchessmove.com): set up any chess position and get the
best move. Instead of a website calling a server, Cheeseee is a Windows app that floats above your other
windows. It runs Stockfish 19 on your own CPU, using all your cores.

## Requirements

- Windows 10 or 11, 64-bit
- [Node.js](https://nodejs.org) 20 or newer (only needed to run from source or rebuild the app)

## Getting started

```bash
git clone https://github.com/giorgosrsss/cheeseee.git
cd cheeseee
npm install
npm start
```

If `npm start` says Electron failed to install (newer npm versions skip install scripts), run this once and try again:

```bash
node node_modules/electron/install.js
```

### Build the app

```bash
npm run package
```

This creates `release\Cheeseee-win32-x64\Cheeseee.exe`. No installer is needed; you can copy that whole folder
anywhere. The `release` folder isn't stored in the repo, so build it after cloning.

Closing the window hides it to the system tray. To quit, right-click the tray icon and choose **Quit**.

## What it does

**Analysis**
- Best move, evaluation, depth, speed and up to 8 best lines (Multi-PV)
- Search limit by time (0.1 s – 2 min), depth, node count, or infinite until you stop it
- Re-analyzes automatically when the position changes, optionally only on one side's turns
- The engine can play White, Black or both on the overlay board, at full or limited strength (Elo / skill level)
- Win / draw / loss chances, scores as pawns or win %, from White's view or the side to move

**Screen reading**
- Reads a chessboard from your screen with a small neural network that runs locally (no internet needed)
- Works on boards in desktop apps, videos, streams, PDFs and websites
- Turns the board into a FEN, loads it on Cheeseee's board and starts analysis
- **Screen** tab: pick which screen or window to watch, set the scan interval, scan once, see confidence and scan time
- Lock the board's exact position by dragging a frame over it, or let auto-detection find it
- Paste a screenshot of a board (`Ctrl+V`) to load the position

**Board**
- Play legal moves (drag or click). Edit mode (`E`) lets you put any piece anywhere, like nextchessmove.com.
- Arrows for the best lines with score badges, plus the expected reply
- Eval bar, move history with back/forward, promotion picker
- Paste or import FEN / PGN, copy FEN / PGN, save and open .pgn files
- 12 board color themes plus custom colors, three coordinate styles, sounds, animation speed, board size limit

**Overlay**
- Always on top, optionally above fullscreen apps
- Window opacity and separate background opacity
- Click-through mode (the mouse passes through to the app behind), with its own opacity
- Compact mode: a small bar showing just the best move
- Lock position, hide from taskbar, start hidden, start with Windows, interface zoom, light/dark theme, accent color
- Rebindable global hotkeys that work from any app

**Engines**
- Stockfish 19 is included. Add any other UCI engine `.exe` (Leela, Dragon, Berserk, …) in the Engine tab.
- Every option the engine reports appears in the Engine tab: threads, hash, skill, Elo, Syzygy tablebases and the rest
- Console tab with the engine's raw input and output, where you can type UCI commands

## Shortcuts

**Global (default; change them in Settings → Global hotkeys)**

| Action | Key |
|---|---|
| Show / hide overlay | Ctrl+Alt+H |
| Click-through on/off | Ctrl+Alt+T |
| Watch screen | Ctrl+Alt+W |
| Analyze / Stop | Ctrl+Alt+A / Ctrl+Alt+S |
| Play button | Ctrl+Alt+P |
| Compact mode | Ctrl+Alt+M |
| Flip board | Ctrl+Alt+F |
| Paste FEN/PGN/image from clipboard | Ctrl+Alt+V |
| Take back | Ctrl+Alt+Z |
| Opacity up / down | Ctrl+Alt+= / Ctrl+Alt+- |

**Inside the overlay:** Space analyze/stop · A play button · F flip · E edit · R start position · K kings only ·
←/→ step through moves · Shift+←/→ jump to start/end · 1–8 number of lines · Ctrl+V paste · Ctrl+C copy FEN ·
M compact · I import · in edit mode: W/B/T set or toggle side to move, right-click removes a piece.

## Project layout

```
src/main/        Electron main process: window, tray, hotkeys, engine, screen capture and IPC
src/preload.js   The API the window is allowed to use
src/renderer/    The interface (board, analysis, screen reader, settings), bundled by esbuild into dist/
src/native/      Source for a small Windows helper (compiled to bin/ during the build)
engines/         Bundled Stockfish 19 (official release build)
assets/          App icon
scripts/         Build, package and icon generator
```

`npm run build` bundles the interface into `dist/`, copies the board-recognition model and ONNX runtime files
there, and compiles `src/native` with the .NET Framework compiler that ships with Windows. `dist/`, `bin/` and
`release/` are generated, so they aren't in the repo.

Settings are saved to `%APPDATA%\Cheeseee\settings.json`.

## Fair play

Chess sites ban engine help during rated games. Cheeseee is for analysis, study, puzzles and playing
against the engine, not for use while playing real opponents online.

## Licenses

Stockfish (GPL-3.0, license text in `engines/stockfish`), chessground (GPL-3.0), chess.js (BSD-2-Clause),
fenshot (MIT), ONNX Runtime Web (MIT), Electron (MIT). Because it bundles GPL code, Cheeseee is GPL-3.0-or-later.
