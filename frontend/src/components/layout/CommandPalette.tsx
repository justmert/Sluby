import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  FileText,
  KeyRound,
  Link2,
  LogOut,
  Moon,
  Search,
  Sun,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { AssetStatusBadge } from '@/components/asset/AssetStatusBadge';
import { AccessBadge } from '@/components/shared/StatusBadge';
import { Kbd } from '@/components/ui/kbd';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Spinner } from '@/components/ui/spinner';
import { useApiKeys, type ApiKeyRecord } from '@/hooks/useApiKeys';
import { useDebounce } from '@/hooks/useDebounce';
import { isTypingTarget } from '@/hooks/useSlashToSearch';
import { useSignOut } from '@/hooks/useSessions';
import { LINKS, navItemsFor, ROUTES } from '@/lib/constants';
import { withLead } from '@/lib/errors';
import { plural } from '@/lib/formatters';
import { Icons } from '@/lib/icons';
import { preloadPage } from '@/lib/page-chunks';
import { useSession } from '@/lib/session';
import { siaObjectUrl } from '@/lib/sia';
import { sluby } from '@/lib/sluby';
import { useTheme } from '@/lib/theme';
import { toastError, toastSuccess } from '@/lib/toast';
import { cn } from '@/lib/utils';

const isMac = () => /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

interface Entry {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Other words people may type for it. */
  keywords?: string;
  /** a single key that runs it from anywhere, shown at the end of the row */
  shortcut?: string;
  run: () => void;
}

const matches = (term: string, e: Entry) =>
  `${e.label} ${e.keywords ?? ''}`.toLowerCase().includes(term.toLowerCase());

/** The label with the typed text in bold, as the design marks a match. */
function Matched({ text, term }: { text: string; term: string }) {
  const needle = term.trim().toLowerCase();
  const at = needle ? text.toLowerCase().indexOf(needle) : -1;
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <b className="font-bold">{text.slice(at, at + needle.length)}</b>
      {text.slice(at + needle.length)}
    </>
  );
}

// on the highlighted row only, so the eye finds what enter will run
function EnterHint() {
  return (
    <kbd
      aria-hidden="true"
      className="ml-auto hidden font-mono text-xs font-normal text-muted-foreground group-data-selected/command-item:inline"
    >
      ↵
    </kbd>
  );
}

function EntryItem({ entry, term }: { entry: Entry; term: string }) {
  const Icon = entry.icon;
  return (
    <CommandItem value={entry.id} onSelect={entry.run} aria-keyshortcuts={entry.shortcut}>
      <Icon className="text-subtle-foreground" />
      <span className="min-w-0 flex-1 truncate">
        <Matched text={entry.label} term={term} />
      </span>
      {/* the key is told through aria-keyshortcuts; the highlighted row
          shows enter instead, which is what runs it from here */}
      {entry.shortcut && (
        <kbd
          aria-hidden="true"
          className="ml-auto font-mono text-xs font-normal text-subtle-foreground group-data-selected/command-item:hidden"
        >
          {entry.shortcut}
        </kbd>
      )}
      <EnterHint />
    </CommandItem>
  );
}

/** A 32 by 18 still of the video, or the dark media tile when it has none to show. */
function PaletteThumb({ ids, isPrivate }: { ids: string[]; isPrivate: boolean }) {
  const [failed, setFailed] = useState(false);
  // a private video's still would be refused by the gateway, so it never asks
  const id = isPrivate ? undefined : ids[0];
  return (
    <span aria-hidden="true" className="h-4.5 w-8 shrink-0 overflow-hidden rounded-[3px] bg-media">
      {id && !failed && (
        <img
          src={siaObjectUrl(id)}
          alt=""
          loading="lazy"
          onError={() => setFailed(true)}
          className="size-full object-cover"
        />
      )}
    </span>
  );
}

function usePaletteVideos(term: string) {
  const search = useDebounce(term.trim(), 200);
  const videos = useQuery({
    queryKey: ['assets', 'palette', search],
    queryFn: ({ signal }) => sluby.assets.list({ search: search || undefined, limit: 5, signal }),
    placeholderData: keepPreviousData,
    staleTime: 10_000,
  });
  return { search, videos };
}

type PaletteVideos = ReturnType<typeof usePaletteVideos>;

const videoValue = (id: string) => `asset-${id}`;

function Videos({
  term,
  found: { search, videos },
  open,
}: {
  term: string;
  found: PaletteVideos;
  open: (path: string) => void;
}) {
  const heading = search ? 'Videos' : 'Recent videos';
  const typing = term.trim() !== search || (videos.isFetching && videos.isPlaceholderData);

  let status: ReactNode = null;
  if (videos.isError) {
    status = withLead('Could not search videos', videos.error);
  } else if (videos.isPending || (typing && !videos.data?.data.length)) {
    status = (
      <>
        <Spinner aria-hidden="true" className="size-3.5" /> Searching videos…
      </>
    );
  }

  const list = videos.data?.data ?? [];
  if (!status && list.length === 0) return null;

  return (
    <CommandGroup heading={heading}>
      {/* the palette's own status region says this; a listbox may own only options */}
      {status && (
        <div
          aria-hidden="true"
          className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground"
        >
          {status}
        </div>
      )}
      {list.map((asset) => (
        <CommandItem
          key={asset.id}
          value={videoValue(asset.id)}
          onSelect={() => open(ROUTES.video(asset.id))}
          className={typing ? 'opacity-60' : undefined}
        >
          <PaletteThumb ids={asset.thumbnailObjectIds} isPrivate={asset.accessTier === 'private'} />
          <span dir="auto" className="min-w-0 flex-1 truncate">
            <Matched text={asset.title || 'Untitled'} term={search} />
          </span>
          {/* a ready public video needs no chip; anything else says so */}
          <AccessBadge access={asset.accessTier} />
          {asset.status !== 'ready' && <AssetStatusBadge status={asset.status} />}
          <EnterHint />
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

/**
 * The account's keys whose name holds the search, from the same list the
 * API keys page shows. Nothing is listed until something is typed: a key is
 * something you look for, not a recent item.
 */
function Keys({
  term,
  found,
  error,
  open,
}: {
  term: string;
  found: ApiKeyRecord[];
  error: unknown;
  open: (path: string) => void;
}) {
  if (!term.trim()) return null;
  if (error) {
    return (
      <CommandGroup heading="Keys">
        {/* the palette's own status region says this; a listbox may own only options */}
        <div aria-hidden="true" className="px-2.5 py-1.5 text-sm text-muted-foreground">
          {withLead('Could not search keys', error)}
        </div>
      </CommandGroup>
    );
  }
  if (found.length === 0) return null;
  return (
    <CommandGroup heading="Keys">
      {found.map((k) => (
        <CommandItem key={k.id} value={keyValue(k.id)} onSelect={() => open(ROUTES.API_KEYS)}>
          <KeyRound className="text-subtle-foreground" />
          <span dir="auto" className="min-w-0 flex-1 truncate">
            <Matched text={k.name} term={term} />
          </span>
          <EnterHint />
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

const keyValue = (id: string) => `key-${id}`;

function PaletteBody({ close }: { close: () => void }) {
  const [term, setTerm] = useState('');
  const found = usePaletteVideos(term);
  const keys = useApiKeys();
  const navigate = useNavigate();
  const { operator, authDisabled } = useSession();
  const { resolvedTheme, setTheme } = useTheme();
  const { signOut } = useSignOut();

  const open = (path: string) => {
    close();
    void navigate(path);
  };

  const pages: Entry[] = navItemsFor(operator).map((item) => ({
    id: `page-${item.path}`,
    label: item.label,
    icon: item.icon,
    keywords: 'go to page open',
    run: () => open(item.path),
  }));
  const actions: Entry[] = [
    {
      id: 'action-upload',
      label: 'Upload video',
      icon: Upload,
      keywords: 'new add file',
      shortcut: 'U',
      run: () => open(ROUTES.UPLOAD),
    },
    {
      id: 'action-key',
      label: 'Create API key',
      icon: KeyRound,
      keywords: 'new add token secret developers',
      run: () => open(`${ROUTES.API_KEYS}?create=key`),
    },
    {
      id: 'action-webhook',
      label: 'Add a webhook',
      icon: Icons.webhook,
      keywords: 'new create events developers',
      run: () => open(`${ROUTES.WEBHOOKS}?create=webhook`),
    },
    {
      id: 'action-base-url',
      label: 'Copy API base URL',
      icon: Link2,
      keywords: 'origin server address endpoint sdk baseurl',
      run: () => {
        close();
        const url = window.location.origin;
        navigator.clipboard.writeText(url).then(
          () => toastSuccess('API base URL copied'),
          // the clipboard needs a secure context and permission; say so
          () => toastError(`Could not copy the API base URL. It is ${url}`),
        );
      },
    },
    {
      id: 'action-reference',
      label: 'Open API reference',
      icon: FileText,
      keywords: 'docs documentation openapi rest endpoints',
      run: () => {
        close();
        window.open(LINKS.API_REFERENCE, '_blank', 'noopener,noreferrer');
      },
    },
    // one row that flips light and dark, as in the design; System lives in
    // Settings and the account menu
    {
      id: 'action-theme',
      label: 'Switch theme',
      icon: resolvedTheme === 'dark' ? Sun : Moon,
      keywords: `appearance mode color dark light ${resolvedTheme === 'dark' ? 'light' : 'dark'}`,
      run: () => {
        setTheme(resolvedTheme === 'dark' ? 'light' : 'dark');
        close();
      },
    },
    // with sign-in off nobody is signed in, so there is nothing to sign out of
    ...(authDisabled
      ? []
      : [
          {
            id: 'action-sign-out',
            label: 'Sign out',
            icon: LogOut,
            keywords: 'log out logout leave session',
            run: () => {
              close();
              signOut().catch((err: unknown) => toastError(withLead('Could not sign out', err)));
            },
          },
        ]),
  ];

  const shownPages = pages.filter((e) => matches(term, e));
  const shownActions = actions.filter((e) => matches(term, e));

  // cmdk loses its selection when the selected video drops out of a new
  // result (enter then does nothing), so the selection is held here and falls
  // back to the first entry whenever it is no longer listed
  const [selected, setSelected] = useState('');
  const needle = term.trim().toLowerCase();
  const shownKeys = needle
    ? (keys.data?.data ?? []).filter((k) => k.name.toLowerCase().includes(needle)).slice(0, 5)
    : [];
  // the order the groups are drawn in: videos, keys, pages, actions
  const shown = [
    ...(found.videos.data?.data ?? []).map((a) => videoValue(a.id)),
    ...shownKeys.map((k) => keyValue(k.id)),
    ...shownPages.map((e) => e.id),
    ...shownActions.map((e) => e.id),
  ];
  const value = shown.includes(selected) ? selected : (shown[0] ?? '');

  // cmdk 1.1.1 moves aria-activedescendant only when its own keys or the
  // pointer move the selection, not when the value above does, so after a
  // search it pointed at an option that was gone; it follows the selected
  // option here, or goes when there is none
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const sync = () => {
      const id = el.querySelector('[cmdk-item][aria-selected="true"]')?.id;
      for (const target of el.querySelectorAll('[cmdk-input], [cmdk-list]')) {
        if (id && target.getAttribute('aria-activedescendant') !== id) {
          target.setAttribute('aria-activedescendant', id);
        } else if (!id && target.hasAttribute('aria-activedescendant')) {
          target.removeAttribute('aria-activedescendant');
        }
      }
    };
    const observer = new MutationObserver(sync);
    observer.observe(el, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['aria-selected', 'aria-activedescendant'],
    });
    sync();
    return () => observer.disconnect();
  }, []);

  // said once the search settles, not on every key; the active option is
  // read out on its own as the arrows move
  const { search, videos } = found;
  const settled = term.trim() === search && !videos.isPending && !videos.isPlaceholderData;
  const announcement = videos.isError
    ? withLead('Could not search videos', videos.error)
    : term.trim() && settled
      ? shown.length === 0
        ? `Nothing matches “${term.trim()}”.`
        : plural(shown.length, 'result')
      : '';

  return (
    // filtering is done here: video results come from the server, which also
    // matches descriptions and ids that cmdk's own filter would drop
    <Command
      ref={root}
      shouldFilter={false}
      loop
      label="Search videos, pages and actions"
      value={value}
      onValueChange={setSelected}
    >
      <CommandInput
        value={term}
        onValueChange={setTerm}
        placeholder="Search videos, pages and actions…"
        trailing={
          <Kbd aria-hidden="true" className="hidden px-1.5 text-kbd sm:inline-flex">
            esc
          </Kbd>
        }
      />
      <CommandList className="max-h-[min(24rem,calc(100svh-8rem))]">
        <CommandEmpty aria-hidden="true">Nothing matches “{term.trim()}”.</CommandEmpty>
        <Videos term={term} found={found} open={open} />
        <Keys term={term} found={shownKeys} error={keys.isError ? keys.error : null} open={open} />
        {shownPages.length > 0 && (
          <CommandGroup heading="Pages">
            {shownPages.map((e) => (
              <EntryItem key={e.id} entry={e} term={term} />
            ))}
          </CommandGroup>
        )}
        {shownActions.length > 0 && (
          <CommandGroup heading="Actions">
            {shownActions.map((e) => (
              <EntryItem key={e.id} entry={e} term={term} />
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      <div
        aria-hidden="true"
        className="hidden items-center gap-3.5 border-t px-3.5 py-2 text-xs text-subtle-foreground sm:flex"
      >
        <span>↑↓ to move</span>
        <span>↵ to open</span>
      </div>
    </Command>
  );
}

/**
 * Cmd+K (Ctrl+K elsewhere) or the top bar button: jump to a page, find a
 * video by title, description or id, or run a common action.
 */
export function CommandPalette({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [mac] = useState(isMac);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setOpen((o) => !o);
        return;
      }
      // U opens the upload page, as the palette's Upload video row says. not
      // while typing, with a modifier, or once something else (an open menu
      // or dialog) has taken the key
      if (
        e.key.toLowerCase() === 'u' &&
        !e.metaKey &&
        !e.ctrlKey &&
        !e.altKey &&
        !e.defaultPrevented &&
        !isTypingTarget(e.target) &&
        !document.querySelector('[role=dialog], [role=alertdialog], [role=menu]')
      ) {
        e.preventDefault();
        preloadPage(ROUTES.UPLOAD);
        void navigate(ROUTES.UPLOAD);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  return (
    <>
      <Button
        variant="outline"
        onClick={() => setOpen(true)}
        // named by its visible words; at narrow widths they are only for
        // screen readers, since the button shrinks to its icon
        aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
        className={cn(
          'w-full max-w-70 min-w-0 shrink justify-start gap-2 px-3 text-subtle-foreground hover:text-subtle-foreground max-[899px]:size-9 max-[899px]:shrink-0 max-[899px]:justify-center max-[899px]:p-0 max-[899px]:pointer-coarse:size-11',
          className,
        )}
      >
        <Search />
        <span className="min-w-0 flex-1 truncate text-left font-normal max-[899px]:sr-only">
          Search videos and pages
        </span>
        {/* the shortcut is exposed through aria-keyshortcuts */}
        <Kbd aria-hidden="true" className="h-auto py-px max-[899px]:hidden">
          {mac ? '⌘K' : 'Ctrl K'}
        </Kbd>
      </Button>
      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title="Search and commands"
        description="Jump to a page, find a video or run an action"
        className="sm:max-w-xl"
      >
        <PaletteBody close={() => setOpen(false)} />
      </CommandDialog>
    </>
  );
}
