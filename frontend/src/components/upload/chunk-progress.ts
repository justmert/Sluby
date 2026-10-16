const MAX_CELLS = 96;

/**
 * The file as the tus chunks it is sent in. Large files group several chunks
 * per cell so the strip stays readable; the caption says how many.
 */
export function chunkProgress(bytesUploaded: number, bytesTotal: number, chunkSize: number) {
  const chunks = Math.max(1, Math.ceil(bytesTotal / chunkSize));
  const perCell = Math.ceil(chunks / MAX_CELLS);
  const cells = Math.ceil(chunks / perCell);
  // the last chunk is usually short, so measure fill against real byte ranges
  const fills = Array.from({ length: cells }, (_, i) => {
    const from = i * perCell * chunkSize;
    const to = Math.min(bytesTotal, (i + 1) * perCell * chunkSize);
    return to > from ? Math.min(1, Math.max(0, (bytesUploaded - from) / (to - from))) : 0;
  });
  const done =
    bytesUploaded >= bytesTotal ? chunks : Math.min(chunks, Math.floor(bytesUploaded / chunkSize));
  return { chunks, perCell, fills, done };
}
