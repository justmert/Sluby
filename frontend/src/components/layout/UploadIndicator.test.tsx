import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { createUploadStore } from '@/lib/upload-store';
import { fakeUploadClient } from '@/test/fake-uploads';
import { renderPage } from '@/test/render';
import { UploadIndicator } from './UploadIndicator';

const file = new File([new Uint8Array(100)], 'clip.mp4', { type: 'video/mp4', lastModified: 1 });

function setup() {
  const f = fakeUploadClient();
  const store = createUploadStore(f.client, { unloadTarget: null });
  renderPage(<UploadIndicator store={store} />, { route: '/studio/assets' });
  return { f, store };
}

describe('UploadIndicator', () => {
  it('stays out of the way with nothing uploading', () => {
    setup();
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });

  it('follows a transfer live and links to the upload page', () => {
    const { f, store } = setup();
    act(() => {
      store.start(file, { title: 'Keynote' });
      f.current().progress(42, 100);
    });
    const link = screen.getByRole('link', { name: 'Uploading Keynote, 42%. Open uploads' });
    expect(link).toHaveAttribute('href', '/studio/upload');
    expect(link).toHaveTextContent('42%');

    act(() => f.current().progress(80, 100));
    expect(screen.getByRole('link', { name: /Uploading Keynote, 80%/ })).toBeInTheDocument();
  });

  it('says when the transfer is paused', async () => {
    const { f, store } = setup();
    const key = store.start(file, { title: 'Keynote' });
    act(() => f.current().progress(30, 100));
    await act(() => store.pause(key));
    expect(
      screen.getByRole('link', { name: 'Keynote is paused at 30%. Open uploads' }),
    ).toHaveTextContent('Paused');
  });

  it('goes away when the upload fails', async () => {
    const { f, store } = setup();
    act(() => {
      store.start(file, { title: 'Keynote' });
    });
    expect(screen.getByRole('link')).toBeInTheDocument();
    await act(async () => f.current().fail(new Error('gone')));
    expect(screen.queryByRole('link')).not.toBeInTheDocument();
  });
});
