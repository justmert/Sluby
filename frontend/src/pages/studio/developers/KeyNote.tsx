import { Link } from 'react-router';
import { ROUTES } from '@/lib/constants';

/**
 * Where a snippet's key comes from, under the quickstart's video picker. Its
 * own module so the route skeleton shows the same note, wrapped the same,
 * without loading the page.
 */
export function KeyNote() {
  return (
    <p className="text-xs text-muted-foreground">
      Create an API key on the{' '}
      <Link to={ROUTES.API_KEYS} className="underline underline-offset-4">
        API keys page
      </Link>{' '}
      and set it as <code className="font-mono">SLUBY_API_KEY</code> on your server. Never put a key
      in browser code. A video is called an asset in the API.
    </p>
  );
}
