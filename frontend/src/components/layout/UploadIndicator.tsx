import { useState } from 'react';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { Pause, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { UploadTray } from '@/components/upload/UploadTray';
import { sentPercent, shortStatus } from '@/components/upload/upload-status';
import { useUploadEvents } from '@/components/upload/useUploadEvents';
import { scaleIn } from '@/lib/motion';
import { useSession } from '@/lib/session';
import { uploadStore } from '@/lib/studio-upload';
import { useUploadSheet } from '@/lib/upload-sheet';
import { isTransferring, useUploads, type UploadState, type UploadStore } from '@/lib/upload-store';
import { cn } from '@/lib/utils';

const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const isActive = (u: UploadState) => isTransferring(u) || u.phase === 'processing';

function percentOf(u: UploadState): number {
  if (u.phase === 'processing') return u.job?.progressPercent ?? 0;
  if (u.phase === 'finishing') return 0;
  return sentPercent(u);
}

function Ring({ percent, paused }: { percent: number; paused: boolean }) {
  // nothing measured yet (a job that has not reported, the server finishing
  // up): an empty ring reads as stuck, so spin a short arc instead
  const waiting = !paused && percent < 1;
  const shown = waiting ? 25 : percent;
  return (
    <span className="relative grid size-5 place-items-center">
      <svg
        viewBox="0 0 18 18"
        className={cn('absolute inset-0 size-5 -rotate-90', waiting && 'motion-safe:animate-spin')}
        aria-hidden="true"
      >
        <circle cx="9" cy="9" r={RADIUS} fill="none" strokeWidth="2" className="stroke-muted" />
        <circle
          cx="9"
          cy="9"
          r={RADIUS}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - shown / 100)}
          className={cn(
            // the same easing as every polled bar (MOT-07)
            'transition-[stroke-dashoffset] duration-(--duration-progress) ease-out-soft',
            paused ? 'stroke-muted-foreground' : 'stroke-progress',
          )}
        />
      </svg>
      {paused && <Pause className="size-2.5 fill-current text-muted-foreground" aria-hidden />}
    </span>
  );
}

/**
 * The top bar's upload control (D-08): "Upload video" opens the upload sheet
 * from any page; while uploads run, a progress ring with a count sits next
 * to it and opens a tray. It also raises the ready and failed toasts for
 * uploads started in this browser, wherever the user is.
 */
export function UploadIndicator({ store = uploadStore }: { store?: UploadStore }) {
  const session = useSession();
  const sheet = useUploadSheet();
  const { uploads, queued } = useUploads(store);
  const region = useUploadEvents(store, session.id);
  const [trayOpen, setTrayOpen] = useState(false);
  const active = uploads.filter(isActive);
  // the running transfer leads; otherwise the newest upload still processing
  const lead = active.find(isTransferring) ?? active[0];
  const count = active.length + queued.length;

  return (
    <div className="flex items-center gap-1">
      {/* phase changes of uploads in this browser, said once */}
      <span ref={region} className="sr-only" role="status" aria-live="polite" />
      <AnimatePresence initial={false}>
        {lead && (
          <m.div key="ring" variants={scaleIn} initial="hidden" animate="visible" exit="exit">
            <Popover open={trayOpen} onOpenChange={setTrayOpen}>
              <PopoverTrigger asChild>
                <RingButton lead={lead} count={count} />
              </PopoverTrigger>
              <PopoverContent align="end" className="w-80" aria-labelledby="upload-tray-title">
                <UploadTray
                  uploads={uploads.filter((u) => isActive(u) || u.phase === 'failed')}
                  queued={queued}
                  onOpen={() => {
                    setTrayOpen(false);
                    sheet.open();
                  }}
                />
              </PopoverContent>
            </Popover>
          </m.div>
        )}
      </AnimatePresence>
      <Button
        variant="outline"
        size="sm"
        className="max-md:size-8 max-md:px-0"
        onClick={() => sheet.open()}
      >
        <Upload aria-hidden="true" />
        <span className="max-md:sr-only">Upload video</span>
      </Button>
    </div>
  );
}

/**
 * The ring and its figures are drawn beside an empty button that covers
 * them, so the button's name is the full sentence (CPY-18) without visible
 * text inside it that the name would have to repeat (WCAG 2.5.3).
 */
function RingButton({
  lead,
  count,
  ...props
}: { lead: UploadState; count: number } & React.ComponentProps<'button'>) {
  const percent = Math.floor(percentOf(lead));
  const paused = lead.phase === 'paused';
  const detail = `${lead.title}: ${shortStatus(lead)}`;
  const label =
    count > 1
      ? `${count} uploads in progress. ${detail}. Go to uploads`
      : `${detail}. Go to uploads`;
  const figure = paused
    ? 'Paused'
    : lead.phase === 'finishing' || (!lead.job && lead.phase === 'processing')
      ? null
      : `${percent}%`;
  return (
    <span className="group/ring relative flex h-8 items-center">
      <span
        aria-hidden="true"
        className="pointer-events-none flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors duration-150 group-hover/ring:bg-muted group-hover/ring:text-foreground"
      >
        <Ring percent={percent} paused={paused} />
        {figure && <span className="hidden tabular-nums sm:inline">{figure}</span>}
        {count > 1 && (
          <span className="rounded-full bg-muted px-1.5 text-xs text-foreground tabular-nums">
            {count}
          </span>
        )}
      </span>
      <button
        type="button"
        aria-label={label}
        className="absolute inset-0 rounded-md focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
        {...props}
      />
    </span>
  );
}
