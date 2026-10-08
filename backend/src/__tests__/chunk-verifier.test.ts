import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createHash } from 'node:crypto';
import { Readable } from 'node:stream';

// Mock fs.createReadStream to return a stream with known content
vi.mock('node:fs', () => ({
  createReadStream: vi.fn(),
}));

import { computeFileHash } from '../upload/chunk-verifier.js';
import { createReadStream } from 'node:fs';

function makeReadStream(data: Buffer): Readable {
  const stream = new Readable({
    read() {
      this.push(data);
      this.push(null);
    },
  });
  return stream;
}

function sha256hex(data: Buffer): string {
  return createHash('sha256').update(data).digest('hex');
}

describe('chunk-verifier', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('computeFileHash', () => {
    it('should compute the SHA-256 hash of a file', async () => {
      const content = Buffer.from('hello world');
      const expectedHash = sha256hex(content);

      vi.mocked(createReadStream).mockReturnValue(makeReadStream(content) as any);

      const hash = await computeFileHash('/fake/path.mp4');

      expect(hash).toBe(expectedHash);
      expect(createReadStream).toHaveBeenCalledWith('/fake/path.mp4');
    });

    it('should handle empty files', async () => {
      const content = Buffer.alloc(0);
      const expectedHash = sha256hex(content);

      vi.mocked(createReadStream).mockReturnValue(makeReadStream(content) as any);

      const hash = await computeFileHash('/empty/file');
      expect(hash).toBe(expectedHash);
    });

    it('should handle large content (multiple chunks)', async () => {
      const chunk1 = Buffer.from('chunk1');
      const chunk2 = Buffer.from('chunk2');
      const chunk3 = Buffer.from('chunk3');
      const fullContent = Buffer.concat([chunk1, chunk2, chunk3]);
      const expectedHash = sha256hex(fullContent);

      const stream = new Readable({
        read() {
          this.push(chunk1);
          this.push(chunk2);
          this.push(chunk3);
          this.push(null);
        },
      });

      vi.mocked(createReadStream).mockReturnValue(stream as any);

      const hash = await computeFileHash('/large/file');
      expect(hash).toBe(expectedHash);
    });

    it('should reject when the stream emits an error', async () => {
      const stream = new Readable({
        read() {
          this.destroy(new Error('Disk read error'));
        },
      });

      vi.mocked(createReadStream).mockReturnValue(stream as any);

      await expect(computeFileHash('/broken/file')).rejects.toThrow('Disk read error');
    });
  });
});
