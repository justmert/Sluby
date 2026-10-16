import { createUploadStore } from './upload-store';
import { sluby } from './sluby';
import { reportUnauthorized } from '@/lib/session-events';

/** The studio's single upload, shared across pages. */
export const uploadStore = createUploadStore(sluby, { onAuthFailure: reportUnauthorized });
