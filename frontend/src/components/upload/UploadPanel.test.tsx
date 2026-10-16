import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SlubyError } from '@sluby/sdk';
import { jsonFetch, renderPage, reply } from '@/test/render';
import { fakeUploadClient } from '@/test/fake-uploads';
import { fakeBus, fakeLocks } from '@/test/fake-tabs';
import { WithSession, testSession } from '@/test/session';
import { job } from '@/test/upload-state';
import { findUpload, recordUpload } from '@/lib/upload-history';
import { createUploadStore, type UploadStoreOptions } from '@/lib/upload-store';
import { createUploadTabs, fileFingerprint, type UploadTabs } from '@/lib/upload-tabs';
import { UploadPanel } from './UploadPanel';

// the asset list hooks watch the shared store for changes; each test hands
// the panel its own
vi.mock('@/lib/studio-upload', async () => {
  const { fakeUploadClient } = await import('@/test/fake-uploads');
  const { createUploadStore } = await import('@/lib/upload-store');
  return { uploadStore: createUploadStore(fakeUploadClient().client, { unloadTarget: null }) };
});

// a video as the api sends it
const oldVideo = (id: string) => ({
  id,
  title: 'Teaser',
  description: '',
  manifest_object_id: 'm',
  thumbnail_object_ids: [],
  duration_ms: 1000,
  resolution: '1280x720',
  status: 'ready',
  access_tier: 'public',
  creator_address: 'github:dev',
  segment_count: 1,
  total_storage_bytes: 1000,
  play_count: 0,
  last_played_at: null,
  created_at: '2026-10-01T00:00:00Z',
  updated_at: '2026-10-01T00:00:00Z',
});

const video = (name = 'my_trip-video.mp4', size = 20 * 1024 * 1024, lastModified = 1700000000000) =>
  new File([new Uint8Array(size)], name, { type: 'video/mp4', lastModified });

function setup({
  routes = {},
  options = {},
  tabs = createUploadTabs({ channel: null, locks: null, pageTarget: null }),
}: {
  routes?: Record<string, unknown>;
  options?: UploadStoreOptions;
  tabs?: UploadTabs;
} = {}) {
  const server = jsonFetch(routes);
  vi.stubGlobal('fetch', vi.fn(server));
  const f = fakeUploadClient();
  const store = createUploadStore(f.client, { unloadTarget: null, onlineTarget: null, ...options });
  const view = renderPage(
    <WithSession>
      <UploadPanel store={store} tabs={tabs} />
    </WithSession>,
  );
  return { f, store, server, view, tabs };
}

const chooseFiles = () => screen.getByRole('button', { name: 'Choose files' });
const drop = (...files: File[]) =>
  fireEvent.drop(screen.getByTestId('drop-zone'), { dataTransfer: { files } });
const files = () => screen.getByRole('region', { name: 'Files' });
// a draft's row in the file list, by its file name
const draftRow = (name: string) =>
  within(files()).getByText(name, { selector: 'span' }).closest('button')!;

async function startUpload(file = video()) {
  drop(file);
  await userEvent.click(screen.getByRole('button', { name: 'Start upload' }));
}

afterEach(() => vi.unstubAllGlobals());

describe('upload page: picking and starting', () => {
  it('takes a dropped video, prefills and selects the title, and starts a tus upload', async () => {
    const { f } = setup();
    const file = video();
    drop(file);

    const title = screen.getByLabelText('Title');
    expect(title).toHaveValue('my trip video');
    // A11Y-13: focus lands on the title, ready to type over
    await waitFor(() => expect(title).toHaveFocus());
    expect((title as HTMLInputElement).selectionEnd).toBe('my trip video'.length);
    // the file is listed as new and selected, with its details beside the list
    expect(draftRow('my_trip-video.mp4')).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('region', { name: 'my_trip-video.mp4' })).toHaveTextContent(
      'What happens next',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Start upload' }));

    expect(f.upload).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ title: 'my trip video', accessTier: 'public' }),
    );
    act(() => f.current().progress(10 * 1000 * 1000, 20 * 1024 * 1024));
    const row = screen.getByTestId('upload-row');
    expect(within(row).getByText(/^10 of 21 MB/)).toBeInTheDocument();
    // the running bar carries a sheen and the chip a pulsing dot, only while it runs
    expect(
      within(row)
        .getByRole('progressbar', { name: 'my trip video upload' })
        .querySelector('[data-slot="progress-indicator"]'),
    ).toHaveAttribute('data-moving', 'true');
    expect(
      within(row).getByText('Uploading').querySelector('[data-slot="status-dot"]'),
    ).not.toBeNull();
    expect(within(files()).getByText('1 uploading')).toBeInTheDocument();
    expect(within(row).getByRole('button', { name: 'Pause' })).toBeInTheDocument();
    // A11Y-13: after Upload, focus is on the new row's heading
    await waitFor(() =>
      expect(within(row).getByRole('heading', { name: 'my trip video' })).toHaveFocus(),
    );
    // the drop zone stays, and says that new files wait their turn
    expect(chooseFiles()).toHaveAccessibleDescription(/wait until the current upload finishes/);
    // the started draft left the details
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
  });

  it('describes Choose files with the drop zone title, the formats and the limit (A11Y-33)', async () => {
    setup({ options: { readLimit: async () => 12_000_000_000 } });
    expect(chooseFiles()).toHaveAccessibleDescription(
      'Drop video files here MP4, MOV, M4V, MKV, WebM or AVI. Add as many as you like.',
    );
    await waitFor(() =>
      expect(chooseFiles()).toHaveAccessibleDescription(
        'Drop video files here MP4, MOV, M4V, MKV, WebM or AVI, up to 12 GB each. Add as many as you like.',
      ),
    );
  });

  it('skips files that are not videos and files that are empty (FLW-46)', async () => {
    setup();
    drop(
      new File(['x'], 'notes.pdf', { type: 'application/pdf' }),
      new File(['y'], 'b.txt', { type: 'text/plain' }),
      new File([], 'empty.mp4', { type: 'video/mp4' }),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      '2 files were skipped because they are not videos: notes.pdf, b.txt. empty.mp4 is empty and was skipped.',
    );
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
  });

  it('lists several files, shows the one picked, removes one, and uploads the rest in order', async () => {
    const { f } = setup();
    drop(video('a.mp4'), video('b_two.mp4'), video('c.mp4'));
    expect(within(files()).getByText('3 new')).toBeInTheDocument();
    // the first is selected; picking another shows its own details
    expect(screen.getByLabelText('Title')).toHaveValue('a');
    await userEvent.click(draftRow('b_two.mp4'));
    expect(draftRow('b_two.mp4')).toHaveAttribute('aria-current', 'true');
    expect(draftRow('b_two.mp4')).toHaveTextContent(
      /^b_two\.mp4New · .+Add a title, then start the upload\.$/,
    );
    expect(draftRow('a.mp4')).not.toHaveAttribute('aria-current');
    expect(screen.getByLabelText('Title')).toHaveValue('b two');
    await userEvent.click(draftRow('c.mp4'));
    await userEvent.click(screen.getByRole('button', { name: 'Remove file' }));
    await waitFor(() => expect(within(files()).queryByText('c.mp4')).not.toBeInTheDocument());
    // the one before it is shown, and focus stays in the list
    await waitFor(() => expect(draftRow('b_two.mp4')).toHaveFocus());
    expect(screen.getByLabelText('Title')).toHaveValue('b two');
    // access belongs to each file
    await userEvent.click(screen.getByRole('radio', { name: 'Private' }));
    await userEvent.click(screen.getByRole('button', { name: 'Upload 2 videos' }));

    expect(f.upload).toHaveBeenCalledTimes(1);
    expect(f.upload.mock.calls[0][1]).toMatchObject({ title: 'a', accessTier: 'public' });
    expect(await screen.findByText('Uploading 2 videos, one at a time')).toBeInTheDocument();
    const queuedRow = within(files()).getByRole('heading', { name: 'b two' }).closest('li')!;
    expect(within(queuedRow).getByText('Queued, 2nd')).toBeInTheDocument();
    expect(queuedRow).toHaveTextContent('Starts when a finishes.');

    f.processing.mockResolvedValue(job());
    act(() => {
      f.current().resolveAsset('a1');
      f.current().finish();
    });
    await waitFor(() => expect(f.upload).toHaveBeenCalledTimes(2));
    expect(f.upload.mock.calls[1][1]).toMatchObject({ title: 'b two', accessTier: 'private' });
  });

  it('queues a file added while another uploads, and takes it back out', async () => {
    const { f } = setup();
    await startUpload(video('first.mp4'));
    drop(video('second.mp4'));
    await userEvent.click(screen.getByRole('button', { name: 'Start upload' }));
    expect(f.upload).toHaveBeenCalledTimes(1);
    expect(await screen.findByText('1 video queued after the current upload')).toBeInTheDocument();
    expect(within(files()).getByText('1 uploading · 1 queued')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Remove second from the queue' }));
    await waitFor(() =>
      expect(within(files()).queryByRole('heading', { name: 'second' })).not.toBeInTheDocument(),
    );
  });

  it('asks for a title inline instead of uploading an untitled video', async () => {
    const { f } = setup();
    drop(video());
    await userEvent.clear(screen.getByLabelText('Title'));
    await userEvent.click(screen.getByRole('button', { name: 'Start upload' }));
    expect(screen.getByText('Enter a title.')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByLabelText('Title')).toHaveFocus());
    expect(f.upload).not.toHaveBeenCalled();
  });

  it('describes each access choice and keeps it a real radio group (A11Y-36)', () => {
    setup();
    drop(video());
    const group = screen.getByRole('radiogroup', { name: 'Who can watch' });
    expect(within(group).getByRole('radio', { name: 'Public' })).toBeChecked();
    expect(within(group).getByRole('radio', { name: 'Private' })).toHaveAccessibleDescription(
      'Only with signed links',
    );
  });

  it('counts the description from 4,500 characters and stops at 5,000 (FLW-30)', async () => {
    setup();
    drop(video());
    const field = screen.getByLabelText('Description optional');
    expect(field).toHaveAttribute('maxLength', '5000');
    fireEvent.change(field, { target: { value: 'x'.repeat(4_812) } });
    expect(screen.getByText('4,812 of 5,000')).toBeInTheDocument();
  });

  it('sends each draft with its own description', async () => {
    const { f } = setup();
    drop(video('a.mp4'), video('b.mp4'));
    fireEvent.change(screen.getByLabelText('Description optional'), {
      target: { value: '  About a  ' },
    });
    await userEvent.click(draftRow('b.mp4'));
    expect(screen.getByLabelText('Description optional')).toHaveValue('');
    await userEvent.click(draftRow('a.mp4'));
    await userEvent.click(screen.getByRole('button', { name: 'Start upload' }));
    expect(f.upload.mock.calls[0][1]).toMatchObject({ title: 'a', description: 'About a' });
    // b is shown next, still new
    expect(screen.getByLabelText('Title')).toHaveValue('b');
  });

  it('keeps drafts when the page is left and opened again', () => {
    const { store, view } = setup();
    drop(video());
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Kept' } });
    view.unmount();
    renderPage(
      <WithSession>
        <UploadPanel
          store={store}
          tabs={createUploadTabs({ channel: null, locks: null, pageTarget: null })}
        />
      </WithSession>,
    );
    expect(screen.getByLabelText('Title')).toHaveValue('Kept');
  });
});

describe('upload page: typing straight after picking', () => {
  it('keeps every keystroke typed the moment the title appears', async () => {
    setup();
    drop(video('clip.mp4'));
    // no waiting and no delay between keys, as autofill or a fast typist:
    // the title must already have focus, with its text selected
    await userEvent.setup({ delay: null }).keyboard('Teaser cut');
    // let any late focus or select attempt run
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(screen.getByLabelText('Title')).toHaveValue('Teaser cut');
    expect(screen.getByLabelText('Title')).toHaveFocus();
  });

  it('never takes focus away from a field the person is typing in', async () => {
    setup();
    drop(video('a.mp4'), video('b.mp4'));
    await userEvent.click(draftRow('b.mp4'));
    const second = screen.getByLabelText('Title');
    await userEvent.click(second);
    await userEvent.keyboard('{End} two');
    // a second drop while typing adds a draft but leaves focus, text and the details alone
    drop(video('c.mp4'));
    await userEvent.keyboard(' more');
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(second).toHaveFocus();
    expect(second).toHaveValue('b two more');
    expect(draftRow('b.mp4')).toHaveAttribute('aria-current', 'true');
    // the new one waits in the list, and its title takes focus once it is picked
    await userEvent.click(draftRow('c.mp4'));
    expect(screen.getByLabelText('Title')).toHaveValue('c');
    expect(screen.getByLabelText('Title')).toHaveFocus();
  });
});

describe('upload page: limits, history and other tabs', () => {
  it('marks a file over the server limit and does not offer to upload it (FLW-45)', async () => {
    setup({ options: { readLimit: async () => 10_000_000 } });
    await act(async () => {});
    drop(video('big.mp4', 20_000_000));
    expect(screen.getByLabelText('Title')).toHaveAccessibleDescription(
      "20 MB is over this server's 10 MB limit.",
    );
    expect(within(draftRow('big.mp4')).getByText('Too large for this server.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start upload' })).toBeDisabled();
  });

  it('says when this file was uploaded before, and links to that video (FLW-47)', () => {
    const file = video('teaser.mp4');
    recordUpload(
      {
        fingerprint: fileFingerprint(file),
        title: 'Teaser',
        assetId: 'a-old',
        accountId: testSession.id,
      },
      Date.now() - 2 * 24 * 60 * 60 * 1000,
    );
    setup({ routes: { '/api/v1/assets/a-old': oldVideo('a-old') } });
    drop(file);
    expect(screen.getByText(/You uploaded this file 2 days ago as/)).toHaveTextContent(
      'You uploaded this file 2 days ago as “Teaser”. Open video',
    );
    expect(screen.getByRole('link', { name: 'Open video' })).toHaveAttribute(
      'href',
      '/studio/videos/a-old',
    );
  });

  it('says nothing about an earlier upload whose video was deleted elsewhere since', async () => {
    const file = video('teaser.mp4');
    recordUpload(
      {
        fingerprint: fileFingerprint(file),
        title: 'Teaser',
        assetId: 'a-gone',
        accountId: testSession.id,
      },
      Date.now() - 60_000,
    );
    setup({ routes: { '/api/v1/assets/a-gone': reply(404, { error: 'Video asset not found' }) } });
    drop(file);
    await waitFor(() =>
      expect(screen.queryByText(/You uploaded this file/)).not.toBeInTheDocument(),
    );
    expect(screen.queryByRole('link', { name: 'Open video' })).not.toBeInTheDocument();
    expect(findUpload(fileFingerprint(file), testSession.id)).toBeNull();
  });

  it('lists what another tab uploads and refuses that file here (FLW-05)', async () => {
    const bus = fakeBus();
    const locks = fakeLocks();
    const other = createUploadTabs({ channel: bus.channel(), locks, pageTarget: null });
    const here = createUploadTabs({ channel: bus.channel(), locks, pageTarget: null });
    const file = video('promo.mp4');
    act(() =>
      other.publish([
        {
          fingerprint: fileFingerprint(file),
          uploadId: 'up-9',
          assetId: null,
          title: 'Promo cut',
          fileName: 'promo.mp4',
          bytesUploaded: 7,
          bytesTotal: 100,
          paused: false,
        },
      ]),
    );
    const { f } = setup({ tabs: here });
    const section = screen.getByRole('region', { name: 'Uploading in another tab' });
    expect(within(section).getByText('Promo cut')).toBeInTheDocument();
    expect(within(section).getByText('7%')).toBeInTheDocument();
    expect(within(section).queryByRole('button')).not.toBeInTheDocument();

    drop(file);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'This file is already uploading in another tab.',
    );
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
    expect(f.upload).not.toHaveBeenCalled();

    // the other tab stops: the file is free, so the refusal goes
    act(() => other.publish([]));
    await waitFor(() =>
      expect(
        screen.queryByText('This file is already uploading in another tab.'),
      ).not.toBeInTheDocument(),
    );
  });
});

describe('upload page: rows', () => {
  it('pauses, shows what was sent once, and resumes', async () => {
    const { f } = setup();
    await startUpload();
    f.getStatus.mockResolvedValue({ uploadedBytes: 6_000_000 });
    act(() => {
      f.current().resolveUpload('u1');
      f.current().progress(5_000_000, 20 * 1024 * 1024);
    });
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }));
    const row = screen.getByTestId('upload-row');
    expect(await within(row).findByText(/^28% · 6 of 21 MB sent$/)).toBeInTheDocument();
    // the badge says Paused; the line does not repeat it
    expect(within(row).getAllByText('Paused')).toHaveLength(1);
    await userEvent.click(within(row).getByRole('button', { name: 'Resume' }));
    expect(f.current().resume).toHaveBeenCalled();
  });

  it('cancels and says nothing was kept only once the server confirmed it', async () => {
    const { f } = setup();
    await startUpload();
    act(() => f.current().resolveUpload('u1'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText('Upload canceled. Nothing was kept.')).toBeInTheDocument();
    expect(screen.getByText('Canceled')).toBeInTheDocument();
  });

  it('says the upload was not cleaned up when the server did not confirm, and tries again', async () => {
    const { f } = setup();
    await startUpload();
    act(() => f.current().resolveUpload('u1'));
    f.failTermination(new Error('tus: unexpected response while terminating upload, 500'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await screen.findByText(/Upload stopped but not cleaned up/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(f.cancel).toHaveBeenCalledWith('u1');
    expect(await screen.findByText('Upload canceled. Nothing was kept.')).toBeInTheDocument();
  });

  it('resumes a transfer that failed on a dropped connection', async () => {
    const { f } = setup({ options: { isOnline: () => true } });
    await startUpload();
    act(() => f.current().fail(new SlubyError('Upload failed: network', 0)));
    expect(await screen.findByText('The connection to the server dropped.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Resume upload' }));
    expect(f.upload).toHaveBeenCalledTimes(2);
  });

  it('shows a failed run in plain words with the raw line under Details, and no Retry for an unreadable file (FLW-21, FLW-22)', async () => {
    const { f } = setup();
    f.processing.mockResolvedValue(
      job({
        status: 'failed',
        stage: 'failed',
        errorMessage: 'ffprobe exited with code 1: /app/uploads/x: Invalid data found',
        // B-15: the server says retrying cannot help
        retryable: false,
      }),
    );
    await startUpload();
    act(() => {
      f.current().resolveAsset('a1');
      f.current().finish();
    });
    const row = await screen.findByTestId('upload-row');
    expect(await within(row).findByText('The file is not a readable video.')).toBeInTheDocument();
    expect(within(row).queryByRole('button', { name: 'Retry processing' })).not.toBeInTheDocument();
    expect(
      within(row).getByRole('button', { name: 'Upload a different file' }),
    ).toBeInTheDocument();
    expect(within(row).queryByText(/ffprobe/)).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Details' }));
    await userEvent.click(within(row).getByText('Details', { selector: 'summary' }));
    expect(within(row).getByText(/ffprobe exited/)).toBeInTheDocument();
  });

  it('offers to retry a failure that retrying can fix', async () => {
    const { f } = setup();
    f.processing.mockResolvedValueOnce(
      job({
        status: 'failed',
        stage: 'failed',
        errorMessage: 'sia upload failed',
        logs: [{ stage: 'upload', message: 'x', timestamp: '2026-10-01T00:00:00Z' }],
      }),
    );
    await startUpload();
    act(() => {
      f.current().resolveAsset('a1');
      f.current().finish();
    });
    const row = await screen.findByTestId('upload-row');
    expect(
      await within(row).findByText('Storing the video on Sia failed. Retrying usually works.'),
    ).toBeInTheDocument();
    f.processing.mockResolvedValue(job());
    await userEvent.click(within(row).getByRole('button', { name: 'Retry processing' }));
    expect(f.retry).toHaveBeenCalledWith('a1');
  });

  it('turns a ready upload into one line: the title links to the video, with the embed code', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    // userEvent.setup() installs a getter-only clipboard, so define it instead of assigning
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const { f } = setup();
    f.processing.mockResolvedValue(job({ status: 'completed', stage: 'completed' }));
    await startUpload();
    act(() => {
      f.current().resolveAsset('a1');
      f.current().finish();
    });
    const row = await screen.findByTestId('upload-row');
    await waitFor(() => expect(row).toHaveAttribute('data-phase', 'ready'));
    const title = within(row).getByRole('heading', { level: 3 });
    expect(within(title).getByRole('link')).toHaveAttribute('href', '/studio/videos/a1');
    expect(within(row).queryByRole('progressbar')).not.toBeInTheDocument();
    await userEvent.click(within(row).getByRole('button', { name: 'Copy embed code' }));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('a1'));
  });

  it('opens the steps, the parts sent and a named, focusable log (A11Y-19)', async () => {
    const { f } = setup();
    f.processing.mockResolvedValue(
      job({
        logs: [
          {
            stage: 'transcode',
            message: 'Starting transcode of video a1',
            timestamp: '2026-10-01T00:00:00Z',
          },
        ],
      }),
    );
    await startUpload();
    act(() => {
      f.current().resolveAsset('a1');
      f.current().finish();
    });
    const row = await screen.findByTestId('upload-row');
    await within(row).findByText('Transcoding, 10%');
    await userEvent.click(within(row).getByRole('button', { name: 'Details' }));
    const log = within(row).getByRole('region', { name: 'Processing log' });
    expect(log).toHaveAttribute('tabindex', '0');
    // stage keys read as the D-30 labels
    expect(within(log).getByText('Transcoding')).toBeInTheDocument();
    expect(within(row).getByText('Publish')).toBeInTheDocument();
  });
});

describe('upload page: unfinished uploads from an earlier page load', () => {
  const fingerprint =
    'tus-br-clip.mp4-video/mp4-1000-1700000000000-http://localhost:3000/api/v1/uploads';
  const storageKey = `tus::${fingerprint}-sluby-abc123::42`;

  function remember() {
    localStorage.setItem(
      storageKey,
      JSON.stringify({
        size: 1000,
        uploadUrl: 'http://localhost:3000/api/v1/uploads/up-1',
        creationTime: new Date().toString(),
        metadata: {
          filename: 'clip.mp4',
          filetype: 'video/mp4',
          title: 'Holiday clip',
          description: 'beach',
          accessTier: 'private',
        },
      }),
    );
  }

  const head = (offset: number) => () =>
    new Response(null, {
      status: 200,
      headers: { 'Upload-Offset': String(offset), 'Upload-Length': '1000' },
    });

  const same = () =>
    new File([new Uint8Array(1000)], 'clip.mp4', {
      type: 'video/mp4',
      lastModified: 1700000000000,
    });

  it('lists it with what the server holds, and deletes it after a confirm (FLW-48)', async () => {
    remember();
    const { server } = setup({
      routes: { 'HEAD /api/v1/uploads/up-1': head(400), 'DELETE /api/v1/uploads/up-1': reply(204) },
    });
    const section = await screen.findByRole('region', { name: 'Unfinished from earlier (1)' });
    expect(within(section).getByText('Holiday clip')).toBeInTheDocument();
    expect(section).toHaveTextContent('clip.mp4, 400 B of 1 KB, started just now');

    await userEvent.click(within(section).getByRole('button', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog', {
      name: 'Delete this unfinished upload?',
    });
    expect(dialog).toHaveTextContent(
      'The 400 B already sent and the video entry are deleted. This cannot be undone.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(localStorage.getItem(storageKey)).toBeNull());
    // named the way the row names it
    expect(await screen.findByText('“Holiday clip” deleted')).toBeInTheDocument();
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toContain(
      'DELETE /api/v1/uploads/up-1',
    );
  });

  it('continues it with the same file, asking the server first, and refuses another file', async () => {
    remember();
    const { f, server } = setup({ routes: { 'HEAD /api/v1/uploads/up-1': head(400) } });
    const section = await screen.findByRole('region', { name: 'Unfinished from earlier (1)' });
    const input = screen.getByTestId('resume-input-up-1');

    await userEvent.upload(input, video('clip.mp4', 1000, 1600000000000));
    expect(await within(section).findByRole('alert')).toHaveTextContent(
      'This is not the same file. Choose clip.mp4 (1 KB).',
    );
    expect(f.upload).not.toHaveBeenCalled();

    const heads = server.calls.filter((c) => c.method === 'HEAD').length;
    await userEvent.upload(input, same());
    await waitFor(() =>
      expect(f.upload).toHaveBeenCalledWith(
        expect.any(File),
        expect.objectContaining({
          title: 'Holiday clip',
          description: 'beach',
          accessTier: 'private',
        }),
      ),
    );
    // FLW-04: the server was asked again right before resuming
    expect(server.calls.filter((c) => c.method === 'HEAD').length).toBeGreaterThan(heads);
  });

  it('starts a dropped file over as a new draft when the server dropped the upload (FLW-04)', async () => {
    remember();
    let gone = false;
    const { f } = setup({
      routes: {
        'HEAD /api/v1/uploads/up-1': () =>
          gone ? new Response(null, { status: 404 }) : head(400)(),
      },
    });
    await screen.findByRole('region', { name: 'Unfinished from earlier (1)' });
    gone = true;
    drop(same());
    expect(await screen.findByLabelText('Title')).toHaveValue('clip');
    expect(f.upload).not.toHaveBeenCalled();
  });

  it('never lists an upload this tab canceled (FLW-04)', async () => {
    remember();
    const { f, store } = setup({
      routes: {
        'HEAD /api/v1/uploads/up-1': head(400),
        'DELETE /api/v1/uploads/up-1': reply(204),
      },
    });
    await screen.findByRole('region', { name: 'Unfinished from earlier (1)' });
    drop(same());
    await waitFor(() => expect(f.upload).toHaveBeenCalled());
    act(() => f.current().resolveUpload('up-1'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await screen.findByText('Upload canceled. Nothing was kept.');
    // tus still remembers it here, as it would in the bug; the row must stay hidden
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss Holiday clip' }));
    expect(store.getState().uploads).toEqual([]);
    expect(
      screen.queryByRole('region', { name: /Unfinished from earlier/ }),
    ).not.toBeInTheDocument();
  });

  it('says so when the list cannot be checked, with Try again', async () => {
    remember();
    setup({ routes: { 'HEAD /api/v1/uploads/up-1': reply(502) } });
    expect(await screen.findByText('Could not check for unfinished uploads')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
