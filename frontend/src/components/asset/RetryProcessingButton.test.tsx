import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkValue, findOperation, responseSchema } from '@/test/openapi';
import { jsonFetch, renderPage, reply } from '@/test/render';
import { restartedMessage } from './processing';
import { RetryProcessingButton } from './RetryProcessingButton';

const asset = { id: 'a1', title: 'Teaser' };
const retryOp = findOperation('POST', '/api/v1/assets/a1/retry')!;

afterEach(() => vi.unstubAllGlobals());

describe('restartedMessage', () => {
  it('names the restart stage with the stage labels', () => {
    expect(restartedMessage('transcode')).toBe('Processing restarted from Transcoding');
    expect(restartedMessage('upload-segments')).toBe('Processing restarted from Storing on Sia');
    expect(restartedMessage('upload-segments', 'Teaser')).toBe(
      '“Teaser”: processing restarted from Storing on Sia',
    );
  });
});

describe('RetryProcessingButton', () => {
  it('uses a fixture that matches the documented retry answer', () => {
    expect(checkValue({ stage: 'upload-segments' }, responseSchema(retryOp)!)).toEqual([]);
  });

  it('restarts processing and says where the new run starts', async () => {
    const stub = jsonFetch({
      'POST /api/v1/assets/a1/retry': reply(202, { stage: 'upload-segments' }),
    });
    vi.stubGlobal('fetch', vi.fn(stub));
    renderPage(<RetryProcessingButton asset={asset} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry processing' }));
    expect(await screen.findByText('Processing restarted from Storing on Sia')).toBeInTheDocument();
    expect(stub.calls.map((c) => `${c.method} ${c.path}`)).toEqual([
      'POST /api/v1/assets/a1/retry',
    ]);
  });

  it('puts the title in the toast when asked', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(jsonFetch({ 'POST /api/v1/assets/a1/retry': reply(202, { stage: 'transcode' }) })),
    );
    renderPage(<RetryProcessingButton asset={asset} named />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry processing' }));
    expect(
      await screen.findByText('“Teaser”: processing restarted from Transcoding'),
    ).toBeInTheDocument();
  });

  it('turns a refusal into a sentence with a lead, never the raw server text', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        jsonFetch({
          'POST /api/v1/assets/a1/retry': reply(502, '<html><body>502 Bad Gateway</body></html>'),
        }),
      ),
    );
    renderPage(<RetryProcessingButton asset={asset} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry processing' }));
    const toast = await screen.findByText(/^Could not retry\. /);
    expect(toast.textContent).not.toContain('<html>');
    // errors stay until they are closed
    expect(screen.getByRole('button', { name: /close/i })).toBeInTheDocument();
  });

  it('is busy and cannot be pressed twice while the retry runs', async () => {
    let release!: () => void;
    const held = new Promise<void>((r) => (release = r));
    const stub = jsonFetch({
      'POST /api/v1/assets/a1/retry': async () => {
        await held;
        return reply(202, { stage: 'transcode' });
      },
    });
    vi.stubGlobal('fetch', vi.fn(stub));
    renderPage(<RetryProcessingButton asset={asset} />);
    const button = screen.getByRole('button', { name: 'Retry processing' });
    await userEvent.click(button);
    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
    await userEvent.click(button);
    release();
    await waitFor(() => expect(button).toBeEnabled());
    expect(stub.calls).toHaveLength(1);
  });

  it('keeps the video in the accessible name of the short version', () => {
    renderPage(<RetryProcessingButton asset={asset} compact labelClassName="sr-only" />);
    const button = screen.getByRole('button', { name: 'Retry processing Teaser' });
    expect(button).toHaveTextContent('Retry');
    expect(screen.getByText('Retry')).toHaveClass('sr-only');
  });

  it('can run the retry through another path and leave the result to it', async () => {
    const stub = jsonFetch({});
    vi.stubGlobal('fetch', vi.fn(stub));
    const onRetry = vi.fn().mockResolvedValue(undefined);
    const onRetried = vi.fn();
    renderPage(<RetryProcessingButton asset={asset} onRetry={onRetry} onRetried={onRetried} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry processing' }));
    await waitFor(() => expect(onRetried).toHaveBeenCalledWith(null));
    expect(onRetry).toHaveBeenCalledOnce();
    expect(stub.calls).toEqual([]);
    expect(screen.queryByText(/processing restarted/i)).toBeNull();
  });

  it('shows the error toast when the other path rejects', async () => {
    const onRetry = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    renderPage(<RetryProcessingButton asset={asset} onRetry={onRetry} />);
    await userEvent.click(screen.getByRole('button', { name: 'Retry processing' }));
    expect(await screen.findByText(/^Could not retry\. /)).toBeInTheDocument();
  });
});
