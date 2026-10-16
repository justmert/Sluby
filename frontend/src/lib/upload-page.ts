import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { ROUTES } from './constants';

/*
 * uploading has its own page. files cannot ride in a url, so a drop on
 * another page parks them here and the upload page takes them as it mounts,
 * or right away when it is already showing.
 */

let pending: File[] = [];
const listeners = new Set<() => void>();

/** Hand over the files waiting for the upload page, once: a second call gets none. */
export function takePendingFiles(): File[] {
  const files = pending;
  pending = [];
  return files;
}

/**
 * Run `listener` when files arrive while the upload page may already be
 * showing. Returns the unsubscribe. The listener calls takePendingFiles itself.
 */
export function onPendingFiles(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function park(files: File[]) {
  if (files.length === 0) return;
  pending = [...pending, ...files];
  for (const listener of [...listeners]) listener();
}

/** Whether a pathname is the upload page. */
export const isUploadPage = (pathname: string) =>
  (pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname) === ROUTES.UPLOAD;

/**
 * Go to the upload page, with files to add as drafts (from a drop or a
 * picker). On the page already, the files are added without a new history
 * entry.
 */
export function useOpenUpload(): (files?: File[]) => void {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const here = isUploadPage(pathname);
  return useCallback(
    (files?: File[]) => {
      park(files ?? []);
      if (!here) void navigate(ROUTES.UPLOAD);
    },
    [here, navigate],
  );
}
