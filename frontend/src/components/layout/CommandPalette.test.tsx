import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, type RecordedCall } from '@/test/render';
import { renderPage } from '@/test/render';
import { replacePage } from '@/lib/navigation';
import { WithSession } from '@/test/session';
import { CommandPalette } from './CommandPalette';

vi.mock('@/lib/navigation', () => ({ loadPage: vi.fn(), replacePage: vi.fn() }));

function asset(id: string, title: string, status = 'ready') {
  return {
    id,
    title,
    description: '',
    manifest_object_id: 'm',
    thumbnail_object_ids: [],
    duration_ms: 90_000,
    resolution: '1280x720',
    status,
    access_tier: 'public',
    creator_address: 'github:dev',
    segment_count: 1,
    total_storage_bytes: 2048,
    created_at: '2026-10-01T00:00:00Z',
    updated_at: '2026-10-01T00:00:00Z',
  };
}

const library = [asset('a1', 'Big Buck Bunny'), asset('a2', 'Sintel', 'processing')];

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function setup(operator = false, authDisabled = false) {
  const server = jsonFetch({
    'POST /api/v1/auth/logout': { success: true },
    '/api/v1/assets': ({ query }: RecordedCall) => {
      const q = (query.get('search') ?? '').toLowerCase();
      const data = library.filter((a) => a.title.toLowerCase().includes(q) || a.id === q);
      return { data, total: data.length, page: 1, limit: 5, next_cursor: null };
    },
  });
  vi.stubGlobal('fetch', vi.fn(server));
  renderPage(
    <WithSession operator={operator} authDisabled={authDisabled}>
      <CommandPalette />
      <Where />
    </WithSession>,
    { route: '/studio' },
  );
  return server;
}

afterEach(() => vi.unstubAllGlobals());

const openWithKeys = () => userEvent.keyboard('{Control>}k{/Control}');

describe('CommandPalette', () => {
  it('opens on ctrl+k with the search focused and recent videos listed', async () => {
    setup();
    await openWithKeys();
    const dialog = await screen.findByRole('dialog', { name: 'Search and commands' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: /search videos/i })).toHaveFocus();
    expect(await screen.findByRole('option', { name: /Big Buck Bunny/ })).toBeInTheDocument();
    expect(screen.getByText('Recent videos')).toBeInTheDocument();
  });

  it('opens from the top bar button and jumps to a page', async () => {
    setup();
    // named by its visible word, so voice control users can say it (A11Y-34)
    await userEvent.click(screen.getByRole('button', { name: 'Search videos and pages' }));
    await userEvent.type(screen.getByRole('combobox'), 'sett');
    await userEvent.click(await screen.findByRole('option', { name: 'Settings' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/studio/settings');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps its title out of the page while closed', async () => {
    setup();
    expect(screen.queryByRole('heading', { name: 'Search and commands' })).not.toBeInTheDocument();
    expect(screen.queryByText('Jump to a page, find a video or run an action')).toBeNull();
    await openWithKeys();
    expect(
      await screen.findByRole('dialog', { name: 'Search and commands' }),
    ).toHaveAccessibleDescription('Jump to a page, find a video or run an action');
  });

  it('opens the create key dialog on the API keys page from its action', async () => {
    setup();
    await openWithKeys();
    await userEvent.type(await screen.findByRole('combobox'), 'api key');
    await userEvent.click(await screen.findByRole('option', { name: 'Create API key' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/studio/developers/keys?create=key');
  });

  it('opens the add webhook dialog on the webhooks page from its action', async () => {
    setup();
    await openWithKeys();
    await userEvent.type(await screen.findByRole('combobox'), 'webhook');
    await userEvent.click(await screen.findByRole('option', { name: 'Add a webhook' }));
    expect(screen.getByTestId('where')).toHaveTextContent(
      '/studio/developers/webhooks?create=webhook',
    );
  });

  it('opens the upload sheet on the current page', async () => {
    setup();
    await openWithKeys();
    await userEvent.type(await screen.findByRole('combobox'), 'upload');
    await userEvent.click(await screen.findByRole('option', { name: 'Upload video' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/studio\?upload=1$/);
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('finds only the settings page for "sett"', async () => {
    const server = setup();
    await openWithKeys();
    await userEvent.type(await screen.findByRole('combobox'), 'sett');
    await waitFor(() =>
      expect(server.calls.some((c) => c.query.get('search') === 'sett')).toBe(true),
    );
    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    expect(screen.getByRole('option', { name: 'Settings' })).toBeInTheDocument();
  });

  it('marks the highlighted row with the enter key, out of its name', async () => {
    setup();
    await openWithKeys();
    await userEvent.type(await screen.findByRole('combobox'), 'sett');
    const option = await screen.findByRole('option', { name: 'Settings' });
    await waitFor(() => expect(option).toHaveAttribute('aria-selected', 'true'));
    expect(option.querySelector('kbd')).toHaveTextContent('↵');
    expect(option.querySelector('kbd')).toHaveAttribute('aria-hidden', 'true');
  });

  it('leaves out operator pages for a member', async () => {
    setup(false);
    await openWithKeys();
    await screen.findByRole('dialog');
    expect(screen.queryByRole('option', { name: 'Health' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Metrics' })).not.toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Videos' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'API keys' })).toBeInTheDocument();
  });

  it('lists health and metrics for an operator', async () => {
    setup(true);
    await openWithKeys();
    await userEvent.type(await screen.findByRole('combobox'), 'metrics');
    await userEvent.click(await screen.findByRole('option', { name: 'Metrics' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/studio/deployment/metrics');
  });

  it('finds a video on the server and opens it with the keyboard', async () => {
    const server = setup();
    await openWithKeys();
    await userEvent.type(await screen.findByRole('combobox'), 'sintel');
    await waitFor(() =>
      expect(server.calls.some((c) => c.query.get('search') === 'sintel')).toBe(true),
    );
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Big Buck Bunny/ })).not.toBeInTheDocument(),
    );
    expect(screen.getByRole('option', { name: /Sintel/ })).toHaveAttribute('aria-selected', 'true');
    await userEvent.keyboard('{Enter}');
    expect(screen.getByTestId('where')).toHaveTextContent('/studio/videos/a2');
  });

  it('selects a video that the search keeps once the others drop out', async () => {
    library.unshift(asset('a0', 'Corrupt upload', 'failed'));
    library.push(asset('a3', 'Mandelbrot clip'), asset('a4', 'Bars clip'));
    try {
      setup();
      await openWithKeys();
      await screen.findByRole('option', { name: /Corrupt upload/ });
      await userEvent.type(screen.getByRole('combobox'), 'mandel');
      await waitFor(() =>
        expect(screen.queryByRole('option', { name: /Corrupt upload/ })).not.toBeInTheDocument(),
      );
      expect(screen.getByRole('option', { name: /Mandelbrot/ })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      await userEvent.keyboard('{Enter}');
      expect(screen.getByTestId('where')).toHaveTextContent('/studio/videos/a3');
    } finally {
      library.splice(0, library.length, ...library.filter((a) => ['a1', 'a2'].includes(a.id)));
    }
  });

  it('points the active option at the selected one after a search moves it', async () => {
    setup();
    await openWithKeys();
    const input = await screen.findByRole('combobox');
    await screen.findByRole('option', { name: /Big Buck Bunny/ });
    await userEvent.keyboard('{ArrowDown}');
    await userEvent.type(input, 'sintel');
    await waitFor(() =>
      expect(screen.queryByRole('option', { name: /Big Buck Bunny/ })).not.toBeInTheDocument(),
    );
    const sintel = screen.getByRole('option', { name: /Sintel/ });
    expect(sintel).toHaveAttribute('aria-selected', 'true');
    await waitFor(() => expect(input).toHaveAttribute('aria-activedescendant', sintel.id));
    await userEvent.type(input, 'zzzz');
    await waitFor(() => expect(screen.queryByRole('option')).not.toBeInTheDocument());
    await waitFor(() => expect(input).not.toHaveAttribute('aria-activedescendant'));
  });

  it('drops an older search that answers after a newer one found nothing', async () => {
    // the answer for "sintel" is held until the one for "sintelzzzz" is in
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const server = jsonFetch({
      '/api/v1/assets': async ({ query }: RecordedCall) => {
        const q = (query.get('search') ?? '').toLowerCase();
        if (q === 'sintel') await held;
        const data = library.filter((a) => a.title.toLowerCase().includes(q));
        return { data, total: data.length, page: 1, limit: 5, next_cursor: null };
      },
    });
    vi.stubGlobal('fetch', vi.fn(server));
    renderPage(
      <WithSession>
        <CommandPalette />
      </WithSession>,
      { route: '/studio' },
    );
    await openWithKeys();
    const input = await screen.findByRole('combobox');
    await screen.findByRole('option', { name: /Big Buck Bunny/ });
    await userEvent.type(input, 'sintel');
    await waitFor(() =>
      expect(server.calls.some((c) => c.query.get('search') === 'sintel')).toBe(true),
    );
    await userEvent.type(input, 'zzzz');
    await waitFor(() =>
      expect(server.calls.some((c) => c.query.get('search') === 'sintelzzzz')).toBe(true),
    );
    await waitFor(() => expect(screen.queryByRole('option')).not.toBeInTheDocument());
    release();
    // the late answer has had its turn once a status says what the search found
    await waitFor(() =>
      expect(within(screen.getByRole('dialog')).getByRole('status')).toHaveTextContent(
        /nothing matches/i,
      ),
    );
    expect(screen.queryByRole('option', { name: /Sintel/ })).not.toBeInTheDocument();
  });

  it('switches the theme', async () => {
    setup();
    await openWithKeys();
    await userEvent.type(await screen.findByRole('combobox'), 'light');
    await userEvent.click(await screen.findByRole('option', { name: 'Use light theme' }));
    expect(document.documentElement).toHaveClass('light');
    expect(localStorage.getItem('sluby-theme')).toBe('light');
  });

  it('says when nothing matches', async () => {
    setup();
    await openWithKeys();
    await userEvent.type(await screen.findByRole('combobox'), 'zzzz');
    expect(
      await screen.findByText('Nothing matches “zzzz”.', { selector: '[cmdk-empty]' }),
    ).toBeVisible();
  });

  it('announces the settled result outside the listbox, which holds only options', async () => {
    setup();
    await openWithKeys();
    const dialog = await screen.findByRole('dialog');
    const region = within(dialog).getByRole('status');
    expect(screen.getByRole('listbox').contains(region)).toBe(false);
    await userEvent.type(screen.getByRole('combobox'), 'zzzz');
    await waitFor(() => expect(region).toHaveTextContent('Nothing matches “zzzz”.'));
    // a listbox may own only options and groups; the visible message is hidden from it
    expect(
      within(screen.getByRole('listbox')).getByText('Nothing matches “zzzz”.'),
    ).toHaveAttribute('aria-hidden', 'true');
    await userEvent.clear(screen.getByRole('combobox'));
    await userEvent.type(screen.getByRole('combobox'), 'sintel');
    await waitFor(() => expect(region).toHaveTextContent('1 result'));
  });
});

describe('CommandPalette actions (FLW-58)', () => {
  const run = async (name: string) => {
    await openWithKeys();
    await userEvent.click(await screen.findByRole('option', { name }));
  };

  it('copies the API base URL', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup();
    await run('Copy API base URL');
    expect(writeText).toHaveBeenCalledWith(window.location.origin);
    expect(await screen.findByText('API base URL copied')).toBeInTheDocument();
  });

  it('says so, with the address, when the clipboard refuses', async () => {
    const writeText = vi.fn().mockRejectedValue(new Error('NotAllowedError'));
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    setup();
    await run('Copy API base URL');
    expect(
      await screen.findByText(`Could not copy the API base URL. It is ${window.location.origin}`),
    ).toBeInTheDocument();
  });

  it('opens the API reference in a new tab', async () => {
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    setup();
    await run('Open API reference');
    expect(open).toHaveBeenCalledWith('/api/v1/docs', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });

  it('signs out the way the user menu does', async () => {
    vi.mocked(replacePage).mockClear();
    const server = setup();
    await run('Sign out');
    await waitFor(() => expect(replacePage).toHaveBeenCalledWith('/studio'));
    expect(server.calls.some((c) => c.method === 'POST' && c.path === '/api/v1/auth/logout')).toBe(
      true,
    );
  });

  it('has no sign out when sign-in is off', async () => {
    setup(true, true);
    await openWithKeys();
    await screen.findByRole('option', { name: 'Copy API base URL' });
    expect(screen.queryByRole('option', { name: 'Sign out' })).not.toBeInTheDocument();
  });

  it('marks private videos in the results (VIS-10)', async () => {
    library.push({ ...asset('a3', 'Board meeting'), access_tier: 'private' });
    setup();
    await openWithKeys();
    const row = await screen.findByRole('option', { name: /Board meeting/ });
    expect(row).toHaveTextContent('Private');
    library.pop();
  });
});
