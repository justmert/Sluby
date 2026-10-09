import { afterEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { toastError } from './toast';

afterEach(() => vi.restoreAllMocks());

describe('toastError', () => {
  it('keeps the error until it is closed', () => {
    const spy = vi.spyOn(toast, 'error').mockReturnValue(1);
    toastError('Could not delete the video. The server ran into a problem (error 500).');
    expect(spy).toHaveBeenCalledWith(expect.any(String), { duration: Infinity });
  });

  it('passes other options through', () => {
    const spy = vi.spyOn(toast, 'error').mockReturnValue(1);
    toastError('x', { id: 'one' });
    expect(spy).toHaveBeenCalledWith('x', { duration: Infinity, id: 'one' });
  });
});
