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
