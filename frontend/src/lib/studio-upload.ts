import { createUploadStore } from './upload-store';
import { queryClient } from './query-client';
import { sluby } from './sluby';
import { createUploadTabs } from './upload-tabs';
import { reportUnauthorized } from '@/lib/session-events';

/** The largest upload the server takes, from the tus OPTIONS answer; null when it sets none. */
async function readUploadLimit(): Promise<number | null> {
  const res = await fetch('/api/v1/uploads', {
    method: 'OPTIONS',
    headers: { 'Tus-Resumable': '1.0.0' },
  });
  if (!res.ok) throw new Error(`OPTIONS /api/v1/uploads answered ${res.status}`);
  const max = Number(res.headers.get('Tus-Max-Size'));
  return Number.isFinite(max) && max > 0 ? max : null;
}

/** The studio's uploads, shared across pages, the sheet and the top bar. */
export const uploadStore = createUploadStore(sluby, {
  onAuthFailure: reportUnauthorized,
  queryClient,
  tabs: createUploadTabs(),
  readLimit: readUploadLimit,
});
