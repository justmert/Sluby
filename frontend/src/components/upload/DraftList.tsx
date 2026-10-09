import { useEffect, useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { AnimatedItem, AnimatedList } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { statusOf } from '@/lib/api-client';
import { ROUTES } from '@/lib/constants';
import { formatBytes, formatRelativeTime } from '@/lib/formatters';
import { sluby } from '@/lib/sluby';
import { forgetUpload, type UploadRecord } from '@/lib/upload-history';
import { overLimit, type Draft } from '@/lib/upload-store';
import { cn } from '@/lib/utils';
import { draftTitleId } from './ids';

export const TITLE_MAX = 200;

export interface DraftListProps {
  drafts: Draft[];
  /** the server's upload limit in bytes, once known */
  limit: number | null;
  /** drafts whose empty title should show its error */
  showErrors: (draft: Draft) => boolean;
  onTitle: (draft: Draft, title: string) => void;
  onBlur: (draft: Draft) => void;
  onRemove: (draft: Draft) => void;
  /** true once for the title that should take focus as it appears (A11Y-13) */
  claimFocus: (draft: Draft) => boolean;
  /** when this account uploaded the same file in this browser lately */
  earlier: (draft: Draft) => UploadRecord | null;
}

/**
 * The picked files, each with its title. One file gets a labelled Title
 * field; several are a numbered list in upload order, each with Remove.
 */
export function DraftList(props: DraftListProps) {
  const { drafts } = props;

  if (drafts.length === 1) {
    const d = drafts[0];
    return <DraftField {...props} draft={d} single />;
  }

  return (
    <div>
      <AnimatedList as="ol" className="flex flex-col gap-2" aria-label="Videos to upload">
        {drafts.map((d, i) => (
          <AnimatedItem key={d.id} className="flex gap-2 rounded-lg border p-3">
            <span
              className="w-5 shrink-0 pt-1.5 text-xs text-muted-foreground tabular-nums"
              aria-hidden="true"
            >
              {i + 1}.
            </span>
            <DraftField {...props} draft={d} single={false} />
          </AnimatedItem>
        ))}
      </AnimatedList>
    </div>
  );
}

function DraftField({
  draft: d,
  single,
  limit,
  showErrors,
  onTitle,
  onBlur,
  onRemove,
  earlier,
  claimFocus,
}: DraftListProps & { draft: Draft; single: boolean }) {
  const input = useRef<HTMLInputElement>(null);
  // focus the new title in the same commit it appears, before the next
  // keystroke can land anywhere else, and never over a field someone is
  // typing in (a second drop while they type)
  useLayoutEffect(() => {
    if (!claimFocus(d)) return;
    const active = document.activeElement;
    const typing =
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLInputElement && active.type !== 'file' && active.type !== 'radio') ||
      (active instanceof HTMLElement && active.isContentEditable);
    if (typing || !input.current) return;
    input.current.focus();
    input.current.select();
    // only on mount: later renders must not move focus
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const empty = d.title.trim() === '';
  const invalid = empty && showErrors(d);
  const tooLarge = limit !== null && d.file.size > limit;
  const before = earlier(d);
  const errorId = `${draftTitleId(d)}-error`;
  const metaId = `${draftTitleId(d)}-meta`;

  return (
    <Field data-invalid={invalid || undefined} className="min-w-0 flex-1 gap-1.5">
      {single && <FieldLabel htmlFor={draftTitleId(d)}>Title</FieldLabel>}
      <div className="flex items-center gap-2">
        <Input
          ref={input}
          id={draftTitleId(d)}
          aria-label={single ? undefined : `Title for ${d.file.name}`}
          aria-invalid={invalid || undefined}
          aria-describedby={cn(metaId, invalid && errorId) || undefined}
          dir="auto"
          value={d.title}
          maxLength={TITLE_MAX}
          onChange={(e) => onTitle(d, e.target.value)}
          onBlur={() => onBlur(d)}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove ${d.file.name}`}
          onClick={() => onRemove(d)}
        >
          <X />
        </Button>
      </div>
      <p id={metaId} className="truncate text-xs text-muted-foreground" title={d.file.name}>
        <span dir="auto">{d.file.name}</span>, {formatBytes(d.file.size)}
      </p>
      {invalid && (
        <FieldError id={errorId} className="text-xs">
          Enter a title.
        </FieldError>
      )}
      {tooLarge && <p className="text-xs text-destructive">{overLimit(d.file.size, limit)}</p>}
      {before && <EarlierUpload record={before} />}
    </Field>
  );
}

/**
 * "You uploaded this file 2 days ago as …" with a link, unless that video was
 * deleted since, from another browser or through the api: then the record is
 * dropped and nothing is said.
 */
function EarlierUpload({ record }: { record: UploadRecord }) {
  const earlier = useQuery({
    queryKey: ['assets', 'one', record.assetId],
    queryFn: () => sluby.assets.get(record.assetId),
    retry: false,
  });
  const status = earlier.isError ? statusOf(earlier.error) : undefined;
  const gone = status === 404 || status === 400;
  useEffect(() => {
    if (gone) forgetUpload(record.assetId);
  }, [gone, record.assetId]);
  if (gone) return null;
  return (
    <p className="text-xs text-muted-foreground">
      You uploaded this file {formatRelativeTime(new Date(record.at))} as “
      <span dir="auto">{record.title}</span>”.{' '}
      <Link
        to={ROUTES.video(record.assetId)}
        className="font-medium text-foreground underline-offset-4 hover:underline"
      >
        Open video
      </Link>
    </p>
  );
}
