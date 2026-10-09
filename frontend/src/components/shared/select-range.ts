/**
 * The selection after a shift-click: every row from the last one toggled
 * (the anchor) through the clicked one takes the clicked row's new state.
 * Without an anchor on this page it is a plain toggle.
 */
export function selectRange(
  ids: readonly string[],
  selected: ReadonlySet<string>,
  anchor: string | null,
  target: string,
  on: boolean,
): Set<string> {
  const next = new Set(selected);
  const from = anchor === null ? -1 : ids.indexOf(anchor);
  const to = ids.indexOf(target);
  const [lo, hi] = from < 0 ? [to, to] : [Math.min(from, to), Math.max(from, to)];
  for (const id of ids.slice(lo, hi + 1)) {
    if (on) next.add(id);
    else next.delete(id);
  }
  return next;
}
