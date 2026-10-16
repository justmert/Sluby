import { readdir, rm } from 'node:fs/promises';
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

/**
 * Remove sources that nothing needs anymore: their asset is ready or was
 * deleted. Finalize and the deletion worker already do this as they go; the
 * sweep catches sources left from before they did, and ones whose removal
 * failed. Files no upload session records are left alone and only counted:
 * they may be uploads whose session row is still being written, and the
 * expiry sweep removes them if they never complete.
 */
export async function sweepFinishedSources(deps: {
  uploadDir: string;
  states: (paths: string[]) => Promise<Map<string, 'ready' | 'gone' | 'in-use' | 'cancelled'>>;
  log: Log;
}): Promise<{ removed: number; unknown: number }> {
  let names: string[];
  try {
    names = await readdir(deps.uploadDir);
  } catch (err) {
    deps.log.error({ err, directory: deps.uploadDir }, 'Could not list the upload directory');
    return { removed: 0, unknown: 0 };
  }
  // tus writes `<id>` and its `<id>.json` sidecar; the data file stands for both
  const paths = names.filter((n) => !n.endsWith('.json')).map((n) => `${deps.uploadDir}/${n}`);
  let states: Map<string, string>;
  try {
    states = await deps.states(paths);
  } catch (err) {
    deps.log.error({ err }, 'Could not look up source uploads to sweep');
    return { removed: 0, unknown: 0 };
  }
  let removed = 0;
  let unknown = 0;
  for (const p of paths) {
    const state = states.get(p);
    if (state === undefined) unknown++;
    else if ((state === 'ready' || state === 'gone') && (await removeSourceUpload(p, deps.log))) {
      removed++;
    }
  }
  deps.log.info({ removed, unknown }, 'Swept source uploads nothing needs');
  return { removed, unknown };
}
