// the overview's layout. the stat grid and the attention row wrap by the
// room the content column has, not by the viewport
export const DASH = {
  // the board's sections, 24px apart
  page: 'flex flex-col gap-6 text-sm',
  // stat cards of at least 200px, as many to a row as fit
  stats: 'grid grid-cols-[repeat(auto-fit,minmax(min(100%,12.5rem),1fr))] gap-4',
  // needs attention takes two parts to status's one, and wraps under it when narrow
  middle: 'flex flex-wrap gap-4',
} as const;

/** Rows in Recent videos. */
export const RECENT = 6;

// how many rows the list showed last time, so a reload holds that much room
// while it loads; per browser, and only a layout hint
const ROWS_KEY = 'sluby-dashboard-latest-rows';

export function rememberedRows(): number | undefined {
  try {
    const n = Number(localStorage.getItem(ROWS_KEY));
    return Number.isInteger(n) && n > 0 && n <= RECENT ? n : undefined;
  } catch {
    // storage blocked (private window, site data off): no hint, nothing breaks
    return undefined;
  }
}

export function rememberRows(n: number) {
  try {
    localStorage.setItem(ROWS_KEY, String(n));
  } catch {
    // see rememberedRows
  }
}

// metrics, on the same page container
export const ANALYTICS = {
  // the counters follow the content width: two across on a phone, four on a desktop
  stats: 'grid grid-cols-2 gap-4 @3xl/page:grid-cols-4',
  charts: 'mt-4 grid gap-4 @3xl/page:grid-cols-2',
  updated: 'mt-3',
} as const;

// a drawn chart keeps this height in every state; a chart with nothing to
// draw collapses to the smaller box
export const SERVER_CHART = 'h-56';
export const EMPTY_CHART = 'min-h-40';

export const THROUGHPUT_COPY = {
  title: 'Streaming throughput',
  description: 'Measured every 10 seconds while this page is open',
};
export const RESPONSES_COPY = {
  title: 'Streaming requests',
  description: 'By file type, since the server started',
};
