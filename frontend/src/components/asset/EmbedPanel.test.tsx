import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PlaybackId } from '@sluby/sdk';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, renderPage, reply } from '@/test/render';
import { EmbedPanel } from './EmbedPanel';

const ORIGIN = window.location.origin;
const PB_OPEN = 'pb_ooooooooooooooooooooo';
const PB_SIGNED = 'pb_sssssssssssssssssssss';

const wire = (playbackId: string, policy: string, name: string | null) => ({
  id: `00000000-0000-4000-8000-${playbackId.slice(-12)}`,
  playback_id: playbackId,
  policy,
  name,
  created_at: '2026-10-01T00:00:00Z',
});

const publicVideo = { id: 'a1', accessTier: 'public', status: 'ready' } as const;
const privateVideo = { id: 'a1', accessTier: 'private', status: 'ready' } as const;

function server(
  list: unknown = {
    data: [wire(PB_OPEN, 'public', 'Site embed'), wire(PB_SIGNED, 'signed', null)],
  },
) {
  const stub = jsonFetch({ '/api/v1/assets/a1/playback-ids': list });
  vi.stubGlobal('fetch', vi.fn(stub));
  return stub;
}

const tabs = () => screen.getAllByRole('tab').map((t) => t.textContent);
const code = () => screen.getByRole('tabpanel').textContent ?? '';

afterEach(() => vi.unstubAllGlobals());

describe('EmbedPanel', () => {
  it('offers React, HTML and the stream URL for a public video, with this video ID', async () => {
    server();
    renderPage(<EmbedPanel asset={publicVideo} />);
    expect(screen.getByRole('combobox', { name: 'Play by' })).toHaveTextContent('Video ID');
    expect(tabs()).toEqual(['React', 'HTML', 'Stream URL']);
    expect(code()).toContain("sluby.playback.streamUrl('a1')");
    expect(screen.getByText('npm install @sluby/player @sluby/sdk')).toBeInTheDocument();
    expect(screen.getByText('Public video: anyone with the code can play it.')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'Stream URL' }));
    expect(code()).toBe(`${ORIGIN}/v1/stream/a1/master.m3u8`);
    // nothing to install for a plain url
    expect(screen.queryByText('npm install @sluby/player @sluby/sdk')).toBeNull();
  });

  it('starts a private video on the server code that signs its URLs', () => {
    server();
    renderPage(<EmbedPanel asset={privateVideo} />);
    expect(tabs()).toEqual(['Server', 'React', 'HTML']);
    expect(code()).toContain("sluby.playback.getSignedUrl('a1'");
    expect(code()).toContain('process.env.SLUBY_API_KEY');
    expect(
      screen.getByText(
        /Private videos play only through signed URLs\. Your server creates them with an API key\. Never put a key in browser code\./,
      ),
    ).toBeInTheDocument();
  });

  it('plays by a playback ID, and a signed one switches to the signing samples', async () => {
    server();
    renderPage(<EmbedPanel asset={publicVideo} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Play by' }));
    const options = await screen.findAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Video ID',
      'Site embed',
      `${PB_SIGNED} · Signed URL`,
    ]);
    await userEvent.click(screen.getByRole('option', { name: 'Site embed' }));
    expect(code()).toContain(`sluby.playback.streamUrl('${PB_OPEN}')`);
    expect(tabs()).toEqual(['React', 'HTML', 'Stream URL']);

    await userEvent.click(screen.getByRole('combobox', { name: 'Play by' }));
    await userEvent.click(await screen.findByRole('option', { name: `${PB_SIGNED} · Signed URL` }));
    expect(tabs()).toEqual(['Server', 'React', 'HTML']);
    expect(code()).toContain(`getSignedUrl('${PB_SIGNED}'`);
    expect(
      screen.getByText(/This playback ID plays only through signed URLs\./),
    ).toBeInTheDocument();
  });

  it('keeps the chosen tab when it still applies', async () => {
    server();
    renderPage(<EmbedPanel asset={publicVideo} />);
    await userEvent.click(screen.getByRole('tab', { name: 'HTML' }));
    await userEvent.click(screen.getByRole('combobox', { name: 'Play by' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Site embed' }));
    expect(screen.getByRole('tab', { name: 'HTML' })).toHaveAttribute('aria-selected', 'true');
    expect(code()).toContain(`/v1/stream/${PB_OPEN}/master.m3u8`);
  });

  it('copies the code on screen', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    server();
    renderPage(<EmbedPanel asset={publicVideo} />);
    await userEvent.click(screen.getByRole('tab', { name: 'Stream URL' }));
    await userEvent.click(screen.getByRole('button', { name: 'Copy embed code (Stream URL)' }));
    expect(writeText).toHaveBeenCalledWith(`${ORIGIN}/v1/stream/a1/master.m3u8`);
  });

  it('uses the playback IDs the page passes instead of loading them', async () => {
    const stub = server();
    const given: PlaybackId[] = [
      { id: 'r1', playbackId: PB_OPEN, policy: 'public', name: 'Partner', createdAt: '' },
    ];
    renderPage(<EmbedPanel asset={publicVideo} playbackIds={given} />);
    await userEvent.click(screen.getByRole('combobox', { name: 'Play by' }));
    expect(await screen.findByRole('option', { name: 'Partner' })).toBeInTheDocument();
    expect(stub.calls).toEqual([]);
  });

  it('says why there is no code before the video is ready, and loads nothing', () => {
    const stub = server();
    renderPage(<EmbedPanel asset={{ ...publicVideo, status: 'processing' }} />);
    expect(screen.getByText('Available once the video is ready.')).toBeInTheDocument();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(stub.calls).toEqual([]);
  });

  it('still embeds by video ID when the playback IDs fail to load', async () => {
    server(reply(500, { error: 'Database unavailable' }));
    renderPage(<EmbedPanel asset={publicVideo} />);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Could not load playback IDs')).toBeInTheDocument();
    // the reader's sentence on the main line; the server's own words only under Details
    expect(within(alert).getByText(/The server ran into a problem/)).toBeInTheDocument();
    expect(code()).toContain("streamUrl('a1')");
  });

  it('links the API reference in a new tab', () => {
    server();
    renderPage(<EmbedPanel asset={publicVideo} />);
    const link = screen.getByRole('link', { name: /API reference/ });
    expect(link).toHaveAttribute('href', '/api/v1/docs');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAccessibleName(/^API reference ?\(opens in a new tab\)$/);
  });
});
