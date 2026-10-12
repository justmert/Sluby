import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CircleAlert, WifiOff, X } from 'lucide-react';
import { useOnline } from '@/hooks/useOnline';
import { AnimatedItem, AnimatedList, Collapse } from '@/components/motion';
import { InlineError } from '@/components/shared/InlineError';
import { SectionHeader } from '@/components/shared/PageHeader';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Progress } from '@/components/ui/progress';
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
import { onPendingFiles, takePendingFiles } from '@/lib/upload-page';
import {
  isTransferring,
  OTHER_TAB,
  titleFromFile,
  useUploads,
  type Draft,
  type UploadState,
  type UploadStore,
} from '@/lib/upload-store';
import { fileFingerprint, type RemoteUpload, type UploadTabs } from '@/lib/upload-tabs';
import { cn } from '@/lib/utils';
import { DraftDetails } from './DraftDetails';
import { draftRowId, draftTitleId, rowTitleId } from './ids';
import { DropZone } from './DropZone';
import { UnfinishedList, type ResumeResult } from './UnfinishedList';
import { UploadRow } from './UploadRow';
import { sentPercent } from './upload-status';

function isVideo(file: File): boolean {
  // some browsers leave type empty for .mkv and friends; the server checks too
  return file.type === ''
    ? /\.(mp4|mov|m4v|mkv|webm|avi)$/i.test(file.name)
    : file.type.startsWith('video/');
}

const useRemoteUploads = (tabs: UploadTabs) =>
  useSyncExternalStore(tabs.subscribe, tabs.remote, tabs.remote);

/** Focus an element by id once it is on screen; rows mount a frame after the store changes. */
function focusSoon(id: string) {
  requestAnimationFrame(() => document.getElementById(id)?.focus());
}

/** Whether focus is in a field someone types in, which a new draft must not take over. */
function typingNow(): boolean {
  const active = document.activeElement;
  return (
    active instanceof HTMLTextAreaElement ||
    (active instanceof HTMLInputElement && active.type !== 'file' && active.type !== 'radio') ||
    (active instanceof HTMLElement && active.isContentEditable)
  );
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

/** "1 uploading · 2 new · 1 queued · 1 done": what the file list holds, by kind. */
function filesSummary(uploads: UploadState[], drafts: number, queued: number): string {
  const count = (phase: (u: UploadState) => boolean) => uploads.filter(phase).length;
  const parts: Array<[number, string]> = [
    [count(isTransferring), 'uploading'],
    [count((u) => u.phase === 'processing'), 'processing'],
    [drafts, 'new'],
    [queued, 'queued'],
    [count((u) => u.phase === 'ready'), 'done'],
    [count((u) => u.phase === 'failed'), 'failed'],
    [count((u) => u.phase === 'cancelled'), 'canceled'],
  ];
  return parts
    .filter(([n]) => n > 0)
    .map(([n, word]) => `${formatCount(n)} ${word}`)
    .join(' · ');
}

const isActive = (u: UploadState) => isTransferring(u) || u.phase === 'processing';

function RemoteRow({ upload: u }: { upload: RemoteUpload }) {
  const percent = Math.floor(sentPercent(u));
  return (
    <li className="flex flex-col gap-1.5 border-t px-4 py-3.5 sm:px-5">
      <div className="flex items-center gap-2">
        <p className="min-w-0 flex-1 truncate text-sm font-medium" dir="auto" title={u.title}>
          {u.title}
        </p>
        <span className="text-xs text-muted-foreground tabular-nums">
          {u.paused ? `Paused at ${percent}%` : `${percent}%`}
        </span>
      </div>
      <Progress value={percent} className="h-1.5" aria-label={`${u.title}, sent in another tab`} />
    </li>
  );
}

/** A picked file in the list: pressing it shows its details beside the list. */
function DraftRow({
  draft: d,
  selected,
  tooLarge,
  onSelect,
}: {
  draft: Draft;
  selected: boolean;
  tooLarge: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      id={draftRowId(d)}
      aria-current={selected || undefined}
      onClick={onSelect}
      className={cn(
        'flex w-full flex-col gap-1 px-4 py-3.5 text-left outline-none transition-colors duration-150 focus-visible:ring-3 focus-visible:ring-ring focus-visible:ring-inset sm:px-5',
        selected ? 'bg-accent shadow-[inset_3px_0_0_var(--color-primary)]' : 'hover:bg-muted',
      )}
    >
      <span className="flex w-full items-center gap-2.5">
        <span className="min-w-0 flex-1 truncate text-sm font-semibold" dir="auto" title={d.title}>
          {d.title.trim() || d.file.name}
        </span>
        <Badge variant="secondary" className="shrink-0">
          New
        </Badge>
      </span>
      <span className="truncate text-xs text-muted-foreground">
        <span dir="auto">{d.file.name}</span>, {formatBytes(d.file.size)}
      </span>
      <span className={cn('text-xs', tooLarge ? 'text-destructive' : 'text-muted-foreground')}>
        {tooLarge ? 'Too large for this server.' : 'Add a title, then start the upload.'}
      </span>
    </button>
  );
}

/**
 * The upload page's body: the drop zone, then every file in one list
 * (uploads, new drafts, the queue and finished ones) beside the selected
 * draft's details, uploads running in other tabs, and the unfinished ones
 * from earlier page loads. All state lives in the upload store, so leaving
 * the page loses nothing and uploads keep going.
 */
export function UploadPanel({ store, tabs }: { store: UploadStore; tabs: UploadTabs }) {
  const session = useSession();
  const queryClient = useQueryClient();
  const { uploads, queued, queueHeld, offline, drafts, selectedDraft, limit, pickNotice } =
    useUploads(store);
  const remote = useRemoteUploads(tabs);
  const online = useOnline();
  // drafts whose empty title shows its error: blurred, or a start was tried
  const [flagged, setFlagged] = useState<ReadonlySet<string>>(() => new Set());
  const reupload = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);
  const busy = uploads.some(isTransferring);
  const waits = busy || queued.length > 0;
  const selected = drafts.find((d) => d.id === selectedDraft) ?? drafts[0] ?? null;
  const select = (d: Draft | null) => store.selectDraft(d?.id ?? null);
  const tooLarge = (d: Draft) => limit !== null && d.file.size > limit;

  useEffect(() => {
    void store.loadLimit();
  }, [store]);

  // arriving on the page starts on Choose files, unless files came along and
  // their title already took focus
  useEffect(() => {
    if (root.current?.contains(document.activeElement)) return;
    root.current?.querySelector<HTMLElement>('[data-upload-choose]')?.focus();
  }, []);

  // a pick refused only because another tab held the file: once that tab lets
  // go, the refusal is stale
  const heldElsewhere = useRef<{ notice: string; fingerprints: string[] } | null>(null);
  useEffect(() => {
    const held = heldElsewhere.current;
    if (!held || held.fingerprints.some((fp) => tabs.ownedElsewhere(fp))) return;
    heldElsewhere.current = null;
    if (store.getState().pickNotice === held.notice) store.setPickNotice(null);
  }, [remote, tabs, store]);

  const unfinished = useQuery({
    queryKey: ['uploads', 'unfinished'],
    queryFn: () => findUnfinishedUploads(session.id),
    staleTime: 0,
  });
  const remoteIds = new Set(remote.map((r) => r.uploadId).filter(Boolean));
  // this tab's own uploads have their own rows, and another tab's are listed as such
  const unfinishedRows = (unfinished.data ?? []).filter(
    (u) => !store.hasSeen(u.uploadId) && !remoteIds.has(u.uploadId),
  );

  const addDrafts = (files: File[]) => {
    if (files.length === 0) return;
    // the first new title takes focus as it mounts (DraftDetails), ready to
    // type over, unless someone is typing in the draft shown now
    store.addDrafts(files, { select: !selected || !typingNow() });
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
    const later = store.busy() || store.getState().queued.length > 0;
    store.enqueue(file, {
      title: fresh.title || titleOf(fresh),
      description: fresh.description,
      accessTier: fresh.accessTier,
      resumeUploadId: fresh.uploadId,
    });
    if (later) {
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
    const notice = reasons.length > 0 ? reasons.join(' ') : null;
    const held = files.filter((f) => isVideo(f) && f.size > 0 && elsewhere(f));
    heldElsewhere.current =
      notice && held.length > 0 && held.length === reasons.length
        ? { notice, fingerprints: held.map(fileFingerprint) }
        : null;
    store.setPickNotice(notice);
    addDrafts(fresh);
  };

  // files handed over by useOpenUpload(files): a drop on the videos page, or
  // a second drop while this page shows
  const takeHanded = useEffectEvent(() => {
    const files = takePendingFiles();
    if (files.length > 0) choose(files);
  });
  // in the layout phase, so the drafts and their focused title are on screen
  // in the same frame the page appears
  useLayoutEffect(() => {
    takeHanded();
    return onPendingFiles(() => takeHanded());
  }, []);

  const flag = (ids: string[]) => setFlagged((f) => new Set([...f, ...ids]));

  /** Start these drafts, or point at the first one that cannot start yet. */
  const start = (list: Draft[]) => {
    const empty = list.find((d) => d.title.trim() === '');
    if (empty) {
      flag(list.filter((d) => d.title.trim() === '').map((d) => d.id));
      select(empty);
      focusSoon(draftTitleId(empty));
      return;
    }
    const large = list.find(tooLarge);
    if (large) {
      select(large);
      focusSoon(draftTitleId(large));
      return;
    }
    const ids = list.map((d) => d.id);
    // the next draft after the one shown takes its place
    const at = selected ? drafts.indexOf(selected) : 0;
    const rest = drafts.filter((d) => !ids.includes(d.id));
    const next = drafts.slice(at + 1).find((d) => !ids.includes(d.id)) ?? rest.at(-1) ?? null;
    const keys = store.startDrafts(ids);
    select(next);
    setFlagged((f) => new Set([...f].filter((id) => !ids.includes(id))));
    store.setPickNotice(null);
    const n = list.length;
    if (waits) toastSuccess(`${plural(n, 'video')} queued after the current upload`);
    else if (n > 1) toastSuccess(`Uploading ${plural(n, 'video')}, one at a time`);
    // the new row's heading takes focus, so the keyboard lands on what just started
    if (keys[0]) focusSoon(rowTitleId(keys[0]));
  };

  const remove = (d: Draft) => {
    const at = drafts.indexOf(d);
    const next = drafts[at + 1] ?? drafts[at - 1] ?? null;
    store.removeDraft(d.id);
    select(next);
    // focus stays in the list, or goes back to Choose files when it is empty
    if (next) focusSoon(draftRowId(next));
    else root.current?.querySelector<HTMLElement>('[data-upload-choose]')?.focus();
  };

  const active = uploads.filter(isActive);
  const ended = uploads.filter((u) => !isActive(u));
  const listed = uploads.length + drafts.length + queued.length > 0;

  const uploadRow = (u: UploadState) => (
    <AnimatedItem key={u.key} className="border-t">
      <UploadRow
        store={store}
        upload={u}
        busy={busy}
        onReupload={() => reupload.current?.click()}
      />
    </AnimatedItem>
  );

  return (
    <div ref={root} className="flex flex-col gap-5">
      <section aria-label="Add videos" className="flex flex-col gap-3">
        <DropZone onFiles={choose} busy={busy} limit={limit} />
        <Collapse open={!!pickNotice}>
          <p role="alert" className="flex gap-2 text-sm text-destructive">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {pickNotice}
          </p>
        </Collapse>
      </section>

      {listed && (
        <div className="flex flex-wrap items-start gap-5">
          <Card
            role="region"
            aria-labelledby="upload-files"
            className="@container/upload min-w-0 flex-[1_1_23.75rem] gap-0 py-0"
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-4 py-4 sm:px-5">
              <h2 id="upload-files" className="font-heading text-heading">
                Files
              </h2>
              <p className="ml-auto text-sm text-muted-foreground tabular-nums">
                {filesSummary(uploads, drafts.length, queued.length)}
              </p>
            </div>
            {queueHeld && (
              <Alert className="mx-4 mb-3 w-auto sm:mx-5">
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
            {offline && queued.length > 0 && (
              <p className="flex items-center gap-2 px-4 pb-3 text-xs text-muted-foreground sm:px-5">
                <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
                You are offline. Uploads start when the connection is back.
              </p>
            )}
            <AnimatedList as="ul" aria-labelledby="upload-files">
              {active.map(uploadRow)}
              {drafts.map((d) => (
                <AnimatedItem key={d.id} className="border-t">
                  <DraftRow
                    draft={d}
                    selected={d === selected}
                    tooLarge={tooLarge(d)}
                    onSelect={() => select(d)}
                  />
                </AnimatedItem>
              ))}
              {queued.map((q, i) => (
                <AnimatedItem
                  key={q.key}
                  className="flex items-center gap-3 border-t px-4 py-3.5 sm:px-5"
                >
                  <div className="min-w-0 flex-1">
                    <h3
                      id={rowTitleId(q.key)}
                      tabIndex={-1}
                      dir="auto"
                      title={q.title}
                      className="truncate rounded-sm text-sm font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring"
                    >
                      {q.title}
                    </h3>
                    <p className="truncate text-xs text-muted-foreground" title={q.fileName}>
                      <span dir="auto">{q.fileName}</span>, {formatBytes(q.bytesTotal)}
                      {i === 0 ? ', next in line' : `, ${ordinal(i + 1)} in line`}
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
              {ended.map(uploadRow)}
            </AnimatedList>
          </Card>

          {selected && (
            <DraftDetails
              key={selected.id}
              draft={selected}
              limit={limit}
              showErrors={flagged.has(selected.id)}
              total={drafts.length}
              online={online}
              onChange={(patch) => store.updateDraft(selected.id, patch)}
              onTitleBlur={() => flag([selected.id])}
              onRemove={() => remove(selected)}
              onStart={() => start([selected])}
              onStartAll={() => start(drafts)}
              claimFocus={() => store.claimDraftFocus(selected.id)}
              earlier={findUpload(selected.fingerprint, session.id)}
            />
          )}
        </div>
      )}

      {remote.length > 0 && (
        <Card role="region" aria-labelledby="uploads-other-tab" className="gap-0 py-0">
          <SectionHeader
            id="uploads-other-tab"
            title="Uploading in another tab"
            description="These run in another tab of this browser. Manage them there."
            className="mt-0 mb-0 px-4 py-4 sm:px-5"
          />
          <ul>
            {remote.map((u) => (
              <RemoteRow key={`${u.tabId}-${u.fingerprint}`} upload={u} />
            ))}
          </ul>
        </Card>
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

/** "2nd", "3rd", "11th": a queue position. */
function ordinal(n: number): string {
  const teen = n % 100 >= 11 && n % 100 <= 13;
  const suffix = teen ? 'th' : (({ 1: 'st', 2: 'nd', 3: 'rd' } as const)[n % 10] ?? 'th');
  return `${n}${suffix}`;
}

const titleOf = (u: UnfinishedUpload) => titleFromFile(u.fileName);
