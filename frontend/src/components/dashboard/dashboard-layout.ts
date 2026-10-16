// the grids follow the page container (PageContainer's `page`), which is the
// content column without the sidebar, not the viewport
export const DASH = {
  stats: 'grid grid-cols-2 gap-4 @3xl/page:grid-cols-4',
  main: 'mt-4 grid gap-4 @3xl/page:grid-cols-3',
  latest: '@3xl/page:col-span-2',
  // one column until a card has room for its rows, about 336 px each
  operator: 'grid gap-4 @2xl/page:grid-cols-2 @5xl/page:grid-cols-3',
  reconciliation: '@2xl/page:col-span-2 @5xl/page:col-span-1',
  updated: 'mt-6',
} as const;

export const STATUS_TENANT_LINE = 'The server and the Sia network it stores on';

export const LATEST = 6;

// how many rows the list showed last time, so a reload holds that much room
// while it loads; per browser, and only a layout hint
const ROWS_KEY = 'sluby-dashboard-latest-rows';

export function rememberedRows(): number | undefined {
  try {
    const n = Number(localStorage.getItem(ROWS_KEY));
    return Number.isInteger(n) && n > 0 && n <= LATEST ? n : undefined;
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

export const STORAGE_COPY = {
  title: 'Storage usage',
  description: 'Data pinned to Sia through the indexer account',
};
export const CACHE_COPY = {
  title: 'Cache statistics',
  description: 'Delivery gateway cache in this backend process',
};
export const RECONCILIATION_COPY = {
  title: 'Reconciliation',
  description: 'The database against the indexer, for every account',
};

export const DEPLOYMENT_HEADING = 'Deployment, shown to operators';

// analytics, on the same page container
export const ANALYTICS = {
  stats: 'grid grid-cols-2 gap-4 @3xl/page:grid-cols-4',
  charts: 'mt-4 grid gap-4 @3xl/page:grid-cols-2',
  updated: 'mt-3',
  library: 'mt-4',
} as const;

// chart boxes keep these heights in every state, so nothing below moves
export const SERVER_CHART = 'h-56';
export const LIBRARY_CHART = 'h-48';

export const THROUGHPUT_COPY = {
  title: 'Gateway throughput',
  description: 'Sampled every 10 seconds while this page is open',
};
export const RESPONSES_COPY = {
  title: 'Gateway responses',
  description: 'By object kind, since the backend started',
};
export const LIBRARY_COPY = { title: 'Your library', description: 'Assets by status' };
