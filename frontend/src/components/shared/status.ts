/*
 * the one place a status becomes a label and a tone. pages never map
 * statuses themselves; they render <StatusBadge kind="asset" status={...} />.
 * tones follow the token rules in index.css: progress is work under way,
 * warning needs attention, danger failed.
 */

export type StatusTone =
  'neutral' | 'progress' | 'success' | 'warning' | 'danger' | 'info' | 'outline';

export interface StatusSpec {
  label: string;
  tone: StatusTone;
  /** work is under way */
  busy?: boolean;
}

const spec = (label: string, tone: StatusTone, busy = false): StatusSpec => ({
  label,
  tone,
  busy,
});

export const STATUS = {
  /** a video, VideoAssetStatus */
  asset: {
    created: spec('Waiting for file', 'neutral'),
    uploading: spec('Uploading', 'progress', true),
    processing: spec('Processing', 'progress', true),
    ready: spec('Ready', 'success'),
    failed: spec('Failed', 'danger'),
    /** created or uploading, but no bytes have come for a while (see isInterrupted) */
    interrupted: spec('Interrupted', 'warning'),
  },
  /** an upload in this browser (upload-store phases) */
  upload: {
    /** waiting in this tab's queue for the running upload to finish */
    queued: spec('Waiting', 'neutral'),
    uploading: spec('Uploading', 'progress', true),
    paused: spec('Paused', 'neutral'),
    finishing: spec('Finishing', 'progress', true),
    processing: spec('Processing', 'progress', true),
    ready: spec('Ready', 'success'),
    failed: spec('Failed', 'danger'),
    cancelled: spec('Canceled', 'neutral'),
    /** its video was deleted, here or elsewhere, before processing finished */
    deleted: spec('Deleted', 'neutral'),
    /** the connection dropped; it continues by itself once the browser is online */
    offline: spec('Offline', 'neutral'),
  },
  /** a processing job, ProcessingJob status */
  job: {
    queued: spec('Waiting to start', 'neutral'),
    processing: spec('Processing', 'progress', true),
    retrying: spec('Trying again', 'progress', true),
    completed: spec('Done', 'success'),
    failed: spec('Failed', 'danger'),
  },
  /** an api key */
  key: {
    creating: spec('Creating', 'neutral', true),
    active: spec('Active', 'success'),
    // the old key of a rotation, working until its grace period ends
    replaced: spec('Replaced', 'warning'),
    revoked: spec('Revoked', 'neutral'),
  },
  /** a member of the workspace */
  member: {
    active: spec('Active', 'success'),
    // cannot sign in until restored
    removed: spec('Removed', 'neutral'),
  },
  /** a webhook endpoint */
  webhook: {
    active: spec('Active', 'success'),
    inactive: spec('Paused', 'warning'),
  },
  /** one webhook delivery */
  delivery: {
    pending: spec('Sending', 'progress', true),
    delivered: spec('Delivered', 'success'),
    failed: spec('Not delivered', 'danger'),
  },
  /** a service probe or the whole server, system status */
  health: {
    ok: spec('Operational', 'success'),
    degraded: spec('Degraded', 'warning'),
    down: spec('Down', 'danger'),
    unknown: spec('Not checked yet', 'neutral'),
  },
  /** the storage check (reconciliation run) */
  check: {
    running: spec('Checking', 'progress', true),
    ok: spec('All present', 'success'),
    drift: spec('Needs attention', 'warning'),
    failed: spec('Check failed', 'danger'),
  },
  /** who can watch a video; public draws no badge (see AccessBadge) */
  access: {
    public: spec('Public', 'neutral'),
    private: spec('Private', 'outline'),
  },
  /** who can play a playback id */
  policy: {
    public: spec('Open', 'neutral'),
    signed: spec('Signed URL', 'outline'),
  },
  /** a signed-in browser */
  session: {
    current: spec('This browser', 'info'),
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
  if (code == null) return { label: 'No response', tone: 'danger' };
  if (code < 300) return { label: String(code), tone: 'success' };
  if (code < 500) return { label: String(code), tone: 'warning' };
  return { label: String(code), tone: 'danger' };
}
