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
// stacked: side by side, a short request beside a long answer left a hole
export const EXPLORER_GRID = 'flex flex-col gap-4';
// template, method, path and Send on one line when there is room; the
// template takes its own line below that, and everything stacks on a phone
export const EXPLORER_ROW =
  'grid grid-cols-1 items-end gap-2 @lg/page:grid-cols-[7rem_minmax(0,1fr)_auto] @4xl/page:grid-cols-[minmax(0,18rem)_7rem_minmax(0,1fr)_auto]';
export const EXPLORER_TEMPLATE = 'grid min-w-0 gap-2 @lg/page:col-span-3 @4xl/page:col-span-1';
export const EXPLORER_SEND = '@lg/page:min-w-24';
