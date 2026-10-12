import { createContext, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatBytes, formatCount, plural } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import { CodeBlock } from './CodeBlock';
import { CopyButton } from './CopyButton';

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

/** objects and arrays deeper than this start closed */
const OPEN_DEPTH = 2;
/** below the root, a node with more children than this starts closed */
const OPEN_MAX = 20;
/** children drawn per node before a "Show more" row, so a long list stays quick */
export const JSON_CHUNK = 100;

const ROOT = '$';

type Mode = 'default' | 'open' | 'closed';

interface TreeState {
  isOpen: (path: string, depth: number, size: number) => boolean;
  toggle: (path: string, open: boolean) => void;
  shownOf: (path: string) => number;
  showMore: (path: string) => void;
  active: string;
  focusPath: (path: string) => void;
}

const TreeContext = createContext<TreeState | null>(null);

const isContainer = (v: Json): v is Json[] | { [key: string]: Json } =>
  typeof v === 'object' && v !== null;

const sizeOf = (v: Json[] | { [key: string]: Json }) =>
  Array.isArray(v) ? v.length : Object.keys(v).length;

const summary = (v: Json[] | { [key: string]: Json }) =>
  Array.isArray(v) ? plural(v.length, 'item') : plural(sizeOf(v), 'key');

const PUNCT = 'text-muted-foreground';

function Leaf({ value }: { value: Json }) {
  if (value === null) return <span className="text-muted-foreground italic">null</span>;
  if (typeof value === 'string')
    return <span className="text-code-string">{JSON.stringify(value)}</span>;
  if (typeof value === 'number') return <span className="text-code-number">{String(value)}</span>;
  return <span className="text-code-keyword">{String(value)}</span>;
}

/** what a screen reader hears for a value it cannot open */
const spoken = (v: Json) => (typeof v === 'string' ? v : String(v));

function Caret({ open, onToggle }: { open: boolean; onToggle: () => void }) {
  return (
    // the treeitem is the keyboard stop and announces the state; this is the mouse target
    <button
      type="button"
      tabIndex={-1}
      aria-hidden="true"
      onClick={onToggle}
      className="grid size-4.5 shrink-0 cursor-pointer place-items-center rounded-sm text-muted-foreground hover:text-foreground"
    >
      <ChevronRight
        className={cn(
          'size-3.5 transition-transform duration-150 ease-out-soft',
          open && 'rotate-90',
        )}
      />
    </button>
  );
}

const Spacer = () => <span aria-hidden="true" className="w-4.5 shrink-0" />;

// the ring sits on the item's own line, not around its whole subtree
const ITEM =
  'outline-none [&:focus-visible>[data-line]]:ring-2 [&:focus-visible>[data-line]]:ring-ring';
const LINE = 'flex items-start rounded-sm';

function JsonNode({
  name,
  value,
  path,
  depth,
  last,
  label,
}: {
  /** the key in its parent object; undefined for array items and the root */
  name?: string;
  value: Json;
  path: string;
  depth: number;
  last: boolean;
  /** what the item is called for a screen reader: the key, the index or the tree's label */
  label: string;
}) {
  const tree = useContext(TreeContext)!;
  const comma = last ? null : <span className={PUNCT}>,</span>;
  const key =
    name === undefined ? null : (
      <>
        <span className="text-code-fn">{JSON.stringify(name)}</span>
        <span className={PUNCT}>:&nbsp;</span>
      </>
    );
  const common = {
    role: 'treeitem',
    'aria-level': depth + 1,
    'data-path': path,
    tabIndex: tree.active === path ? 0 : -1,
    className: ITEM,
  } as const;

  if (!isContainer(value)) {
    return (
      <li {...common} aria-label={`${label}: ${spoken(value)}`}>
        <div data-line className={LINE}>
          <Spacer />
          <span className="min-w-0 wrap-anywhere">
            {key}
            <Leaf value={value} />
            {comma}
          </span>
        </div>
      </li>
    );
  }

  const array = Array.isArray(value);
  const [opening, closing] = array ? ['[', ']'] : ['{', '}'];
  const size = sizeOf(value);

  if (size === 0) {
    return (
      <li {...common} aria-label={`${label}: ${array ? 'empty list' : 'empty object'}`}>
        <div data-line className={LINE}>
          <Spacer />
          <span className="min-w-0 wrap-anywhere">
            {key}
            <span className={PUNCT}>
              {opening}
              {closing}
            </span>
            {comma}
          </span>
        </div>
      </li>
    );
  }

  const open = tree.isOpen(path, depth, size);
  const toggle = () => {
    tree.toggle(path, !open);
    tree.focusPath(path);
  };
  const entries: Array<[string, Json]> = array
    ? value.map((v, i) => [String(i), v])
    : Object.entries(value);
  const shown = tree.shownOf(path);
  const rest = size - shown;

  return (
    <li {...common} aria-label={`${label}, ${summary(value)}`} aria-expanded={open}>
      <div data-line className={LINE}>
        <Caret open={open} onToggle={toggle} />
        <span className="min-w-0 wrap-anywhere">
          {key}
          <span className={PUNCT}>{opening}</span>
          {!open && (
            <>
              <span className="mx-1 rounded-sm border px-1 text-muted-foreground">
                {summary(value)}
              </span>
              <span className={PUNCT}>{closing}</span>
              {comma}
            </>
          )}
        </span>
      </div>
      {open && (
        <>
          <ul role="group" className="pl-4.5">
            {entries.slice(0, shown).map(([k, v], i) => (
              <JsonNode
                key={k}
                name={array ? undefined : k}
                value={v}
                path={`${path}.${i}`}
                depth={depth + 1}
                last={i === size - 1}
                label={array ? `Item ${i + 1}` : k}
              />
            ))}
            {rest > 0 && <MoreItem path={path} depth={depth + 1} rest={rest} />}
          </ul>
          <div data-line aria-hidden="true" className={LINE}>
            <Spacer />
            <span>
              <span className={PUNCT}>{closing}</span>
              {comma}
            </span>
          </div>
        </>
      )}
    </li>
  );
}

/** the row that draws the next chunk of a long list; the tree's keys activate it too */
function MoreItem({ path, depth, rest }: { path: string; depth: number; rest: number }) {
  const tree = useContext(TreeContext)!;
  const morePath = `${path}.more`;
  const next = Math.min(rest, JSON_CHUNK);
  return (
    <li
      role="treeitem"
      aria-level={depth + 1}
      data-path={morePath}
      data-more={path}
      tabIndex={tree.active === morePath ? 0 : -1}
      aria-label={`Show ${formatCount(next)} more, ${formatCount(rest)} left`}
      className={ITEM}
    >
      <div data-line className={LINE}>
        <Spacer />
        <span className="text-muted-foreground">
          <button
            type="button"
            tabIndex={-1}
            aria-hidden="true"
            className="cursor-pointer text-code-fn underline underline-offset-4"
            onClick={() => tree.showMore(path)}
          >
            Show {formatCount(next)} more
          </button>{' '}
          ({formatCount(rest)} left)
        </span>
      </div>
    </li>
  );
}

function utf8Length(s: string) {
  return new TextEncoder().encode(s).length;
}

type Parsed =
  { ok: true; value: Json; pretty: string; bytes: number } | { ok: false; text: string };

function parse(input: { value: unknown } | { text: string }): Parsed {
  if ('text' in input) {
    let value: Json;
    try {
      value = JSON.parse(input.text) as Json;
    } catch {
      // not json: the viewer shows the text as it came, with a note saying so
      return { ok: false, text: input.text };
    }
    return {
      ok: true,
      value,
      pretty: JSON.stringify(value, null, 2),
      bytes: utf8Length(input.text),
    };
  }
  // what JSON.stringify gives is what gets sent and copied, so the tree shows
  // that and not the object as it sits in memory (undefined fields dropped)
  const compact = JSON.stringify(input.value) as string | undefined;
  if (compact === undefined) return { ok: false, text: String(input.value) };
  const value = JSON.parse(compact) as Json;
  return { ok: true, value, pretty: JSON.stringify(value, null, 2), bytes: utf8Length(compact) };
}

export type JsonViewerProps = (
  | { /** a parsed value, such as a stored webhook payload */ value: unknown; text?: never }
  | {
      /** raw text, such as a response body; shown as text when it is not JSON */ text: string;
      value?: never;
    }
) & {
  /** the header text, e.g. "Payload" */
  label: string;
  /** the tree's accessible name when the label alone is too vague, e.g. "asset.ready payload" */
  name?: string;
  className?: string;
  /** goes on the scrolling body, e.g. max-h-80 */
  bodyClassName?: string;
};

/**
 * JSON as a tree: objects and arrays fold open and closed, values are colored
 * by type with the code tokens, and the header copies the whole document.
 * Text that is not JSON is shown as plain code with a note.
 *
 *   <JsonViewer value={delivery.payload} label="Payload" />
 *   <JsonViewer text={responseBody} label="Response body" />
 */
export function JsonViewer(props: JsonViewerProps) {
  const { text, value, label, name = label, className, bodyClassName } = props;
  const parsed = useMemo(
    () => (text !== undefined ? parse({ text }) : parse({ value })),
    [text, value],
  );

  const [mode, setMode] = useState<Mode>('default');
  const [overrides, setOverrides] = useState<ReadonlyMap<string, boolean>>(new Map());
  const [shown, setShown] = useState<ReadonlyMap<string, number>>(new Map());
  const [active, setActive] = useState(ROOT);
  const treeRef = useRef<HTMLUListElement>(null);

  // a new document starts over: its paths name different nodes
  const [seen, setSeen] = useState(parsed);
  if (seen !== parsed) {
    setSeen(parsed);
    setMode('default');
    setOverrides(new Map());
    setShown(new Map());
    setActive(ROOT);
  }

  // an item asked for focus before it was drawn, such as the first of a newly shown chunk
  const pendingFocus = useRef<string | null>(null);

  useEffect(() => {
    const tree = treeRef.current;
    if (!tree) return;
    const find = (path: string) => tree.querySelector<HTMLElement>(`[data-path="${path}"]`);
    if (pendingFocus.current) {
      find(pendingFocus.current)?.focus();
      pendingFocus.current = null;
    }
    // the tab stop must stay on a drawn item; when its branch closes, the root takes it
    if (!find(active)) setActive(ROOT);
  }, [active, mode, overrides, shown, parsed]);

  const state = useMemo<TreeState>(
    () => ({
      isOpen: (path, depth, size) =>
        overrides.get(path) ??
        (mode === 'open'
          ? true
          : mode === 'closed'
            ? depth === 0
            : depth === 0 || (depth < OPEN_DEPTH && size <= OPEN_MAX)),
      toggle: (path, open) => setOverrides((o) => new Map(o).set(path, open)),
      shownOf: (path) => shown.get(path) ?? JSON_CHUNK,
      // focus moves to the first new item, since the more row may be gone after
      showMore: (path) => {
        const before = shown.get(path) ?? JSON_CHUNK;
        setShown((s) => new Map(s).set(path, before + JSON_CHUNK));
        setActive(`${path}.${before}`);
        pendingFocus.current = `${path}.${before}`;
      },
      active,
      focusPath: (path) => {
        setActive(path);
        const item = treeRef.current?.querySelector<HTMLElement>(`[data-path="${path}"]`);
        if (item) item.focus();
        else pendingFocus.current = path;
      },
    }),
    [mode, overrides, shown, active],
  );

  if (!parsed.ok) {
    return (
      <div className={cn('flex flex-col gap-1.5', className)}>
        <p className="text-xs text-muted-foreground">Not valid JSON, shown as text.</p>
        <CodeBlock code={parsed.text} language="text" label={name} preClassName={bodyClassName} />
      </div>
    );
  }

  const allOpen = mode === 'open' && overrides.size === 0;
  const setAll = (next: Mode) => {
    setMode(next);
    setOverrides(new Map());
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    const tree = e.currentTarget;
    const item = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
    if (!item || !tree.contains(item)) return;
    const items = [...tree.querySelectorAll<HTMLElement>('[role="treeitem"]')];
    const i = items.indexOf(item);
    const path = item.dataset.path!;
    const expanded = item.getAttribute('aria-expanded');
    const go = (to: HTMLElement | null | undefined) => {
      if (to) state.focusPath(to.dataset.path!);
    };
    switch (e.key) {
      case 'ArrowDown':
        go(items[i + 1]);
        break;
      case 'ArrowUp':
        go(items[i - 1]);
        break;
      case 'Home':
        go(items[0]);
        break;
      case 'End':
        go(items.at(-1));
        break;
      case 'ArrowRight':
        if (expanded === 'false') state.toggle(path, true);
        else if (expanded === 'true') go(items[i + 1]);
        break;
      case 'ArrowLeft':
        if (expanded === 'true') state.toggle(path, false);
        else go(item.parentElement?.closest<HTMLElement>('[role="treeitem"]'));
        break;
      case 'Enter':
      case ' ':
        if (expanded !== null) state.toggle(path, expanded === 'false');
        else if (item.dataset.more) state.showMore(item.dataset.more);
        else return;
        break;
      default:
        return;
    }
    e.preventDefault();
  };

  return (
    <div
      data-slot="json-viewer"
      className={cn('overflow-hidden rounded-lg border bg-card', className)}
    >
      <div className="flex flex-wrap items-center gap-2 border-b bg-background py-1.5 pr-1.5 pl-3 text-xs text-muted-foreground">
        <span className="min-w-0">
          {label} · {formatBytes(parsed.bytes)}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {isContainer(parsed.value) && sizeOf(parsed.value) > 0 && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setAll(allOpen ? 'closed' : 'open')}
            >
              {allOpen ? 'Collapse all' : 'Expand all'}
            </Button>
          )}
          <CopyButton
            value={parsed.pretty}
            withText
            text="Copy JSON"
            variant="outline"
            label={`Copy JSON of ${name}`}
          />
        </div>
      </div>
      <div className={cn('overflow-auto px-3.5 py-3', bodyClassName)}>
        <TreeContext value={state}>
          <ul
            ref={treeRef}
            role="tree"
            aria-label={name}
            onKeyDown={onKeyDown}
            onFocus={(e) => {
              const item = (e.target as HTMLElement).closest<HTMLElement>('[role="treeitem"]');
              if (item?.dataset.path) setActive(item.dataset.path);
            }}
            // no ligatures, as in CodeBlock: copied json should read as typed
            className="font-mono text-xs leading-relaxed [font-variant-ligatures:none]"
          >
            <JsonNode value={parsed.value} path={ROOT} depth={0} last label={name} />
          </ul>
        </TreeContext>
      </div>
    </div>
  );
}
