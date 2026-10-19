import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes, useLocation } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { uploadStore } from '@/lib/studio-upload';
import { useOpenUpload } from '@/lib/upload-page';
import type { fakeUploadClient } from '@/test/fake-uploads';
import { renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import UploadPage from './UploadPage';

// the page runs on the studio's shared store; here it gets one on a fake sdk
// whose transfers the test drives by hand
const fake = vi.hoisted(() => ({ client: null as ReturnType<typeof fakeUploadClient> | null }));
vi.mock('@/lib/studio-upload', async () => {
  const { fakeUploadClient } = await import('@/test/fake-uploads');
  const { createUploadStore } = await import('@/lib/upload-store');
  const { createUploadTabs } = await import('@/lib/upload-tabs');
  fake.client = fakeUploadClient();
  return {
    uploadStore: createUploadStore(fake.client.client, { unloadTarget: null, onlineTarget: null }),
    uploadTabs: createUploadTabs({ channel: null, locks: null, pageTarget: null }),
  };
});

const video = (name: string) =>
  new File([new Uint8Array(4_000_000)], name, { type: 'video/mp4', lastModified: 1 });

// the videos page's drop, as AssetsPage hands it over
function VideosPage() {
  const open = useOpenUpload();
  return (
    <button type="button" onClick={() => open([video('launch_keynote.mp4'), video('intro.mov')])}>
      drop two files
    </button>
  );
}

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

function render(route: string) {
  return renderPage(
    <WithSession>
      <Routes>
        <Route path="/studio/videos" element={<VideosPage />} />
        <Route path="/studio/videos/upload" element={<UploadPage />} />
      </Routes>
      <Where />
    </WithSession>,
    { route },
  );
}

const filesList = () => screen.getByRole('region', { name: 'Files' });
const draftRow = (name: string) =>
  within(filesList()).getByText(name, { selector: 'span' }).closest('button')!;

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  // the store outlives a test, as it outlives a page; empty it for the next
  for (const d of uploadStore.getState().drafts) uploadStore.removeDraft(d.id);
});

describe('UploadPage', () => {
  it('has its own header, a way back to videos, and starts on Choose files', () => {
    render('/studio/videos/upload');
    expect(screen.getByRole('heading', { level: 1, name: 'Upload videos' })).toBeInTheDocument();
    expect(
      screen.getByText(
        'Uploads keep going if you leave this page. Finished videos show up in Videos.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to videos' })).toHaveAttribute(
      'href',
      '/studio/videos',
    );
    expect(screen.getByRole('button', { name: 'Choose files' })).toHaveFocus();
    // nothing picked yet: no list and no details
    expect(screen.queryByRole('region', { name: 'Files' })).not.toBeInTheDocument();
  });

  it('lands files dropped on the videos page here as drafts, the first one selected', async () => {
    render('/studio/videos');
    await userEvent.click(screen.getByRole('button', { name: 'drop two files' }));
    expect(screen.getByTestId('where')).toHaveTextContent('/studio/videos/upload');

    expect(within(filesList()).getByText('2 new')).toBeInTheDocument();
    expect(draftRow('launch_keynote.mp4')).toHaveAttribute('aria-current', 'true');
    expect(draftRow('intro.mov')).not.toHaveAttribute('aria-current');
    // the selected draft's title takes focus, ready to type over
    const title = screen.getByLabelText('Title');
    expect(title).toHaveValue('launch keynote');
    await waitFor(() => expect(title).toHaveFocus());

    const details = screen.getByRole('region', { name: 'launch_keynote.mp4' });
    expect(details).toHaveTextContent('4 MB');
    expect(within(details).getByLabelText('Description optional')).toHaveValue('');
    expect(within(details).getByRole('radiogroup', { name: 'Who can watch' })).toBeInTheDocument();
    expect(
      within(within(details).getByRole('list', { name: 'What happens next' }))
        .getAllByRole('listitem')
        .map((li) => li.textContent),
    ).toEqual(['Upload', 'Transcode', 'Store on Sia', 'Publish']);
  });

  it('starts the selected draft with its details, and the upload keeps going after leaving', async () => {
    render('/studio/videos');
    await userEvent.click(screen.getByRole('button', { name: 'drop two files' }));
    const title = screen.getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Launch keynote');
    await userEvent.type(screen.getByLabelText('Description optional'), 'The 2026 launch');
    await userEvent.click(screen.getByRole('radio', { name: 'Private' }));
    await userEvent.click(screen.getByRole('button', { name: 'Start upload' }));

    const f = fake.client!;
    expect(f.upload).toHaveBeenCalledTimes(1);
    expect(f.upload.mock.calls[0][1]).toMatchObject({
      title: 'Launch keynote',
      description: 'The 2026 launch',
      accessTier: 'private',
    });
    // the started file is uploading in the list; the other one is selected now
    const row = await within(filesList()).findByTestId('upload-row');
    expect(within(row).getByRole('heading', { name: 'Launch keynote' })).toBeInTheDocument();
    await waitFor(() =>
      expect(within(row).getByRole('heading', { name: 'Launch keynote' })).toHaveFocus(),
    );
    expect(draftRow('intro.mov')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByLabelText('Title')).toHaveValue('intro');
    expect(within(filesList()).getByText('1 uploading · 1 new')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Back to videos' }));
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/studio\/videos$/);
    act(() => f.current().progress(2_000_000, 4_000_000));
    expect(uploadStore.getState().uploads[0]).toMatchObject({
      phase: 'uploading',
      bytesUploaded: 2_000_000,
    });
  });
});
