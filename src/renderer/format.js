// Turning engine numbers and moves into text.
import { makeChess } from './game.js';

const FIGURINES = { K: '♚', Q: '♛', R: '♜', B: '♝', N: '♞' };

export function winPercent(cp) {
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

// Engine scores are from the side to move. Convert to White's view.
export function whiteScore(score, turn) {
  if (!score) return null;
  const sign = turn === 'b' ? -1 : 1;
  if (score.mate !== undefined) return { mate: score.mate * sign, bound: score.bound };
  return { cp: score.cp * sign, bound: score.bound };
}

export function viewScore(score, turn, perspective) {
  if (!score) return null;
  return perspective === 'side' ? score : whiteScore(score, turn);
}

export function scoreToWinPct(s) {
  if (!s) return 50;
  if (s.mate !== undefined) return s.mate > 0 ? 100 : s.mate < 0 ? 0 : 50;
  return winPercent(s.cp);
}

export function formatScore(s, format = 'pawns') {
  if (!s) return '…';
  if (s.mate !== undefined) {
    if (s.mate === 0) return '#';
    return s.mate > 0 ? `M${s.mate}` : `-M${-s.mate}`;
  }
  if (format === 'winpct') return `${scoreToWinPct(s).toFixed(0)}%`;
  const v = s.cp / 100;
  const txt = Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2);
  return v > 0 ? `+${txt}` : txt;
}

export function scoreClass(s) {
  if (!s) return '';
  if (s.mate !== undefined) return s.mate > 0 ? 'pos mate' : 'neg mate';
  if (s.cp > 30) return 'pos';
  if (s.cp < -30) return 'neg';
  return 'even';
}

export function shortScore(s) {
  if (!s) return '';
  if (s.mate !== undefined) return s.mate > 0 ? `M${s.mate}` : `-M${-s.mate}`;
  const v = s.cp / 100;
  return (v > 0 ? '+' : '') + (Math.abs(v) >= 10 ? v.toFixed(0) : v.toFixed(1));
}

export function figurine(san) {
  return san.replace(/[KQRBN]/g, (c) => FIGURINES[c]);
}

export function moveText(move, notation) {
  if (notation === 'uci') return move.uci;
  if (notation === 'figurine') return figurine(move.san);
  return move.san;
}

// Converts an engine line (UCI moves) into moves with SAN, starting at fen.
export function pvMoves(fen, uciMoves, max = 99) {
  const out = [];
  let c;
  try {
    c = makeChess(fen);
  } catch (_) {
    return out;
  }
  for (const uci of uciMoves.slice(0, max)) {
    let m;
    try {
      m = c.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] || undefined });
    } catch (_) {
      break;
    }
    if (!m) break;
    out.push({ uci, san: m.san, color: m.color, fen: c.fen() });
  }
  return out;
}

export function moveNumberOf(fen) {
  return Number(fen.split(' ')[5]) || 1;
}

export function formatNodes(n) {
  if (n === undefined || n === null) return '–';
  if (n >= 1e9) return (n / 1e9).toFixed(2) + 'G';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'k';
  return String(n);
}

export function formatNps(n) {
  if (!n) return '–';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + ' Mn/s';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + ' kn/s';
  return n + ' n/s';
}

export function formatMs(ms) {
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${Number.isInteger(s) ? s : s.toFixed(1)} s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

export function rateMoveOutOf10(lineScore, bestScore) {
  if (!lineScore || !bestScore) return '10/10';
  const bestWin = scoreToWinPct(bestScore);
  const lineWin = scoreToWinPct(lineScore);
  const drop = Math.max(0, bestWin - lineWin);

  if (drop < 0.4) return '10/10';

  const rating = Math.max(1.0, Math.min(9.9, 10.0 - (drop * 0.18)));
  return `${rating.toFixed(1)}/10`;
}

export function ratingClass(ratingStr) {
  const num = parseFloat(ratingStr) || 10;
  if (num >= 9.8) return 'best';
  if (num >= 9.0) return 'great';
  if (num >= 7.5) return 'good';
  if (num >= 5.5) return 'inaccuracy';
  if (num >= 3.5) return 'mistake';
  return 'blunder';
}
