/**
 * Each stage enqueues the next under a fixed job id so a stage that runs twice
 * (a stall, a crash mid-job) does not start its successor twice. BullMQ keeps
 * failed jobs and ignores an add whose id it already has, so a retry needs ids
 * of its own or its later stages would be dropped behind the failed attempt's
 * jobs. `runId` names the attempt: absent for the first, set by a retry.
 */
export function stageJobId(stage: 'upload' | 'finalize', videoAssetId: string, runId?: string) {
  return runId ? `${stage}-${videoAssetId}-${runId}` : `${stage}-${videoAssetId}`;
}
