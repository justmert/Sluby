import type { QualityLevel } from './types.js';

/** A rendition as the player and `useVideo` report it. */
export function toQualityLevel(
  level: { width: number; height: number; bitrate: number },
  index: number,
): QualityLevel {
  return {
    index,
    width: level.width,
    height: level.height,
    bitrate: level.bitrate,
    // by the short side, so a portrait 720x1280 is 720p like a landscape 1280x720
    name: `${Math.min(level.width, level.height) || level.height}p`,
  };
}
