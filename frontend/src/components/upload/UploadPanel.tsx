import { useEffect, useEffectEvent, useRef, useState, useSyncExternalStore } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, WifiOff, X } from 'lucide-react';
import { AnimatedItem, AnimatedList, Collapse } from '@/components/motion';
import { InlineError } from '@/components/shared/InlineError';
import { SectionHeader } from '@/components/shared/PageHeader';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Field, FieldLabel } from '@/components/ui/field';
import { Progress } from '@/components/ui/progress';
import { Textarea } from '@/components/ui/textarea';
import { withLead } from '@/lib/errors';
import { formatBytes, formatCount, plural } from '@/lib/formatters';
import { useSession } from '@/lib/session';
import { toastSuccess } from '@/lib/toast';
import {
  findUnfinishedUploads,
  isSameFile,
  recheckUnfinishedUpload,
  type UnfinishedUpload,
} from '@/lib/unfinished-uploads';
import { findUpload } from '@/lib/upload-history';
import { onPendingFiles, takePendingFiles } from '@/lib/upload-sheet';
import {
  isTransferring,
  OTHER_TAB,
  titleFromFile,
  useUploads,
  type Draft,
  type UploadStore,
} from '@/lib/upload-store';
import { fileFingerprint, type RemoteUpload, type UploadTabs } from '@/lib/upload-tabs';
import { AccessChoice } from './AccessChoice';
import { DraftList } from './DraftList';
import { draftTitleId, rowTitleId } from './ids';
import { DropZone } from './DropZone';
import { UnfinishedList, type ResumeResult } from './UnfinishedList';
import { UploadRow } from './UploadRow';
import { sentPercent } from './upload-status';

export const DESCRIPTION_MAX = 5_000;
// the counter shows once the description gets near the limit (FLW-30)
const COUNTER_FROM = 4_500;

function isVideo(file: File): boolean {
  // some browsers leave type empty for .mkv and friends; the server checks too
  return file.type === ''
    ? /\.(mp4|mov|m4v|mkv|webm|avi)$/i.test(file.name)
    : file.type.startsWith('video/');
}

function subscribeOnline(onChange: () => void) {
  window.addEventListener('online', onChange);
  window.addEventListener('offline', onChange);
  return () => {
    window.removeEventListener('online', onChange);
    window.removeEventListener('offline', onChange);
  };
}

const useOnline = () =>
  useSyncExternalStore(
    subscribeOnline,
    () => navigator.onLine !== false,
    () => true,
  );

const useRemoteUploads = (tabs: UploadTabs) =>
  useSyncExternalStore(tabs.subscribe, tabs.remote, tabs.remote);

/** Focus an element by id once it is on screen; rows mount a frame after the store changes. */
function focusSoon(id: string, select = false) {
  requestAnimationFrame(() => {
    const el = document.getElementById(id);
    el?.focus();
    if (select && el instanceof HTMLInputElement) el.select();
  });
}

/** "a.txt is not a video file." and the other reasons picked files were skipped. */
function skipReasons(files: File[], elsewhere: (f: File) => boolean): string[] {
  const reasons: string[] = [];
  const others = files.filter((f) => !isVideo(f));
  if (others.length === 1) reasons.push(`${others[0].name} is not a video file.`);
  else if (others.length > 1) {
    reasons.push(
      `${others.length} files were skipped because they are not videos: ${others.map((f) => f.name).join(', ')}.`,
    );
  }
  for (const f of files.filter((f) => isVideo(f) && f.size === 0)) {
    reasons.push(`${f.name} is empty and was skipped.`);
  }
  const busy = files.filter((f) => isVideo(f) && f.size > 0 && elsewhere(f));
  if (busy.length === 1 && files.length === 1) reasons.push(OTHER_TAB);
  else for (const f of busy) reasons.push(`${f.name} is already uploading in another tab.`);
  return reasons;
}

function RemoteRow({ upload: u }: { upload: RemoteUpload }) {
  const percent = Math.floor(sentPercent(u));
  return (
    <li className="flex flex-col gap-1.5 rounded-lg border border-dashed p-3">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto" title={u.title}>
          {u.title}
        </p>
        <span className="text-xs text-muted-foreground tabular-nums">
          {u.paused ? `Paused at ${percent}%` : `${percent}%`}
        </span>
      </div>
      <Progress value={percent} aria-label={`${u.title}, sent in another tab`} />
    </li>
  );
}

/**
 * Everything the upload sheet holds: the drop zone, the drafts form, the
 * uploads of this tab, the queue, uploads running in other tabs, and the
 * unfinished ones from earlier page loads. All state lives in the upload
 * store, so closing the sheet loses nothing.
 */
export function UploadPanel({ store, tabs }: { store: UploadStore; tabs: UploadTabs }) {
  const session = useSession();
  const queryClient = useQueryClient();
  const { uploads, queued, queueHeld, offline, drafts, draftOptions, limit, pickNotice } =
    useUploads(store);
  const remote = useRemoteUploads(tabs);
  const online = useOnline();
  const [submitted, setSubmitted] = useState(false);
  const [touched, setTouched] = useState<ReadonlySet<string>>(() => new Set());
  const reupload = useRef<HTMLInputElement>(null);
  const busy = uploads.some(isTransferring);
  const single = drafts.length === 1;

  useEffect(() => {
    void store.loadLimit();
  }, [store]);

  const unfinished = useQuery({
    queryKey: ['uploads', 'unfinished'],
    queryFn: findUnfinishedUploads,
    staleTime: 0,
  });
  const remoteIds = new Set(remote.map((r) => r.uploadId).filter(Boolean));
  // this tab's own uploads have their own rows, and another tab's are listed as such
  const unfinishedRows = (unfinished.data ?? []).filter(
    (u) => !store.hasSeen(u.uploadId) && !remoteIds.has(u.uploadId),
  );

  const addDrafts = (files: File[]) => {
    if (files.length === 0) return;
    const [first] = store.addDrafts(files);
    // the first new title takes focus, selected, ready to type over (A11Y-13)
    focusSoon(draftTitleId({ id: first }), true);
  };

  /** Continue an unfinished upload with its file; returns why not, if it cannot. */
  const resume = async (u: UnfinishedUpload, file: File): Promise<ResumeResult> => {
    if (!isSameFile(u, file)) {
      return `This is not the same file. Choose ${u.fileName} (${formatBytes(u.size)}).`;
    }
    if (tabs.ownedElsewhere(fileFingerprint(file))) return OTHER_TAB;
    let fresh: UnfinishedUpload | null;
    try {
      // the list can be minutes old; resuming what the server dropped would
      // start a new upload under the old title (FLW-04)
      fresh = await recheckUnfinishedUpload(u);
    } catch (err) {
      return withLead('Could not check this upload', err);
    }
    void queryClient.invalidateQueries({ queryKey: ['uploads', 'unfinished'] });
    if (!fresh) {
      // gone from the server: it starts over as a new upload with new details
      addDrafts([file]);
      return null;
    }
    const waits = store.busy() || store.getState().queued.length > 0;
    store.enqueue(file, {
      title: fresh.title || titleOf(fresh),
      description: fresh.description,
      accessTier: fresh.accessTier,
      resumeUploadId: fresh.uploadId,
    });
    if (waits) {
      const percent = fresh.size > 0 ? Math.floor((fresh.offset / fresh.size) * 100) : 0;
      toastSuccess(
        `“${fresh.title || titleOf(fresh)}” will continue from ${percent}% after the current upload`,
      );
    }
    // otherwise the toast waits for the offset the sdk really continues from
    return null;
  };

  const choose = (files: File[]) => {
    const elsewhere = (f: File) => tabs.ownedElsewhere(fileFingerprint(f));
    const reasons = skipReasons(files, elsewhere);
    const usable = files.filter((f) => isVideo(f) && f.size > 0 && !elsewhere(f));
    const fresh: File[] = [];
    for (const file of usable) {
      // a file that matches an unfinished upload picks up where it stopped,
      // with the details it was started with
      const match = unfinishedRows.find((u) => isSameFile(u, file));
      if (match) {
        void resume(match, file).then((problem) => problem && store.setPickNotice(problem));
      } else fresh.push(file);
    }
    store.setPickNotice(reasons.length > 0 ? reasons.join(' ') : null);
    addDrafts(fresh);
  };

  // files handed over by useUploadSheet().open(files): a drop on a page, or a
  // second drop while the sheet is open
  const takeHanded = useEffectEvent(() => {
    const files = takePendingFiles();
    if (files.length > 0) choose(files);
  });
  useEffect(() => {
    takeHanded();
    return onPendingFiles(() => takeHanded());
  }, []);

  const tooLarge = limit !== null && drafts.some((d) => d.file.size > limit);
  const showErrors = (d: Draft) => submitted || touched.has(d.id);

  const start = (e: React.FormEvent) => {
    e.preventDefault();
    const empty = drafts.find((d) => d.title.trim() === '');
    if (empty) {
      setSubmitted(true);
      document.getElementById(draftTitleId(empty))?.focus();
      return;
    }
    if (tooLarge) return;
    const n = drafts.length;
    const waits = busy || queued.length > 0;
    const keys = store.startDrafts();
    setSubmitted(false);
    setTouched(new Set());
    store.setPickNotice(null);
    if (waits) toastSuccess(`${plural(n, 'video')} queued after the current upload`);
    else if (n > 1) toastSuccess(`Uploading ${plural(n, 'video')}, one at a time`);
    // the new row's heading takes focus, so the keyboard lands on what just started
    if (keys[0]) focusSoon(rowTitleId(keys[0]));
  };

  const startLabel = single
    ? waitsLabel(busy || queued.length > 0, 'Add to queue', 'Upload')
    : waitsLabel(
        busy || queued.length > 0,
        `Queue ${plural(drafts.length, 'video')}`,
        `Upload ${plural(drafts.length, 'video')}`,
      );

  const descriptionLength = draftOptions.description.length;

  return (
    <div className="@container/sheet flex flex-col gap-8">
      <section aria-label="Add videos" className="flex flex-col gap-4">
        <DropZone onFiles={choose} busy={busy} compact={drafts.length > 0} />
        <Collapse open={!!pickNotice}>
          <p role="alert" className="flex gap-2 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {pickNotice}
          </p>
        </Collapse>

        {drafts.length > 0 && (
          <form noValidate onSubmit={start} className="flex flex-col gap-5">
            <DraftList
              drafts={drafts}
              limit={limit}
              showErrors={showErrors}
              onTitle={(d, title) => store.updateDraft(d.id, { title })}
              onBlur={(d) => setTouched((t) => new Set(t).add(d.id))}
              onRemove={(d) => store.removeDraft(d.id)}
              earlier={(d) => findUpload(d.fingerprint, session.id)}
            />
            {single && (
              <Field className="gap-1.5">
                <FieldLabel htmlFor="upload-description">Description</FieldLabel>
                <Textarea
                  id="upload-description"
                  dir="auto"
                  rows={3}
                  maxLength={DESCRIPTION_MAX}
                  value={draftOptions.description}
                  aria-describedby={
                    descriptionLength >= COUNTER_FROM ? 'upload-description-count' : undefined
                  }
                  onChange={(e) => store.setDraftOptions({ description: e.target.value })}
                />
                {descriptionLength >= COUNTER_FROM && (
                  <p
                    id="upload-description-count"
                    className="text-right text-xs text-muted-foreground tabular-nums"
                  >
                    {formatCount(descriptionLength)} of {formatCount(DESCRIPTION_MAX)}
                  </p>
                )}
              </Field>
            )}
            <AccessChoice
              value={draftOptions.accessTier}
              onChange={(accessTier) => store.setDraftOptions({ accessTier })}
              hint={single ? undefined : 'This applies to every video in the list.'}
            />
            {!online && (
              <p className="flex items-center gap-2 text-xs text-muted-foreground">
                <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
                You are offline. Uploads start when the connection is back.
              </p>
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => store.clearDrafts()}>
                Cancel
              </Button>
              <Button type="submit" disabled={tooLarge}>
                {startLabel}
              </Button>
            </div>
          </form>
        )}
      </section>

      {uploads.length > 0 && (
        <section aria-labelledby="uploads-in-progress">
          <SectionHeader id="uploads-in-progress" title="In progress" className="mt-0 mb-3" />
          <AnimatedList as="ul" className="flex flex-col gap-2">
            {uploads.map((u) => (
              <AnimatedItem key={u.key}>
                <UploadRow
                  store={store}
                  upload={u}
                  busy={busy}
                  onReupload={() => reupload.current?.click()}
                />
              </AnimatedItem>
            ))}
          </AnimatedList>
        </section>
      )}

      {queued.length > 0 && (
        <section aria-labelledby="uploads-up-next" className="flex flex-col gap-3">
          <SectionHeader id="uploads-up-next" title="Up next" className="mt-0 mb-0" />
          {queueHeld && (
            <Alert>
              <CircleAlert />
              <AlertTitle>Queue paused</AlertTitle>
              <AlertDescription>
                <p>
                  The last upload failed, so the next ones are waiting. Resume it, or skip to the
                  next one.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="mt-2"
                  onClick={() => store.continueQueue()}
                >
                  Skip to next
                </Button>
              </AlertDescription>
            </Alert>
          )}
          {offline && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
              You are offline. Uploads start when the connection is back.
            </p>
          )}
          <AnimatedList as="ol" className="flex flex-col gap-2">
            {queued.map((q) => (
              <AnimatedItem
                key={q.key}
                className="flex items-center gap-3 rounded-lg border bg-card px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <h3
                    id={rowTitleId(q.key)}
                    tabIndex={-1}
                    dir="auto"
                    title={q.title}
                    className="truncate rounded-sm text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring"
                  >
                    {q.title}
                  </h3>
                  <p className="truncate text-xs text-muted-foreground" title={q.fileName}>
                    <span dir="auto">{q.fileName}</span>, {formatBytes(q.bytesTotal)}
                  </p>
                </div>
                <StatusBadge kind="upload" status="queued" />
                <Button
                  variant="ghost"
                  size="icon-xs"
                  className="text-muted-foreground"
                  aria-label={`Remove ${q.title} from the queue`}
                  onClick={() => store.removeQueued(q.key)}
                >
                  <X />
                </Button>
              </AnimatedItem>
            ))}
          </AnimatedList>
        </section>
      )}

      {remote.length > 0 && (
        <section aria-labelledby="uploads-other-tab" className="flex flex-col gap-3">
          <SectionHeader
            id="uploads-other-tab"
            title="Uploading in another tab"
            description="These run in another tab of this browser. Manage them there."
            className="mt-0 mb-0"
          />
          <ul className="flex flex-col gap-2">
            {remote.map((u) => (
              <RemoteRow key={`${u.tabId}-${u.fingerprint}`} upload={u} />
            ))}
          </ul>
        </section>
      )}

      {unfinished.isError ? (
        <InlineError
          title="Could not check for unfinished uploads"
          error={unfinished.error}
          onRetry={() => unfinished.refetch()}
          retrying={unfinished.isFetching}
        />
      ) : (
        unfinishedRows.length > 0 && (
          <section aria-labelledby="uploads-unfinished" className="flex flex-col gap-3">
            <SectionHeader
              id="uploads-unfinished"
              title={`Unfinished from earlier (${unfinishedRows.length})`}
              description="These stopped partway, for example when the tab closed. Add the same file again to continue."
              className="mt-0 mb-0"
            />
            <UnfinishedList rows={unfinishedRows} onChoose={resume} />
          </section>
        )
      )}

      <input
        ref={reupload}
        type="file"
        accept="video/*,.mkv,.avi,.m4v"
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          choose(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </div>
  );
}

const waitsLabel = (waits: boolean, queued: string, now: string) => (waits ? queued : now);

const titleOf = (u: UnfinishedUpload) => titleFromFile(u.fileName);
