import { useId, useRef, useState } from 'react';
import * as m from 'motion/react-m';
import { Upload } from 'lucide-react';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';

export const VIDEO_TYPES = 'MP4, MOV, M4V, MKV, WebM or AVI';

/**
 * Where files come in: a drop target that also opens the file picker. Its
 * name is its visible title and its description the hint (A11Y-33). On drag
 * the border, fill and a soft ring change and the icon lifts; the box itself
 * does not scale (MOT-16).
 */
export function DropZone({
  onFiles,
  busy,
  compact = false,
}: {
  onFiles: (files: File[]) => void;
  /** a transfer runs, so new files wait */
  busy: boolean;
  /** drafts are open below, so the zone takes less room */
  compact?: boolean;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  // dragenter and dragleave fire for every child the pointer crosses, so
  // count them instead of trusting the last one
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);

  return (
    // the box is a big mouse target; the button inside is the keyboard's way in
    <div
      onClick={(e) => {
        // the input's own click bubbles up here; opening it again would stack a second picker
        if (e.target === input.current) return;
        input.current?.click();
      }}
      onDragEnter={(e) => {
        e.preventDefault();
        depth.current += 1;
        setDragging(true);
      }}
      onDragOver={(e) => e.preventDefault()}
      onDragLeave={() => {
        depth.current = Math.max(0, depth.current - 1);
        if (depth.current === 0) setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        depth.current = 0;
        setDragging(false);
        onFiles(Array.from(e.dataTransfer.files));
      }}
      data-dragging={dragging || undefined}
      className={cn(
        'flex cursor-pointer items-center gap-4 rounded-xl border-2 border-dashed px-4 transition-[border-color,background-color,box-shadow] duration-150 has-focus-visible:border-ring',
        compact ? 'py-4' : 'flex-col justify-center py-10 text-center sm:py-12',
        dragging
          ? 'border-primary ring-4 ring-primary/15'
          : 'hover:border-primary/50 hover:bg-muted/40 active:bg-muted/60',
      )}
    >
      <m.div
        animate={{ y: dragging ? -3 : 0 }}
        transition={spring}
        className={cn(
          'flex shrink-0 items-center justify-center rounded-full border border-primary/40 text-primary transition-colors duration-150',
          compact ? 'size-9' : 'size-12',
          dragging && 'border-primary bg-primary text-primary-foreground',
        )}
      >
        <Upload className={compact ? 'size-4' : 'size-5'} aria-hidden="true" />
      </m.div>
      <div className="min-w-0">
        <p id={`${id}-title`} className="text-sm font-medium">
          {dragging ? (
            'Drop to add'
          ) : (
            <>
              Drop videos here, or{' '}
              <button
                type="button"
                data-upload-choose
                aria-labelledby={`${id}-title`}
                aria-describedby={`${id}-hint`}
                onClick={(e) => {
                  // the box around would open the picker a second time
                  e.stopPropagation();
                  input.current?.click();
                }}
                className="rounded-sm text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring"
              >
                choose files
              </button>
            </>
          )}
        </p>
        <p id={`${id}-hint`} className="mt-0.5 text-xs text-muted-foreground">
          {busy
            ? 'Files you add now wait until the current upload finishes.'
            : `${VIDEO_TYPES}. Add several at once and they upload in order. Interrupted uploads can resume.`}
        </p>
      </div>
      <input
        ref={input}
        type="file"
        accept="video/*,.mkv,.avi,.m4v"
        multiple
        className="hidden"
        tabIndex={-1}
        aria-hidden="true"
        data-testid="file-input"
        onChange={(e) => {
          onFiles(Array.from(e.target.files ?? []));
          e.target.value = '';
        }}
      />
    </div>
  );
}
