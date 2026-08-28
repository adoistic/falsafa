/**
 * Inline icon set for the player — 20px, 1.5px strokes, currentColor.
 * Drawn to match the site's chrome icons (search / theme triggers).
 */
const svg = (inner: string, vb = "0 0 20 20") =>
  `<svg viewBox="${vb}" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

export const icons = {
  play: svg(`<path d="M6 4.2v11.6c0 .5.55.8.98.53l9.02-5.8a.62.62 0 0 0 0-1.06L6.98 3.67A.62.62 0 0 0 6 4.2Z" fill="currentColor" stroke="none"/>`),
  pause: svg(`<rect x="5" y="4" width="3.2" height="12" rx="0.8" fill="currentColor" stroke="none"/><rect x="11.8" y="4" width="3.2" height="12" rx="0.8" fill="currentColor" stroke="none"/>`),
  back15: svg(`<path d="M9.5 3.8 7 6l2.5 2.2"/><path d="M7 6h5.2a4.8 4.8 0 1 1-4.7 5.9"/><text x="10.1" y="16.5" font-size="6.2" fill="currentColor" stroke="none" text-anchor="middle" font-family="inherit">15</text>`),
  fwd30: svg(`<path d="M10.5 3.8 13 6l-2.5 2.2"/><path d="M13 6H7.8a4.8 4.8 0 1 0 4.7 5.9"/><text x="10" y="16.5" font-size="6.2" fill="currentColor" stroke="none" text-anchor="middle" font-family="inherit">30</text>`),
  close: svg(`<path d="M5 5l10 10M15 5L5 15"/>`),
  lines: svg(`<path d="M4 5.5h12M4 10h12M4 14.5h7"/>`),
  chevronDown: svg(`<path d="M5 8l5 5 5-5"/>`),
  spinner: svg(`<circle cx="10" cy="10" r="6.5" stroke-opacity="0.25"/><path d="M16.5 10a6.5 6.5 0 0 0-6.5-6.5"/>`),
};
