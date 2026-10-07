import type { Server } from 'node:http';
import type { Logger } from 'pino';

/**
 * How long a shutdown may take before the process exits anyway. The compose
 * files give the backend a stop_grace_period of 30s, so this leaves docker a
 * few seconds before it sends SIGKILL. A job still running then is not lost:
 * its lock lapses and bullmq's stalled-job check runs it again on the next
 * start.
 */
export const SHUTDOWN_DEADLINE_MS = 25_000;

export interface ShutdownDeps {
  server: Server;
  log: Logger;
  /** Timers and other in-process work to stop first. */
  stopTimers: () => void;
  /** Stop taking jobs and let the running ones finish. */
  closeWorkers: () => Promise<unknown>;
  closeQueues: () => Promise<unknown>;
  closeDatabase: () => Promise<unknown>;
  exit: (code: number) => void;
  deadlineMs?: number;
}

/** Resolves once every connection has ended; a server that never listened counts as closed. */
export function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err && (err as NodeJS.ErrnoException).code !== 'ERR_SERVER_NOT_RUNNING') reject(err);
      else resolve();
    });
    // idle keep-alive sockets would otherwise hold close() open until they time out
    server.closeIdleConnections();
  });
}

/**
 * The process's one shutdown. The first call runs it; later calls (a second
 * signal, an error while shutting down) only log, so nothing is closed twice.
 * HTTP and the workers drain together, then the queues and the database pool
 * close. Exit code 0 when everything closed in time, 1 on an error, on the
 * deadline, or when the reason was a crash.
 */
export function createShutdown(deps: ShutdownDeps): (reason: string, failed?: boolean) => void {
  let started = false;
  return (reason, failed = false) => {
    if (started) {
      deps.log.warn({ reason }, 'Shutdown already in progress');
      return;
    }
    started = true;
    deps.log.info({ reason }, 'Received shutdown signal, starting graceful shutdown');

    const deadlineMs = deps.deadlineMs ?? SHUTDOWN_DEADLINE_MS;
    const deadline = setTimeout(() => {
      deps.log.error({ deadlineMs }, 'Shutdown did not finish in time, exiting');
      deps.exit(1);
    }, deadlineMs);
    deadline.unref();

    void (async () => {
      try {
        deps.stopTimers();
        await Promise.all([
          closeServer(deps.server).then(() => deps.log.info('HTTP server closed')),
          deps.closeWorkers().then(() => deps.log.info('Queue workers closed')),
        ]);
        await deps.closeQueues();
        await deps.closeDatabase();
        clearTimeout(deadline);
        deps.log.info('Graceful shutdown complete');
        deps.exit(failed ? 1 : 0);
      } catch (err) {
        clearTimeout(deadline);
        deps.log.error({ err }, 'Error during graceful shutdown');
        deps.exit(1);
      }
    })();
  };
}
