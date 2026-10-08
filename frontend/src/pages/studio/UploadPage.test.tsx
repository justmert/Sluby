import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotFoundError, SlubyError, type ProcessingJob } from '@sluby/sdk';
import { jsonFetch, renderPage, reply } from '@/test/render';
import { fakeUploadClient } from '@/test/fake-uploads';
import { createUploadStore, type UploadState } from '@/lib/upload-store';
import { stepStates } from '@/components/upload/pipeline-steps';
import UploadPage from './UploadPage';

vi.mock('@/lib/studio-upload', () => ({ uploadStore: null }));

function setup() {
  const f = fakeUploadClient();
  const store = createUploadStore(f.client, { unloadTarget: null });
  renderPage(<UploadPage store={store} />);
  return { f, store };
}

const video = (name = 'my_trip-video.mp4', size = 20 * 1024 * 1024) =>
  new File([new Uint8Array(size)], name, { type: 'video/mp4', lastModified: 1700000000000 });

const dropZone = () => screen.getByRole('button', { name: /choose a video/i });

async function startUpload(file = video()) {
  fireEvent.drop(dropZone(), { dataTransfer: { files: [file] } });
  await userEvent.click(screen.getByRole('button', { name: /start upload/i }));
}

const job = (overrides: Partial<ProcessingJob> = {}): ProcessingJob => ({
  id: 'j',
  status: 'processing',
  stage: 'transcode',
  progressPercent: 40,
  retryCount: 0,
  errorMessage: null,
  startedAt: null,
  completedAt: null,
  createdAt: '2026-10-01T00:00:00Z',
  logs: [],
  ...overrides,
});

afterEach(() => vi.unstubAllGlobals());

describe('UploadPage', () => {
  it('takes a dropped video, prefills the title, and starts a tus upload', async () => {
    const { f } = setup();
    const file = video();
    fireEvent.drop(dropZone(), { dataTransfer: { files: [file] } });

    expect(screen.getByLabelText('Title')).toHaveValue('my trip video');
    await userEvent.click(screen.getByRole('button', { name: /start upload/i }));

    expect(f.upload).toHaveBeenCalledWith(
      file,
      expect.objectContaining({ title: 'my trip video', accessTier: 'public' }),
    );
    act(() => f.current().progress(10 * 1024 * 1024, 20 * 1024 * 1024));
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('1 of 3 chunks')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();
    // no second upload while this one transfers
    expect(screen.queryByRole('button', { name: /choose a video/i })).not.toBeInTheDocument();
  });

  it('rejects files that are not video', async () => {
    setup();
    const doc = new File(['x'], 'notes.pdf', { type: 'application/pdf' });

    await userEvent.upload(screen.getByTestId('file-input'), doc, { applyAccept: false });

    expect(screen.getByRole('alert')).toHaveTextContent('notes.pdf is not a video file.');
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
  });

  it('says when several dropped files were reduced to one', () => {
    setup();
    fireEvent.drop(dropZone(), {
      dataTransfer: { files: [video('a.mp4'), video('b.mp4'), video('c.mp4')] },
    });
    expect(screen.getByLabelText('Title')).toHaveValue('a');
    expect(
      screen.getByText('Only one file uploads at a time, so 2 other files were not added.'),
    ).toBeInTheDocument();
  });

  it('keeps the drop highlight while the pointer crosses child elements', () => {
    setup();
    const zone = dropZone();
    const child = within(zone).getByText(/drop a video here/i);
    fireEvent.dragEnter(zone);
    fireEvent.dragEnter(child);
    fireEvent.dragLeave(zone);
    expect(zone).toHaveClass('border-primary');
    fireEvent.dragLeave(child);
    expect(zone).not.toHaveClass('border-primary');
  });

  it('offers another upload while the first one processes, and keeps the first card', async () => {
    const { f } = setup();
    f.processing.mockResolvedValue(job());
    await startUpload(video('first.mp4'));
    act(() => {
      f.current().resolveAsset('a1');
      f.current().finish();
    });

    expect(await screen.findByRole('link', { name: 'View asset' })).toBeInTheDocument();
    expect(dropZone()).toBeInTheDocument();
    await startUpload(video('second.mp4'));

    const cards = screen.getAllByTestId('upload-card');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText('second')).toBeInTheDocument();
    expect(within(cards[1]).getByText('first')).toBeInTheDocument();
    expect(within(cards[1]).getByRole('link', { name: 'View asset' })).toHaveAttribute(
      'href',
      '/studio/assets/a1',
    );
  });

  it('shows a paused upload as paused, with the bytes the server holds', async () => {
    const { f } = setup();
    await startUpload(video('my_trip-video.mp4', 20_000_000));
    act(() => {
      f.current().resolveUpload('u1');
      f.current().resolveAsset('a1');
      f.current().progress(9_000_000, 20_000_000);
    });
    f.getStatus.mockResolvedValue({ uploadedBytes: 8_000_000 });

    await userEvent.click(screen.getByRole('button', { name: /pause/i }));

    expect(await screen.findByText('8 MB of 20 MB')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /resume/i })).toBeInTheDocument();
    const uploadStep = screen.getByText('Resumable tus transfer to the backend').closest('li')!;
    expect(uploadStep).toHaveAttribute('data-state', 'paused');
    expect(within(uploadStep).getByText('paused')).toBeInTheDocument();
    expect(screen.getByText('my trip video: Paused')).toHaveAttribute('role', 'status');
    // the asset is an empty placeholder until the bytes arrive
    expect(screen.queryByRole('link', { name: 'View asset' })).not.toBeInTheDocument();
  });

  it('cancels and only claims removal once the server confirmed it', async () => {
    const { f } = setup();
    await startUpload();
    act(() => f.current().resolveUpload('u1'));
    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));
    expect(
      await screen.findByText('Upload cancelled. The partial file and its asset were removed.'),
    ).toBeInTheDocument();
  });

  it('says the upload was not removed when the termination failed, and can try again', async () => {
    const { f } = setup();
    await startUpload();
    act(() => f.current().resolveUpload('u1'));
    f.failTermination(new Error('tus: unexpected response while terminating upload, 500'));

    await userEvent.click(screen.getByRole('button', { name: /cancel/i }));

    expect(await screen.findByText('Upload stopped, but not removed')).toBeInTheDocument();
    expect(screen.queryByText(/were removed/)).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /try removing again/i }));
    expect(f.cancel).toHaveBeenCalledWith('u1');
    expect(
      await screen.findByText('Upload cancelled. The partial file and its asset were removed.'),
    ).toBeInTheDocument();
  });

  it('resumes a transfer that failed on a network error', async () => {
    const { f } = setup();
    await startUpload();
    act(() => f.current().fail(new SlubyError('Upload failed: network error', 0)));

    expect(await screen.findByText('Upload failed')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /resume upload/i }));
    expect(f.upload).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole('button', { name: /pause/i })).toBeInTheDocument();
  });

  it('tells the user when the asset was deleted during processing, and stops', async () => {
    const { f } = setup();
    f.processing.mockRejectedValue(new NotFoundError('No processing job found for this asset'));
    f.get.mockRejectedValue(new NotFoundError('Video asset not found'));
    await startUpload();
    act(() => {
      f.current().resolveAsset('a1');
      f.current().finish();
    });

    expect(await screen.findByText('Video deleted')).toBeInTheDocument();
    expect(
      screen.getByText('This video was deleted before processing finished.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /retry processing/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /view asset/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(screen.queryByTestId('upload-card')).not.toBeInTheDocument();
  });
});

describe('UploadPage: unfinished uploads from an earlier page load', () => {
  const fingerprint =
    'tus-br-clip.mp4-video/mp4-1000-1700000000000-http://localhost:3000/api/v1/uploads';
  const storageKey = `tus::${fingerprint}-sluby-abc123::42`;
  const b64 = (v: string) => btoa(v);

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

  function stubServer() {
    const fetchStub = jsonFetch({
      'HEAD /api/v1/uploads/up-1': () =>
        new Response(null, {
          status: 200,
          headers: {
            'Upload-Offset': '400',
            'Upload-Length': '1000',
            'Upload-Metadata': `filename ${b64('clip.mp4')},videoAssetId ${b64('asset-9')}`,
          },
        }),
      'DELETE /api/v1/uploads/up-1': reply(204),
    });
    vi.stubGlobal('fetch', vi.fn(fetchStub));
    return fetchStub;
  }

  it('lists it with what the server holds, and discards it on the server', async () => {
    remember();
    const server = stubServer();
    const f = fakeUploadClient();
    const store = createUploadStore(f.client, { unloadTarget: null });
    renderPage(<UploadPage store={store} />);

    expect(await screen.findByText('Holiday clip')).toBeInTheDocument();
    expect(screen.getByText(/clip\.mp4, 400 B of 1 KB sent \(40%\)/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /discard/i }));
    await waitFor(() => expect(localStorage.getItem(storageKey)).toBeNull());
    expect(server.calls.map((c) => `${c.method} ${c.path}`)).toContain(
      'DELETE /api/v1/uploads/up-1',
    );
  });

  it('resumes it with the same file and its stored title, and refuses another file', async () => {
    remember();
    stubServer();
    const f = fakeUploadClient();
    const store = createUploadStore(f.client, { unloadTarget: null });
    renderPage(<UploadPage store={store} />);
    await screen.findByText('Holiday clip');

    const other = new File([new Uint8Array(1000)], 'clip.mp4', {
      type: 'video/mp4',
      lastModified: 1600000000000,
    });
    await userEvent.upload(screen.getByLabelText('Choose clip.mp4 to resume its upload'), other);
    expect(screen.getByRole('alert')).toHaveTextContent(/is not the file this upload started from/);
    expect(f.upload).not.toHaveBeenCalled();

    const same = new File([new Uint8Array(1000)], 'clip.mp4', {
      type: 'video/mp4',
      lastModified: 1700000000000,
    });
    await userEvent.upload(screen.getByLabelText('Choose clip.mp4 to resume its upload'), same);
    expect(f.upload).toHaveBeenCalledWith(
      same,
      expect.objectContaining({
        title: 'Holiday clip',
        description: 'beach',
        accessTier: 'private',
      }),
    );
  });
});

describe('stepStates', () => {
  const base: UploadState = {
    key: 'k',
    phase: 'processing',
    fileName: 'a.mp4',
    title: 'a',
    bytesUploaded: 1,
    bytesTotal: 1,
    speed: 0,
    assetId: 'a',
    uploadId: 'u',
    job: null,
    failedDuring: null,
    error: null,
    canResume: false,
    assetGone: false,
    authFailed: false,
    pollStopped: false,
    cleanup: null,
    notice: null,
    activeMs: 0,
  };
  const withJob = (stage: string, logs: Array<{ stage: string }> = []) =>
    job({
      stage: stage as ProcessingJob['stage'],
      logs: logs.map((l) => ({ ...l, timestamp: '', message: '' })),
    });

  it('follows the backend stage through the pipeline', () => {
    expect(stepStates({ ...base, job: withJob('upload') })).toEqual([
      'done',
      'done',
      'active',
      'pending',
    ]);
    expect(stepStates({ ...base, phase: 'ready', job: withJob('completed') })).toEqual([
      'done',
      'done',
      'done',
      'done',
    ]);
  });

  it('shows a paused transfer as paused, not active', () => {
    expect(stepStates({ ...base, phase: 'paused' })).toEqual([
      'paused',
      'pending',
      'pending',
      'pending',
    ]);
  });

  it('marks the step a failed job died in', () => {
    expect(
      stepStates({
        ...base,
        phase: 'failed',
        failedDuring: 'processing',
        job: withJob('failed', [{ stage: 'transcode' }, { stage: 'upload' }]),
      }),
    ).toEqual(['done', 'done', 'failed', 'pending']);
  });
});
