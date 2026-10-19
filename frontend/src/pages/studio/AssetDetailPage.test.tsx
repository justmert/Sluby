import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkValue, findOperation, responseSchema } from '@/test/openapi';
import { jsonFetch, renderPage, reply, type RecordedCall } from '@/test/render';
import { WithSession } from '@/test/session';
import { reportUnauthorized } from '@/lib/session-events';
import AssetDetailPage from './AssetDetailPage';

const setQuality = vi.fn();
const playerProps = vi.fn();

// the real player needs MSE and hls.js; this stand-in drives the same callbacks
vi.mock('@sluby/player', () => ({
  SlubyPlayer: forwardRef(function FakePlayer(props: Record<string, unknown>, ref) {
    playerProps(props);
    useImperativeHandle(ref, () => ({ setQuality }));
    useEffect(() => {
      (props.onQualitiesChange as (l: unknown[]) => void)?.([
        { index: 0, width: 1280, height: 720, bitrate: 3_500_000, name: '720p' },
        { index: 1, width: 640, height: 360, bitrate: 800_000, name: '360p' },
      ]);
      (props.onQualityChange as (l: unknown) => void)?.({
        index: 0,
        width: 1280,
        height: 720,
        bitrate: 3_500_000,
        name: '720p',
      });
      (props.onDeliveryChange as (m: string) => void)?.('sia');
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);
    return <video data-testid="player" aria-label={props.title as string} />;
  }),
}));

const UPDATED = '2026-10-01T00:00:00.000Z';

const asset = (overrides: Record<string, unknown> = {}) => ({
  id: 'a1',
  title: 'Big Buck Bunny',
  description: 'A bunny',
  manifest_object_id: 'master-1',
  thumbnail_object_ids: [],
  duration_ms: 596_000,
  resolution: '1280x720',
  status: 'ready',
  access_tier: 'private',
  creator_address: 'github:dev',
  segment_count: 2,
  total_storage_bytes: 9_000_000,
  play_count: 128,
  last_played_at: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: UPDATED,
  ...overrides,
});

const sia = {
  manifest_object_id: 'master-1',
  objects: [
    {
      object_id: 'master-1',
      role: 'master_manifest',
      rendition: null,
      size: 400,
      encoded_size: 4_194_304,
      slab_count: 1,
      sector_count: 30,
      shared_slab_count: 0,
      host_count: 30,
      created_at: '2026-10-01T00:00:00Z',
    },
    {
      object_id: 'pl-720',
      role: 'variant_playlist',
      rendition: '720p',
      size: 300,
      encoded_size: 300,
      slab_count: 1,
      sector_count: 30,
      shared_slab_count: 1,
      host_count: 30,
      created_at: '2026-10-01T00:00:00Z',
    },
  ],
  unavailable_object_ids: [],
  totals: {
    object_count: 2,
    raw_bytes: 700,
    encoded_bytes: 4_194_604,
    unique_slab_count: 2,
    unique_sector_count: 60,
    sector_bytes: 60 * 4 * 1024 * 1024,
    data_shards: 10,
    parity_shards: 20,
    redundancy_ratio: 3,
    host_count: 31,
    country_count: 2,
  },
  hosts: [
    {
      public_key: 'ed25519:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
      sectors: 2,
      country_code: 'DE',
      latitude: 0,
      longitude: 0,
      good_for_upload: true,
    },
  ],
  countries: [
    { country_code: 'DE', hosts: 20, sectors: 40 },
    { country_code: 'US', hosts: 11, sectors: 20 },
  ],
  contracts: null,
  indexer: { url: 'https://sia.storage', network: 'mainnet', wallet_address: null },
};

const renditions = {
  data: [
    {
      name: '720p',
      width: 1280,
      height: 720,
      video_bitrate_kbps: 3500,
      segment_count: 60,
      byte_size: 8_000_000,
      data_object_id: 'data-720',
      playlist_object_id: 'pl-720',
    },
  ],
};

const job = (over: Record<string, unknown> = {}) => ({
  id: 'j',
  status: 'completed',
  stage: 'completed',
  progress_percent: 100,
  retry_count: 0,
  error_message: null,
  started_at: null,
  completed_at: null,
  created_at: '2026-10-01T00:00:00Z',
  retryable: false,
  logs: [{ timestamp: '2026-10-01T00:00:00Z', stage: 'transcode', message: 'Starting' }],
  ...over,
});

const failedJob = job({
  status: 'failed',
  stage: 'failed',
  progress_percent: 65,
  retry_count: 3,
  error_message: 'ffmpeg exited with code 1',
  retryable: true,
});

/** Every If-Match the page sent, in order. */
let ifMatch: Array<string | null> = [];

function render(
  assetBody: unknown = asset(),
  extra: Record<string, unknown> = {},
  route = '/studio/videos/a1',
) {
  const server = jsonFetch({
    '/api/v1/assets/a1': assetBody,
    '/api/v1/assets/a1/sia': sia,
    '/api/v1/assets/a1/renditions': renditions,
    '/api/v1/assets/a1/processing': job(),
    '/api/v1/assets/a1/playback-ids': { data: [] },
    ...extra,
  });
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === 'PATCH') ifMatch.push(new Headers(init.headers).get('If-Match'));
      return server(input, init);
    }),
  );
  return {
    server,
    ...renderPage(
      <WithSession>
        <Routes>
          <Route
            path="/studio/videos/:id"
            element={
              <>
                <AssetDetailPage />
                <Where />
              </>
            }
          />
          <Route path="/studio/videos" element={<p>Library</p>} />
        </Routes>
      </WithSession>,
      { route },
    ),
  };
}

function Where() {
  return <output data-testid="where">{useLocation().search}</output>;
}

beforeEach(() => {
  ifMatch = [];
  setQuality.mockClear();
  playerProps.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

const etag = (iso: string) => `"${Date.parse(iso)}"`;

describe('AssetDetailPage', () => {
  it('uses fixtures that match the documented shapes', () => {
    // play_count, last_played_at (B-09) and retryable (B-15) are documented on final-be,
    // whose openapi this branch does not have yet; the rest must match today
    const { play_count: _p, last_played_at: _l, ...documentedAsset } = asset();
    const { retryable: _r, ...documentedJob } = failedJob;
    expect(
      checkValue(documentedAsset, responseSchema(findOperation('GET', '/api/v1/assets/a1')!)!),
    ).toEqual([]);
    expect(
      checkValue(
        documentedJob,
        responseSchema(findOperation('GET', '/api/v1/assets/a1/processing')!)!,
      ),
    ).toEqual([]);
  });

  describe('a ready video', () => {
    it('puts the title, its edit button, the status and the two actions in one row', async () => {
      render();
      const h1 = await screen.findByRole('heading', { level: 1, name: 'Big Buck Bunny' });
      const row = h1.closest('[data-slot="inline-edit"]')!.parentElement!;
      expect(within(row).getByRole('button', { name: 'Edit title' })).toBeInTheDocument();
      expect(within(row).getByText('Ready')).toBeInTheDocument();
      expect(within(row).getByRole('button', { name: 'Copy embed code' })).toBeEnabled();
      expect(within(row).getByRole('button', { name: 'More actions' })).toHaveTextContent('More');
      // no back link: the breadcrumb does that (VIS-19)
      expect(screen.queryByRole('link', { name: /videos/i })).toBeNull();
    });

    it('copies the embed code from the title row', async () => {
      const writeText = vi.fn().mockResolvedValue(undefined);
      Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
      render(asset({ access_tier: 'public' }));
      await userEvent.click(await screen.findByRole('button', { name: 'Copy embed code' }));
      expect(writeText.mock.lastCall![0]).toContain('/watch/a1"');
      expect(await screen.findByText('Embed code copied')).toBeInTheDocument();
    });

    it('lists the details in the side card, with the access control and a copyable ID', async () => {
      render(asset({ last_played_at: new Date(Date.now() - 3 * 3600_000).toISOString() }));
      const details = (await screen.findByRole('heading', { level: 2, name: 'Details' })).closest(
        'section',
      )!;
      expect(
        within(details)
          .getAllByRole('term')
          .map((t) => t.textContent),
      ).toEqual([
        'Access',
        'Length',
        'Quality',
        'Size',
        'Plays',
        'Last played',
        'Uploaded',
        'Video ID',
      ]);
      const value = (term: string) =>
        within(details).getByText(term, { selector: 'dt' }).nextElementSibling as HTMLElement;
      expect(
        within(value('Access')).getByRole('radiogroup', { name: 'Who can watch' }),
      ).toBeInTheDocument();
      expect(value('Length')).toHaveTextContent('9:56');
      expect(await within(details).findByText('720p')).toBeInTheDocument();
      expect(value('Size')).toHaveTextContent('9 MB');
      expect(value('Plays')).toHaveTextContent('128');
      expect(value('Last played')).toHaveTextContent('3 hours ago');
      expect(value('Uploaded')).toHaveTextContent('Oct 1, 2026');
      expect(
        within(value('Video ID')).getByRole('button', { name: 'Copy video ID' }),
      ).toBeVisible();
    });

    it('says a video nobody played was never played', async () => {
      render();
      const details = (await screen.findByRole('heading', { level: 2, name: 'Details' })).closest(
        'section',
      )!;
      expect(within(details).getByText('Never')).toBeInTheDocument();
    });

    it('plays a private video signed, named after its title, with qualities', async () => {
      render();
      expect(await screen.findByTestId('player')).toHaveAccessibleName('Big Buck Bunny');
      expect(playerProps).toHaveBeenLastCalledWith(
        expect.objectContaining({ assetId: 'a1', signed: true, expiresIn: 3600 }),
      );
      expect(screen.getByText('Direct from Sia')).toBeInTheDocument();
      await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Quality' }), '360p');
      expect(setQuality).toHaveBeenLastCalledWith(1);
    });

    it('opens on Share with the signing code first for a private video (RDS-01)', async () => {
      render();
      const sections = await screen.findByRole('tablist', { name: 'Video sections' });
      expect(within(sections).getByRole('tab', { name: 'Share' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      const share = screen.getByRole('tabpanel', { name: 'Share' });
      expect(
        within(share)
          .getAllByRole('tab')
          .map((t) => t.textContent),
      ).toEqual(['Server', 'Iframe', 'React', 'HTML']);
      expect(share.textContent).toContain("getSignedUrl('a1'");
    });

    it('offers the iframe first for a public video, playing it by this ID', async () => {
      render(asset({ access_tier: 'public' }));
      const share = await screen.findByRole('tabpanel', { name: 'Share' });
      expect(
        within(share)
          .getAllByRole('tab')
          .map((t) => t.textContent),
      ).toEqual(['Iframe', 'Link', 'React', 'HTML', 'Stream URL']);
      expect(share.textContent).toContain('/watch/a1"');
    });

    it('opens the section named in the url and keeps the choice there', async () => {
      render(undefined, {}, '/studio/videos/a1?tab=renditions');
      expect(await screen.findByRole('tabpanel', { name: /Renditions/ })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('tab', { name: 'Storage' }));
      expect(screen.getByTestId('where')).toHaveTextContent('?tab=storage');
      // Share is the default, so it leaves the url clean
      await userEvent.click(screen.getByRole('tab', { name: 'Share' }));
      expect(screen.getByTestId('where')).toBeEmptyDOMElement();
    });

    it('still opens Share from the old ?panel=share links', async () => {
      render(undefined, {}, '/studio/videos/a1?panel=share');
      expect(await screen.findByRole('tabpanel', { name: 'Share' })).toBeInTheDocument();
    });

    it('has one row of section tabs in the board order, counting playback IDs and renditions', async () => {
      render();
      const sections = await screen.findByRole('tablist', { name: 'Video sections' });
      await waitFor(() =>
        expect(
          within(sections)
            .getAllByRole('tab')
            .map((t) => t.textContent),
        ).toEqual(['Share', 'Playback IDs0', 'Renditions1', 'Storage', 'Activity']),
      );
      expect(screen.getAllByRole('tablist', { name: 'Video sections' })).toHaveLength(1);
    });

    it('scrolls a tab that is cut off by its sideways strip into view when it takes focus (2.4.11)', async () => {
      render();
      await screen.findByTestId('player');
      const scrolled = vi.fn();
      Element.prototype.scrollIntoView = scrolled;
      const tabs = within(
        await screen.findByRole('tablist', { name: 'Video sections' }),
      ).getAllByRole('tab');
      act(() => tabs[tabs.length - 1].focus());
      expect(scrolled).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' });
    });

    it('lets the section tabs scroll sideways on a phone', async () => {
      render();
      const sections = await screen.findByRole('tablist', { name: 'Video sections' });
      expect(sections.parentElement).toHaveClass('overflow-x-auto');
    });

    it('shows the description in its own card with an Edit button, clamped to six lines', async () => {
      render();
      const card = (await screen.findByRole('heading', { level: 2, name: 'Description' })).closest(
        'section',
      )!;
      expect(within(card).getByText('A bunny')).toHaveClass('line-clamp-6', 'wrap-anywhere');
      expect(within(card).getByRole('button', { name: 'Edit description' })).toBeInTheDocument();
    });

    it('ends the side column with a Delete video card whose outlined button asks first', async () => {
      render();
      const card = (await screen.findByRole('heading', { level: 2, name: 'Delete video' })).closest(
        'section',
      )!;
      expect(card).toHaveTextContent('Removes it from Sia and stops every embed.');
      const button = within(card).getByRole('button', { name: 'Delete video' });
      expect(button).toHaveAttribute('data-variant', 'destructive-outline');
      await userEvent.click(button);
      expect(
        await screen.findByRole('alertdialog', { name: 'Delete “Big Buck Bunny”?' }),
      ).toBeInTheDocument();
    });
  });

  describe('editing in place', () => {
    const patchRoute = ({ body }: RecordedCall) =>
      asset({ ...(body as object), updated_at: '2026-10-02T00:00:00.000Z' });

    it('saves only the title, based on the version the edit started from (FLW-06)', async () => {
      const { server } = render(undefined, { 'PATCH /api/v1/assets/a1': patchRoute });
      await screen.findByTestId('player');
      await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
      const input = screen.getByRole('textbox', { name: 'Edit title' });
      await userEvent.clear(input);
      await userEvent.type(input, '  Bunny cut  {Enter}');

      await waitFor(() =>
        expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Bunny cut'),
      );
      const patch = server.calls.find((c) => c.method === 'PATCH')!;
      expect(patch.body).toEqual({ title: 'Bunny cut' });
      expect(ifMatch).toEqual([etag(UPDATED)]);
      expect(await screen.findByText('Changes saved')).toBeInTheDocument();
    });

    it('keeps the page heading while the title is being edited', async () => {
      render();
      await screen.findByTestId('player');
      const heading = screen.getByRole('heading', { level: 1 });
      const name = heading.textContent;
      await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
      expect(screen.getByRole('textbox', { name: 'Edit title' })).toHaveFocus();
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(name!);
    });

    it('refuses an empty title without a request (CPY-28)', async () => {
      const { server } = render();
      await screen.findByTestId('player');
      await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
      const input = screen.getByRole('textbox', { name: 'Edit title' });
      await userEvent.clear(input);
      await userEvent.type(input, '   {Enter}');
      expect(screen.getByRole('alert')).toHaveTextContent('Enter a title.');
      expect(input).toHaveAttribute('aria-invalid', 'true');
      expect(server.calls.some((c) => c.method === 'PATCH')).toBe(false);
    });

    it('stops a stale description edit, keeps what was typed, and saves after Reload', async () => {
      let version = 0;
      render(undefined, {
        'PATCH /api/v1/assets/a1': ({ body }: RecordedCall) =>
          version++ === 0
            ? reply(412, {
                error: 'This video was changed somewhere else.',
                current: asset({
                  title: 'Renamed in tab B',
                  updated_at: '2026-10-03T00:00:00.000Z',
                }),
              })
            : asset({ ...(body as object), title: 'Renamed in tab B' }),
      });
      await userEvent.click(await screen.findByRole('button', { name: 'Edit description' }));
      const box = screen.getByRole('textbox', { name: 'Edit description' });
      await userEvent.clear(box);
      await userEvent.type(box, 'Mine{Control>}{Enter}{/Control}');

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(
        'This video was changed somewhere else. Reload it to see the latest, then edit again.',
      );
      // nothing typed is lost
      expect(screen.getByRole('textbox', { name: 'Edit description' })).toHaveValue('Mine');

      await userEvent.click(within(alert).getByRole('button', { name: 'Reload' }));
      expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Renamed in tab B');
      // the reload worked: the warning gives way to what to do next, and the text stays
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(
        screen.getByText(
          'Reloaded. Save again to keep what you typed, or press Escape to keep the latest.',
        ),
      ).toHaveAttribute('role', 'status');
      expect(screen.getByRole('textbox', { name: 'Edit description' })).toHaveValue('Mine');
      await userEvent.type(
        screen.getByRole('textbox', { name: 'Edit description' }),
        '{Control>}{Enter}{/Control}',
      );
      await waitFor(() => expect(ifMatch).toHaveLength(2));
      expect(ifMatch).toEqual([etag(UPDATED), etag('2026-10-03T00:00:00.000Z')]);
      expect(await screen.findByText('Changes saved')).toBeInTheDocument();
    });

    it('keeps a description whose save met an ended session, and reopens it after sign-in (FLW-15)', async () => {
      sessionStorage.clear();
      const first = render(undefined, {
        // what the app's query client does with a 401
        'PATCH /api/v1/assets/a1': () => {
          reportUnauthorized('revoked');
          return reply(401, { error: 'Not signed in', reason: 'revoked' });
        },
      });
      await userEvent.click(await screen.findByRole('button', { name: 'Edit description' }));
      const box = screen.getByRole('textbox', { name: 'Edit description' });
      await userEvent.clear(box);
      await userEvent.type(box, 'Written before the session ended{Control>}{Enter}{/Control}');
      await waitFor(() => expect(ifMatch).toHaveLength(1));
      first.unmount();

      render();
      expect(await screen.findByRole('textbox', { name: 'Edit description' })).toHaveValue(
        'Written before the session ended',
      );
    });

    it('caps the description and counts from 4,500 characters (FLW-30)', async () => {
      render(asset({ description: 'x'.repeat(4500) }));
      await userEvent.click(await screen.findByRole('button', { name: 'Edit description' }));
      const box = screen.getByRole('textbox', { name: 'Edit description' });
      expect(box).toHaveAttribute('maxLength', '5000');
      expect(screen.getByText('4,500 of 5,000')).toBeInTheDocument();
    });

    it('asks before making the video public, then saves the access with If-Match', async () => {
      const { server } = render(undefined, { 'PATCH /api/v1/assets/a1': patchRoute });
      await screen.findByTestId('player');
      const access = screen.getByRole('radiogroup', { name: 'Who can watch' });
      await userEvent.click(within(access).getByRole('radio', { name: 'Public' }));
      const confirm = await screen.findByRole('dialog', { name: 'Make this video public?' });
      expect(server.calls.some((c) => c.method === 'PATCH')).toBe(false);
      await userEvent.click(within(confirm).getByRole('button', { name: 'Make public' }));

      await waitFor(() =>
        expect(within(access).getByRole('radio', { name: 'Public' })).toHaveAttribute(
          'aria-checked',
          'true',
        ),
      );
      expect(server.calls.find((c) => c.method === 'PATCH')!.body).toEqual({
        access_tier: 'public',
      });
      expect(ifMatch).toEqual([etag(UPDATED)]);
      expect(await screen.findByText('The video is public now')).toBeInTheDocument();
    });
  });

  describe('deleting', () => {
    it('deletes from the overflow menu, goes to the library, and fetches nothing after', async () => {
      const { server } = render(undefined, { 'DELETE /api/v1/assets/a1': { success: true } });
      await screen.findByTestId('player');
      await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete video' }));
      const dialog = await screen.findByRole('alertdialog', { name: 'Delete “Big Buck Bunny”?' });
      await waitFor(() =>
        expect(dialog).toHaveTextContent(
          'It is removed from your library now and its 2 files are removed from Sia in the background. Every embed stops working. This cannot be undone.',
        ),
      );
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete video' }));

      expect(await screen.findByText('Library')).toBeInTheDocument();
      expect(await screen.findByText('Video deleted')).toBeInTheDocument();
      const deletedAt = server.calls.findIndex((c) => c.method === 'DELETE');
      expect(deletedAt).toBeGreaterThan(-1);
      await new Promise((r) => setTimeout(r, 50));
      expect(
        server.calls.slice(deletedAt + 1).filter((c) => c.path.startsWith('/api/v1/assets/a1')),
      ).toEqual([]);
    });

    it('says why a delete failed and stays on the video', async () => {
      render(undefined, {
        'DELETE /api/v1/assets/a1': reply(500, { error: 'Database unavailable' }),
      });
      await screen.findByTestId('player');
      await userEvent.click(screen.getByRole('button', { name: 'More actions' }));
      await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete video' }));
      await userEvent.click(
        within(await screen.findByRole('alertdialog')).getByRole('button', {
          name: 'Delete video',
        }),
      );
      expect(
        await screen.findByText(/^Could not delete the video\. The server ran into a problem/),
      ).toBeInTheDocument();
      expect(screen.queryByText('Library')).toBeNull();
    });

    it('tells you when the video was deleted somewhere else, then says not found (FLW-44)', async () => {
      let alive = true;
      const { client } = render(undefined, {
        '/api/v1/assets/a1': () =>
          alive ? asset() : reply(404, { error: 'Video asset not found' }),
      });
      await screen.findByTestId('player');
      alive = false;
      await act(() => client.refetchQueries({ queryKey: ['assets', 'one', 'a1'] }));
      expect(
        await screen.findByText('This video was deleted in another tab or browser'),
      ).toBeInTheDocument();
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Video not found' }),
      ).toBeInTheDocument();
    });
  });

  describe('a save that finds the video gone', () => {
    it('says it was deleted somewhere else and shows not found (FLW-44)', async () => {
      let alive = true;
      render(undefined, {
        '/api/v1/assets/a1': () =>
          alive ? asset() : reply(404, { error: 'Video asset not found' }),
        'PATCH /api/v1/assets/a1': () => {
          alive = false;
          return reply(404, { error: 'Video asset not found' });
        },
      });
      await screen.findByTestId('player');
      await userEvent.click(screen.getByRole('button', { name: 'Edit title' }));
      await userEvent.type(screen.getByRole('textbox', { name: 'Edit title' }), 'New{Enter}');
      expect(
        await screen.findByText('This video was deleted in another tab or browser'),
      ).toBeInTheDocument();
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Video not found' }),
      ).toBeInTheDocument();
    });
  });

  describe('before the video is ready', () => {
    it('shows the running step and percent, and opens on Activity with Share waiting', async () => {
      render(asset({ status: 'processing', manifest_object_id: null }), {
        '/api/v1/assets/a1/processing': job({
          status: 'processing',
          stage: 'upload',
          progress_percent: 72,
        }),
      });
      const card = await screen.findByRole('region', { name: 'Processing' });
      expect(await within(card).findByText('Storing on Sia')).toBeInTheDocument();
      expect(within(card).getByText('72%')).toBeInTheDocument();
      expect(screen.getByRole('tab', { name: 'Activity' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(
        within(screen.getByRole('tablist', { name: 'Video sections' }))
          .getAllByRole('tab')
          .map((t) => t.textContent),
      ).toEqual(['Share', 'Activity']);
      expect(screen.getByRole('button', { name: 'Copy embed code' })).toBeDisabled();
      expect(screen.getByRole('region', { name: 'Processing log' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('tab', { name: 'Share' }));
      expect(screen.getByText('Available once the video is ready.')).toBeInTheDocument();
    });

    it('says it cannot read the processing status and checks again (FLW-11)', async () => {
      let calls = 0;
      render(asset({ status: 'processing' }), {
        '/api/v1/assets/a1/processing': () =>
          calls++ === 0
            ? reply(500, { error: 'boom' })
            : job({ status: 'processing', stage: 'transcode', progress_percent: 20 }),
      });
      expect(await screen.findByText('Could not read the processing status.')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Check again' }));
      const card = screen.getByRole('region', { name: 'Processing' });
      expect(await within(card).findByText('Transcoding')).toBeInTheDocument();
    });

    it('turns an upload that stopped long ago into Upload interrupted (FLW-12)', async () => {
      const { server } = render(
        asset({ status: 'created', created_at: '2026-01-01T00:00:00Z', manifest_object_id: null }),
      );
      expect(
        await screen.findByRole('heading', { name: 'Upload interrupted' }),
      ).toBeInTheDocument();
      expect(screen.getByText('Interrupted')).toBeInTheDocument();
      // no processing job exists for an upload that never finished, and the log says so
      expect(server.calls.some((c) => c.path.endsWith('/processing'))).toBe(false);
      expect(screen.getByText('Nothing has run yet')).toBeInTheDocument();
      await userEvent.click(screen.getAllByRole('button', { name: 'Delete video' })[0]);
      expect(
        await screen.findByRole('alertdialog', { name: 'Delete “Big Buck Bunny”?' }),
      ).toHaveTextContent('It is removed from your library now. This cannot be undone.');
    });

    it('keeps an old upload that another tab of this browser is sending as Uploading', async () => {
      // another studio tab announces what it sends on the shared channel
      const otherTab = new BroadcastChannel('sluby-uploads');
      otherTab.postMessage({
        type: 'state',
        tabId: 'other-tab',
        uploads: [
          {
            fingerprint: 'big.mp4-video/mp4-1000-1',
            uploadId: 'up-1',
            assetId: 'a1',
            title: 'Big Buck Bunny',
            fileName: 'big.mp4',
            bytesUploaded: 400,
            bytesTotal: 1000,
            paused: false,
          },
        ],
      });
      try {
        render(
          asset({
            status: 'created',
            created_at: '2026-01-01T00:00:00Z',
            manifest_object_id: null,
          }),
        );
        expect(await screen.findByRole('heading', { name: 'Uploading' })).toBeInTheDocument();
        expect(screen.queryByRole('heading', { name: 'Upload interrupted' })).toBeNull();
        expect(screen.queryByText('Interrupted')).toBeNull();
      } finally {
        otherTab.postMessage({ type: 'bye', tabId: 'other-tab' });
        otherTab.close();
      }
    });

    it('keeps reading a video another tab is sending, so it moves on once the file is in', async () => {
      const otherTab = new BroadcastChannel('sluby-uploads');
      otherTab.postMessage({
        type: 'state',
        tabId: 'other-tab',
        uploads: [
          {
            fingerprint: 'big.mp4-video/mp4-1000-1',
            uploadId: 'up-1',
            assetId: 'a1',
            title: 'Big Buck Bunny',
            fileName: 'big.mp4',
            bytesUploaded: 900,
            bytesTotal: 1000,
            paused: false,
          },
        ],
      });
      let reads = 0;
      try {
        render(() =>
          asset({
            status: ++reads > 1 ? 'processing' : 'created',
            created_at: '2026-01-01T00:00:00Z',
            manifest_object_id: null,
          }),
        );
        expect(await screen.findByRole('heading', { name: 'Uploading' })).toBeInTheDocument();
        expect(
          await screen.findByRole('heading', { name: 'Processing' }, { timeout: 4_000 }),
        ).toBeInTheDocument();
      } finally {
        otherTab.postMessage({ type: 'bye', tabId: 'other-tab' });
        otherTab.close();
      }
    });

    it('explains a failure plainly, raw text under Details, and retries it', async () => {
      let failed = true;
      const { server } = render(() => asset({ status: failed ? 'failed' : 'processing' }), {
        '/api/v1/assets/a1/processing': () =>
          failed ? failedJob : job({ status: 'queued', stage: 'queued', logs: [] }),
        'POST /api/v1/assets/a1/retry': () => {
          failed = false;
          return reply(202, { stage: 'transcode' });
        },
      });
      expect(await screen.findByText('Transcoding the video failed.')).toBeInTheDocument();
      expect(screen.getByText('ffmpeg exited with code 1').closest('details')).not.toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Retry processing' }));
      expect(await screen.findByText('Processing restarted from Transcoding')).toBeInTheDocument();
      expect(await screen.findByText('Waiting to start')).toBeInTheDocument();
      expect(server.calls.some((c) => c.method === 'POST' && c.path.endsWith('/retry'))).toBe(true);
    });

    it('offers a new upload, not Retry, for a file that is not a video (FLW-22)', async () => {
      render(asset({ status: 'failed' }), {
        '/api/v1/assets/a1/processing': job({
          status: 'failed',
          stage: 'failed',
          error_message: 'ffprobe exited with code 1: Invalid data found when processing input',
          retryable: false,
        }),
      });
      expect(await screen.findByText('The file is not a readable video.')).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Retry processing' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Upload a different file' })).toHaveAttribute(
        'href',
        '/studio/videos/upload',
      );
    });
  });

  describe('page states', () => {
    it('lays out a loading page with a heading and a status for screen readers (A11Y-37)', async () => {
      let release!: () => void;
      const held = new Promise<void>((r) => (release = r));
      render(async () => {
        await held;
        return asset();
      });
      expect(screen.getByRole('heading', { level: 1, name: 'Loading video' })).toBeInTheDocument();
      expect(screen.getByText('Loading video details')).toHaveAttribute('role', 'status');
      release();
      expect(await screen.findByTestId('player')).toBeInTheDocument();
    });

    it('says not found for a missing video and for a malformed ID (FLW-34)', async () => {
      render(undefined, { '/api/v1/assets/a1': reply(404, { error: 'Video asset not found' }) });
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Video not found' }),
      ).toBeInTheDocument();
      expect(
        screen.getByText(
          'Check the link. It may have been deleted, or it belongs to another account.',
        ),
      ).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
      expect(screen.getByRole('link', { name: 'Back to videos' })).toHaveAttribute(
        'href',
        '/studio/videos',
      );
    });

    it('treats a 400 for a malformed ID as not found', async () => {
      render(undefined, {
        '/api/v1/assets/a1': reply(400, { error: 'Invalid identifier format' }),
      });
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Video not found' }),
      ).toBeInTheDocument();
    });

    it('offers Try again with the reader sentence when the video did not load', async () => {
      render(undefined, { '/api/v1/assets/a1': reply(500, { error: 'Database unavailable' }) });
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Could not load this video' }),
      ).toBeInTheDocument();
      expect(screen.getByText(/The server ran into a problem \(error 500\)/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    });
  });

  describe('layout', () => {
    it('keeps the player and tabs first and the side cards after them, so a phone stacks them in that order', async () => {
      render(asset({ access_tier: 'public' }));
      await screen.findByTestId('player');
      const tabs = screen.getByRole('tablist', { name: 'Video sections' });
      const aside = screen.getByRole('complementary', { name: 'About this video' });
      expect(tabs.compareDocumentPosition(aside) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(
        within(aside)
          .getAllByRole('heading', { level: 2 })
          .map((h) => h.textContent),
      ).toEqual(['Details', 'Description', 'Delete video']);
      // both columns wrap: the side one drops under the player when there is no room
      expect(aside.parentElement).toHaveClass('flex-wrap');
    });
  });
});
