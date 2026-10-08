import { mkdirSync, readFileSync } from 'node:fs';
import { env, sessionSecretGenerated } from './config/env.js';
import { logger } from './config/logger.js';
import { db, closeDatabase } from './config/database.js';
import {
  closeQueues,
  transcodeQueue,
  uploadSegmentsQueue,
  finalizeQueue,
  deletionQueue,
} from './queue/bull-config.js';
import { closeWorkers } from './queue/processors.js';
import { createApp } from './app.js';
import { createShutdown } from './shutdown.js';
import { sweepExpiredUploads, UPLOAD_SWEEP_INTERVAL_MS } from './upload/upload-store.js';
import { sweepFinishedSources } from './upload/source-files.js';
import { sourceFileStates, deleteDetachedUploadSessions } from './db/queries/uploads.js';
import { pruneEndedStudioSessions } from './db/queries/sessions.js';
import { pruneWebhookDeliveries } from './db/queries/webhooks.js';
import { WEBHOOK_DELIVERY_RETENTION_MS } from './webhooks/delivery.js';
import { ENDED_SESSION_RETENTION_MS } from './api/routes/auth.js';
import { signInWarnings } from './api/auth/startup.js';
import { BOOTSTRAP_CREATOR_ADDRESS, seedBootstrapApiKey } from './db/api-key-seeding.js';
import { getClient } from './storage/sia-client.js';
import {
  scheduleReconciliation,
  triggerReconciliation,
  closeReconcileWorker,
} from './reconcile/worker.js';

// Importing the deletion worker module starts its BullMQ worker (same
// in-process model as the transcode/reconcile workers).
import { scheduleDeletionGc, closeDeletionWorker } from './deletion/worker.js';
// importing the webhook module starts its worker, which sends the queued
// deliveries
import { webhookDispatcher, closeWebhookWorker } from './webhooks/worker.js';

for (const dir of [env.UPLOAD_DIR, env.TRANSCODE_OUTPUT_DIR]) {
  mkdirSync(dir, { recursive: true });
}

// read from package.json rather than npm_package_version, which is only set
// when the process is started through npm
const APP_VERSION = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string;
  }
).version;

const { app, tusServer, expireAbandonedUploads } = createApp({
  logger,
  version: APP_VERSION,
  startedAt: new Date(),
  queues: {
    transcode: transcodeQueue,
    uploadSegments: uploadSegmentsQueue,
    finalize: finalizeQueue,
    deletion: deletionQueue,
  },
  pingRedis: async () => {
    // the bullmq client interface has no ping; any read is a real round trip
    const client = await transcodeQueue.client;
    await client.get('sluby:health');
  },
  webhookDispatcher,
  triggerReconciliation: () => triggerReconciliation(),
});

if (sessionSecretGenerated) {
  logger.warn(
    'SESSION_SECRET is not set: using a random one for this run, so Studio sessions and ' +
      'signed URLs stop working when the backend restarts. Set SESSION_SECRET to keep them.',
  );
}
if (env.EXPOSE_ERROR_STACKS) {
  logger.warn(
    'EXPOSE_ERROR_STACKS is on: error responses carry internal messages and stack traces',
  );
}

// the bootstrap key exists before the first request, so a script that waits
// for /health can use it at once; a server without its only key is no use,
// so a failure stops the boot
if (env.BOOTSTRAP_API_KEY) {
  try {
    const outcome = await seedBootstrapApiKey(db, env.BOOTSTRAP_API_KEY);
    if (outcome === 'created') {
      logger.info({ platformAddress: BOOTSTRAP_CREATOR_ADDRESS }, 'Bootstrap API key seeded');
    } else if (outcome === 'retired') {
      logger.warn(
        'BOOTSTRAP_API_KEY was deleted or rotated away earlier and is not seeded again. ' +
          'Remove it from the environment, or set a new key.',
      );
    }
  } catch (err) {
    logger.fatal({ err }, 'Could not seed BOOTSTRAP_API_KEY');
    await closeDatabase().catch(() => {});
    process.exit(1);
  }
}

// Make an open Studio or a plaintext session cookie explicit rather than silent.
for (const warning of signInWarnings({
  authDisabled: env.AUTH_DISABLED,
  publicUrl: env.PUBLIC_URL,
})) {
  logger.warn(warning);
}

// Register the periodic reconciliation sweep (non-fatal if Redis is down).
scheduleReconciliation().catch((err) => {
  logger.warn({ err }, 'Failed to schedule reconciliation sweep (non-fatal)');
});

// Register the periodic deletion GC sweep (non-fatal if Redis is down).
scheduleDeletionGc().catch((err) => {
  logger.warn({ err }, 'Failed to schedule deletion GC sweep (non-fatal)');
});

// Sweep incomplete tus uploads past their expiry, now and then every hour.
// A timer in this process rather than a queue job, because the files live on
// this process's UPLOAD_DIR. The same hour prunes ended Studio sessions, which
// sign-in prunes only for the login signing in, and old webhook delivery logs.
const sweepUploads = async () => {
  await sweepExpiredUploads(tusServer, logger);
  // the rows of those uploads: failed sessions, and no empty assets left behind
  await expireAbandonedUploads().catch((err) =>
    logger.error({ err }, 'Closing expired uploads failed'),
  );
  await sweepFinishedSources({
    uploadDir: env.UPLOAD_DIR,
    states: sourceFileStates,
    forgetDetached: deleteDetachedUploadSessions,
    log: logger,
  });
};
const pruneSessions = () =>
  pruneEndedStudioSessions(new Date(Date.now() - ENDED_SESSION_RETENTION_MS)).catch((err) =>
    logger.warn({ err }, 'Could not prune ended Studio sessions'),
  );
const pruneDeliveries = () =>
  pruneWebhookDeliveries(new Date(Date.now() - WEBHOOK_DELIVERY_RETENTION_MS)).catch((err) =>
    logger.warn({ err }, 'Could not prune old webhook deliveries'),
  );
void sweepUploads();
void pruneSessions();
void pruneDeliveries();
const uploadSweepTimer = setInterval(() => {
  void sweepUploads();
  void pruneSessions();
  void pruneDeliveries();
}, UPLOAD_SWEEP_INTERVAL_MS);
uploadSweepTimer.unref();

const server = app.listen(env.PORT, env.HOST, () => {
  logger.info({ host: env.HOST, port: env.PORT }, 'Sluby backend is running');
  // connecting to the indexer takes a while on a cold start; do it now rather
  // than inside the first upload or status check. a failure here is only
  // logged: getClient retries on the next call.
  if (env.SIA_APP_KEY) {
    getClient().catch((err) =>
      logger.warn({ err }, 'Could not connect to the Sia indexer at startup'),
    );
  } else {
    logger.warn('SIA_APP_KEY is not set: uploads need an indexer connection (see connect-indexer)');
  }
});

const shutdown = createShutdown({
  server,
  log: logger,
  stopTimers: () => clearInterval(uploadSweepTimer),
  closeWorkers: () =>
    Promise.all([
      closeWorkers(),
      closeReconcileWorker(),
      closeDeletionWorker(),
      closeWebhookWorker(),
    ]),
  closeQueues,
  closeDatabase,
  exit: (code) => process.exit(code),
});

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// after either of these the process state is unknown, so it shuts down and
// exits non-zero for the restart policy to bring it back clean
process.on('unhandledRejection', (reason) => {
  logger.fatal({ reason }, 'Unhandled promise rejection, shutting down');
  shutdown('unhandledRejection', true);
});
process.on('uncaughtException', (err) => {
  logger.fatal({ err }, 'Uncaught exception, shutting down');
  shutdown('uncaughtException', true);
});
