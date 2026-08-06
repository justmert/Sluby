import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { logger } from '../config/logger.js';

/**
 * Compute SHA-256 hash of a file using streaming to handle large files.
 */
export async function computeFileHash(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);

    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * Verify that a file matches the expected SHA-256 hash.
 */
export async function verifyFileHash(filePath: string, expectedHash: string): Promise<boolean> {
  const actualHash = await computeFileHash(filePath);
  const matches = actualHash === expectedHash;

  if (!matches) {
    logger.warn(
      {
        filePath,
        expected: expectedHash,
        actual: actualHash,
      },
      'File hash mismatch',
    );
  }

  return matches;
}
