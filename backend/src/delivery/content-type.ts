/**
 * Map a caller-supplied `?type=` hint on a gateway object URL to a MIME
 * type. Sia object ids are opaque, so the gateway cannot infer the type
 * from the id alone. Playback URLs carry a hint (e.g. `?type=manifest`);
 * when present we honour it, otherwise callers fall back to sniffing or a
 * sensible default.
 */
export function contentTypeForHint(hint: string | undefined): string | null {
  switch (hint) {
    case 'manifest':
    case 'playlist':
      return 'application/vnd.apple.mpegurl';
    case 'thumbnail':
    case 'poster':
      return 'image/jpeg';
    case 'video':
    case 'segment':
    case 'data':
      return 'video/mp4';
    default:
      return null;
  }
}
