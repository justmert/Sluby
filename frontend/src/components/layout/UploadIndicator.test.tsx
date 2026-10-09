import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { SlubyError } from '@sluby/sdk';
import { findUpload } from '@/lib/upload-history';
import { createUploadStore } from '@/lib/upload-store';
import { fileFingerprint } from '@/lib/upload-tabs';
import { fakeUploadClient } from '@/test/fake-uploads';
import { renderPage } from '@/test/render';
import { testSession, WithSession } from '@/test/session';
import { job } from '@/test/upload-state';
import { UploadIndicator } from './UploadIndicator';

const file = new File([new Uint8Array(100)], 'clip.mp4', { type: 'video/mp4', lastModified: 1 });

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function setup(route = '/studio/videos?status=ready') {
  const f = fakeUploadClient();
  const store = createUploadStore(f.client, { unloadTarget: null, onlineTarget: null });
  renderPage(
    <WithSession>
      <UploadIndicator store={store} />
      <Where />
    </WithSession>,
    { route },
  );
  return { f, store };
}

describe('UploadIndicator', () => {
  it('always offers Upload video, which opens the sheet on this page', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Upload video' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/studio/videos?status=ready&upload=1');
    expect(screen.queryByRole('button', { name: /go to uploads/i })).not.toBeInTheDocument();
  });

  it('follows a transfer with a ring, and opens a tray of uploads', async () => {
    const { f, store } = setup();
    act(() => {
      store.start(file, { title: 'Keynote' });
      f.current().progress(42, 100);
    });
    const ring = screen.getByRole('button', { name: 'Keynote: Uploading, 42%. Go to uploads' });
    // the figure is drawn beside the button that covers it
    expect(ring.parentElement).toHaveTextContent('42%');

    act(() => f.current().progress(80, 100));
    expect(screen.getByRole('button', { name: /Keynote: Uploading, 80%/ })).toBeInTheDocument();

    await userEvent.click(ring);
    const tray = await screen.findByRole('dialog', { name: 'Uploads' });
    expect(within(tray).getByText('Keynote')).toBeInTheDocument();
    await userEvent.click(within(tray).getByRole('button', { name: 'Open uploads' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/studio/videos?status=ready&upload=1');
  });

  it('says when the transfer is paused, and announces it once', async () => {
    const { f, store } = setup();
    const key = store.start(file, { title: 'Keynote' });
    act(() => f.current().progress(30, 100));
    await act(() => store.pause(key));
    expect(
      screen.getByRole('button', { name: 'Keynote: Paused at 30%. Go to uploads' }).parentElement,
    ).toHaveTextContent('Paused');
    expect(screen.getByRole('status')).toHaveTextContent('“Keynote”: Paused');
  });

  it('counts files waiting in the queue', () => {
    const { f, store } = setup();
    const other = new File([new Uint8Array(50)], 'b.mp4', { type: 'video/mp4', lastModified: 2 });
    act(() => {
      store.enqueue(file, { title: 'Keynote' });
      store.enqueue(other, { title: 'Second' });
      f.current().progress(10, 100);
    });
    expect(
      screen.getByRole('button', { name: /^2 uploads in progress\. Keynote: Uploading, 10%/ })
        .parentElement,
    ).toHaveTextContent('2');
  });

  it('toasts a failed upload once, wherever the user is', async () => {
    const { f, store } = setup();
    act(() => {
      store.start(file, { title: 'Keynote' });
    });
    await act(async () => f.current().fail(new SlubyError('Bad request', 400)));
    expect(screen.queryByRole('button', { name: /go to uploads/i })).not.toBeInTheDocument();
    expect(await screen.findByText(/^“Keynote” failed\. Bad request\.$/)).toBeInTheDocument();
  });

  it('toasts a ready video with its embed code, and remembers the file', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const { f, store } = setup();
    f.processing
      .mockResolvedValueOnce(job())
      .mockResolvedValue(job({ status: 'completed', stage: 'completed' }));
    act(() => {
      store.start(file, { title: 'Keynote' });
    });
    await act(async () => {
      f.current().resolveAsset('a1');
      f.current().finish();
    });
    expect(findUpload(fileFingerprint(file), testSession.id)).toMatchObject({
      assetId: 'a1',
      title: 'Keynote',
    });
    expect(
      await screen.findByText('“Keynote” is ready', {}, { timeout: 4_000 }),
    ).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Copy embed code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('a1')));
  });

  it('says where a resumed upload continued from, once the sdk sent bytes', async () => {
    const { f, store } = setup();
    act(() => {
      store.enqueue(file, { title: 'Keynote', resumeUploadId: 'up-1' });
    });
    await act(async () => f.current().resolveUpload('up-1'));
    act(() => f.current().progress(40, 100));
    expect(await screen.findByText('Continuing “Keynote” from 40%')).toBeInTheDocument();
  });

  it('says a failure in the live region instead of a toast while the sheet shows the row', async () => {
    const { f, store } = setup('/studio/videos?upload=1');
    act(() => {
      store.start(file, { title: 'Keynote' });
    });
    await act(async () => f.current().fail(new SlubyError('Bad request', 400)));
    expect(screen.getByRole('status')).toHaveTextContent('“Keynote” failed. Bad request.');
    expect(
      screen.queryByText(/^“Keynote” failed/, { selector: '[data-title]' }),
    ).not.toBeInTheDocument();
  });

  it('shows a dropped connection as offline, without a failure toast', async () => {
    const f = fakeUploadClient();
    const store = createUploadStore(f.client, {
      unloadTarget: null,
      onlineTarget: null,
      isOnline: () => false,
    });
    renderPage(
      <WithSession>
        <UploadIndicator store={store} />
      </WithSession>,
    );
    act(() => {
      store.start(file, { title: 'Keynote' });
    });
    await act(async () => f.current().fail(new SlubyError('Upload failed: network', 0)));
    expect(screen.getByRole('status')).toHaveTextContent('“Keynote”: Offline');
    expect(screen.queryByText(/failed/)).not.toBeInTheDocument();
  });
});
