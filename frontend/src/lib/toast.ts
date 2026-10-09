import { toast, type ExternalToast } from 'sonner';

/**
 * An error toast that stays until it is closed. It carries a reason the
 * reader has to take in, so it must not leave on a timer (WCAG 2.2.1); every
 * toast has a close button. Successes and notes keep the 8 s default.
 */
export function toastError(message: string, options?: ExternalToast) {
  return toast.error(message, { duration: Infinity, ...options });
}
