import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { checkValue, findOperation, responseSchema } from '@/test/openapi';
import { jsonFetch, renderPage, reply, type RecordedCall } from '@/test/render';
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
      </Routes>,
      { route },
    ),
  };
}

function Where() {
  return <output data-testid="where">{useLocation().search}</output>;
}

/** jsdom has no layout; the page asks for 640px and up to show the side panel. */
function viewport(wide: boolean) {
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: wide && query.includes('min-width: 640px'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  }));
}

beforeEach(() => {
  ifMatch = [];
  viewport(true);
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
    it('titles the page with the video and shows its facts in one meta row', async () => {
      render();
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Big Buck Bunny' }),
      ).toBeInTheDocument();
      expect(screen.getByText('Ready')).toBeInTheDocument();
      expect(screen.getByText('9:56')).toBeInTheDocument();
      expect(screen.getByText('1280 × 720')).toBeInTheDocument();
      expect(screen.getByText('9 MB on Sia')).toBeInTheDocument();
      expect(screen.getByText('128 plays')).toBeInTheDocument();
      expect(screen.getByText(/^Created /)).toBeInTheDocument();
      // no back link: the breadcrumb does that (VIS-19)
      expect(screen.queryByRole('link', { name: /videos/i })).toBeNull();
    });

    it('plays a private video signed, named after its title, with qualities', async () => {
      render();
      expect(await screen.findByTestId('player')).toHaveAccessibleName('Big Buck Bunny');
      expect(playerProps).toHaveBeenLastCalledWith(
        expect.objectContaining({ assetId: 'a1', signed: true, expiresIn: 3600 }),
      );
      expect(screen.getByText('Streaming from Sia')).toBeInTheDocument();
      await userEvent.click(screen.getByRole('radio', { name: '360p' }));
      expect(setQuality).toHaveBeenLastCalledWith(1);
    });

    it('opens on Share with the signing code first for a private video (RDS-01)', async () => {
      render();
      const panel = await screen.findByRole('tablist', { name: 'Share and details' });
      expect(within(panel).getByRole('tab', { name: 'Share' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      const share = screen.getByRole('tabpanel', { name: 'Share' });
      expect(
        within(share)
          .getAllByRole('tab')
          .map((t) => t.textContent),
      ).toEqual(['Server', 'React', 'HTML']);
      expect(share.textContent).toContain("getSignedUrl('a1'");
    });

    it('offers React first for a public video, playing it by this ID', async () => {
      render(asset({ access_tier: 'public' }));
      const share = await screen.findByRole('tabpanel', { name: 'Share' });
      expect(
        within(share)
          .getAllByRole('tab')
          .map((t) => t.textContent),
      ).toEqual(['React', 'HTML', 'Stream URL']);
      expect(share.textContent).toContain("streamUrl('a1')");
    });

    it('opens the panel and the section named in the url, and keeps the choice there', async () => {
      render(undefined, {}, '/studio/videos/a1?panel=details&tab=renditions');
      expect(await screen.findByRole('tabpanel', { name: 'Details' })).toBeInTheDocument();
      expect(screen.getByRole('tabpanel', { name: /Renditions/ })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('tab', { name: 'Storage on Sia' }));
      expect(screen.getByTestId('where')).toHaveTextContent('panel=details&tab=storage');
    });

    it('names both tab lists and counts playback IDs and renditions', async () => {
      render();
      const sections = await screen.findByRole('tablist', { name: 'Video sections' });
      await waitFor(() =>
        expect(
          within(sections)
            .getAllByRole('tab')
            .map((t) => t.textContent),
        ).toEqual(['Playback IDs(0)', 'Storage on Sia', 'Renditions(1)', 'Activity']),
      );
    });

    it('shows the details with copyable IDs and the description', async () => {
      render(undefined, {}, '/studio/videos/a1?panel=details');
      const details = await screen.findByRole('tabpanel', { name: 'Details' });
      expect(within(details).getByText('Video ID')).toBeInTheDocument();
      expect(within(details).getByRole('button', { name: /Copy video ID/ })).toBeInTheDocument();
      expect(within(details).getByText('Main playlist file')).toBeInTheDocument();
      expect(within(details).getByText('A bunny')).toHaveClass('line-clamp-6', 'wrap-anywhere');
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
      await userEvent.click(await screen.findByRole('tab', { name: 'Details' }));
      await userEvent.click(screen.getByRole('button', { name: 'Edit description' }));
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
      await userEvent.type(
        screen.getByRole('textbox', { name: 'Edit description' }),
        '{Control>}{Enter}{/Control}',
      );
      await waitFor(() => expect(ifMatch).toHaveLength(2));
      expect(ifMatch).toEqual([etag(UPDATED), etag('2026-10-03T00:00:00.000Z')]);
      expect(await screen.findByText('Changes saved')).toBeInTheDocument();
    });

    it('caps the description and counts from 4,500 characters (FLW-30)', async () => {
      render(asset({ description: 'x'.repeat(4500) }), {}, '/studio/videos/a1?panel=details');
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
      const dialog = await screen.findByRole('alertdialog', { name: 'Delete this video?' });
      await waitFor(() =>
        expect(dialog).toHaveTextContent(
          '“Big Buck Bunny” is removed from your library now and its 2 files are removed from Sia in the background. This cannot be undone.',
        ),
      );
      await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

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
        within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
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
        await screen.findByText('This video was deleted in another tab or browser.'),
      ).toBeInTheDocument();
      expect(
        await screen.findByRole('heading', { level: 1, name: 'Video not found' }),
      ).toBeInTheDocument();
    });
  });

  describe('before the video is ready', () => {
    it('shows the running step and percent, opens on Details and Activity', async () => {
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
      expect(screen.getByRole('tab', { name: 'Details' })).toHaveAttribute('aria-selected', 'true');
      expect(
        within(screen.getByRole('tablist', { name: 'Video sections' }))
          .getAllByRole('tab')
          .map((t) => t.textContent),
      ).toEqual(['Activity']);
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
      await userEvent.click(screen.getByRole('button', { name: 'Delete video' }));
      expect(
        await screen.findByRole('alertdialog', { name: 'Delete this video?' }),
      ).toHaveTextContent(
        '“Big Buck Bunny” is removed from your library now. This cannot be undone.',
      );
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
      expect(screen.getByRole('button', { name: 'Upload a different file' })).toBeInTheDocument();
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

  describe('on a phone', () => {
    it('puts the share panel in a bottom sheet and the details under the player', async () => {
      viewport(false);
      render(asset({ access_tier: 'public' }));
      await screen.findByTestId('player');
      expect(screen.queryByRole('tablist', { name: 'Share and details' })).toBeNull();
      expect(screen.getByRole('heading', { level: 2, name: 'Details' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Share' }));
      const sheet = await screen.findByRole('dialog', { name: 'Share' });
      expect(sheet.textContent).toContain("streamUrl('a1')");
    });
  });
});
