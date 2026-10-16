import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ChunkStrip } from './ChunkStrip';

const MiB = 1024 * 1024;

describe('ChunkStrip', () => {
  it('moves only the cell being sent, and nothing once the transfer stops', () => {
    const { container, rerender } = render(
      <ChunkStrip bytesUploaded={12 * MiB} bytesTotal={32 * MiB} chunkSize={8 * MiB} active />,
    );
    const sending = container.querySelectorAll('[data-sending]');
    expect(sending).toHaveLength(1);
    expect(container.querySelectorAll('.animate-pulse')).toHaveLength(0);
    // the second of four cells is half sent
    expect(Array.from(sending[0].parentElement!.children).indexOf(sending[0])).toBe(1);

    rerender(
      <ChunkStrip
        bytesUploaded={12 * MiB}
        bytesTotal={32 * MiB}
        chunkSize={8 * MiB}
        active={false}
      />,
    );
    expect(container.querySelectorAll('[data-sending]')).toHaveLength(0);
  });
});
