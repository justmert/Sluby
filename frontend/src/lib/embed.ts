import type { PlaybackId, VideoAsset } from '@sluby/sdk';

// the code the share panel, "Copy embed code" and the checklist hand out for
// one video. the react and server samples are typechecked against the real
// @sluby/sdk and @sluby/player in embed.test.ts, and the html one against
// hls.js, so a renamed api breaks the build instead of a reader's page.

export type EmbedKind = 'react' | 'html' | 'stream-url' | 'server';

/** Play by the video ID, or by one of its playback IDs. */
export type EmbedBy = 'video' | Pick<PlaybackId, 'playbackId' | 'policy'>;

export type EmbedAsset = Pick<VideoAsset, 'id' | 'accessTier'>;

export interface EmbedCode {
  kind: EmbedKind;
  /** The tab label: "React", "HTML", "Stream URL", "Server". */
  label: string;
  /** For CodeBlock. */
  language: 'tsx' | 'ts' | 'html' | 'text';
  code: string;
}

export interface EmbedOptions {
  by?: EmbedBy;
  /** This server's address as the reader's code should reach it; the studio's origin by default. */
  baseUrl?: string;
}

/** What a reader installs for the react and server samples. */
export const EMBED_INSTALL = 'npm install @sluby/player @sluby/sdk';

/** The hls.js build the html sample loads; the major version matches @sluby/player's. */
export const HLS_CDN_URL = 'https://cdn.jsdelivr.net/npm/hls.js@1.7.3/dist/hls.min.js';

/** Where the samples' own server hands out signed URLs; the reader's server, not this one. */
export const SIGNED_URL_PATH = '/signed-video-url';

const LABEL: Record<EmbedKind, string> = {
  react: 'React',
  html: 'HTML',
  'stream-url': 'Stream URL',
  server: 'Server',
};

/**
 * Whether playing needs a signed URL from the reader's server: a private
 * video always, and a signed playback ID even on a public video, since it
 * gates its own stream URL.
 */
export function needsSigning(asset: EmbedAsset, by: EmbedBy = 'video'): boolean {
  return asset.accessTier === 'private' || (by !== 'video' && by.policy === 'signed');
}

/** The samples that apply, in tab order: open ones play with no key, signed ones start on the server. */
export function embedKinds(asset: EmbedAsset, by: EmbedBy = 'video'): EmbedKind[] {
  return needsSigning(asset, by) ? ['server', 'react', 'html'] : ['react', 'html', 'stream-url'];
}

const trimBase = (baseUrl: string) => baseUrl.replace(/\/+$/, '');
const idOf = (asset: EmbedAsset, by: EmbedBy) => (by === 'video' ? asset.id : by.playbackId);

/** The master playlist URL, built the way the sdk's playback.streamUrl builds it. */
export function streamUrl(baseUrl: string, id: string): string {
  return `${trimBase(baseUrl)}/v1/stream/${encodeURIComponent(id)}/master.m3u8`;
}

/**
 * One sample for a video. `kind` must be one of embedKinds(asset, by): a
 * stream URL alone cannot play a signed video, and an open one needs no
 * server code, so those throw.
 */
export function embedCode(
  asset: EmbedAsset,
  { kind, by = 'video', baseUrl = window.location.origin }: EmbedOptions & { kind: EmbedKind },
): EmbedCode {
  if (!embedKinds(asset, by).includes(kind)) {
    throw new RangeError(
      `No ${kind} sample for a ${needsSigning(asset, by) ? 'signed' : 'public'} video.`,
    );
  }
  const base = trimBase(baseUrl);
  const id = idOf(asset, by);
  const signed = needsSigning(asset, by);
  const code =
    kind === 'stream-url'
      ? streamUrl(base, id)
      : kind === 'server'
        ? serverSample(base, id)
        : kind === 'react'
          ? signed
            ? reactSignedSample()
            : reactPublicSample(base, id)
          : signed
            ? htmlSample(null)
            : htmlSample(streamUrl(base, id));
  const language =
    kind === 'react' ? 'tsx' : kind === 'server' ? 'ts' : kind === 'html' ? 'html' : 'text';
  return { kind, label: LABEL[kind], language, code };
}

/** Every sample that applies, in tab order, for CodeBlock's `samples`. */
export function embedSamples(asset: EmbedAsset, options: EmbedOptions = {}): EmbedCode[] {
  return embedKinds(asset, options.by).map((kind) => embedCode(asset, { ...options, kind }));
}

/**
 * What "Copy embed code" copies: the react player for a public video, and
 * for a private one the server code that signs its URL, since that has to
 * exist before any page can play it.
 */
export function primaryEmbed(asset: EmbedAsset, options: EmbedOptions = {}): EmbedCode {
  return embedCode(asset, { ...options, kind: embedKinds(asset, options.by)[0] });
}

const q = (s: string) => `'${s.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;

function reactPublicSample(base: string, id: string): string {
  return `import { SlubyPlayer } from '@sluby/player';
import { SlubyClient } from '@sluby/sdk';

// browser code: a public video plays with no api key
const sluby = new SlubyClient({ baseUrl: ${q(base)} });

export function Video() {
  return <SlubyPlayer src={sluby.playback.streamUrl(${q(id)})} />;
}`;
}

function reactSignedSample(): string {
  return `import { useEffect, useState } from 'react';
import { SlubyPlayer } from '@sluby/player';

// your server's route from the server sample; the api key stays there
async function signedUrl(): Promise<string> {
  const res = await fetch(${q(SIGNED_URL_PATH)});
  if (!res.ok) throw new Error(\`Could not get a signed URL (\${res.status})\`);
  const { signedUrl } = (await res.json()) as { signedUrl: string };
  return signedUrl;
}

export function Video() {
  const [src, setSrc] = useState<string>();
  useEffect(() => {
    signedUrl().then(setSrc, console.error);
  }, []);
  // refreshSrc fetches a new url before this one expires, so playback carries on
  return src ? <SlubyPlayer src={src} refreshSrc={signedUrl} /> : null;
}`;
}

function serverSample(base: string, id: string): string {
  return `import { createServer } from 'node:http';
import { SlubyClient } from '@sluby/sdk';

// server-side code: the api key never reaches a browser
const sluby = new SlubyClient({
  baseUrl: ${q(base)},
  apiKey: process.env.SLUBY_API_KEY!,
});

// your pages ask this route for a signed url; check here that the viewer may watch
createServer(async (req, res) => {
  if (req.url !== ${q(SIGNED_URL_PATH)}) {
    res.writeHead(404).end();
    return;
  }
  try {
    const { signedUrl, expiresAt } = await sluby.playback.getSignedUrl(${q(id)}, {
      expiresIn: 3600,
    });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ signedUrl, expiresAt }));
  } catch (err) {
    console.error(err);
    res.writeHead(502).end();
  }
}).listen(8080);`;
}

/** `src` null: a signed video, whose url comes from the reader's server. */
function htmlSample(src: string | null): string {
  const load = src
    ? `  const src = ${q(src)};
  play(src);`
    : `  // your server's route from the server sample; the api key stays there
  fetch(${q(SIGNED_URL_PATH)})
    .then((res) => res.json())
    .then(({ signedUrl }) => play(signedUrl));`;
  return `<video id="video" controls playsinline style="width: 100%"></video>
<script src="${HLS_CDN_URL}"></script>
<script>
  const video = /** @type {HTMLVideoElement} */ (document.getElementById('video'));
  /** @param {string} src */
  function play(src) {
    // hls.js where the browser has media source extensions, native hls on older iphones
    if (Hls.isSupported()) {
      const hls = new Hls();
      hls.loadSource(src);
      hls.attachMedia(video);
    } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = src;
    }
  }
${load}
</script>`;
}
