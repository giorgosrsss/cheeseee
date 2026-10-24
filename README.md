# Cheeseee

A desktop take on [nextchessmove.com](https://nextchessmove.com): set up any chess position and get the
best move. Instead of a website calling a server, Cheeseee is an app for Windows and macOS that floats above
your other windows. It runs Stockfish 19 on your own CPU, using all your cores.

## Requirements

- Windows 10 or 11 (64-bit), or macOS 12 or newer (Apple Silicon or Intel)
- [Node.js](https://nodejs.org) 20 or newer (only needed to run from source or build the app)

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

**On a Mac**, the first `npm start` also downloads Stockfish (about 80 MB) from the
[official Stockfish release](https://github.com/official-stockfish/Stockfish/releases/tag/sf_19) and checks it
against the official checksum. The Mac build is just over GitHub's 100 MB file limit, so it isn't stored in
this repo. To download it on its own:

```bash
npm run engine
```

### Build the app

```bash
npm run package
```

This builds the app for the computer you run it on:

- **Windows:** `release\Cheeseee-win32-x64\Cheeseee.exe`
- **macOS:** `release/Cheeseee-darwin-arm64/Cheeseee.app` on Apple Silicon, `Cheeseee-darwin-x64` on Intel.
  Drag it into Applications if you like. To build for the other kind of Mac, run `npm run package -- --arch x64`
  (or `arm64`).

No installer is needed. Build the Mac app on a Mac and the Windows app on Windows. The `release` folder isn't
stored in the repo, so build it after cloning.

Closing the window hides it to the system tray (the menu bar on a Mac). To quit, use the tray icon's menu and
choose **Quit**, or press Cmd+Q on a Mac.

### Notes for macOS

- **Screen reading** needs Screen Recording permission. macOS asks once per launch the first time you use it.
  Turn Cheeseee on in System Settings → Privacy & Security → Screen Recording, then quit and reopen Cheeseee.
  Until then, the Screen tab shows these steps instead of asking again.
- **Use the built app for screen reading.** With `npm start`, macOS asks on behalf of **Terminal**, and allowing
  it would let anything you run in Terminal record your screen. Run `npm run package` and open `Cheeseee.app`
  so the permission belongs to Cheeseee only.
- After you rebuild the app, macOS may treat it as a new app. If Cheeseee is switched on in Screen Recording
  but still blocked, remove it from the list with **–**, then open it and allow it again.
- **Hotkeys:** `Ctrl` means the Control key and `Alt` means Option. You can rebind them in Settings.
- **Above fullscreen apps:** macOS only lets a window float over fullscreen apps when the app has no Dock icon,
  so the "Aggressive" setting hides Cheeseee's Dock icon while it's on.
- The build is signed locally (ad-hoc), not by Apple. A Mac app you built yourself opens normally. If you copy it
  to another Mac, right-click it and choose **Open** the first time.

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
- Paste a screenshot of a board (`Ctrl+V`, or `Cmd+V` on a Mac) to load the position

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
- Lock position, hide from taskbar / Dock, start hidden, start at login, interface zoom, light/dark theme, accent color
- Rebindable global hotkeys that work from any app

**Engines**
- Stockfish 19 is included. Add any other UCI engine (Leela, Dragon, Berserk, …) in the Engine tab.
- Every option the engine reports appears in the Engine tab: threads, hash, skill, Elo, Syzygy tablebases and the rest
- Console tab with the engine's raw input and output, where you can type UCI commands

## Shortcuts

**Global (default; change them in Settings → Global hotkeys. On a Mac, Ctrl = Control and Alt = Option.)**

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
←/→ step through moves · Shift+←/→ jump to start/end · 1–8 number of lines · Ctrl/Cmd+V paste · Ctrl/Cmd+C copy FEN ·
M compact · I import · in edit mode: W/B/T set or toggle side to move, right-click removes a piece.

## Project layout

```
src/main/        Electron main process: window, tray, hotkeys, engine, screen capture and IPC
src/preload.js   The API the window is allowed to use
src/renderer/    The interface (board, analysis, screen reader, settings), bundled by esbuild into dist/
src/native/      Source for a small Windows helper (compiled to bin/ during the build on Windows)
engines/         Stockfish 19: the Windows build is stored here; the Mac build is downloaded into it
assets/          App icons (.png, .ico for Windows, .icns for macOS)
scripts/         Build, package, Stockfish download and icon generator
```

`npm run build` bundles the interface into `dist/`, copies the board-recognition model and ONNX runtime files
there, and downloads Stockfish if this OS's build is missing. On Windows it also compiles `src/native` with the
.NET Framework compiler that ships with Windows. `dist/`, `bin/` and `release/` are generated, so they aren't in
the repo.

Settings are saved to `%APPDATA%\Cheeseee\settings.json` on Windows and
`~/Library/Application Support/Cheeseee/settings.json` on macOS.

## Fair play

Chess sites ban engine help during rated games. Cheeseee is for analysis, study, puzzles and playing
against the engine, not for use while playing real opponents online.

## Licenses

Stockfish (GPL-3.0, license text in `engines/stockfish`), chessground (GPL-3.0), chess.js (BSD-2-Clause),
fenshot (MIT), ONNX Runtime Web (MIT), Electron (MIT). Because it bundles GPL code, Cheeseee is GPL-3.0-or-later.
