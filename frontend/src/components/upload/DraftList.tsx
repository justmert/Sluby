import { Link } from 'react-router';
import { X } from 'lucide-react';
import { AnimatedItem, AnimatedList } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { ROUTES } from '@/lib/constants';
import { formatBytes, formatRelativeTime } from '@/lib/formatters';
import type { UploadRecord } from '@/lib/upload-history';
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
}: DraftListProps & { draft: Draft; single: boolean }) {
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
      {before && (
        <p className="text-xs text-muted-foreground">
          You uploaded this file {formatRelativeTime(new Date(before.at))} as “
          <span dir="auto">{before.title}</span>”.{' '}
          <Link
            to={ROUTES.video(before.assetId)}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Open video
          </Link>
        </p>
      )}
    </Field>
  );
}
