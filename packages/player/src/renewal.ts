import Hls from 'hls.js';
import type {
  HlsConfig,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
} from 'hls.js';

/** A url without its query or fragment: the part a renewed signature leaves alone. */
export function withoutQuery(url: string): string {
  return url.split(/[?#]/)[0];
}

/** The current url of every object of one load, by its url without the query. */
export type SignedUrls = Map<string, string>;

// tags in a master playlist whose URI is itself a playlist
const PLAYLIST_URI_TAGS = /^#EXT-X-(?:MEDIA|I-FRAME-STREAM-INF):/;

async function fetchPlaylist(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`could not load ${url} (HTTP ${res.status})`);
  return res.text();
}

/**
 * The urls a playlist references, made absolute against it, split into the
 * ones that are playlists (variants and renditions of a master) and the rest
 * (segments, init sections, keys).
 */
function playlistUris(text: string, base: string): { playlists: string[]; others: string[] } {
  const playlists: string[] = [];
  const others: string[] = [];
  let variantNext = false;
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith('#')) {
      const uri = /URI="([^"]+)"/.exec(line)?.[1];
      if (uri) (PLAYLIST_URI_TAGS.test(line) ? playlists : others).push(new URL(uri, base).href);
      variantNext = line.startsWith('#EXT-X-STREAM-INF:');
      continue;
    }
    (variantNext ? playlists : others).push(new URL(line, base).href);
    variantNext = false;
  }
  return { playlists, others };
}

/**
 * Every object url of the video `masterUrl` plays, as the gateway signs them
 * for that master. A signed url only covers its own object, so a renewed
 * signature for the master comes with a newly signed url for each playlist
 * and media file under it, and those are read from the renewed playlists
 * rather than built here.
 */
export async function signedUrlsFor(masterUrl: string): Promise<SignedUrls> {
  const urls: SignedUrls = new Map([[withoutQuery(masterUrl), masterUrl]]);
  const add = (url: string) => urls.set(withoutQuery(url), url);
  const master = playlistUris(await fetchPlaylist(masterUrl), masterUrl);
  master.others.forEach(add);
  await Promise.all(
    master.playlists.map(async (playlistUrl) => {
      add(playlistUrl);
      const media = playlistUris(await fetchPlaylist(playlistUrl), playlistUrl);
      media.others.forEach(add);
    }),
  );
  return urls;
}

/**
 * hls.js's own http loader, sending each request to the current url of its
 * object. hls.js keeps the urls it read from the playlists for as long as a
 * load lasts, so after a renewal this is what moves its later requests (a
 * quality switch, a seek past the buffer, a retry) onto the new signatures
 * without reloading the video.
 */
export function renewingLoader(urls: { readonly current: SignedUrls }): {
  new (config: HlsConfig): Loader<LoaderContext>;
} {
  const Base = Hls.DefaultConfig.loader;
  return class RenewingLoader extends Base {
    load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>,
    ): void {
      context.url = urls.current.get(withoutQuery(context.url)) ?? context.url;
      super.load(context, config, callbacks);
    }
  };
}
