import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useLocation } from 'react-router';
import { describe, expect, it } from 'vitest';
import { createUploadStore } from '@/lib/upload-store';
import { fakeUploadClient } from '@/test/fake-uploads';
import { renderPage } from '@/test/render';
import { UploadIndicator } from './UploadIndicator';

const file = new File([new Uint8Array(100)], 'clip.mp4', { type: 'video/mp4', lastModified: 1 });

function Where() {
  const { pathname, search } = useLocation();
  return <p data-testid="where">{pathname + search}</p>;
}

function setup() {
  const f = fakeUploadClient();
  const store = createUploadStore(f.client, { unloadTarget: null });
  renderPage(
    <>
      <UploadIndicator store={store} />
      <Where />
    </>,
    { route: '/studio/videos?status=ready' },
  );
  return { f, store };
}

describe('UploadIndicator', () => {
  it('stays out of the way with nothing uploading', () => {
    setup();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('follows a transfer live and opens the upload sheet on this page', async () => {
    const { f, store } = setup();
    act(() => {
      store.start(file, { title: 'Keynote' });
      f.current().progress(42, 100);
    });
    const button = screen.getByRole('button', { name: 'Uploading Keynote, 42%. Open uploads' });
    expect(button).toHaveTextContent('42%');

    act(() => f.current().progress(80, 100));
    expect(screen.getByRole('button', { name: /Uploading Keynote, 80%/ })).toBeInTheDocument();

    await userEvent.click(button);
    expect(screen.getByTestId('where')).toHaveTextContent('/studio/videos?status=ready&upload=1');
  });

  it('says when the transfer is paused', async () => {
    const { f, store } = setup();
    const key = store.start(file, { title: 'Keynote' });
    act(() => f.current().progress(30, 100));
    await act(() => store.pause(key));
    expect(
      screen.getByRole('button', { name: 'Keynote is paused at 30%. Open uploads' }),
    ).toHaveTextContent('Paused');
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
      screen.getByRole('button', { name: /^2 uploads in progress or queued\. Uploading Keynote/ }),
    ).toHaveTextContent('2');
  });

  it('goes away when the upload fails', async () => {
    const { f, store } = setup();
    act(() => {
      store.start(file, { title: 'Keynote' });
    });
    expect(screen.getByRole('button')).toBeInTheDocument();
    await act(async () => f.current().fail(new Error('gone')));
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
