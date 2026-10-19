import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';

// /watch/:id renders the public watch page. The db is mocked; the gate and
// the signing are the real ones /v1/stream uses.
vi.mock('../config/logger.js', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock('../db/queries/assets.js', () => ({
  getVideoAssetById: vi.fn(),
}));
vi.mock('../db/queries/playback-ids.js', () => ({
  getPlaybackIdByPublicId: vi.fn(),
  resolveAssetId: vi.fn(),
}));

const { watchRouter } = await import('../watch/watch-router.js');
const { getVideoAssetById } = await import('../db/queries/assets.js');
const { getPlaybackIdByPublicId } = await import('../db/queries/playback-ids.js');
const { buildSignedObjectQuery, verifyObjectAccess } = await import('../delivery/signed-url.js');
const { env } = await import('../config/env.js');

const SECRET = env.SESSION_SECRET;
const PB_SIGNED = 'pb_bbbbbbbbbbbbbbbbbbbbb';
const ASSET = '00000000-0000-4000-8000-000000000001';
const MASTER = 'a1'.repeat(32);
const THUMB = 'c3'.repeat(32);

function app() {
  const a = express();
  a.use('/', watchRouter);
  return a;
}
const nowSec = () => Math.floor(Date.now() / 1000);

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: ASSET,
    title: 'Launch <party> & "friends"',
    thumbnailObjectIds: [THUMB],
    manifestObjectId: MASTER,
    accessTier: 'public',
    status: 'ready',
    signingGeneration: 0,
    legacySignaturesUntil: null,
    ...overrides,
  } as never;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getPlaybackIdByPublicId).mockResolvedValue(undefined);
  vi.mocked(getVideoAssetById).mockResolvedValue(asset());
});

describe('/watch/:id', () => {
  it('renders a public video with its stream, poster and an escaped title', async () => {
    const res = await request(app()).get(`/watch/${ASSET}`);

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
    expect(res.text).toContain(`data-src="/v1/stream/${ASSET}/master.m3u8"`);
    expect(res.text).toContain(`poster="/v1/objects/${THUMB}"`);
    expect(res.text).toContain('<title>Launch &lt;party&gt; &amp; &quot;friends&quot;</title>');
    expect(res.text).not.toContain('<party>');
    // link previews for a public video, and search may list it
    expect(res.text).toContain('property="og:title"');
    expect(res.text).toContain(`${env.PUBLIC_URL.replace(/\/$/, '')}/v1/objects/${THUMB}`);
    expect(res.text).not.toContain('noindex');
    expect(res.headers['cache-control']).toBe('no-cache');
  });

  it('may be framed by any page, and loads only its own scripts', async () => {
    const res = await request(app()).get(`/watch/${ASSET}`);
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain('frame-ancestors *');
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("default-src 'none'");
    expect(res.headers['x-frame-options']).toBeUndefined();
    expect(res.text).toContain('<script src="/watch/assets/hls.min.js"></script>');
    expect(res.text).not.toMatch(/<script>(?!<\/script>)/);
  });

  it('asks for a signed link on a private video', async () => {
    vi.mocked(getVideoAssetById).mockResolvedValue(asset({ accessTier: 'private' }));
    const res = await request(app()).get(`/watch/${ASSET}`);
    expect(res.status).toBe(403);
    expect(res.text).toContain('This video needs a signed link');
    expect(res.text).not.toContain(MASTER);
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('says an expired link has expired', async () => {
    vi.mocked(getVideoAssetById).mockResolvedValue(asset({ accessTier: 'private' }));
    const past = nowSec() - 60;
    const res = await request(app()).get(
      `/watch/${ASSET}?${buildSignedObjectQuery(MASTER, past, 0, SECRET)}`,
    );
    expect(res.status).toBe(403);
    expect(res.text).toContain('This link has expired');
  });

  it('plays a private video with its signature passed on to the stream and the poster', async () => {
    vi.mocked(getVideoAssetById).mockResolvedValue(asset({ accessTier: 'private' }));
    const exp = nowSec() + 600;
    const query = buildSignedObjectQuery(MASTER, exp, 0, SECRET);
    const res = await request(app()).get(`/watch/${ASSET}?${query}`);

    expect(res.status).toBe(200);
    expect(res.text).toContain(
      `data-src="/v1/stream/${ASSET}/master.m3u8?${query.replace('&', '&amp;')}"`,
    );
    const poster = /poster="\/v1\/objects\/[0-9a-f]+\?expires=(\d+)&amp;sig=([0-9a-f]+)"/.exec(
      res.text,
    );
    expect(poster).not.toBeNull();
    // the poster is signed for its own object until the same expiry
    expect(
      verifyObjectAccess(
        THUMB,
        poster![1],
        poster![2],
        { generation: 0, legacyUntilSec: null },
        SECRET,
        nowSec(),
      ).ok,
    ).toBe(true);
    // one person's link: no previews, no search, no shared cache
    expect(res.text).not.toContain('og:');
    expect(res.text).toContain('noindex');
    expect(res.headers['cache-control']).toBe('private, no-store');
  });

  it('gates a signed playback id on a public video the same way', async () => {
    vi.mocked(getPlaybackIdByPublicId).mockResolvedValue({
      videoAssetId: ASSET,
      policy: 'signed',
    } as never);
    const res = await request(app()).get(`/watch/${PB_SIGNED}`);
    expect(res.status).toBe(403);
  });

  it('says a missing or unfinished video is not available', async () => {
    vi.mocked(getVideoAssetById).mockResolvedValue(asset({ manifestObjectId: null }));
    expect((await request(app()).get(`/watch/${ASSET}`)).status).toBe(404);
    expect((await request(app()).get('/watch/not-an-id')).status).toBe(404);
  });

  it('serves its scripts and stylesheet, and nothing else under the assets path', async () => {
    const hls = await request(app()).get('/watch/assets/hls.min.js');
    expect(hls.status).toBe(200);
    expect(hls.headers['content-type']).toContain('text/javascript');
    expect(hls.text.length).toBeGreaterThan(100_000);
    expect((await request(app()).get('/watch/assets/watch.js')).text).toContain('data-src');
    expect((await request(app()).get('/watch/assets/watch.css')).status).toBe(200);
    expect((await request(app()).get('/watch/assets/../package.json')).status).toBe(404);
    expect((await request(app()).get('/watch/assets/other.js')).status).toBe(404);
  });
});
