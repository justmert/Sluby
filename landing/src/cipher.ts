// ciphertext look: rows of hex in warm tints. a full paint fills the canvas,
// otherwise a few rows are reshuffled per call
export function drawCipher(cv: HTMLCanvasElement, full: boolean) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = Math.floor(cv.clientWidth * dpr),
    h = Math.floor(cv.clientHeight * dpr);
  if (!w || !h) return;
  const ctx = cv.getContext('2d');
  if (!ctx) return;
  if (cv.width !== w || cv.height !== h) {
    cv.width = w;
    cv.height = h;
    full = true;
  }
  const fs = 14 * dpr,
    lh = 20 * dpr,
    cw = fs * 0.62;
  const rows = Math.ceil(h / lh),
    cols = Math.ceil(w / cw);
  const tints = ['#4a3f34', '#5a4c3e', '#6e5c4a', '#8c7660', '#c9b28f', '#f08a55'];
  const hex = '0123456789abcdef';
  ctx.font = `${fs}px 'DM Mono', ui-monospace, monospace`;
  ctx.textBaseline = 'top';
  const paint = (r: number) => {
    ctx.fillStyle = '#241f1a';
    ctx.fillRect(0, r * lh, w, lh);
    for (let c = 0; c < cols; c++) {
      const k = Math.random();
      ctx.fillStyle =
        tints[k < 0.5 ? 0 : k < 0.72 ? 1 : k < 0.86 ? 2 : k < 0.95 ? 3 : k < 0.985 ? 4 : 5];
      ctx.globalAlpha = 0.45 + Math.random() * 0.5;
      ctx.fillText(hex[(Math.random() * 16) | 0], c * cw, r * lh + 3 * dpr);
    }
    ctx.globalAlpha = 1;
  };
  if (full) for (let r = 0; r < rows; r++) paint(r);
  else for (let n = 0; n < 4; n++) paint((Math.random() * rows) | 0);
}

export function cipherNeedsResize(cv: HTMLCanvasElement) {
  return cv.width !== Math.floor(cv.clientWidth * Math.min(window.devicePixelRatio || 1, 2));
}
