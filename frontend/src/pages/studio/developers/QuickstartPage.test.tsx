import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, renderPage, reply } from '@/test/render';
import { WithSession } from '@/test/session';
import QuickstartPage from './QuickstartPage';

const asset = (id: string, title: string, accessTier = 'public') => ({
  id,
  title,
  description: null,
  status: 'ready',
  access_tier: accessTier,
  duration_ms: 10_000,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
});

const VID = '6c1b2f3e-0000-4000-8000-00000000abcd';
let routes: Record<string, unknown>;
let fetchStub: ReturnType<typeof jsonFetch>;

beforeEach(() => {
  routes = {
    '/api/v1/assets': {
      data: [asset(VID, 'Product walkthrough'), asset('vid-private', 'Board meeting', 'private')],
      total: 2,
      page: 1,
      limit: 50,
      has_more: false,
    },
    '/api/v1/keys': {
      data: [
        {
          id: 'k1',
          name: 'a',
          scopes: ['read'],
          rate_limit: 1,
          is_active: true,
          created_at: '2026-10-01T00:00:00Z',
          expires_at: null,
        },
        {
          id: 'k2',
          name: 'b',
          scopes: ['read'],
          rate_limit: 1,
          is_active: true,
          created_at: '2026-10-01T00:00:00Z',
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        },
      ],
      has_more: false,
      next_cursor: null,
      limits: { max_keys: 100, max_rate_limit: 10000 },
    },
  };
  fetchStub = jsonFetch(new Proxy({}, { get: (_, k) => routes[k as string] }));
  vi.stubGlobal('fetch', vi.fn(fetchStub));
});
afterEach(() => vi.unstubAllGlobals());

const render = () =>
  renderPage(
    <WithSession>
      <QuickstartPage />
    </WithSession>,
  );

// the panel of the selected snippet
const code = () => screen.getByRole('tabpanel');
const picker = () => screen.findByRole('combobox', { name: 'Pick a video' });

describe('Quickstart', () => {
  it('lays the page out as four numbered steps', async () => {
    render();
    expect(screen.getByRole('heading', { level: 1, name: 'Quickstart' })).toBeInTheDocument();
    expect(
      screen.getByText('Play a video on your site, then automate uploads from your server.'),
    ).toBeInTheDocument();
    const headings = screen.getAllByRole('heading', { level: 2 });
    expect(headings.map((h) => h.textContent)).toEqual([
      'Pick a video',
      'Your API',
      'Copy a snippet',
      'Try a request',
    ]);
    // an ordered list, so each step is announced with its number
    expect(headings.map((h) => h.closest('li')?.parentElement?.tagName)).toEqual([
      'OL',
      'OL',
      'OL',
      'OL',
    ]);
    expect(await picker()).toBeInTheDocument();
  });

  it('shows this server’s base URL with Copy, the key count and where to manage keys', async () => {
    render();
    expect(screen.getByText(window.location.origin)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy base URL' })).toBeInTheDocument();
    expect(await screen.findByText('1 active key')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create key' })).toHaveAttribute(
      'href',
      '/studio/developers/keys?create=key',
    );
    expect(screen.getByRole('link', { name: 'Manage keys' })).toHaveAttribute(
      'href',
      '/studio/developers/keys',
    );
    expect(
      screen.getByText(
        'Keys are server secrets. Never put one in browser code; the embed snippets need none.',
      ),
    ).toBeInTheDocument();
  });

  it('offers the four snippets as a named tab list', () => {
    render();
    const snippets = screen.getByRole('tablist', { name: 'Snippets' });
    expect(
      within(snippets)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['Play in React', 'Upload from Node', 'Verify a webhook', 'curl']);
    expect(screen.getByRole('tab', { name: 'Play in React' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  it('moves between the snippets with the arrow keys', async () => {
    render();
    await userEvent.click(screen.getByRole('tab', { name: 'Play in React' }));
    await userEvent.keyboard('{ArrowRight}');
    const next = screen.getByRole('tab', { name: 'Upload from Node' });
    expect(next).toHaveFocus();
    expect(next).toHaveAttribute('aria-selected', 'true');
    expect(code()).toHaveTextContent('upload.ts');
  });

  it('heads each snippet with its file name and a Copy button for that snippet', async () => {
    render();
    expect(within(code()).getByText('App.tsx')).toBeInTheDocument();
    expect(
      within(code()).getByRole('button', { name: 'Copy Play in React snippet' }),
    ).toBeInTheDocument();
    for (const [tab, file, text] of [
      ['Upload from Node', 'upload.ts', 'sluby.uploads.upload(file'],
      ['Verify a webhook', 'webhook.ts', 'webhooks.verifyRequest(body, req.headers, secret)'],
      ['curl', 'request.sh', 'curl -s'],
    ]) {
      await userEvent.click(screen.getByRole('tab', { name: tab }));
      expect(within(code()).getByText(file)).toBeInTheDocument();
      expect(code()).toHaveTextContent(text);
    }
  });

  it('fills the newest ready video’s ID into the player, and another one when picked', async () => {
    render();
    await userEvent.click(await picker());
    expect(
      await screen.findByRole('option', { name: 'Product walkthrough · Public' }),
    ).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(code()).toHaveTextContent(`streamUrl('${VID}')`);
    expect(code()).toHaveTextContent('Public videos need no key.');
    await userEvent.click(await picker());
    await userEvent.click(await screen.findByRole('option', { name: 'Board meeting · Private' }));
    // a private video plays through a url your server signs
    expect(code()).toHaveTextContent('This video is private');
    expect(code()).toHaveTextContent('refreshSrc={signedUrl}');
  });

  it('keeps YOUR_VIDEO_ID and says why when no video is ready', async () => {
    routes['/api/v1/assets'] = { data: [], total: 0, page: 1, limit: 50, has_more: false };
    render();
    expect(
      await screen.findByText(/The snippets use YOUR_VIDEO_ID until a video is ready/),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Upload a video' })).toHaveAttribute(
      'href',
      '/studio/videos/upload',
    );
    expect(code()).toHaveTextContent("streamUrl('YOUR_VIDEO_ID')");
  });

  it('keeps the placeholder when the videos do not load, and says so', async () => {
    routes['/api/v1/assets'] = reply(500, { error: 'boom' });
    render();
    expect(
      await screen.findByText('Could not load your videos, so the snippets use YOUR_VIDEO_ID.'),
    ).toBeInTheDocument();
    routes['/api/v1/assets'] = { data: [], total: 0, page: 1, limit: 50, has_more: false };
    await userEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0]);
    expect(
      await screen.findByText(/The snippets use YOUR_VIDEO_ID until a video is ready/),
    ).toBeInTheDocument();
  });

  it('links to the explorer and the API reference', () => {
    render();
    expect(screen.getByRole('link', { name: 'Open the API explorer' })).toHaveAttribute(
      'href',
      '/studio/developers/explorer',
    );
    const reference = screen.getByRole('link', { name: /API reference/ });
    expect(reference).toHaveAttribute('href', '/api/v1/docs');
    expect(reference).toHaveAttribute('target', '_blank');
    expect(reference).toHaveTextContent('(opens in a new tab)');
  });

  it('offers Try again when the keys do not load, and keeps the rest of the page (D-25)', async () => {
    routes['/api/v1/keys'] = reply(502, '<html>Bad Gateway</html>');
    render();
    expect(await screen.findByText('Could not load your API keys.')).toBeInTheDocument();
    routes['/api/v1/keys'] = {
      data: [],
      has_more: false,
      next_cursor: null,
      limits: { max_keys: 100, max_rate_limit: 10000 },
    };
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('No active keys yet')).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Snippets' })).toBeInTheDocument();
  });

  it('truncates a long title in the video list and keeps the whole title as its tooltip', async () => {
    const long =
      'Quarterly all-hands recording with the full engineering, design and operations teams, extended cut including Q&A';
    routes['/api/v1/assets'] = {
      data: [asset(VID, long)],
      total: 1,
      page: 1,
      limit: 50,
      has_more: false,
    };
    render();
    await userEvent.click(await picker());
    const option = await screen.findByRole('option', { name: `${long} · Public` });
    expect(option).toHaveAttribute('title', long);
    expect(option).toHaveClass('*:[span]:last:min-w-0');
    expect(within(option).getByText(`${long} · Public`)).toHaveClass('truncate');
  });
});
