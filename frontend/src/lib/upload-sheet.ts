import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { UPLOAD_PARAM } from './constants';

/*
 * the upload sheet is open while the current url has ?upload=1, on any
 * route (plan D-08), so /studio/upload, old docs links and a reload all land
 * with it open. files cannot ride in a url, so open(files) parks them here
 * until the sheet takes them.
 */

let pending: File[] = [];
const listeners = new Set<() => void>();

/** Hand over the files waiting for the sheet, once: a second call gets none. */
export function takePendingFiles(): File[] {
  const files = pending;
  pending = [];
  return files;
}

/**
 * Run `listener` when files arrive while the sheet may already be open, such
 * as a second drop. Returns the unsubscribe. The listener calls
 * takePendingFiles itself.
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

/** Marks the history entry that opening the sheet pushed, so closing can go back over it. */
interface SheetState {
  uploadSheet?: true;
}

export interface UploadSheet {
  isOpen: boolean;
  /** Open the sheet, with files to add as drafts (from a drop or a picker). */
  open: (files?: File[]) => void;
  close: () => void;
}

export function useUploadSheet(): UploadSheet {
  const location = useLocation();
  const navigate = useNavigate();
  const isOpen = new URLSearchParams(location.search).get(UPLOAD_PARAM) === '1';
  const openedHere = (location.state as SheetState | null)?.uploadSheet === true;

  const open = useCallback(
    (files?: File[]) => {
      park(files ?? []);
      if (isOpen) return;
      const params = new URLSearchParams(location.search);
      params.set(UPLOAD_PARAM, '1');
      // a new history entry, so Back closes the sheet (as on a phone)
      void navigate(
        { pathname: location.pathname, search: `?${params}`, hash: location.hash },
        { state: { uploadSheet: true } satisfies SheetState },
      );
    },
    [isOpen, location.pathname, location.search, location.hash, navigate],
  );

  const close = useCallback(() => {
    if (!isOpen) return;
    // opened by open(): step back over that entry, so Back does not reopen it
    if (openedHere) {
      void navigate(-1);
      return;
    }
    // arrived with ?upload=1 (a link, a reload, the /studio/upload redirect)
    const params = new URLSearchParams(location.search);
    params.delete(UPLOAD_PARAM);
    const search = params.toString();
    void navigate(
      { pathname: location.pathname, search: search ? `?${search}` : '', hash: location.hash },
      { replace: true },
    );
  }, [isOpen, openedHere, location.pathname, location.search, location.hash, navigate]);

  return { isOpen, open, close };
}
