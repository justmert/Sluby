import pino from 'pino';
import { env } from './env.js';

/**
 * The backend's one logger. Modules take `logger.child({ name })` so every
 * line goes through the same stream in the same format: pretty outside
 * production, json in production.
 */
export const logger = pino({
  name: 'sluby',
  level: env.LOG_LEVEL,
  transport:
    env.NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true } }
      : undefined,
});

/** The sia sdk's level names for a pino level; the sdk has no fatal or silent. */
export function sdkLogLevel(
  level: typeof env.LOG_LEVEL,
): 'off' | 'error' | 'warn' | 'info' | 'debug' | 'trace' {
  if (level === 'silent') return 'off';
  if (level === 'fatal') return 'error';
  return level;
}
