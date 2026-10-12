import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CirclePause,
  Clock,
  Lock,
  Monitor,
  Trash2,
  TriangleAlert,
  WifiOff,
  type LucideIcon,
} from 'lucide-react';

/*
 * the one place a status becomes a label, a tone and an icon. pages never map
 * statuses themselves; they render <StatusBadge kind="asset" status={...} />.
 * tones follow the token rules in index.css: progress is work under way,
 * warning needs attention, danger failed.
 */

export type StatusTone =
  'neutral' | 'progress' | 'success' | 'warning' | 'danger' | 'info' | 'outline';

export interface StatusSpec {
  label: string;
  tone: StatusTone;
  /** shown before the label; busy states show a spinner or a dot instead */
  icon?: LucideIcon;
  /** work is under way */
  busy?: boolean;
}

const spec = (label: string, tone: StatusTone, icon?: LucideIcon, busy = false): StatusSpec => ({
  label,
  tone,
  icon,
  busy,
});

export const STATUS = {
  /** a video, VideoAssetStatus */
  asset: {
    created: spec('Waiting for file', 'neutral', Clock),
    uploading: spec('Uploading', 'progress', undefined, true),
    processing: spec('Processing', 'progress', undefined, true),
    ready: spec('Ready', 'success', CircleCheck),
    failed: spec('Failed', 'danger', CircleAlert),
    /** created or uploading, but no bytes have come for a while (see isInterrupted) */
    interrupted: spec('Interrupted', 'warning', CirclePause),
  },
  /** an upload in this browser (upload-store phases) */
  upload: {
    /** waiting in this tab's queue for the running upload to finish */
    queued: spec('Waiting', 'neutral', Clock),
    uploading: spec('Uploading', 'progress', undefined, true),
    paused: spec('Paused', 'neutral', CirclePause),
    finishing: spec('Finishing', 'progress', undefined, true),
    processing: spec('Processing', 'progress', undefined, true),
    ready: spec('Ready', 'success', CircleCheck),
    failed: spec('Failed', 'danger', CircleAlert),
    cancelled: spec('Canceled', 'neutral'),
    /** its video was deleted, here or elsewhere, before processing finished */
    deleted: spec('Deleted', 'neutral', Trash2),
    /** the connection dropped; it continues by itself once the browser is online */
    offline: spec('Offline', 'neutral', WifiOff),
  },
  /** a processing job, ProcessingJob status */
  job: {
    queued: spec('Waiting to start', 'neutral', Clock),
    processing: spec('Processing', 'progress', undefined, true),
    retrying: spec('Trying again', 'progress', undefined, true),
    completed: spec('Done', 'success', CircleCheck),
    failed: spec('Failed', 'danger', CircleAlert),
  },
  /** an api key */
  key: {
    creating: spec('Creating', 'neutral', undefined, true),
    active: spec('Active', 'success'),
    // the old key of a rotation, working until its grace period ends
    replaced: spec('Replaced', 'warning', Clock),
    revoked: spec('Revoked', 'neutral'),
  },
  /** a webhook endpoint */
  webhook: {
    active: spec('Active', 'success'),
    inactive: spec('Paused', 'warning', CirclePause),
  },
  /** one webhook delivery */
  delivery: {
    pending: spec('Sending', 'progress', undefined, true),
    delivered: spec('Delivered', 'success', CircleCheck),
    failed: spec('Not delivered', 'danger', CircleAlert),
  },
  /** a service probe or the whole server, system status */
  health: {
    ok: spec('Operational', 'success'),
    degraded: spec('Degraded', 'warning', TriangleAlert),
    down: spec('Down', 'danger', CircleAlert),
    unknown: spec('Not checked yet', 'neutral', CircleDashed),
  },
  /** the storage check (reconciliation run) */
  check: {
    running: spec('Checking', 'progress', undefined, true),
    ok: spec('All present', 'success', CircleCheck),
    drift: spec('Needs attention', 'warning', TriangleAlert),
    failed: spec('Check failed', 'danger', CircleAlert),
  },
  /** who can watch a video; public draws no badge (see AccessBadge) */
  access: {
    public: spec('Public', 'neutral'),
    private: spec('Private', 'outline', Lock),
  },
  /** who can play a playback id */
  policy: {
    public: spec('Open', 'neutral'),
    signed: spec('Signed URL', 'outline', Lock),
  },
  /** a signed-in browser */
  session: {
    current: spec('This browser', 'info', Monitor),
    other: spec('Signed in', 'neutral'),
  },
} as const satisfies Record<string, Record<string, StatusSpec>>;

export type StatusKind = keyof typeof STATUS;
export type StatusOf<K extends StatusKind> = keyof (typeof STATUS)[K];

/** The spec for a status; an unknown one is shown as itself, neutral, rather than dropped. */
export function statusSpec<K extends StatusKind>(
  kind: K,
  status: StatusOf<K> | string,
): StatusSpec {
  const table = STATUS[kind] as Record<string, StatusSpec>;
  const found = table[status as string];
  if (found) return found;
  const text = String(status).replace(/[_-]/g, ' ');
  return { label: text.charAt(0).toUpperCase() + text.slice(1), tone: 'neutral' };
}

/** The tone and label for an http answer: 2xx success, 4xx warning, 5xx or none danger. */
export function httpSpec(code: number | null | undefined): StatusSpec {
  if (code == null) return { label: 'No response', tone: 'danger', icon: CircleAlert };
  if (code < 300) return { label: String(code), tone: 'success' };
  if (code < 500) return { label: String(code), tone: 'warning' };
  return { label: String(code), tone: 'danger' };
}
