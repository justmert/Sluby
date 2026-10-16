import { eq, desc, sql } from 'drizzle-orm';
import { db } from '../../config/database.js';
import { processingJobs, type ProcessingJob, type NewProcessingJob } from '../schema.js';

/**
 * Append a log entry to a processing job's logs array.
 */
export async function appendProcessingLog(
  jobId: string,
  stage: string,
  message: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE processing_jobs
    SET logs = COALESCE(logs, '[]'::jsonb) || ${JSON.stringify([{ timestamp: new Date().toISOString(), stage, message }])}::jsonb
    WHERE id = ${jobId}
  `);
}

/**
 * Create a new processing job record.
 */
export async function createProcessingJob(data: NewProcessingJob): Promise<ProcessingJob> {
  const [job] = await db.insert(processingJobs).values(data).returning();
  return job;
}

/**
 * Find a processing job by its associated video asset ID.
 * Returns the most recent job for that asset.
 */
export async function getProcessingJobByVideoAssetId(
  videoAssetId: string,
): Promise<ProcessingJob | undefined> {
  return db.query.processingJobs.findFirst({
    where: eq(processingJobs.videoAssetId, videoAssetId),
    orderBy: [desc(processingJobs.createdAt)],
  });
}

/**
 * Find a processing job by its associated upload session ID.
 */
export async function getProcessingJobByUploadSessionId(
  uploadSessionId: string,
): Promise<ProcessingJob | undefined> {
  return db.query.processingJobs.findFirst({
    where: eq(processingJobs.uploadSessionId, uploadSessionId),
    orderBy: [desc(processingJobs.createdAt)],
  });
}

/**
 * Update the status and progress of a processing job. `startedAt` is set by
 * the first move to processing of a run only, so the duration covers every
 * attempt and not just the last one.
 */
export async function updateProcessingJobStatus(
  id: string,
  data: {
    status: ProcessingJob['status'];
    progressPercent?: number;
    errorMessage?: string | null;
  },
): Promise<ProcessingJob | undefined> {
  const now = new Date();
  const updateData: Record<string, unknown> = {
    status: data.status,
    updatedAt: now,
  };

  if (data.progressPercent !== undefined) {
    updateData.progressPercent = data.progressPercent;
  }
  if (data.errorMessage !== undefined) {
    updateData.errorMessage = data.errorMessage;
  }
  if (data.status === 'processing') {
    updateData.startedAt = sql`coalesce(${processingJobs.startedAt}, ${now.toISOString()}::timestamptz)`;
  }
  if (data.status === 'completed') {
    updateData.completedAt = now;
    updateData.progressPercent = 100;
  }

  const [updated] = await db
    .update(processingJobs)
    .set(updateData)
    .where(eq(processingJobs.id, id))
    .returning();
  return updated;
}

/** A stage failed and BullMQ will run it again. */
export async function recordProcessingRetry(id: string, errorMessage: string): Promise<void> {
  await db
    .update(processingJobs)
    .set({
      status: 'retrying',
      errorMessage,
      retryCount: sql`${processingJobs.retryCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(processingJobs.id, id));
}

/**
 * A failed asset is retried through the API: a new run starts, which counts
 * as a retry and gets its own start time.
 */
export async function restartProcessingJob(id: string): Promise<void> {
  await db
    .update(processingJobs)
    .set({
      status: 'queued',
      errorMessage: null,
      startedAt: null,
      completedAt: null,
      retryCount: sql`${processingJobs.retryCount} + 1`,
      updatedAt: new Date(),
    })
    .where(eq(processingJobs.id, id));
}

/**
 * Update the progress percentage of a processing job.
 */
export async function updateProcessingJobProgress(
  id: string,
  progressPercent: number,
): Promise<ProcessingJob | undefined> {
  const [updated] = await db
    .update(processingJobs)
    .set({
      progressPercent,
      updatedAt: new Date(),
    })
    .where(eq(processingJobs.id, id))
    .returning();
  return updated;
}
