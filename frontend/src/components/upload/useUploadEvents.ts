import { useEffect, useEffectEvent, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { statusSpec } from '@/components/shared/status';
import { ROUTES } from '@/lib/constants';
import { primaryEmbed } from '@/lib/embed';
import { toastError, toastSuccess, toastWarning } from '@/lib/toast';
import { rememberUploadOwner } from '@/lib/unfinished-uploads';
import { recordUpload } from '@/lib/upload-history';
import { isUploadPage } from '@/lib/upload-page';
import { endedText } from './upload-status';
import {
  useUploads,
  type UploadPhase,
  type UploadState,
  type UploadStore,
} from '@/lib/upload-store';

type Seen = Map<string, { phase: UploadPhase; resumed: boolean; uploadId: string | null }>;

// a small file goes from uploading to processing within a fraction of a
// second; the region waits this long and then says where each upload ended up
const SETTLE_MS = 700;

async function copyEmbed(u: UploadState) {
  try {
    await navigator.clipboard.writeText(
      primaryEmbed({ id: u.assetId!, accessTier: u.accessTier }).code,
    );
    toastSuccess('Embed code copied');
  } catch {
    toastError('Could not copy. Your browser blocked the clipboard');
  }
}

/**
 * Reacts once to each change of an upload started in this browser, wherever
 * the user is: "“Teaser” is ready" with Copy embed code, "“Teaser” failed"
 * with Open video (D-14), "Continuing “Teaser” from 40%" once the sdk
 * really continued (FLW-04), and the file remembered for the duplicate hint
 * (FLW-47). Other phase changes are written to the returned live region,
 * once they settle, so a burst of phases is said once; ready and failed are
 * announced by their toasts, or by the region while the upload page shows
 * and the row already says so.
 */
export function useUploadEvents(store: UploadStore, accountId: string) {
  const { uploads } = useUploads(store);
  const navigate = useNavigate();
  const onPage = isUploadPage(useLocation().pathname);
  const seen = useRef<Seen | null>(null);
  const region = useRef<HTMLSpanElement>(null);
  // what each upload's last change says, until the region says it
  const pending = useRef(new Map<string, string>());
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const changed = useEffectEvent((list: UploadState[]) => {
    const first = seen.current === null;
    const before: Seen = seen.current ?? new Map();
    const next: Seen = new Map();
    const said = new Map<string, string>();
    for (const u of list) {
      const was = before.get(u.key);
      next.set(u.key, { phase: u.phase, resumed: u.resumedFrom !== null, uploadId: u.uploadId });
      // so the unfinished list of another account in this browser leaves it be
      if (u.uploadId && was?.uploadId !== u.uploadId) rememberUploadOwner(u.uploadId, accountId);
      // mounted with uploads already there: nothing just happened to them
      if (first) continue;

      if (u.resumedFrom !== null && !was?.resumed && u.bytesTotal > 0) {
        const percent = Math.floor((u.resumedFrom / u.bytesTotal) * 100);
        toastSuccess(`Continuing “${u.title}” from ${percent}%`);
      }
      if (was?.phase === u.phase) continue;

      if (u.phase === 'processing' && u.assetId) {
        recordUpload({ fingerprint: u.fingerprint, title: u.title, assetId: u.assetId, accountId });
      }
      // on the upload page the row itself shows it; say it once, without a toast on top
      if (
        (u.phase === 'ready' || u.phase === 'failed') &&
        onPage &&
        !u.authFailed &&
        !u.lostConnection
      ) {
        said.set(u.key, u.phase === 'ready' ? `“${u.title}” is ready` : endedText(u));
      } else if (u.phase === 'ready' && u.assetId) {
        toastSuccess(`“${u.title}” is ready`, {
          action: { label: 'Copy embed code', onClick: () => void copyEmbed(u) },
        });
      } else if (u.phase === 'failed') {
        // a 401 hands over to the sign-in screen, which says why
        if (u.authFailed) continue;
        // a dropped connection continues by itself; a toast would cry wolf
        if (u.lostConnection) {
          said.set(u.key, `“${u.title}”: ${statusSpec('upload', 'offline').label}`);
          continue;
        }
        if (u.assetGone) {
          toastWarning(endedText(u));
          continue;
        }
        const action =
          u.assetId && u.failedDuring === 'processing'
            ? { label: 'Open video', onClick: () => void navigate(ROUTES.video(u.assetId!)) }
            : { label: 'Open uploads', onClick: () => void navigate(ROUTES.UPLOAD) };
        toastError(endedText(u), { action });
      } else {
        said.set(u.key, `“${u.title}”: ${statusSpec('upload', u.phase).label}`);
      }
    }
    seen.current = next;
    if (said.size === 0) return;
    for (const [key, text] of said) pending.current.set(key, text);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (region.current) region.current.textContent = [...pending.current.values()].join('. ');
      pending.current.clear();
    }, SETTLE_MS);
  });

  useEffect(() => changed(uploads), [uploads]);
  useEffect(() => () => clearTimeout(timer.current), []);

  return region;
}
