import { createUploadStore } from './upload-store';
import { sluby } from './sluby';

/** The studio's single upload, shared across pages. */
export const uploadStore = createUploadStore(sluby);
