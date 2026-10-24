export const BOARD_THEMES = {
  ncm: { name: 'Classic NCM', light: '#cdc574', dark: '#7a9e6b' },
  green: { name: 'Green', light: '#eeeed2', dark: '#769656' },
  brown: { name: 'Brown', light: '#f0d9b5', dark: '#b58863' },
  blue: { name: 'Blue', light: '#dee3e6', dark: '#8ca2ad' },
  ice: { name: 'Ice', light: '#e8f0f7', dark: '#93afc8' },
  purple: { name: 'Purple', light: '#ece4f3', dark: '#9a7bb5' },
  coral: { name: 'Coral', light: '#f3e4d6', dark: '#d08c6a' },
  gray: { name: 'Gray', light: '#dadada', dark: '#9b9b9b' },
  wood: { name: 'Walnut', light: '#e6c79c', dark: '#8b5a3c' },
  tournament: { name: 'Tournament', light: '#ece6d2', dark: '#4f7d5c' },
  midnight: { name: 'Midnight', light: '#7d8a99', dark: '#3b4654' },
  custom: { name: 'Custom', light: null, dark: null },
};

export const ACCENTS = ['#6fbf73', '#4aa3ff', '#f2b134', '#ef6f6c', '#b48cf2', '#33c3b5', '#ff8fc7', '#e6e6e6'];

export const ARROW_COLORS = ['#22a35a', '#3b82f6', '#f59e0b', '#a855f7', '#ef4444', '#14b8a6', '#ec4899', '#64748b'];
export const REPLY_COLOR = '#e5484d';

export function boardColors(settings) {
  const b = settings.board;
  if (b.theme === 'custom') return { light: b.customLight, dark: b.customDark };
  const t = BOARD_THEMES[b.theme] || BOARD_THEMES.ncm;
  return { light: t.light, dark: t.dark };
}

export function boardSvg(light, dark) {
  let rects = '';
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      if ((x + y) % 2 === 1) rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${dark}"/>`;
    }
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8" shape-rendering="crispEdges"><rect width="8" height="8" fill="${light}"/>${rects}</svg>`;
  return `url("data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}")`;
}

// Light text on dark squares and dark text on light squares.
export function contrastText(hex) {
  const n = parseInt(hex.replace('#', ''), 16);
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150 ? 'rgba(40,40,40,0.85)' : 'rgba(255,255,255,0.9)';
}
