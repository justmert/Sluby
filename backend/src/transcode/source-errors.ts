/**
 * The uploaded file is not something FFmpeg can read as a video: it is not
 * a media file at all, or it has no video stream. Trying again cannot help,
 * so the pipeline fails the video at once instead of retrying.
 */
export class UnreadableSourceError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'UnreadableSourceError';
  }
}

/** ffprobe's words for bytes that are no media file it knows. */
export const INVALID_DATA_TEXT = 'Invalid data found when processing input';

/** Our words for a file whose streams hold no video. */
export const NO_VIDEO_STREAM_TEXT = 'No video stream found';

/**
 * Every text that marks a stored failure as unreadable. Migration 0021
 * matched failed jobs from before this classification against the same texts;
 * a test keeps the two equal.
 */
export const UNREADABLE_SOURCE_TEXTS = [INVALID_DATA_TEXT, NO_VIDEO_STREAM_TEXT] as const;
