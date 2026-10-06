import { rm } from 'node:fs/promises';
import type { Logger } from 'pino';

type Log = Pick<Logger, 'info' | 'error'>;

/**
 * Remove a source upload: the data file tus wrote and the `<id>.json`
 * metadata sidecar the file store keeps next to it. Missing files are not an
 * error, so this is safe to repeat. A failure is logged with the path and
 * never thrown, so cleanup can not fail the step that triggered it.
 */
export async function removeSourceUpload(
  filePath: string,
  log: Log,
  context: Record<string, unknown> = {},
): Promise<boolean> {
  if (!filePath) return true;
  let removed = true;
  for (const target of [filePath, `${filePath}.json`]) {
    try {
      await rm(target, { force: true });
    } catch (err) {
      removed = false;
      log.error({ ...context, path: target, err }, 'Failed to remove source upload file');
    }
  }
  if (removed) log.info({ ...context, filePath }, 'Removed source upload');
  return removed;
}

/**
 * Remove the source of a finished asset, found through its upload session.
 * Runs after the asset is ready, so a lookup failure is logged rather than
 * thrown: the asset is done either way.
 */
export async function removeSessionSource(
  uploadSessionId: string,
  deps: { getUploadSession: (id: string) => Promise<{ filePath: string } | undefined>; log: Log },
  context: Record<string, unknown> = {},
): Promise<void> {
  let filePath: string | undefined;
  try {
    filePath = (await deps.getUploadSession(uploadSessionId))?.filePath;
  } catch (err) {
    deps.log.error(
      { ...context, uploadSessionId, err },
      'Could not look up the source upload to remove it',
    );
    return;
  }
  if (filePath) await removeSourceUpload(filePath, deps.log, { ...context, uploadSessionId });
}

/**
 * Remove every source upload still on disk for an asset that is being
 * deleted (a failed asset kept for retry, or an upload still in flight).
 * The lookup is allowed to throw so the deletion job retries while the
 * session rows still point at the files; removing a file only logs.
 */
export async function removeAssetSources(
  videoAssetId: string,
  deps: { listSourcePaths: (videoAssetId: string) => Promise<string[]>; log: Log },
): Promise<void> {
  for (const filePath of await deps.listSourcePaths(videoAssetId)) {
    await removeSourceUpload(filePath, deps.log, { videoAssetId });
  }
}
