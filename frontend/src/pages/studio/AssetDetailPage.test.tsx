import { forwardRef, useEffect, useImperativeHandle } from 'react';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, renderPage, reply } from '@/test/render';
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
    return <video data-testid="player" />;
  }),
}));

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
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
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

const failedJob = {
  id: 'j',
  status: 'failed',
  stage: 'failed',
  progress_percent: 65,
  retry_count: 3,
  error_message: 'ffmpeg exited with code 1',
  started_at: null,
  completed_at: null,
  created_at: '2026-10-01T00:00:00Z',
  logs: [{ timestamp: '2026-10-01T00:00:00Z', stage: 'transcode', message: 'Starting' }],
};

function render(assetBody = asset(), extra: Record<string, unknown> = {}) {
  const server = jsonFetch({
    '/api/v1/assets/a1': assetBody,
    '/api/v1/assets/a1/sia': sia,
    '/api/v1/assets/a1/renditions': renditions,
    '/api/v1/assets/a1/processing': failedJob,
    '/api/v1/assets/a1/playback-ids': { data: [] },
    ...extra,
  });
  vi.stubGlobal('fetch', vi.fn(server));
  return {
    server,
    ...renderPage(
      <Routes>
        <Route path="/studio/assets/:id" element={<AssetDetailPage />} />
        <Route path="/studio/assets" element={<p>Library</p>} />
      </Routes>,
      { route: '/studio/assets/a1' },
    ),
  };
}

function Where() {
  return <output data-testid="where">{useLocation().search}</output>;
}

function renderAt(route: string) {
  const server = jsonFetch({
    '/api/v1/assets/a1': asset(),
    '/api/v1/assets/a1/sia': sia,
    '/api/v1/assets/a1/renditions': renditions,
    '/api/v1/assets/a1/playback-ids': { data: [] },
  });
  vi.stubGlobal('fetch', vi.fn(server));
  return renderPage(
    <Routes>
      <Route
        path="/studio/assets/:id"
        element={
          <>
            <AssetDetailPage />
            <Where />
          </>
        }
      />
    </Routes>,
    { route },
  );
}

beforeEach(() => {
  setQuality.mockClear();
  playerProps.mockClear();
});
afterEach(() => vi.unstubAllGlobals());

describe('AssetDetailPage', () => {
  it('embeds the player signed for private assets and switches quality', async () => {
    render();
    expect(await screen.findByTestId('player')).toBeInTheDocument();
    expect(playerProps.mock.calls[0][0]).toMatchObject({ assetId: 'a1', signed: true });
    expect(screen.getByText('Streaming direct from Sia')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('radio', { name: '360p' }));
    expect(setQuality).toHaveBeenLastCalledWith(1);
    await userEvent.click(screen.getByRole('radio', { name: 'Auto' }));
    expect(setQuality).toHaveBeenLastCalledWith(-1);
  });

  it('shows the Sia breakdown with shards, redundancy and countries', async () => {
    render();
    await userEvent.click(await screen.findByRole('tab', { name: 'Sia storage' }));
    expect(await screen.findByText('3.0x')).toBeInTheDocument();
    expect(screen.getByText('10 data + 20 parity shards')).toBeInTheDocument();
    // once in the host list, once in the country bars
    expect(screen.getAllByText('Germany')).toHaveLength(2);
    expect(screen.getByText('20 sectors, 11 hosts')).toBeInTheDocument();
    expect(screen.getByText('1 shared')).toBeInTheDocument();
    expect(screen.getByText('Variant playlist')).toBeInTheDocument();
  });

  it('lists the real renditions', async () => {
    render();
    await screen.findByTestId('player');
    await userEvent.click(screen.getByRole('tab', { name: 'Renditions' }));
    const table = await screen.findByRole('table');
    expect(within(table).getByText('1280x720')).toBeInTheDocument();
    expect(within(table).getByText('3.5 Mbps')).toBeInTheDocument();
  });

  it('explains a failure plainly, keeps the raw error under details, and offers a retry', async () => {
    render(asset({ status: 'failed', manifest_object_id: null }));
    expect(await screen.findByText('Transcoding the video failed.')).toBeInTheDocument();
    expect(screen.queryByText('ffmpeg exited with code 1')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Details' }));
    expect(screen.getByText('ffmpeg exited with code 1')).toBeInTheDocument();
    expect(
      within(screen.getByRole('list', { name: 'Pipeline' })).getByText('Transcode'),
    ).toHaveTextContent('Transcode, failed');
    expect(screen.getByRole('button', { name: /retry processing/i })).toBeInTheDocument();
    expect(screen.queryByTestId('player')).not.toBeInTheDocument();
  });

  it('follows the new run after a retry instead of keeping "Processing failed"', async () => {
    let status = 'failed';
    const { server, client } = render(undefined, {
      '/api/v1/assets/a1': () => asset({ status, manifest_object_id: null }),
      '/api/v1/assets/a1/processing': () =>
        status === 'failed'
          ? failedJob
          : { ...failedJob, status: 'processing', stage: 'transcode', error_message: null },
      'POST /api/v1/assets/a1/retry': () => {
        status = 'processing';
        return { success: true, stage: 'transcode' };
      },
    });
    client.setQueryData(['assets', 'latest', 6], { data: [] });
    client.setQueryData(['stats'], {});
    await screen.findByText('Transcoding the video failed.');

    await userEvent.click(screen.getByRole('button', { name: /retry processing/i }));

    expect(await screen.findByText('Processing restarted from the transcode')).toBeInTheDocument();
    expect(await screen.findByText('Transcoding, 65%')).toBeInTheDocument();
    expect(screen.queryByText('Processing failed')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry processing/i })).not.toBeInTheDocument();
    expect(screen.getByRole('progressbar', { name: 'Processing progress' })).toBeInTheDocument();
    expect(client.getQueryState(['assets', 'latest', 6])?.isInvalidated).toBe(true);
    expect(client.getQueryState(['stats'])?.isInvalidated).toBe(true);
    const retryAt = server.calls.findIndex((c) => c.method === 'POST');
    expect(
      server.calls.slice(retryAt).some((c) => c.method === 'GET' && c.path === '/api/v1/assets/a1'),
    ).toBe(true);
  });

  it('switches to the player when the retried run finishes', async () => {
    let status = 'failed';
    render(undefined, {
      '/api/v1/assets/a1': () =>
        asset({ status, manifest_object_id: status === 'ready' ? 'master-1' : null }),
      '/api/v1/assets/a1/processing': () => failedJob,
      'POST /api/v1/assets/a1/retry': () => {
        // the run is quick: done by the time the page asks again
        status = 'ready';
        return { success: true, stage: 'upload-segments' };
      },
    });
    await screen.findByText('Transcoding the video failed.');
    await userEvent.click(screen.getByRole('button', { name: /retry processing/i }));
    expect(await screen.findByTestId('player')).toBeInTheDocument();
  });

  it('deletes, goes back to the library, and does not fetch the deleted asset again', async () => {
    const { server } = render(undefined, { 'DELETE /api/v1/assets/a1': { success: true } });
    await screen.findByTestId('player');

    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await screen.findByText('Library')).toBeInTheDocument();
    const deletedAt = server.calls.findIndex((c) => c.method === 'DELETE');
    expect(deletedAt).toBeGreaterThan(-1);
    // give a stray refetch the chance to happen
    await new Promise((r) => setTimeout(r, 50));
    expect(
      server.calls.slice(deletedAt + 1).filter((c) => c.path.startsWith('/api/v1/assets/a1')),
    ).toEqual([]);
  });

  it('refuses an empty title and trims what it saves', async () => {
    const { server, client } = render(undefined, {
      'PATCH /api/v1/assets/a1': ({ body }: { body: Record<string, unknown> }) =>
        asset({ title: body.title, description: body.description }),
    });
    client.setQueryData(['assets', 'latest', 6], { data: [] });
    await screen.findByTestId('player');
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    const title = within(dialog).getByLabelText('Title');

    await userEvent.clear(title);
    await userEvent.type(title, '   ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));
    expect(within(dialog).getByText('Enter a title.')).toBeInTheDocument();
    expect(title).toHaveAttribute('aria-invalid', 'true');
    expect(server.calls.some((c) => c.method === 'PATCH')).toBe(false);

    await userEvent.clear(title);
    await userEvent.type(title, '  New title  ');
    const description = within(dialog).getByLabelText('Description');
    await userEvent.clear(description);
    await userEvent.type(description, '  about it  ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(server.calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      title: 'New title',
      description: 'about it',
    });
    expect(await screen.findByRole('heading', { name: 'New title' })).toHaveAttribute(
      'title',
      'New title',
    );
    expect(client.getQueryState(['assets', 'latest', 6])?.isInvalidated).toBe(true);
  });

  it('does not poll a job that is not there', async () => {
    const { server } = render(asset({ status: 'created', manifest_object_id: null }), {
      '/api/v1/assets/a1/processing': reply(404, { error: 'No processing job found' }),
    });
    expect(await screen.findByText('Waiting for the upload to finish')).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 3_500));
    expect(server.calls.filter((c) => c.path.endsWith('/processing'))).toHaveLength(1);
  });

  it('words the delete dialog without a gap when the object count is not known', async () => {
    render(asset({ status: 'failed', manifest_object_id: null }));
    await screen.findByText('Processing failed');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    const text = within(dialog).getByText(/unpinned in the background/).textContent!;
    expect(text).not.toMatch(/ {2}/);
    expect(text).toContain('its Sia objects are unpinned');
  });

  it('counts the Sia objects in the delete dialog once they are known', async () => {
    const { client } = render();
    await waitFor(() => expect(client.getQueryData(['assets', 'sia', 'a1'])).toBeDefined());
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/its 2 Sia objects are unpinned/)).toBeInTheDocument();
  });

  it('lays the loading state out like the page, back link included', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise(() => {})),
    );
    renderPage(
      <Routes>
        <Route path="/studio/assets/:id" element={<AssetDetailPage />} />
      </Routes>,
      { route: '/studio/assets/a1' },
    );
    expect(await screen.findByRole('link', { name: 'Assets' })).toHaveAttribute(
      'href',
      '/studio/assets',
    );
    expect(await screen.findByTestId('asset-detail-skeleton')).toBeInTheDocument();
  });

  it('shows an edit at once and keeps it when the save lands', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const { server } = render(asset({ access_tier: 'public' }), {
      'PATCH /api/v1/assets/a1': async ({ body }: { body: Record<string, unknown> }) => {
        await held;
        return asset({ ...body, access_tier: body.accessTier ?? body.access_tier });
      },
    });
    await screen.findByTestId('player');
    expect(screen.queryByText('Private')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    const title = within(dialog).getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Renamed');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Access' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Private' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    // before the server has answered
    expect(await screen.findByRole('heading', { name: 'Renamed' })).toBeInTheDocument();
    expect(screen.getAllByText('Private').length).toBeGreaterThan(0);
    expect(screen.getByRole('status', { name: 'Saving' })).toBeInTheDocument();
    expect(server.calls.find((c) => c.method === 'PATCH')?.body).toMatchObject({
      title: 'Renamed',
      access_tier: 'private',
    });

    release();
    expect(await screen.findByText('Asset updated')).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Saving' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Renamed' })).toBeInTheDocument();
  });

  it('puts the old values back when a save fails, and reopens the form on what was typed', async () => {
    render(undefined, {
      'PATCH /api/v1/assets/a1': reply(500, { error: 'Database unavailable' }),
    });
    await screen.findByTestId('player');
    await userEvent.click(screen.getByRole('button', { name: 'Edit' }));
    const dialog = await screen.findByRole('dialog');
    const title = within(dialog).getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Doomed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Could not save: Database unavailable')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Big Buck Bunny' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Edit again' }));
    const again = await screen.findByRole('dialog');
    expect(within(again).getByLabelText('Title')).toHaveValue('Doomed');
  });

  it('reads the processing stage and percent in words, with the pipeline steps', async () => {
    render(asset({ status: 'processing', manifest_object_id: null }), {
      '/api/v1/assets/a1/processing': {
        ...failedJob,
        status: 'processing',
        stage: 'upload',
        error_message: null,
      },
    });
    expect(await screen.findByText('Storing on Sia, 65%')).toBeInTheDocument();
    const steps = screen.getByRole('list', { name: 'Pipeline' });
    expect(within(steps).getByText('Transcode')).toHaveTextContent('Transcode, done');
    expect(within(steps).getByText('Store on Sia')).toHaveTextContent('Store on Sia, in progress');
    expect(within(steps).getByText('Finalize')).toHaveTextContent('Finalize, pending');
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('stays busy while the delete runs instead of offering it again', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    render(undefined, {
      'DELETE /api/v1/assets/a1': async () => {
        await held;
        return { success: true };
      },
    });
    await screen.findByTestId('player');
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));

    expect(await within(dialog).findByRole('button', { name: 'Deleting...' })).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    release();
    expect(await screen.findByText('Library')).toBeInTheDocument();
  });

  it('opens the tab named in the url and keeps the choice there', async () => {
    renderAt('/studio/assets/a1?tab=renditions');
    expect(
      await screen.findByRole('tab', { name: 'Renditions', selected: true }),
    ).toBeInTheDocument();
    expect(within(await screen.findByRole('table')).getByText('1280x720')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('tab', { name: 'Sia storage' }));
    expect(screen.getByTestId('where')).toHaveTextContent('?tab=storage');
  });

  it('shows the shared page state for a missing asset, and a retry when loading failed', async () => {
    render(undefined, { '/api/v1/assets/a1': reply(404, { error: 'Video asset not found' }) });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Asset not found' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to assets' })).toHaveAttribute(
      'href',
      '/studio/assets',
    );
  });

  it('offers a retry and the server message when the asset did not load', async () => {
    render(undefined, { '/api/v1/assets/a1': reply(500, { error: 'Database unavailable' }) });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Could not load this asset' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Database unavailable')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
