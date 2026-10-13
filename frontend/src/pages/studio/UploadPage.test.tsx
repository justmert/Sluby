import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SlubyClient } from '@sluby/sdk';
import { renderPage } from '@/test/render';
import { createUploadStore } from '@/lib/upload-store';
import { stepStates } from '@/components/upload/PipelineSteps';
import UploadPage from './UploadPage';

vi.mock('@/lib/studio-upload', () => ({ uploadStore: null }));

function storeWithFakeUpload() {
  let progress: (pct: number, bytes: number, total: number) => void = () => {};
  const upload = vi.fn((_file: File, opts: { onProgress?: typeof progress }) => {
    progress = opts.onProgress ?? progress;
    return Object.assign(new Promise<void>(() => {}), {
      assetId: new Promise<string>(() => {}),
      pause: vi.fn().mockResolvedValue(undefined),
      resume: vi.fn(),
      abort: vi.fn().mockResolvedValue(undefined),
      isPaused: false,
    });
  });
  const client = {
    uploads: { upload },
    assets: { processing: vi.fn(), retry: vi.fn() },
  } as unknown as SlubyClient;
  return {
    store: createUploadStore(client),
    upload,
    progress: (b: number, t: number) => progress(0, b, t),
  };
}

describe('UploadPage', () => {
  it('takes a dropped video, prefills the title, and starts a tus upload', async () => {
    const { store, upload, progress } = storeWithFakeUpload();
    renderPage(<UploadPage store={store} />);

    const video = new File([new Uint8Array(20 * 1024 * 1024)], 'my_trip-video.mp4', {
      type: 'video/mp4',
    });
    fireEvent.drop(screen.getByRole('button', { name: /choose a video/i }), {
      dataTransfer: { files: [video] },
    });

    expect(screen.getByLabelText('Title')).toHaveValue('my trip video');
    await userEvent.click(screen.getByRole('button', { name: /start upload/i }));

    expect(upload).toHaveBeenCalledWith(
      video,
      expect.objectContaining({ title: 'my trip video', accessTier: 'public' }),
    );
    act(() => progress(10 * 1024 * 1024, 20 * 1024 * 1024));
    expect(screen.getByText('50%')).toBeInTheDocument();
    expect(screen.getByText('1 of 3 chunks')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /pause/i })).toBeInTheDocument();
  });

  it('rejects files that are not video', async () => {
    const { store } = storeWithFakeUpload();
    renderPage(<UploadPage store={store} />);
    const doc = new File(['x'], 'notes.pdf', { type: 'application/pdf' });

    await userEvent.upload(screen.getByTestId('file-input'), doc, { applyAccept: false });

    expect(screen.getByRole('alert')).toHaveTextContent('notes.pdf is not a video file.');
    expect(screen.queryByLabelText('Title')).not.toBeInTheDocument();
  });
});

describe('stepStates', () => {
  const base = {
    phase: 'processing' as const,
    fileName: 'a.mp4',
    title: 'a',
    bytesUploaded: 1,
    bytesTotal: 1,
    speed: 0,
    assetId: 'a',
    failedDuring: null,
    error: null,
  };
  const job = (stage: string, logs: Array<{ stage: string }> = []) => ({
    id: 'j',
    status: 'processing' as const,
    stage: stage as never,
    progressPercent: 0,
    retryCount: 0,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    createdAt: '',
    logs: logs.map((l) => ({ ...l, timestamp: '', message: '' })),
  });

  it('follows the backend stage through the pipeline', () => {
    expect(stepStates({ ...base, job: job('upload') })).toEqual([
      'done',
      'done',
      'active',
      'pending',
    ]);
    expect(stepStates({ ...base, phase: 'ready', job: job('completed') })).toEqual([
      'done',
      'done',
      'done',
      'done',
    ]);
  });

  it('marks the step a failed job died in', () => {
    expect(
      stepStates({
        ...base,
        phase: 'failed',
        failedDuring: 'processing',
        job: job('failed', [{ stage: 'transcode' }, { stage: 'upload' }]),
      }),
    ).toEqual(['done', 'done', 'failed', 'pending']);
  });
});
