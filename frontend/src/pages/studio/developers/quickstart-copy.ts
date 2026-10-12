// the quickstart's words and shared classes, apart from its components so
// fast refresh keeps working on them

export const QUICKSTART_DESCRIPTION =
  'Play a video on your site, then automate uploads from your server.';

export const STEP_TITLES = ['Pick a video', 'Your API', 'Copy a snippet', 'Try a request'];
export const stepHeadingId = (n: number) => `quickstart-step-${n}`;

// a small button beside a value: 30 px on a mouse, a finger's 36 px on touch
export const SMALL_BUTTON = 'h-7.5 px-2.5 text-sm pointer-coarse:h-9';

// the explorer's cards and grids, shared with its route skeleton
export const EXPLORER_CARD =
  'flex min-w-0 flex-col gap-4 rounded-xl border bg-card px-6 py-5 text-sm max-sm:px-4';
export const EXPLORER_GRID = 'grid items-start gap-4 @4xl/page:grid-cols-2';
export const EXPLORER_ROW =
  'grid grid-cols-1 items-end gap-2 @[16rem]/page:grid-cols-[7rem_minmax(0,1fr)] @lg/page:grid-cols-[7rem_minmax(0,1fr)_auto]';
