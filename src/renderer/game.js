// Position + move history, built on chess.js.
import { Chess, validateFen } from 'chess.js';

export const START_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
export const EMPTY_KINGS_FEN = '4k3/8/8/8/8/8/8/4K3 w - - 0 1';

export function makeChess(fen) {
  try {
    return new Chess(fen);
  } catch (_) {
    return new Chess(fen, { skipValidation: true });
  }
}

// Returns null when the position is fine for an engine, otherwise a short reason.
export function positionProblem(fen) {
  const v = validateFen(fen);
  if (!v.ok) return v.error.replace('Invalid FEN: ', '').replace(/^./, (c) => c.toUpperCase());
  const placement = fen.split(' ')[0];
  const count = (re) => (placement.match(re) || []).length;
  if (count(/[A-Z]/g) > 16) return 'White has more than 16 pieces';
  if (count(/[a-z]/g) > 16) return 'Black has more than 16 pieces';
  if (count(/P/g) > 8) return 'White has more than 8 pawns';
  if (count(/p/g) > 8) return 'Black has more than 8 pawns';
  const parts = fen.split(' ');
  parts[1] = parts[1] === 'w' ? 'b' : 'w';
  parts[3] = '-';
  try {
    const flipped = new Chess(parts.join(' '), { skipValidation: true });
    if (flipped.inCheck()) {
      const who = parts[1] === 'w' ? 'White' : 'Black';
      return `${who} is in check but it's not ${who}'s turn`;
    }
  } catch (_) {
    return 'Position is not valid';
  }
  return null;
}

// Removes castling rights / en passant that the piece placement can't support.
export function sanitizeFen(placement, turn, castling) {
  const rows = placement.split('/');
  const grid = rows.map((r) => r.replace(/\d/g, (d) => '.'.repeat(Number(d))));
  const at = (sq) => {
    const file = sq.charCodeAt(0) - 97;
    const rank = Number(sq[1]);
    return grid[8 - rank]?.[file];
  };
  let c = '';
  if (castling.K && at('e1') === 'K' && at('h1') === 'R') c += 'K';
  if (castling.Q && at('e1') === 'K' && at('a1') === 'R') c += 'Q';
  if (castling.k && at('e8') === 'k' && at('h8') === 'r') c += 'k';
  if (castling.q && at('e8') === 'k' && at('a8') === 'r') c += 'q';
  return `${placement} ${turn} ${c || '-'} - 0 1`;
}

export function castlingFromFen(fen) {
  const c = fen.split(' ')[2] || '-';
  return { K: c.includes('K'), Q: c.includes('Q'), k: c.includes('k'), q: c.includes('q') };
}

export class GameModel {
  constructor(fen = START_FEN) {
    this.reset(fen);
  }

  reset(fen = START_FEN) {
    this.rootFen = fen;
    this.moves = [];
    this.cursor = 0;
    this.headers = {};
  }

  get fen() {
    return this.cursor === 0 ? this.rootFen : this.moves[this.cursor - 1].fen;
  }

  setTurn(turn) {
    const parts = this.fen.split(' ');
    parts[1] = turn;
    parts[3] = '-';
    const newFen = parts.join(' ');
    this.reset(newFen);
    return newFen;
  }

  get turn() {
    return this.fen.split(' ')[1] === 'b' ? 'b' : 'w';
  }

  get lastMove() {
    return this.cursor ? this.moves[this.cursor - 1] : null;
  }

  chess() {
    return makeChess(this.fen);
  }

  legalDests() {
    const dests = new Map();
    try {
      for (const m of this.chess().moves({ verbose: true })) {
        if (!dests.has(m.from)) dests.set(m.from, []);
        dests.get(m.from).push(m.to);
      }
    } catch (_) { /* invalid position: no legal moves */ }
    return dests;
  }

  isPromotion(from, to) {
    try {
      return this.chess().moves({ verbose: true }).some((m) => m.from === from && m.to === to && m.promotion);
    } catch (_) {
      return false;
    }
  }

  play({ from, to, promotion }) {
    const c = this.chess();
    let m;
    try {
      m = c.move({ from, to, promotion: promotion || undefined });
    } catch (_) {
      return null;
    }
    if (!m) return null;
    const rec = {
      from: m.from,
      to: m.to,
      promotion: m.promotion,
      san: m.san,
      uci: m.from + m.to + (m.promotion || ''),
      fen: c.fen(),
      color: m.color,
      captured: m.captured,
      check: c.inCheck(),
    };
    // Same move as the existing next move: just step forward and keep the rest of the line.
    const next = this.moves[this.cursor];
    if (next && next.uci === rec.uci) {
      this.cursor++;
      return next;
    }
    this.moves = this.moves.slice(0, this.cursor);
    this.moves.push(rec);
    this.cursor++;
    return rec;
  }

  playUci(uci) {
    if (!uci || uci.length < 4) return null;
    return this.play({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] });
  }

  back() { if (this.cursor > 0) { this.cursor--; return true; } return false; }
  forward() { if (this.cursor < this.moves.length) { this.cursor++; return true; } return false; }
  toStart() { const ch = this.cursor !== 0; this.cursor = 0; return ch; }
  toEnd() { const ch = this.cursor !== this.moves.length; this.cursor = this.moves.length; return ch; }
  goto(n) {
    const c = Math.max(0, Math.min(this.moves.length, n));
    const ch = c !== this.cursor;
    this.cursor = c;
    return ch;
  }

  uciMoves() {
    return this.moves.slice(0, this.cursor).map((m) => m.uci);
  }

  gameState() {
    try {
      const c = this.chess();
      if (c.isCheckmate()) return { over: true, text: `Checkmate — ${c.turn() === 'w' ? 'Black' : 'White'} wins` };
      if (c.isStalemate()) return { over: true, text: 'Stalemate — draw' };
      if (c.isInsufficientMaterial()) return { over: true, text: 'Draw — insufficient material' };
      if (c.isDrawByFiftyMoves()) return { over: true, text: 'Draw — 50-move rule' };
      if (this.isThreefold()) return { over: true, text: 'Draw — threefold repetition' };
      return { over: false, check: c.inCheck() };
    } catch (_) {
      return { over: false };
    }
  }

  isThreefold() {
    const key = (fen) => fen.split(' ').slice(0, 4).join(' ');
    const fens = [this.rootFen, ...this.moves.slice(0, this.cursor).map((m) => m.fen)].map(key);
    const now = key(this.fen);
    return fens.filter((f) => f === now).length >= 3;
  }

  loadPgn(text) {
    const c = new Chess();
    c.loadPgn(text);
    const hist = c.history({ verbose: true });
    const headers = c.getHeaders();
    const root = hist.length ? hist[0].before : c.fen();
    this.reset(root);
    this.headers = headers;
    for (const m of hist) this.play({ from: m.from, to: m.to, promotion: m.promotion });
    return this;
  }

  pgn() {
    const c = makeChess(this.rootFen);
    const headers = { Event: 'Cheeseee analysis', Date: new Date().toISOString().slice(0, 10).replace(/-/g, '.'), ...this.headers };
    for (const [k, v] of Object.entries(headers)) if (v) c.setHeader(k, v);
    if (this.rootFen !== START_FEN) {
      c.setHeader('SetUp', '1');
      c.setHeader('FEN', this.rootFen);
    }
    for (const m of this.moves) {
      try { c.move({ from: m.from, to: m.to, promotion: m.promotion }); } catch (_) { break; }
    }
    return c.pgn({ maxWidth: 80 });
  }
}

export function placementToGrid(placement) {
  const rows = (placement || '').split('/');
  const grid = {};
  for (let r = 0; r < 8; r++) {
    const rank = 8 - r;
    const row = rows[r] || '8';
    let fileIdx = 0;
    for (const ch of row) {
      if (ch >= '1' && ch <= '8') {
        const count = Number(ch);
        for (let i = 0; i < count; i++) {
          grid[String.fromCharCode(97 + fileIdx) + rank] = '.';
          fileIdx++;
        }
      } else {
        grid[String.fromCharCode(97 + fileIdx) + rank] = ch;
        fileIdx++;
      }
    }
  }
  return grid;
}

export function analyzeMoveBetweenPlacements(oldPlacement, newPlacement, currentTurn = 'w') {
  if (!oldPlacement || !newPlacement || oldPlacement === newPlacement) return null;
  const oldGrid = placementToGrid(oldPlacement);
  const newGrid = placementToGrid(newPlacement);

  const changed = [];
  const disappeared = [];
  const appeared = [];

  for (let f = 0; f < 8; f++) {
    for (let r = 1; r <= 8; r++) {
      const sq = String.fromCharCode(97 + f) + r;
      const oldPiece = oldGrid[sq] || '.';
      const newPiece = newGrid[sq] || '.';
      if (oldPiece !== newPiece) {
        changed.push({ sq, oldPiece, newPiece });
        if (oldPiece !== '.') {
          const color = oldPiece === oldPiece.toUpperCase() ? 'w' : 'b';
          disappeared.push({ sq, piece: oldPiece, color });
        }
        if (newPiece !== '.') {
          const color = newPiece === newPiece.toUpperCase() ? 'w' : 'b';
          appeared.push({ sq, piece: newPiece, color });
        }
      }
    }
  }

  if (changed.length === 0) return null;

  // Case 1: Standard Move
  if (disappeared.length === 1 && appeared.length === 1) {
    const moverColor = appeared[0].color;
    return {
      type: 'move',
      from: disappeared[0].sq,
      to: appeared[0].sq,
      moverColor,
      nextTurn: moverColor === 'w' ? 'b' : 'w',
      uci: disappeared[0].sq + appeared[0].sq,
    };
  }

  // Case 2: Capture
  if (disappeared.length === 2 && appeared.length === 1) {
    const arrival = appeared[0];
    const departure = disappeared.find((d) => d.color === arrival.color) || disappeared[0];
    const moverColor = arrival.color;
    return {
      type: 'capture',
      from: departure.sq,
      to: arrival.sq,
      moverColor,
      nextTurn: moverColor === 'w' ? 'b' : 'w',
      uci: departure.sq + arrival.sq,
    };
  }

  // Case 3: Castling
  if (disappeared.length === 2 && appeared.length === 2) {
    const moverColor = appeared[0].color;
    const kingMove = disappeared.find((d) => d.piece.toLowerCase() === 'k');
    const kingDest = appeared.find((a) => a.piece.toLowerCase() === 'k');
    if (kingMove && kingDest) {
      return {
        type: 'castle',
        from: kingMove.sq,
        to: kingDest.sq,
        moverColor,
        nextTurn: moverColor === 'w' ? 'b' : 'w',
        uci: kingMove.sq + kingDest.sq,
      };
    }
  }

  // Case 4: Promotion or pawn advance
  if (appeared.length === 1 && disappeared.length === 1) {
    const moverColor = appeared[0].color;
    return {
      type: 'promotion',
      from: disappeared[0].sq,
      to: appeared[0].sq,
      moverColor,
      nextTurn: moverColor === 'w' ? 'b' : 'w',
      uci: disappeared[0].sq + appeared[0].sq,
    };
  }

  return {
    type: 'complex',
    nextTurn: currentTurn === 'w' ? 'b' : 'w',
  };
}

export function inferTurnFromPlacement(placement) {
  try {
    const wTest = makeChess(`${placement} w - - 0 1`);
    if (wTest.inCheck()) return 'w';
  } catch (_) {}

  try {
    const bTest = makeChess(`${placement} b - - 0 1`);
    if (bTest.inCheck()) return 'b';
  } catch (_) {}

  const grid = placementToGrid(placement);
  let whiteMoved = 0;
  let blackMoved = 0;

  for (let f = 0; f < 8; f++) {
    const file = String.fromCharCode(97 + f);
    if (grid[file + '2'] !== 'P') whiteMoved++;
    if (grid[file + '1'] === '.') whiteMoved++;
    if (grid[file + '7'] !== 'p') blackMoved++;
    if (grid[file + '8'] === '.') blackMoved++;
  }

  if (whiteMoved > blackMoved) return 'b';
  return 'w';
}
