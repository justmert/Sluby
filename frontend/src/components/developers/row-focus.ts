/*
 * after a row's dialog closes, focus goes back to that row's menu, or to the
 * row that took its place when it was deleted, or to the page's main button
 * when the table is empty (A11Y-03). dialogs opened from a menu item cannot
 * rely on the opener: the item is gone by the time the dialog closes. rows
 * are found by id (DataTable's data-row-id), since a deleted row stays in
 * the table while it fades out.
 */

function rowOf(caption: string, id: string): HTMLElement | null {
  const table = document.querySelector(`table[aria-label="${CSS.escape(caption)}"]`);
  return table?.querySelector<HTMLElement>(`tbody tr[data-row-id="${CSS.escape(id)}"]`) ?? null;
}

/**
 * Focus the menu of the first of `ids` still in the table, or `fallback`.
 * It waits a frame, so the table has caught up with the change first.
 */
export function focusRowMenu(
  caption: string,
  ids: Array<string | null | undefined>,
  fallback?: () => HTMLElement | null,
) {
  requestAnimationFrame(() => {
    for (const id of ids) {
      const menu = id
        ? rowOf(caption, id)?.querySelector<HTMLElement>('button[aria-label^="Actions for"]')
        : null;
      if (menu) {
        menu.focus();
        return;
      }
    }
    fallback?.()?.focus();
  });
}

/**
 * Click a row's inline edit button once the menu that asked for it has
 * closed: the menu hands focus back to its trigger as it goes, which would
 * blur (and so end) an edit started any earlier.
 */
export function startRowEdit(caption: string, id: string) {
  let frames = 0;
  const tick = () => {
    const row = rowOf(caption, id);
    const trigger = row?.querySelector('button[aria-label^="Actions for"]');
    const menuOpen = document.querySelector('[role="menu"]') !== null;
    if ((document.activeElement === trigger && !menuOpen) || frames++ > 30) {
      row?.querySelector<HTMLButtonElement>('button[data-slot="inline-edit"]')?.click();
      return;
    }
    requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

/** Where focus should go after a row's dialog: the row itself, else its neighbours. */
export interface RowFocus {
  own: string;
  next?: string;
  prev?: string;
  /** the row was deleted, so it is not a target any more */
  gone: boolean;
}

export function rowFocus<T>(rows: T[] | undefined, row: T, idOf: (r: T) => string): RowFocus {
  const i = rows?.indexOf(row) ?? -1;
  return {
    own: idOf(row),
    next: i >= 0 && rows && i + 1 < rows.length ? idOf(rows[i + 1]) : undefined,
    prev: i > 0 && rows ? idOf(rows[i - 1]) : undefined,
    gone: false,
  };
}

export const focusTargets = (f: RowFocus) => (f.gone ? [f.next, f.prev] : [f.own]);
