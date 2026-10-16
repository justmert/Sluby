import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { toastError, toastSuccess } from './toast';

afterEach(() => vi.restoreAllMocks());

describe('toastError', () => {
  it('keeps the error until it is closed, with a close button', () => {
    const spy = vi.spyOn(toast, 'error').mockReturnValue(1);
    toastError('Could not delete the video. The server ran into a problem (error 500).');
    expect(spy).toHaveBeenCalledWith(expect.any(String), {
      duration: Infinity,
      closeButton: true,
    });
  });

  it('passes other options through', () => {
    const spy = vi.spyOn(toast, 'error').mockReturnValue(1);
    toastError('x', { id: 'one' });
    expect(spy).toHaveBeenCalledWith('x', { duration: Infinity, closeButton: true, id: 'one' });
  });
});

describe('toastSuccess', () => {
  it('leaves after 4 seconds', () => {
    const spy = vi.spyOn(toast, 'success').mockReturnValue(1);
    toastSuccess('Video deleted');
    expect(spy).toHaveBeenCalledWith('Video deleted', { duration: 4_000 });
  });

  it('passes an action through', () => {
    const spy = vi.spyOn(toast, 'success').mockReturnValue(1);
    const action = { label: 'Copy embed code', onClick: () => {} };
    toastSuccess('“Teaser” is ready', { action });
    expect(spy).toHaveBeenCalledWith('“Teaser” is ready', { duration: 4_000, action });
  });
});
