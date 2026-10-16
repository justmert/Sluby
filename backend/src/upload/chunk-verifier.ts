import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

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
