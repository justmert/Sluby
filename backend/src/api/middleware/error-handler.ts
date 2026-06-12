import type { Request, Response, NextFunction } from 'express';
import { logger } from '../../config/logger.js';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

// Express error handlers require 4 parameters even if not all are used
export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    res.status(err.statusCode).json({
      error: err.message,
      details: err.details,
    });
    return;
  }

  logger.error({ err }, 'Unhandled error');

  res.status(500).json({
    error: 'Internal server error',
  });
}
