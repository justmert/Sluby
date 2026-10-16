import { forwardRef } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, renderPage, type RecordedCall } from '@/test/render';
import PlayerPage from './PlayerPage';

const mounted = vi.fn();

vi.mock('@sluby/player', () => ({
  SlubyPlayer: forwardRef(function FakePlayer(props: { assetId: string }) {
    mounted(props.assetId);
    return <video data-testid="player" />;
  }),
}));

const asset = (id: string, title: string, status = 'ready') => ({
  id,
  title,
  description: '',
  manifest_object_id: status === 'ready' ? 'm' : null,
  thumbnail_object_ids: [],
  duration_ms: 60_000,
  resolution: '1280x720',
  status,
  access_tier: 'public',
  creator_address: 'local:dev',
  segment_count: 1,
  total_storage_bytes: 1,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
});

const ready = Array.from({ length: 45 }, (_, i) => asset(`r${i}`, `Ready ${i}`));

function server(extra: Record<string, unknown> = {}) {
  const stub = jsonFetch({
    '/api/v1/assets': ({ query }: RecordedCall) => {
      // keyset paging: the cursor is the index to continue from
      const from = Number(query.get('cursor') ?? 0);
      const limit = Number(query.get('limit'));
      const data = ready.slice(from, from + limit);
      const next = from + limit < ready.length ? String(from + limit) : null;
      return { data, total: ready.length, page: 1, limit, next_cursor: next };
    },
    ...extra,
  });
  vi.stubGlobal('fetch', vi.fn(stub));
  return stub;
}

afterEach(() => {
  vi.unstubAllGlobals();
  mounted.mockClear();
});

describe('PlayerPage', () => {
  it('lists ready videos a page at a time', async () => {
    const stub = server();
    renderPage(<PlayerPage />);
    expect(await screen.findByText('45 playable')).toBeInTheDocument();
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(30);

    await userEvent.click(screen.getByRole('button', { name: 'Show more' }));
    expect(await within(list).findByText('Ready 44')).toBeInTheDocument();
    expect(within(list).getAllByRole('listitem')).toHaveLength(45);
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument();
    const calls = stub.calls.filter((c) => c.path === '/api/v1/assets');
    expect(calls.map((c) => c.query.get('status'))).toEqual(['ready', 'ready']);
    expect(calls[1].query.get('cursor')).toBe('30');
  });

  it('marks the playing video as current', async () => {
    server({ '/api/v1/assets/r1': asset('r1', 'Ready 1') });
    renderPage(<PlayerPage />, { route: '/?asset=r1' });
    const list = await screen.findByRole('list');
    const item = (await within(list).findByText('Ready 1')).closest('button');
    expect(item).toHaveAttribute('aria-current', 'true');
    expect(within(list).getByText('Ready 2').closest('button')).not.toHaveAttribute('aria-current');
    expect(await screen.findByTestId('player')).toBeInTheDocument();
  });

  it('does not mount the player for a video that is not ready', async () => {
    server({ '/api/v1/assets/f1': asset('f1', 'Broken', 'failed') });
    renderPage(<PlayerPage />, { route: '/?asset=f1' });
    expect(await screen.findByText('Broken is not ready to play')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Open the asset' })).toHaveAttribute(
      'href',
      '/studio/assets/f1',
    );
    expect(mounted).not.toHaveBeenCalled();
  });

  it('says the library has no ready videos yet when nothing was searched', async () => {
    server({
      '/api/v1/assets': { data: [], total: 0, page: 1, limit: 30, next_cursor: null },
    });
    renderPage(<PlayerPage />);
    const empty = await screen.findByText(/No ready videos yet\./);
    // a sentence, not a stray item in an otherwise empty list
    expect(empty.closest('ul')).toBeNull();
    expect(within(empty).getByRole('link', { name: 'Upload a video' })).toHaveAttribute(
      'href',
      '/studio/upload',
    );
    expect(screen.queryByText(/match/)).not.toBeInTheDocument();
  });

  it('says nothing matches only once a search ran', async () => {
    const stub = server({
      '/api/v1/assets': ({ query }: RecordedCall) =>
        query.get('search')
          ? { data: [], total: 0, page: 1, limit: 30, next_cursor: null }
          : { data: [asset('r1', 'Ready 1')], total: 1, page: 1, limit: 30, next_cursor: null },
    });
    renderPage(<PlayerPage />);
    expect(await screen.findByText('Ready 1')).toBeInTheDocument();
    await userEvent.type(screen.getByRole('textbox', { name: 'Search ready videos' }), 'nope');
    const empty = await screen.findByText('No ready videos match.');
    expect(empty.closest('ul')).toBeNull();
    expect(screen.queryByText(/No ready videos yet/)).not.toBeInTheDocument();
    expect(stub.calls.some((c) => c.query.get('search') === 'nope')).toBe(true);
  });

  it('gives list items the same focus ring as buttons', async () => {
    server();
    renderPage(<PlayerPage />);
    const item = (await screen.findByText('Ready 0')).closest('button')!;
    expect(item.className).toContain('focus-visible:ring-3');
    expect(item.className).toContain('outline-none');
  });

  it('keeps the search in the url, and picking a video keeps the search', async () => {
    const stub = server({ '/api/v1/assets/r1': asset('r1', 'Ready 1') });
    function Where() {
      return <output data-testid="where">{useLocation().search}</output>;
    }
    renderPage(
      <Routes>
        <Route
          path="/studio/player"
          element={
            <>
              <PlayerPage />
              <Where />
            </>
          }
        />
      </Routes>,
      { route: '/studio/player?q=Ready' },
    );
    const box = await screen.findByRole('textbox', { name: 'Search ready videos' });
    expect(box).toHaveValue('Ready');
    await screen.findByText('Ready 1');
    expect(stub.calls.find((c) => c.path === '/api/v1/assets')!.query.get('search')).toBe('Ready');

    await userEvent.click(screen.getByText('Ready 1'));
    await waitFor(() =>
      expect(new URLSearchParams(screen.getByTestId('where').textContent!).get('asset')).toBe('r1'),
    );
    expect(new URLSearchParams(screen.getByTestId('where').textContent!).get('q')).toBe('Ready');
  });

  it('brings the player back into view when a video is picked below it', async () => {
    server({ '/api/v1/assets/r3': asset('r3', 'Ready 3') });
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const rect = vi
      .spyOn(Element.prototype, 'getBoundingClientRect')
      .mockReturnValue({ top: -400, bottom: -100 } as DOMRect);
    renderPage(<PlayerPage />);
    await userEvent.click(await screen.findByText('Ready 3'));
    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: 'smooth', block: 'start' });
    rect.mockRestore();
  });

  it('focuses the search on "/"', async () => {
    server();
    renderPage(<PlayerPage />);
    await screen.findByText('Ready 0');
    await userEvent.keyboard('/');
    expect(screen.getByRole('textbox', { name: 'Search ready videos' })).toHaveFocus();
  });
});
