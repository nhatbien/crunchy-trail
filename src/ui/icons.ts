const svg = (body: string, vb = '0 0 24 24') => `<svg viewBox="${vb}" aria-hidden="true" focusable="false">${body}</svg>`;

export const ICONS = {
  play: svg('<path d="M8 4.8v14.4c0 .8.9 1.3 1.6.9l11.3-7.2c.6-.4.6-1.4 0-1.8L9.6 3.9C8.9 3.5 8 4 8 4.8z" fill="currentColor"/>'),
  pause: svg('<rect x="6" y="4.5" width="4.2" height="15" rx="2" fill="currentColor"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="2" fill="currentColor"/>'),
  gear: svg(
    '<path fill="currentColor" d="M19.14 12.94c.04-.3.06-.61.06-.94s-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.49.49 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z"/>',
  ),
  shirt: svg('<path fill="currentColor" d="M8.3 3.2 3.4 5.6a1.6 1.6 0 0 0-.8 2l1.1 2.8c.3.8 1.2 1.2 2 .8l.9-.4v8.5c0 .9.7 1.6 1.6 1.6h7.6c.9 0 1.6-.7 1.6-1.6v-8.5l.9.4c.8.4 1.7 0 2-.8l1.1-2.8a1.6 1.6 0 0 0-.8-2l-4.9-2.4c-.5.9-1.9 2.2-3.7 2.2S8.8 4.1 8.3 3.2z"/>'),
  gem: svg(
    '<path d="M6.2 3.5h11.6l4 5.4L12 21 2.2 8.9z" fill="#ff8fb8"/><path d="M2.2 8.9h19.6L12 21z" fill="#ff6f9f"/><path d="M8.6 8.9 12 21l3.4-12.1z" fill="#ff86ad"/><path d="M6.2 3.5 8.6 8.9h6.8l2.4-5.4z" fill="#ffc2d8"/><path d="M8.6 8.9 12 3.5l3.4 5.4z" fill="#ffe3ee"/>',
  ),
  home: svg('<path fill="currentColor" d="M11.1 3.4a1.4 1.4 0 0 1 1.8 0l7.8 6.7c.9.8.4 2.3-.8 2.3H19v6.8c0 .9-.7 1.6-1.6 1.6h-3v-5.2h-4.8v5.2h-3c-.9 0-1.6-.7-1.6-1.6v-6.8h-.9c-1.2 0-1.7-1.5-.8-2.3z"/>'),
  music: svg('<path fill="currentColor" d="M12 3v10.6A4 4 0 1 0 14 17V7h4V3z"/>'),
  leaf: svg('<path fill="currentColor" d="M20.5 3.5C11 3.6 4.4 7.6 4.4 14.4c0 1.4.4 2.7 1 3.8L3.6 20l1.4 1.4 1.8-1.8c1.1.6 2.4 1 3.8 1 6.8 0 10-6.8 9.9-17.1zM8 17.4c2.3-3.6 5.3-6.4 9-8.4-3.2 2.6-5.6 5.5-7.4 9z"/>'),
  vibrate: svg('<path fill="currentColor" d="M0 15h2V9H0zm3 2h2V7H3zm19-8v6h2V9zm-3 8h2V7h-2zM16.5 3h-9C6.7 3 6 3.7 6 4.5v15c0 .8.7 1.5 1.5 1.5h9c.8 0 1.5-.7 1.5-1.5v-15c0-.8-.7-1.5-1.5-1.5zM16 19H8V5h8z"/>'),
  map: svg('<path fill="currentColor" d="M9 3.6 3.9 5.5c-.5.2-.9.7-.9 1.3v12.6c0 .7.7 1.2 1.4.9L9 18.6l6 2.1 5.1-1.9c.5-.2.9-.7.9-1.3V4.9c0-.7-.7-1.2-1.4-.9L15 5.7zm1 2.1 4 1.4v11.2l-4-1.4z"/>'),
  check: svg('<path fill="currentColor" d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/>'),
  next: svg('<path fill="currentColor" d="M9.3 5.3a1 1 0 0 0 0 1.4l5.3 5.3-5.3 5.3a1 1 0 1 0 1.4 1.4l6-6a1 1 0 0 0 0-1.4l-6-6a1 1 0 0 0-1.4 0z"/>'),
  sparkle: svg('<path fill="currentColor" d="M12 2c.6 4.6 2.4 7.4 7 8-4.6.6-6.4 3.4-7 8-.6-4.6-2.4-7.4-7-8 4.6-.6 6.4-3.4 7-8zm7 12c.3 2.2 1.1 3.4 3 3.7-1.9.3-2.7 1.5-3 3.7-.3-2.2-1.1-3.4-3-3.7 1.9-.3 2.7-1.5 3-3.7z"/>'),
  hand: svg(
    '<path d="M9 11.5V5.2a1.7 1.7 0 1 1 3.4 0v5.1l.1-1.6a1.7 1.7 0 0 1 3.4.2v1.5a1.6 1.6 0 0 1 3.2.2v1.3a1.5 1.5 0 0 1 3 .2v4.6c0 3.6-2.8 6.4-6.4 6.4h-1.9a6.3 6.3 0 0 1-5-2.5l-3.6-4.8a1.6 1.6 0 0 1 2.4-2.1z" fill="#fff" stroke="#3b2f4a" stroke-width="1.3" stroke-linejoin="round"/>',
    '0 0 26 26',
  ),
};

/** Small illustrated icons for the hat shop. */
export const HAT_ICONS: Record<string, string> = {
  none: svg('<circle cx="24" cy="26" r="13" fill="#fff4e8" stroke="#e9d9c8" stroke-width="2"/><circle cx="19.5" cy="25" r="1.8" fill="#3b2f4a"/><circle cx="28.5" cy="25" r="1.8" fill="#3b2f4a"/>', '0 0 48 48'),
  sprout: svg('<path d="M24 34V18" stroke="#5fb236" stroke-width="3" stroke-linecap="round"/><path d="M24 20c-2-6-8-8-13-6 2 6 8 8 13 6zM24 20c2-6 8-8 13-6-2 6-8 8-13 6z" fill="#86dc5a"/>', '0 0 48 48'),
  flower: svg('<g fill="#ffb3d1"><circle cx="24" cy="15" r="7"/><circle cx="33" cy="21.5" r="7"/><circle cx="29.5" cy="32" r="7"/><circle cx="18.5" cy="32" r="7"/><circle cx="15" cy="21.5" r="7"/></g><circle cx="24" cy="24" r="5.5" fill="#ffd84d"/>', '0 0 48 48'),
  beanie: svg('<path d="M9 31a15 15 0 0 1 30 0z" fill="#ff8a8a"/><rect x="7" y="29" width="34" height="8" rx="4" fill="#fff1ea"/><circle cx="24" cy="12" r="5" fill="#fff1ea"/>', '0 0 48 48'),
  bow: svg('<path d="M24 24 9 15v18zM24 24l15-9v18z" fill="#ff6f9f"/><circle cx="24" cy="24" r="5" fill="#ff4f88"/>', '0 0 48 48'),
  headphones: svg('<path d="M9 28v-4a15 15 0 0 1 30 0v4" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/><path d="M9 28v-4a15 15 0 0 1 30 0v4" fill="none" stroke="#e8dff5" stroke-width="1.2"/><rect x="5" y="25" width="10" height="14" rx="5" fill="#ff9ec0"/><rect x="33" y="25" width="10" height="14" rx="5" fill="#ff9ec0"/>', '0 0 48 48'),
  crown: svg('<path d="M8 34 6 15l10 8 8-12 8 12 10-8-2 19z" fill="#ffd35a" stroke="#e8b33a" stroke-width="1.5" stroke-linejoin="round"/><circle cx="16" cy="29" r="2.2" fill="#ff6f91"/><circle cx="24" cy="29" r="2.2" fill="#6fc3ff"/><circle cx="32" cy="29" r="2.2" fill="#9be564"/>', '0 0 48 48'),
};
