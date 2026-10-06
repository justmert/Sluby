import pino from 'pino';
import { mkdirSync, readFileSync } from 'node:fs';
import { env } from './config/env.js';
import { db } from './config/database.js';
import { closeDatabase } from './config/database.js';
import {
  closeQueues,
  transcodeQueue,
  uploadSegmentsQueue,
  finalizeQueue,
  deletionQueue,
} from './queue/bull-config.js';
import { closeWorkers } from './queue/processors.js';
import { createApp } from './app.js';
import { sweepExpiredUploads, UPLOAD_SWEEP_INTERVAL_MS } from './upload/upload-store.js';
import { sweepFinishedSources } from './upload/source-files.js';
import { sourceFileStates } from './db/queries/uploads.js';
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

// ──────────────────────────────────────────
// Logger
// ──────────────────────────────────────────

export const logger = pino({
  name: 'sluby',
  level: process.env.LOG_LEVEL || 'info',
  transport:
    process.env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

// ──────────────────────────────────────────
// Ensure required directories exist
// ──────────────────────────────────────────

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

const { app, tusServer } = createApp({
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

// ──────────────────────────────────────────
// Bootstrap API Key (if configured)
// ──────────────────────────────────────────

async function bootstrapApiKey(): Promise<void> {
  if (!env.BOOTSTRAP_API_KEY) return;
  const outcome = await seedBootstrapApiKey(db, env.BOOTSTRAP_API_KEY);
  if (outcome === 'created') {
    logger.info({ platformAddress: BOOTSTRAP_CREATOR_ADDRESS }, 'Bootstrap API key seeded');
  }
}

// ──────────────────────────────────────────
// Server Startup
// ──────────────────────────────────────────

// Seed bootstrap key before accepting requests
bootstrapApiKey().catch((err) => {
  logger.warn({ err }, 'Failed to seed bootstrap API key (non-fatal)');
});

// Make an open Studio explicit rather than a silent default.
if (!env.AUTH_DISABLED && env.GITHUB_ALLOWED_USERS.trim() === '') {
  logger.warn(
    'GITHUB_ALLOWED_USERS is empty: Studio sign-in is open to any GitHub account. ' +
      'Set GITHUB_ALLOWED_USERS to restrict it.',
  );
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
// this process's UPLOAD_DIR.
const sweepUploads = async () => {
  await sweepExpiredUploads(tusServer, logger);
  await sweepFinishedSources({
    uploadDir: env.UPLOAD_DIR,
    states: sourceFileStates,
    log: logger,
  });
};
void sweepUploads();
const uploadSweepTimer = setInterval(() => void sweepUploads(), UPLOAD_SWEEP_INTERVAL_MS);
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

// ──────────────────────────────────────────
// Graceful Shutdown
// ──────────────────────────────────────────

async function gracefulShutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Received shutdown signal, starting graceful shutdown');

  clearInterval(uploadSweepTimer);

  // Stop accepting new connections
  server.close(() => {
    logger.info('HTTP server closed');
  });

  try {
    // Close workers first (stop processing new jobs)
    logger.info('Closing queue workers...');
    await Promise.all([
      closeWorkers(),
      closeReconcileWorker(),
      closeDeletionWorker(),
      closeWebhookWorker(),
    ]);

    // Close queue connections
    logger.info('Closing queue connections...');
    await closeQueues();

    // Close database connection pool
    logger.info('Closing database connection...');
    await closeDatabase();

    logger.info('Graceful shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'Error during graceful shutdown');
    process.exit(1);
  }
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Catch unhandled rejections and exceptions
process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection');
});

process.on('uncaughtException', (error) => {
  logger.fatal({ error }, 'Uncaught exception, shutting down');
  gracefulShutdown('uncaughtException');
});

export { app };
