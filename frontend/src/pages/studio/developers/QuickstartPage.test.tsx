import { act, screen, within } from '@testing-library/react';
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

// the snippet's panel; the language panel sits inside it
const code = () => screen.getAllByRole('tabpanel')[0];

describe('Quickstart', () => {
  it('shows this server’s base URL, the key count and the reference links', async () => {
    render();
    expect(screen.getByRole('heading', { level: 1, name: 'Quickstart' })).toBeInTheDocument();
    expect(screen.getByText('Connect your app to this server')).toBeInTheDocument();
    expect(screen.getByText(window.location.origin)).toBeInTheDocument();
    expect(await screen.findByText('1 active key')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Create key' })).toHaveAttribute(
      'href',
      '/studio/developers/keys?create=key',
    );
    expect(screen.getByRole('link', { name: 'Manage keys' })).toHaveAttribute(
      'href',
      '/studio/developers/keys',
    );
    expect(screen.getByRole('link', { name: /API reference/ })).toHaveAttribute(
      'href',
      '/api/v1/docs',
    );
    expect(screen.getByRole('link', { name: /SDK on npm/ })).toHaveAttribute(
      'href',
      'https://www.npmjs.com/package/@sluby/sdk',
    );
  });

  it('names the snippet and language tab lists (A11Y-36)', async () => {
    render();
    const snippets = screen.getByRole('tablist', { name: 'Snippets' });
    expect(
      within(snippets)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual([
      'Set up',
      'Upload',
      'Track',
      'Search',
      'Play',
      'Private',
      'Direct from Sia',
      'Storage',
      'Webhooks',
    ]);
    expect(screen.getByRole('tablist', { name: 'Snippet language' })).toBeInTheDocument();
    expect(
      screen.getByText('A video is called an asset in the API.', { exact: false }),
    ).toBeInTheDocument();
  });

  it('scrolls a tab that is cut off by its sideways strip into view when it takes focus (2.4.11)', async () => {
    render();
    const scrolled = vi.fn();
    Element.prototype.scrollIntoView = scrolled;
    const tabs = within(await screen.findByRole('tablist', { name: 'Snippets' })).getAllByRole(
      'tab',
    );
    act(() => tabs[tabs.length - 1].focus());
    expect(scrolled).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
  });

  it('fills the newest ready video’s ID into the snippets, and another one when picked', async () => {
    render();
    await screen.findByRole('combobox', { name: 'Video' });
    await userEvent.click(screen.getByRole('tab', { name: 'Track' }));
    expect(code()).toHaveTextContent(`const assetId = '${VID}';`);
    await userEvent.click(screen.getByRole('combobox', { name: 'Video' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Board meeting' }));
    expect(code()).toHaveTextContent("const assetId = 'vid-private';");
  });

  it('keeps YOUR_VIDEO_ID and says why when no video is ready', async () => {
    routes['/api/v1/assets'] = { data: [], total: 0, page: 1, limit: 50, has_more: false };
    render();
    expect(
      await screen.findByText(/The snippets use YOUR_VIDEO_ID until a video is ready/),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Track' }));
    expect(code()).toHaveTextContent("const assetId = 'YOUR_VIDEO_ID';");
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

  it('plays a public video with the share panel’s code, and signs a private one', async () => {
    render();
    await screen.findByRole('combobox', { name: 'Video' });
    await userEvent.click(screen.getByRole('tab', { name: 'Play' }));
    const langs = () =>
      within(code())
        .getAllByRole('tab')
        .map((t) => t.textContent);
    expect(langs()).toEqual(['React', 'HTML', 'Stream URL']);
    expect(code()).toHaveTextContent(`streamUrl('${VID}')`);
    await userEvent.click(screen.getByRole('combobox', { name: 'Video' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Board meeting' }));
    expect(langs()[0]).toBe('Server');
    expect(code()).toHaveTextContent('This video is private');
  });

  it('says which snippets need the manage scope (FLW-56)', async () => {
    render();
    await userEvent.click(screen.getByRole('tab', { name: 'Webhooks' }));
    expect(within(code()).getByText('Needs a key with the manage scope.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Search' }));
    expect(
      within(code()).queryByText('Needs a key with the manage scope.'),
    ).not.toBeInTheDocument();
  });

  it('remembers the language from one snippet to the next', async () => {
    render();
    await userEvent.click(screen.getByRole('tab', { name: 'curl' }));
    await userEvent.click(screen.getByRole('tab', { name: 'Search' }));
    expect(screen.getByRole('tab', { name: 'curl' })).toHaveAttribute('aria-selected', 'true');
    expect(code()).toHaveTextContent('curl -s');
  });

  it('links to the explorer', () => {
    render();
    expect(screen.getByRole('link', { name: 'Try a request in the API explorer' })).toHaveAttribute(
      'href',
      '/studio/developers/explorer',
    );
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
    await userEvent.click(await screen.findByRole('combobox', { name: 'Video' }));
    const option = await screen.findByRole('option', { name: long });
    expect(option).toHaveAttribute('title', long);
    expect(option).toHaveClass('*:[span]:last:min-w-0');
    expect(within(option).getByText(long)).toHaveClass('truncate');
  });
});
