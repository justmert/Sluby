import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router';
import { useSystemStatus, type SystemStatus } from '@/hooks/useSystemStatus';
import { ROUTES } from '@/lib/constants';
import { useSession } from '@/lib/session';
import { toastError, toastSuccess, toastWarning } from '@/lib/toast';

/** One toast id, so a newer state replaces the last one instead of piling up. */
export const SERVICE_TOAST_ID = 'service-status';

/** What is not answering, in words: "Sia storage", "the database and the job queue". */
function failing(status: SystemStatus): string[] {
  const names: string[] = [];
  if (!status.indexer.ok) names.push('Sia storage');
  if (!status.database.ok) names.push('the database');
  if (!status.redis.ok) names.push('the job queue');
  return names;
}

function sentence(names: string[]): string {
  if (names.length === 0) return 'Some services are not working.';
  const list =
    names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
  const verb = names.length === 1 ? 'is' : 'are';
  return `${list.charAt(0).toUpperCase()}${list.slice(1)} ${verb} not working.`;
}

/**
 * Toasts when the server's health changes while the Studio is open: once
 * per change, never per poll, and not for the state found on load (the
 * Health dot shows that). A change counts once two polls in a row agree, so
 * a probe that fails for one poll does not toast (and get read out) twice,
 * down and then back. Shares the shell's status poll.
 */
export function LiveAlerts() {
  const status = useSystemStatus({ poll: true });
  const { operator } = useSession();
  const navigate = useNavigate();
  // the verdict last told (or found on load), and the previous poll's
  const told = useRef<SystemStatus['status'] | null>(null);
  const previous = useRef<SystemStatus['status'] | null>(null);
  const current = status.data?.status;

  useEffect(() => {
    if (!status.data || !current) return;
    const before = previous.current;
    previous.current = current;
    if (told.current === null) {
      told.current = current;
      return;
    }
    if (current === told.current || current !== before) return;
    told.current = current;

    const action = operator
      ? { label: 'Open health', onClick: () => void navigate(ROUTES.DEPLOYMENT) }
      : undefined;
    const message = sentence(failing(status.data));
    if (current === 'ok') {
      // sonner keeps the old toast's options under the same id; clear the
      // action and close button the warning had
      toastSuccess('Everything is working again.', {
        id: SERVICE_TOAST_ID,
        action: undefined,
        closeButton: undefined,
      });
    } else if (current === 'down') {
      toastError(`This server is down. ${message}`, { id: SERVICE_TOAST_ID, action });
    } else {
      toastWarning(message, { id: SERVICE_TOAST_ID, action });
    }
    // runs once per poll answer; status.data and the rest are read as they are then
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.dataUpdatedAt]);

  return null;
}
