export type LibraryView = 'table' | 'grid';

const VIEW_KEY = 'sluby:videos-view';

function storedView(): LibraryView | null {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === 'grid' || v === 'table' ? v : null;
  } catch (err) {
    // storage off (a private window, a policy): the url still carries the view
    console.warn('Could not read the remembered library view', err);
    return null;
  }
}

export function rememberView(view: LibraryView) {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch (err) {
    console.warn('Could not remember the library view', err);
  }
}

/**
 * The library's view from the url's `view` (already checked), else the one
 * this browser remembers, else the table. "list" is what the view was called
 * before the table became the default.
 */
export function libraryView(param: string | undefined): LibraryView {
  if (param === 'grid') return 'grid';
  if (param) return 'table';
  return storedView() ?? 'table';
}
