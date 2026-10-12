import { TriangleAlert } from 'lucide-react';

/**
 * The note under the quickstart's API rows: keys belong on a server. A
 * neutral card with an amber icon, since it asks for care, not alarm. Its own
 * module so the route skeleton shows the same note, wrapped the same, without
 * loading the page.
 */
export function KeyNote() {
  return (
    <p className="flex items-start gap-2.5 rounded-[10px] border px-3.5 py-3">
      <TriangleAlert aria-hidden="true" className="mt-px size-4.5 shrink-0 text-warning-icon" />
      <span>
        Keys are server secrets. Never put one in browser code; the embed snippets need none.
      </span>
    </p>
  );
}
