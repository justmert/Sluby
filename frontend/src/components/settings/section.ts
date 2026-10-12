// one settings section: its heading and a line about it in a label column,
// the content beside it. the columns follow the page container, so they
// stack once the page is too narrow for both, and the first section drops
// its rule because the page header is right above it
export const SETTINGS_SECTION =
  'grid items-start gap-x-8 gap-y-3 border-t pt-6 first:border-t-0 first:pt-0 @2xl/page:grid-cols-[15rem_minmax(0,1fr)] @2xl/page:[&>*:not(:first-child)]:col-start-2';

// the heading block in the label column: no rhythm of its own (the grid
// spaces it), and an action stacks under the line instead of squeezing it
export const SETTINGS_HEAD = 'mt-0 mb-0 flex-col items-start gap-3';
