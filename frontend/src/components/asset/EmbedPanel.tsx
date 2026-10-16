import { useId, useState } from 'react';
import type { PlaybackId, VideoAsset } from '@sluby/sdk';
import { ArrowUpRight } from 'lucide-react';
import { CodeBlock } from '@/components/shared/CodeBlock';
import { CopyButton } from '@/components/shared/CopyButton';
import { InlineError } from '@/components/shared/InlineError';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { isPendingPlaybackId, usePlaybackIds } from '@/hooks/playback-id-queries';
import {
  API_REFERENCE_URL,
  EMBED_INSTALL,
  embedSamples,
  needsSigning,
  type EmbedBy,
} from '@/lib/embed';
import { cn } from '@/lib/utils';

const VIDEO = 'video';

export interface EmbedPanelProps {
  asset: Pick<VideoAsset, 'id' | 'accessTier' | 'status'>;
  /**
   * The video's playback IDs, when the page has them loaded. Without them the
   * panel loads them itself (the same query, so nothing is fetched twice).
   */
  playbackIds?: PlaybackId[];
  /** Tighter spacing, for the preview sheet and other narrow places. */
  compact?: boolean;
  /** This server's address as the reader's code should reach it; the Studio's origin by default. */
  baseUrl?: string;
  className?: string;
}

function optionLabel(p: PlaybackId): string {
  const name = p.name.trim() || p.playbackId;
  return p.policy === 'signed' ? `${name} · Signed URL` : name;
}

/**
 * Embed code for one video: pick what to play by (the video ID or one of its
 * playback IDs), then copy React, HTML or the stream URL for an open video,
 * or the server code that signs URLs plus the page code for a private one
 * (RDS-01, D-11). The samples come from lib/embed.ts, which typechecks them
 * against the real sdk and player.
 */
export function EmbedPanel({
  asset,
  playbackIds,
  compact = false,
  baseUrl,
  className,
}: EmbedPanelProps) {
  const ready = asset.status === 'ready';
  const selectId = useId();
  const [byKey, setByKey] = useState(VIDEO);
  const [tab, setTab] = useState<string>();
  // load the playback ids only when the page did not hand them over
  const own = usePlaybackIds(asset.id, ready && playbackIds === undefined);
  const rows = (playbackIds ?? own.data ?? []).filter((p) => !isPendingPlaybackId(p));

  if (!ready) {
    return (
      <div
        data-slot="embed-panel"
        className={cn(
          'rounded-lg border border-dashed p-4 text-sm text-muted-foreground',
          className,
        )}
      >
        Available once the video is ready.
      </div>
    );
  }

  // a deleted playback id falls back to the video id
  const picked = rows.find((p) => p.playbackId === byKey);
  const by: EmbedBy = picked ?? VIDEO;
  const signed = needsSigning(asset, by);
  const samples = embedSamples(asset, { by, baseUrl });
  const selected = samples.find((s) => s.label === tab) ?? samples[0];
  const npm = selected.kind === 'react' || selected.kind === 'server';

  return (
    <div
      data-slot="embed-panel"
      className={cn('flex min-w-0 flex-col', compact ? 'gap-3' : 'gap-4', className)}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <label htmlFor={selectId} className="text-sm font-medium">
          Play by
        </label>
        <Select value={picked ? picked.playbackId : VIDEO} onValueChange={setByKey}>
          <SelectTrigger id={selectId} size="sm" className="max-w-full min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={VIDEO}>Video ID</SelectItem>
            {rows.map((p) => (
              <SelectItem key={p.id} value={p.playbackId}>
                <span className="truncate" dir="auto">
                  {optionLabel(p)}
                </span>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {playbackIds === undefined && (
        <InlineError
          what="playback IDs"
          error={own.error}
          onRetry={own.refetch}
          retrying={own.isFetching}
        />
      )}

      <CodeBlock
        label="embed code"
        samples={samples.map((s) => ({ label: s.label, language: s.language, code: s.code }))}
        value={selected.label}
        onValueChange={setTab}
        preClassName={compact ? 'max-h-64' : 'max-h-80'}
      />

      {npm && (
        <div className="flex min-w-0 items-center gap-2 rounded-lg border bg-muted/40 py-1 pr-1 pl-3">
          <code className="min-w-0 flex-1 truncate font-mono text-xs">{EMBED_INSTALL}</code>
          <CopyButton value={EMBED_INSTALL} label="Copy install command" />
        </div>
      )}

      <p className="text-sm text-muted-foreground">
        {signed ? (
          <>
            {asset.accessTier === 'private'
              ? 'Private videos play only through signed URLs.'
              : 'This playback ID plays only through signed URLs.'}{' '}
            Your server creates them with an API key. Never put a key in browser code.
          </>
        ) : (
          'Anyone with this code can play the video. No API key needed.'
        )}{' '}
        <a
          href={API_REFERENCE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-0.5 rounded-sm font-medium text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring"
        >
          API reference
          <ArrowUpRight aria-hidden="true" className="size-3.5" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </p>
    </div>
  );
}
