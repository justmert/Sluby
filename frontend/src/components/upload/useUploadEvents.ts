import { useEffect, useEffectEvent, useRef } from 'react';
import { useNavigate } from 'react-router';
import { statusSpec } from '@/components/shared/status';
import { ROUTES } from '@/lib/constants';
import { primaryEmbed } from '@/lib/embed';
import { toastError, toastSuccess } from '@/lib/toast';
import { recordUpload } from '@/lib/upload-history';
import { useUploadSheet } from '@/lib/upload-sheet';
import {
  useUploads,
  type UploadPhase,
  type UploadState,
  type UploadStore,
} from '@/lib/upload-store';

type Seen = Map<string, { phase: UploadPhase; resumed: boolean }>;

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
 * once each; ready and failed are announced by their toasts.
 */
export function useUploadEvents(store: UploadStore, accountId: string) {
  const { uploads } = useUploads(store);
  const navigate = useNavigate();
  const sheet = useUploadSheet();
  const seen = useRef<Seen | null>(null);
  const region = useRef<HTMLSpanElement>(null);

  const changed = useEffectEvent((list: UploadState[]) => {
    const first = seen.current === null;
    const before: Seen = seen.current ?? new Map();
    const next: Seen = new Map();
    const said: string[] = [];
    for (const u of list) {
      const was = before.get(u.key);
      next.set(u.key, { phase: u.phase, resumed: u.resumedFrom !== null });
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
      if (u.phase === 'ready' && u.assetId) {
        toastSuccess(`“${u.title}” is ready`, {
          action: { label: 'Copy embed code', onClick: () => void copyEmbed(u) },
        });
      } else if (u.phase === 'failed') {
        // a 401 hands over to the sign-in screen, which says why
        if (u.authFailed) continue;
        // a dropped connection continues by itself; a toast would cry wolf
        if (u.lostConnection) {
          said.push(`“${u.title}”: ${statusSpec('upload', 'offline').label}`);
          continue;
        }
        const action =
          u.assetId && !u.assetGone && u.failedDuring === 'processing'
            ? { label: 'Open video', onClick: () => void navigate(ROUTES.video(u.assetId!)) }
            : { label: 'Open uploads', onClick: () => sheet.open() };
        toastError(`“${u.title}” failed. ${u.error ?? ''}`.trim(), { action });
      } else {
        said.push(`“${u.title}”: ${statusSpec('upload', u.phase).label}`);
      }
    }
    seen.current = next;
    if (said.length > 0 && region.current) region.current.textContent = said.join('. ');
  });

  useEffect(() => changed(uploads), [uploads]);

  return region;
}
