import { toast, type ExternalToast } from 'sonner';

// the only way pages raise toasts (plan D-20), so every toast lasts as long
// as its kind should

/** How long a success stays. */
export const SUCCESS_TOAST_MS = 4_000;

/**
 * An error toast that stays until it is closed. It carries a reason the
 * reader has to take in, so it must not leave on a timer (WCAG 2.2.1).
 */
export function toastError(message: string, options?: ExternalToast) {
  return toast.error(message, { duration: Infinity, closeButton: true, ...options });
}

/** A success toast that leaves after 4 seconds; the change it reports is on screen already. */
export function toastSuccess(message: string, options?: ExternalToast) {
  return toast.success(message, { duration: SUCCESS_TOAST_MS, ...options });
}
