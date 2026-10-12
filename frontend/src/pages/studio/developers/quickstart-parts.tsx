import { Link } from 'react-router';
import { ArrowRight, ExternalLink, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ROUTES } from '@/lib/constants';
import { preloadPage } from '@/lib/page-chunks';

// the quickstart's fixed pieces, in their own module (like KeyNote) so the
// route skeleton draws the same rows, links and text without loading the page

/** A row of the server card: its label over (or beside) its value. */
export function ServerRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5 py-3 first:pt-0 last:pb-0 @2xl/page:grid-cols-[10rem_1fr] @2xl/page:items-center @2xl/page:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="flex min-w-0 flex-wrap items-center gap-2">{children}</dd>
    </div>
  );
}

/** The keys row: how many keys there are (or a bar while that loads), then where to manage them. */
export function KeysRow({ count }: { count: React.ReactNode }) {
  return (
    <>
      <span className="mr-auto text-sm">{count}</span>
      <Button variant="outline" size="sm" asChild>
        <Link to={ROUTES.API_KEYS} onPointerEnter={() => preloadPage(ROUTES.API_KEYS)}>
          Manage keys
        </Link>
      </Button>
      <Button size="sm" asChild>
        <Link
          to={`${ROUTES.API_KEYS}?create=key`}
          onPointerEnter={() => preloadPage(ROUTES.API_KEYS)}
        >
          <Plus />
          Create key
        </Link>
      </Button>
    </>
  );
}

const LINKS = [
  { label: 'API reference', href: '/api/v1/docs' },
  { label: 'SDK on npm', href: 'https://www.npmjs.com/package/@sluby/sdk' },
  { label: 'Source on GitHub', href: 'https://github.com/justmert/Sluby' },
];

export function ReferenceLinks() {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
      {LINKS.map((l) => (
        <li key={l.href}>
          <a
            href={l.href}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 rounded-sm font-medium underline-offset-4 hover:underline focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
          >
            {l.label}
            <ExternalLink aria-hidden="true" className="size-3.5 text-muted-foreground" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        </li>
      ))}
    </ul>
  );
}

export function TryExplorerLink() {
  return (
    <div className="mt-6">
      <Button
        variant="outline"
        className="h-auto min-h-8 py-1.5 whitespace-normal pointer-coarse:h-auto pointer-coarse:min-h-10"
        asChild
      >
        <Link to={ROUTES.EXPLORER} onPointerEnter={() => preloadPage(ROUTES.EXPLORER)}>
          Try a request in the API explorer
          <ArrowRight />
        </Link>
      </Button>
    </div>
  );
}

/** The keys count while it loads. */
export function KeysCountLoading() {
  return <Skeleton className="inline-block h-4 w-24 align-middle" />;
}
