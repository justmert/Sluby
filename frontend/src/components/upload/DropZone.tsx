import { useId, useRef, useState } from 'react';
import * as m from 'motion/react-m';
import { Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatBytes } from '@/lib/formatters';
import { spring } from '@/lib/motion';
import { cn } from '@/lib/utils';

export const VIDEO_TYPES = 'MP4, MOV, M4V, MKV, WebM or AVI';

/**
 * Where files come in: a drop target that also opens the file picker. Its
 * title and hint describe the Choose files button, the keyboard's way in
 * (A11Y-33). On drag the border and a soft ring change and the icon lifts;
 * the box itself does not scale (MOT-16). The button carries
 * data-upload-choose, so the upload page can start there.
 */
export function DropZone({
  onFiles,
  busy,
  limit = null,
}: {
  onFiles: (files: File[]) => void;
  /** a transfer runs, so new files wait */
  busy: boolean;
  /** the server's upload limit in bytes, once known */
  limit?: number | null;
}) {
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  // dragenter and dragleave fire for every child the pointer crosses, so
  // count them instead of trusting the last one
  const depth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const each = limit !== null ? `, up to ${formatBytes(limit)} each` : '';

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
      data-testid="drop-zone"
      data-dragging={dragging || undefined}
      className={cn(
        'flex cursor-pointer flex-col items-center justify-center gap-2.5 rounded-xl border-[1.5px] border-dashed bg-card px-6 py-8 text-center transition-[border-color,box-shadow] duration-150',
        dragging ? 'border-primary ring-4 ring-ring/20' : 'border-primary/40 hover:border-primary',
      )}
    >
      <m.div
        animate={{ y: dragging ? -3 : 0 }}
        transition={spring}
        className={cn(
          'flex size-12 shrink-0 items-center justify-center rounded-full border-[1.5px] text-primary transition-colors duration-150',
          dragging ? 'border-primary' : 'border-primary/40',
        )}
      >
        <Upload className="size-5" aria-hidden="true" />
      </m.div>
      <p id={`${id}-title`} className="text-base font-semibold">
        {dragging ? 'Drop to add' : 'Drop video files here'}
      </p>
      <p id={`${id}-hint`} className="text-sm text-muted-foreground">
        {busy
          ? 'Files you add now wait until the current upload finishes.'
          : `${VIDEO_TYPES}${each}. Add several and they upload in order.`}
      </p>
      <Button
        type="button"
        variant="outline"
        className="mt-1"
        data-upload-choose
        aria-describedby={`${id}-title ${id}-hint`}
        onClick={(e) => {
          // the box around would open the picker a second time
          e.stopPropagation();
          input.current?.click();
        }}
      >
        Choose files
      </Button>
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
