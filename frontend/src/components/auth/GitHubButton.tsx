import { useEffect, useState } from 'react';
import { GitHubMark } from '@/components/brand/GitHubMark';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
import { loadPage } from '@/lib/navigation';

/**
 * Leave for GitHub's sign-in at `href`, an /api/v1/auth/github/login url.
 * The button stays pending while the browser goes.
 */
export function GitHubButton({ href }: { href: () => string }) {
  const [redirecting, setRedirecting] = useState(false);

  // coming back with the browser's back button can restore this page from
  // the cache with the button still pending; let it be pressed again
  useEffect(() => {
    const reset = (e: PageTransitionEvent) => {
      if (e.persisted) setRedirecting(false);
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  return (
    // in the inverse of the page, like github's own mark
    <Button
      type="button"
      size="lg"
      disabled={redirecting}
      onClick={() => {
        setRedirecting(true);
        loadPage(href());
      }}
      className="h-11 w-full gap-2.5 rounded-lg border-foreground bg-foreground font-semibold text-background hover:bg-[color-mix(in_oklab,var(--foreground),var(--background)_15%)] pointer-coarse:h-11"
    >
      {redirecting ? <Spinner aria-hidden="true" /> : <GitHubMark className="size-5" />}
      {redirecting ? 'Redirecting to GitHub…' : 'Continue with GitHub'}
    </Button>
  );
}
