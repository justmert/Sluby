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
 * Update the status and progress of a processing job.
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
    updateData.startedAt = now;
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
