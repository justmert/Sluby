import { Link } from 'react-router';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { Pause } from 'lucide-react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ROUTES } from '@/lib/constants';
import { scaleIn } from '@/lib/motion';
import { uploadStore } from '@/lib/studio-upload';
import { isTransferring, useUploads, type UploadState, type UploadStore } from '@/lib/upload-store';
import { cn } from '@/lib/utils';

const RADIUS = 7;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const isActive = (u: UploadState) => isTransferring(u) || u.phase === 'processing';

function percentOf(u: UploadState): number {
  if (u.phase === 'processing') return u.job?.progressPercent ?? 0;
  if (u.phase === 'finishing' || u.bytesTotal === 0) return 100;
  return (u.bytesUploaded / u.bytesTotal) * 100;
}

function describe(u: UploadState, percent: number): string {
  if (u.phase === 'paused') return `${u.title} is paused at ${percent}%`;
  if (u.phase === 'finishing') return `${u.title} is finishing the upload`;
  if (u.phase === 'processing') return `${u.title} is processing, ${percent}%`;
  return `Uploading ${u.title}, ${percent}%`;
}

function Ring({ percent, paused }: { percent: number; paused: boolean }) {
  return (
    <span className="relative grid size-5 place-items-center">
      <svg viewBox="0 0 18 18" className="absolute inset-0 size-5 -rotate-90" aria-hidden="true">
        <circle cx="9" cy="9" r={RADIUS} fill="none" strokeWidth="2" className="stroke-muted" />
        <circle
          cx="9"
          cy="9"
          r={RADIUS}
          fill="none"
          strokeWidth="2"
          strokeLinecap="round"
          strokeDasharray={CIRCUMFERENCE}
          strokeDashoffset={CIRCUMFERENCE * (1 - percent / 100)}
          className={cn(
            'transition-[stroke-dashoffset] duration-300 ease-out-soft',
            paused ? 'stroke-muted-foreground' : 'stroke-primary',
          )}
        />
      </svg>
      {paused && <Pause className="size-2.5 fill-current text-muted-foreground" aria-hidden />}
    </span>
  );
}

/**
 * A compact progress ring in the top bar while uploads transfer or process,
 * so leaving the upload page does not hide them. Links back to the page.
 */
export function UploadIndicator({ store = uploadStore }: { store?: UploadStore }) {
  const { uploads } = useUploads(store);
  const active = uploads.filter(isActive);
  // the running transfer leads; otherwise the newest upload still processing
  const lead = active.find(isTransferring) ?? active[0];

  return (
    <AnimatePresence initial={false}>
      {lead && (
        <m.div key="uploads" variants={scaleIn} initial="hidden" animate="visible" exit="exit">
          <IndicatorLink lead={lead} count={active.length} />
        </m.div>
      )}
    </AnimatePresence>
  );
}

function IndicatorLink({ lead, count }: { lead: UploadState; count: number }) {
  const percent = Math.floor(percentOf(lead));
  const paused = lead.phase === 'paused';
  const detail = describe(lead, percent);
  const label =
    count > 1 ? `${count} uploads in progress. ${detail}. Open uploads` : `${detail}. Open uploads`;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to={ROUTES.STUDIO_UPLOAD}
          aria-label={label}
          className="flex h-8 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-muted-foreground transition-colors duration-150 hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <Ring percent={percent} paused={paused} />
          <span className="hidden tabular-nums sm:inline" aria-hidden="true">
            {lead.phase === 'processing' ? 'Processing' : paused ? 'Paused' : `${percent}%`}
          </span>
          {count > 1 && (
            <span
              className="rounded-full bg-muted px-1.5 text-[0.7rem] text-foreground tabular-nums"
              aria-hidden="true"
            >
              {count}
            </span>
          )}
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom">{detail}</TooltipContent>
    </Tooltip>
  );
}
