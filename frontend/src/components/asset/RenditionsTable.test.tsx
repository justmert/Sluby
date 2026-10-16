import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkValue, findOperation, responseSchema } from '@/test/openapi';
import { jsonFetch, renderPage, reply } from '@/test/render';
import { RenditionsTable } from './RenditionsTable';

const r720 = {
  name: '720p',
  width: 1280,
  height: 720,
  video_bitrate_kbps: 3500,
  segment_count: 1204,
  byte_size: 4_200_000,
  data_object_id: 'd'.repeat(64),
  playlist_object_id: 'p'.repeat(64),
};
const listOp = findOperation('GET', '/api/v1/assets/a1/renditions')!;

afterEach(() => vi.unstubAllGlobals());

function serve(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(jsonFetch({ '/api/v1/assets/a1/renditions': body })));
  renderPage(<RenditionsTable assetId="a1" />);
}

describe('RenditionsTable', () => {
  it('uses a fixture that matches the documented shape', () => {
    expect(checkValue({ data: [r720] }, responseSchema(listOp)!)).toEqual([]);
  });

  it('lists each quality with plain column names and units', async () => {
    serve({ data: [r720] });
    const table = await screen.findByRole('table', { name: 'Renditions' });
    await within(table).findByText('720p');
    expect(within(table).getByText('1280 × 720')).toBeInTheDocument();
    expect(within(table).getByText('3.5 Mbps')).toBeInTheDocument();
    expect(within(table).getByText('1,204')).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Playlist file' })).toBeInTheDocument();
    expect(within(table).getByRole('columnheader', { name: 'Video file' })).toBeInTheDocument();
    expect(
      within(table).getByRole('button', { name: 'Copy video file ID for 720p' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('The qualities made from your video, up to its original resolution'),
    ).toBeInTheDocument();
  });

  it('hides bitrate and segments first when the page is narrow (A11Y-30)', async () => {
    serve({ data: [r720] });
    const cell = (await screen.findByText('3.5 Mbps')).closest('td')!;
    expect(cell.className).toContain('hidden');
    expect(cell.className).toContain('@3xl/page:table-cell');
  });

  it('explains an empty list', async () => {
    serve({ data: [] });
    expect(await screen.findByText('No quality list')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Videos uploaded before this was recorded show their files on the Sia storage tab.',
      ),
    ).toBeInTheDocument();
  });

  it('offers Try again when the list does not load (CPY-19)', async () => {
    serve(reply(500, { error: 'boom' }));
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Could not load the quality list')).toBeInTheDocument();
    expect(within(alert).queryByText('boom')).not.toBeVisible();
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
  });
});
