import type { Request } from 'express';
import { logger } from '../config/logger.js';
import { writePlays } from '../db/queries/plays.js';
import { createPlayCounter, fromStudio, viewerOf } from './plays.js';

/** The process's play counter; index.ts starts and stops its flushing. */
export const playCounter = createPlayCounter({
  write: writePlays,
  onError: (err, rows) =>
    logger.error(
      { err, plays: rows.reduce((n, r) => n + r.plays, 0) },
      'Could not write play counts; they are lost',
    ),
});

/** Count a play of `assetId` for a request that loaded it, see plays.ts. */
export function countPlay(req: Request, assetId: string): void {
  if (req.method !== 'GET' || fromStudio(req)) return;
  playCounter.record(assetId, viewerOf(req));
}
