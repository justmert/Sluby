import type { ProcessingJob } from '@sluby/sdk';
import type { UploadState } from '@/lib/upload-store';

/** A processing job with sensible defaults. */
export function job(overrides: Partial<ProcessingJob> = {}): ProcessingJob {
  return {
    id: 'job',
    status: 'processing',
    stage: 'transcode',
    progressPercent: 10,
    retryCount: 0,
    errorMessage: null,
    startedAt: null,
    completedAt: null,
    createdAt: '2026-10-02T00:00:00Z',
    logs: [],
    ...overrides,
  };
}

/** An upload as the store holds it, uploading by default. */
export function upload(overrides: Partial<UploadState> = {}): UploadState {
  return {
    key: 'k1',
    phase: 'uploading',
    fileName: 'clip.mp4',
    fingerprint: 'clip.mp4-video/mp4-100-1',
    title: 'Clip',
    accessTier: 'public',
    bytesUploaded: 0,
    bytesTotal: 12_000_000,
    speed: 0,
    assetId: null,
    uploadId: null,
    job: null,
    failedDuring: null,
    error: null,
    errorDetail: null,
    canResume: false,
    lostConnection: false,
    assetGone: false,
    authFailed: false,
    pollStopped: false,
    checking: false,
    attempt: null,
    resumedFrom: null,
    cleanup: null,
    notice: null,
    activeMs: 0,
    ...overrides,
  };
}
