import { randomBytes } from 'node:crypto';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Logger } from 'pino';

/**
 * Transcode output lives in `<root>/<assetId>/<run dir>`. Every execution of
 * the transcode stage writes into a directory of its own, so a second
 * execution of the same job (a stalled job BullMQ handed to another worker
 * while the first kept going) never rewrites files an upload is reading.
 *
 * A run directory counts as a finished transcode only once it holds the
 * completion marker, written after FFmpeg exited 0 and the thumbnails were
 * taken. FFmpeg writes a master playlist on some failures too (header only,
 * or complete looking after an interrupt), so the playlists prove nothing.
 */

export const COMPLETION_MARKER = 'transcode-complete.json';

export interface CompletionMarker {
  durationMs: number;
  resolution: string;
  /** thumbnail file names inside the run directory */
  thumbnails: string[];
  completedAt: string;
}

export interface CompletedOutput {
  outputDir: string;
  marker: CompletionMarker;
  /** the marker's thumbnails that are still on disk, as full paths */
  thumbnailPaths: string[];
}

const ASSET_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The directory holding every run of one asset. */
export function assetOutputDir(root: string, videoAssetId: string): string {
  // the id becomes a path that is removed recursively, so it must be an id
  if (!ASSET_ID.test(videoAssetId)) throw new Error(`not an asset id: ${videoAssetId}`);
  return path.join(root, videoAssetId);
}

/** Create a fresh, empty run directory for one transcode execution. */
export async function createRunDir(root: string, videoAssetId: string): Promise<string> {
  const dir = path.join(
    assetOutputDir(root, videoAssetId),
    `${Date.now()}-${randomBytes(4).toString('hex')}`,
  );
  await mkdir(dir, { recursive: true });
  return dir;
}

/** Mark a run directory finished. Written by rename, so a reader never sees half a marker. */
export async function writeCompletionMarker(
  outputDir: string,
  marker: Omit<CompletionMarker, 'completedAt'>,
): Promise<CompletionMarker> {
  const full: CompletionMarker = { ...marker, completedAt: new Date().toISOString() };
  const target = path.join(outputDir, COMPLETION_MARKER);
  await writeFile(`${target}.tmp`, JSON.stringify(full));
  await rename(`${target}.tmp`, target);
  return full;
}

function isMarker(value: unknown): value is CompletionMarker {
  const m = value as CompletionMarker;
  return (
    typeof m === 'object' &&
    m !== null &&
    typeof m.durationMs === 'number' &&
    typeof m.resolution === 'string' &&
    Array.isArray(m.thumbnails) &&
    m.thumbnails.every((t) => typeof t === 'string' && path.basename(t) === t) &&
    typeof m.completedAt === 'string'
  );
}

/** The marker of a run directory, or null when the run did not finish. */
export async function readCompletionMarker(outputDir: string): Promise<CompletionMarker | null> {
  let text: string;
  try {
    text = await readFile(path.join(outputDir, COMPLETION_MARKER), 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  const parsed: unknown = JSON.parse(text);
  return isMarker(parsed) ? parsed : null;
}

async function existing(paths: string[]): Promise<string[]> {
  const found: string[] = [];
  for (const p of paths) {
    try {
      if ((await stat(p)).size > 0) found.push(p);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
  }
  return found;
}

/** The newest finished run of an asset, or null when no run finished. */
export async function findCompletedOutput(
  root: string,
  videoAssetId: string,
): Promise<CompletedOutput | null> {
  const assetDir = assetOutputDir(root, videoAssetId);
  let entries: string[];
  try {
    entries = await readdir(assetDir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw err;
  }
  let best: CompletedOutput | null = null;
  for (const name of entries) {
    const outputDir = path.join(assetDir, name);
    if (!(await stat(outputDir)).isDirectory()) continue;
    const marker = await readCompletionMarker(outputDir);
    if (!marker) continue;
    if (best && best.marker.completedAt >= marker.completedAt) continue;
    const thumbnailPaths = await existing(marker.thumbnails.map((t) => path.join(outputDir, t)));
    best = { outputDir, marker, thumbnailPaths };
  }
  return best;
}

/** Remove one run directory, or every run of an asset. Missing is fine. */
export async function removeOutput(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function removeAssetOutput(root: string, videoAssetId: string): Promise<void> {
  await removeOutput(assetOutputDir(root, videoAssetId));
}

/** What a sweep does with an asset's output: keep it for the pipeline or a retry, or remove it. */
export type OutputDisposition = 'keep' | 'remove';

/**
 * Remove the output of assets that no longer need it: deleted, or ready.
 * Finalize and the deletion worker remove it as they go; the sweep catches
 * output left by a crash between their steps, or by an execution that kept
 * writing after its asset was done. Entries that are not asset ids are left
 * alone.
 */
export async function sweepOutputDirs(deps: {
  root: string;
  dispositions: (videoAssetIds: string[]) => Promise<Map<string, OutputDisposition>>;
  log: Pick<Logger, 'info' | 'error'>;
}): Promise<number> {
  let names: string[];
  try {
    names = await readdir(deps.root);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return 0;
    throw err;
  }
  const ids = names.filter((n) => ASSET_ID.test(n));
  if (ids.length === 0) return 0;
  const dispositions = await deps.dispositions(ids);
  let removed = 0;
  for (const id of ids) {
    if (dispositions.get(id) !== 'remove') continue;
    await removeAssetOutput(deps.root, id);
    removed++;
  }
  if (removed > 0)
    deps.log.info({ removed }, 'Removed transcode output of deleted or ready assets');
  return removed;
}
