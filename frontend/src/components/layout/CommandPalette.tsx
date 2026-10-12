import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  FileText,
  Film,
  KeyRound,
  Link2,
  LogOut,
  Search,
  Upload,
  Webhook,
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
import { useDebounce } from '@/hooks/useDebounce';
import { useSignOut } from '@/hooks/useSessions';
import { LINKS, navItemsFor, ROUTES } from '@/lib/constants';
import { withLead } from '@/lib/errors';
import { formatDuration, plural } from '@/lib/formatters';
import { useSession } from '@/lib/session';
import { sluby } from '@/lib/sluby';
import { THEME_OPTIONS, useTheme } from '@/lib/theme';
import { toastError, toastSuccess } from '@/lib/toast';

const isMac = () => /mac|iphone|ipad/i.test(navigator.platform || navigator.userAgent);

interface Entry {
  id: string;
  label: string;
  icon: LucideIcon;
  /** Other words people may type for it. */
  keywords?: string;
  run: () => void;
  checked?: boolean;
}

const matches = (term: string, e: Entry) =>
  `${e.label} ${e.keywords ?? ''}`.toLowerCase().includes(term.toLowerCase());

function EntryItem({ entry }: { entry: Entry }) {
  const Icon = entry.icon;
  return (
    <CommandItem value={entry.id} onSelect={entry.run} data-checked={entry.checked}>
      <Icon className="text-muted-foreground" />
      {entry.label}
    </CommandItem>
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
          <Film className="text-muted-foreground" />
          <span dir="auto" className="min-w-0 flex-1 truncate">
            {asset.title || 'Untitled'}
          </span>
          {asset.durationMs ? (
            <span className="text-xs text-muted-foreground tabular-nums">
              {formatDuration(asset.durationMs)}
            </span>
          ) : null}
          <AccessBadge access={asset.accessTier} />
          <AssetStatusBadge status={asset.status} />
        </CommandItem>
      ))}
    </CommandGroup>
  );
}

function PaletteBody({ close }: { close: () => void }) {
  const [term, setTerm] = useState('');
  const found = usePaletteVideos(term);
  const navigate = useNavigate();
  const { operator, authDisabled } = useSession();
  const { theme, setTheme } = useTheme();
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
      icon: Webhook,
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
    ...THEME_OPTIONS.map(({ value, label, icon }) => ({
      id: `theme-${value}`,
      label: `Use ${label.toLowerCase()} theme`,
      icon,
      keywords: 'appearance mode color',
      checked: theme === value,
      run: () => {
        setTheme(value);
        close();
      },
    })),
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
  const shown = [
    ...shownPages.map((e) => e.id),
    ...(found.videos.data?.data ?? []).map((a) => videoValue(a.id)),
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
      />
      <CommandList className="max-h-[min(24rem,calc(100svh-8rem))]">
        <CommandEmpty aria-hidden="true">Nothing matches “{term.trim()}”.</CommandEmpty>
        {shownPages.length > 0 && (
          <CommandGroup heading="Pages">
            {shownPages.map((e) => (
              <EntryItem key={e.id} entry={e} />
            ))}
          </CommandGroup>
        )}
        <Videos term={term} found={found} open={open} />
        {shownActions.length > 0 && (
          // a border, not a CommandSeparator: a listbox may not own a separator
          <CommandGroup heading="Actions" className="border-t">
            {shownActions.map((e) => (
              <EntryItem key={e.id} entry={e} />
            ))}
          </CommandGroup>
        )}
      </CommandList>
      <p className="sr-only" role="status">
        {announcement}
      </p>
      <div
        aria-hidden="true"
        className="hidden items-center gap-3 border-t px-3 py-2 text-xs text-muted-foreground sm:flex"
      >
        <span>↑↓ to move</span>
        <span>Enter to open</span>
        <span>Esc to close</span>
      </div>
    </Command>
  );
}

/**
 * Cmd+K (Ctrl+K elsewhere) or the top bar button: jump to a page, find a
 * video by title, description or id, or run a common action.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [mac] = useState(isMac);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'k' && (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        // named by its visible word, "Search"; below md the word is only for
        // screen readers, since the button shrinks to its icon
        aria-keyshortcuts={mac ? 'Meta+K' : 'Control+K'}
        className="size-8 justify-start gap-2 p-0 text-muted-foreground max-md:justify-center max-md:pointer-coarse:size-10 md:w-44 md:px-2.5 md:pointer-coarse:h-10 xl:w-60"
      >
        <Search />
        <span className="flex-1 text-left font-normal max-md:sr-only">Search</span>
        {/* the shortcut is exposed through aria-keyshortcuts */}
        <Kbd aria-hidden="true" className="hidden md:inline-flex">
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
