import { Fragment, useEffect, useId, useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { statusOf } from '@/lib/api-client';
import { ROUTES } from '@/lib/constants';
import {
  formatBytes,
  formatCount,
  formatDuration,
  formatRelativeTime,
  plural,
} from '@/lib/formatters';
import { sluby } from '@/lib/sluby';
import { forgetUpload, type UploadRecord } from '@/lib/upload-history';
import { overLimit, type Draft, type DraftDetails as Details } from '@/lib/upload-store';
import { cn } from '@/lib/utils';
import { AccessChoice } from './AccessChoice';
import { draftTitleId } from './ids';
import { useVideoMeta } from './video-meta';

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 5_000;
// the counter shows once the description gets near the limit (FLW-30)
const COUNTER_FROM = 4_500;

const NEXT_STEPS = ['Upload', 'Transcode', 'Store on Sia', 'Ready to play'];

export interface DraftDetailsProps {
  draft: Draft;
  /** the server's upload limit in bytes, once known */
  limit: number | null;
  /** the empty title should show its error */
  showErrors: boolean;
  /** how many drafts wait, so several can start at once */
  total: number;
  online: boolean;
  onChange: (patch: Partial<Details>) => void;
  onTitleBlur: () => void;
  onRemove: () => void;
  onStart: () => void;
  onStartAll: () => void;
  /** true once for the title that should take focus as it appears (A11Y-13) */
  claimFocus: () => boolean;
  /** when this account uploaded the same file in this browser lately */
  earlier: UploadRecord | null;
}

/**
 * The selected draft's details on the upload page: its title, an optional
 * description, who can watch, what happens after the upload, and the buttons
 * that remove or start it. Enter in the title starts it.
 */
export function DraftDetails({
  draft: d,
  limit,
  showErrors,
  total,
  online,
  onChange,
  onTitleBlur,
  onRemove,
  onStart,
  onStartAll,
  claimFocus,
  earlier,
}: DraftDetailsProps) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  // focus the new title in the same commit it appears, before the next
  // keystroke can land anywhere else, and never over a field someone is
  // typing in (a second drop while they type)
  useLayoutEffect(() => {
    if (!claimFocus()) return;
    const active = document.activeElement;
    const typing =
      active instanceof HTMLTextAreaElement ||
      (active instanceof HTMLInputElement && active.type !== 'file' && active.type !== 'radio') ||
      (active instanceof HTMLElement && active.isContentEditable);
    if (typing || !input.current) return;
    input.current.focus();
    input.current.select();
    // only on mount (the form is keyed by draft): later renders must not move focus
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const invalid = d.title.trim() === '' && showErrors;
  const tooLarge = limit !== null && d.file.size > limit;
  const titleId = draftTitleId(d);
  const errorId = `${titleId}-error`;
  const limitId = `${titleId}-limit`;
  const descriptionLength = d.description.length;
  const meta = useVideoMeta(d.file);
  const facts = [
    formatBytes(d.file.size),
    ...(meta ? [`${meta.height}p`, formatDuration(meta.durationMs)] : []),
  ];

  return (
    <Card
      role="region"
      aria-labelledby={`${id}-heading`}
      className="@container/upload min-w-0 flex-[999_1_27.5rem] gap-4 px-5 py-5 shadow-none sm:px-6"
    >
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          onStart();
        }}
        className="flex flex-col gap-4"
      >
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <h2
            id={`${id}-heading`}
            dir="auto"
            title={d.file.name}
            className="min-w-0 truncate font-heading text-heading"
          >
            {d.file.name}
          </h2>
          <span className="text-sm text-muted-foreground tabular-nums">{facts.join(' · ')}</span>
        </div>

        <Field data-invalid={invalid || undefined} className="gap-1.5">
          <FieldLabel htmlFor={titleId} className="font-semibold">
            Title
          </FieldLabel>
          <Input
            ref={input}
            id={titleId}
            className="h-10"
            aria-invalid={invalid || undefined}
            aria-describedby={cn(invalid && errorId, tooLarge && limitId) || undefined}
            dir="auto"
            value={d.title}
            maxLength={TITLE_MAX}
            onChange={(e) => onChange({ title: e.target.value })}
            onBlur={onTitleBlur}
          />
          {invalid && (
            <FieldError id={errorId} className="text-xs">
              Enter a title.
            </FieldError>
          )}
          {tooLarge && (
            <p id={limitId} className="text-xs text-destructive">
              {overLimit(d.file.size, limit)}
            </p>
          )}
          {earlier && <EarlierUpload record={earlier} />}
        </Field>

        <Field className="gap-1.5">
          <FieldLabel htmlFor={`${id}-description`} className="font-semibold">
            Description <span className="font-normal text-subtle-foreground">optional</span>
          </FieldLabel>
          <Textarea
            id={`${id}-description`}
            dir="auto"
            rows={3}
            maxLength={DESCRIPTION_MAX}
            value={d.description}
            aria-describedby={descriptionLength >= COUNTER_FROM ? `${id}-count` : undefined}
            onChange={(e) => onChange({ description: e.target.value })}
          />
          {descriptionLength >= COUNTER_FROM && (
            <p id={`${id}-count`} className="text-right text-xs text-muted-foreground tabular-nums">
              {formatCount(descriptionLength)} of {formatCount(DESCRIPTION_MAX)}
            </p>
          )}
        </Field>

        <AccessChoice value={d.accessTier} onChange={(accessTier) => onChange({ accessTier })} />

        <div className="flex flex-col gap-2">
          <p id={`${id}-next`} className="text-sm font-semibold">
            What happens next
          </p>
          <ol
            aria-labelledby={`${id}-next`}
            className="flex flex-wrap items-center gap-2.5 text-sm text-muted-foreground"
          >
            {NEXT_STEPS.map((step, i) => (
              <Fragment key={step}>
                {/* the separators are list items of their own, hidden from
                    screen readers, so each step reads as just its name */}
                {i > 0 && (
                  <li aria-hidden="true" className="text-subtle-foreground">
                    ›
                  </li>
                )}
                <li className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="grid size-5.5 shrink-0 place-items-center rounded-full border-[1.5px] border-border-strong text-xs font-bold tabular-nums"
                  >
                    {i + 1}
                  </span>
                  {step}
                </li>
              </Fragment>
            ))}
          </ol>
        </div>

        {!online && (
          <p className="flex items-center gap-2 text-xs text-muted-foreground">
            <WifiOff className="size-3.5 shrink-0" aria-hidden="true" />
            You are offline. Uploads start when the connection is back.
          </p>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-border-soft pt-4">
          <Button type="button" variant="outline" onClick={onRemove}>
            Remove file
          </Button>
          <div className="ml-auto flex flex-wrap justify-end gap-2">
            {total > 1 && (
              <Button type="button" variant="outline" onClick={onStartAll}>
                Upload {plural(total, 'video')}
              </Button>
            )}
            <Button type="submit" disabled={tooLarge}>
              Start upload
            </Button>
          </div>
        </div>
      </form>
    </Card>
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
