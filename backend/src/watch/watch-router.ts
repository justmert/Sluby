import { Router, type Request, type Response } from 'express';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import { resolveEntry, signingStateOf } from '../delivery/aggregator.js';
import { buildSignedObjectQuery, verifyObjectAccess } from '../delivery/signed-url.js';
import {
  WATCH_ASSET_PATH,
  WATCH_ASSETS,
  WATCH_CSP,
  renderWatchMessage,
  renderWatchPage,
} from './watch-page.js';

/**
 * GET /watch/:id, the public watch page of a video by asset id or pb_
 * playback id, and the files it loads. It plays the same stream as
 * /v1/stream and asks for the same thing: nothing for a public video, and
 * for a private video or a signed playback id the `expires` and `sig` of a
 * signed url, which the page passes on to the stream and its poster.
 */
export const watchRouter = Router();

const PAGE_HEADERS = {
  'Content-Security-Policy': WATCH_CSP,
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
};

function sendMessage(res: Response, status: number, heading: string, detail: string): void {
  res
    .status(status)
    .set({ ...PAGE_HEADERS, 'Cache-Control': 'no-store' })
    .type('html')
    .send(renderWatchMessage(heading, detail));
}

watchRouter.get(`${WATCH_ASSET_PATH}/:file`, (req: Request, res: Response) => {
  const asset = WATCH_ASSETS[String(req.params.file)];
  if (!asset) {
    res.status(404).set('Cache-Control', 'no-store').type('text').send('Not found');
    return;
  }
  // the names carry no version, so a cached copy lives an hour at most
  res
    .status(200)
    .set({
      'Content-Type': asset.type,
      'Cache-Control': 'public, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    })
    .send(asset.body);
});

watchRouter.get('/watch/:id', async (req: Request, res: Response) => {
  const param = String(req.params.id);
  let entry: Awaited<ReturnType<typeof resolveEntry>>;
  try {
    entry = await resolveEntry(param);
  } catch (err) {
    logger.error({ err, param }, 'Watch page could not read the database');
    sendMessage(res, 503, 'This video is unavailable right now', 'Try again in a moment.');
    return;
  }
  if (!entry || !entry.asset.manifestObjectId) {
    sendMessage(
      res,
      404,
      'This video is not available',
      'It may have been deleted, or it is still being processed.',
    );
    return;
  }
  const { asset, policy } = entry;
  const manifestObjectId = entry.asset.manifestObjectId;

  const signed = asset.accessTier === 'private' || policy === 'signed';
  let query = '';
  let posterQuery = '';
  if (signed) {
    const signing = signingStateOf(asset);
    const expires = typeof req.query.expires === 'string' ? req.query.expires : undefined;
    const sig = typeof req.query.sig === 'string' ? req.query.sig : undefined;
    const check = verifyObjectAccess(
      manifestObjectId,
      expires,
      sig,
      signing,
      env.SESSION_SECRET,
      Math.floor(Date.now() / 1000),
    );
    if (!check.ok) {
      sendMessage(
        res,
        403,
        check.reason === 'expired' ? 'This link has expired' : 'This video needs a signed link',
        check.reason === 'expired'
          ? 'Ask whoever sent it for a new one.'
          : 'Open it from the site that shared it.',
      );
      return;
    }
    query = `?expires=${encodeURIComponent(expires!)}&sig=${encodeURIComponent(sig!)}`;
    const poster = asset.thumbnailObjectIds[0];
    if (poster) {
      posterQuery = `?${buildSignedObjectQuery(poster, check.expiresAtSec, signing.generation, env.SESSION_SECRET)}`;
    }
  }

  const base = env.PUBLIC_URL.replace(/\/$/, '');
  const poster = asset.thumbnailObjectIds[0];
  const posterPath = poster ? `/v1/objects/${poster}${posterQuery}` : null;
  res
    .status(200)
    .set({
      ...PAGE_HEADERS,
      // a signed page is one viewer's link; a public one is checked again on
      // every load, so making it private or deleting it takes effect at once
      'Cache-Control': signed ? 'private, no-store' : 'no-cache',
    })
    .type('html')
    .send(
      renderWatchPage({
        title: asset.title,
        videoId: param,
        streamPath: `/v1/stream/${encodeURIComponent(param)}/master.m3u8${query}`,
        posterPath,
        pageUrl: `${base}/watch/${encodeURIComponent(param)}`,
        previewImageUrl: !signed && posterPath ? `${base}${posterPath}` : null,
        signed,
      }),
    );
});
