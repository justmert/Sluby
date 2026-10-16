import { useId, useMemo, useState } from 'react';
import type { PlaybackId, VideoAsset } from '@sluby/sdk';
import { CopyButton } from '@/components/shared/CopyButton';
import { InlineError } from '@/components/shared/InlineError';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { isPendingPlaybackId, usePlaybackIds } from '@/hooks/playback-id-queries';
import {
  API_REFERENCE_URL,
  EMBED_INSTALL,
  embedSamples,
  needsSigning,
  type EmbedBy,
} from '@/lib/embed';
import { tokenize, type CodeLanguage, type TokenType } from '@/lib/highlight';
import { cn } from '@/lib/utils';

const VIDEO = 'video';

const TOKEN_CLASS: Record<TokenType, string | undefined> = {
  comment: 'text-muted-foreground italic',
  string: 'text-code-string',
  keyword: 'text-code-keyword',
  number: 'text-code-number',
  variable: 'text-code-number',
  fn: 'text-code-fn',
  tag: 'text-code-keyword',
  plain: undefined,
};

function Highlighted({ code, language }: { code: string; language: CodeLanguage }) {
  const tokens = useMemo(() => tokenize(code, language), [code, language]);
  return (
    <>
      {tokens.map((t, i) =>
        TOKEN_CLASS[t.type] ? (
          <span key={i} className={TOKEN_CLASS[t.type]}>
            {t.text}
          </span>
        ) : (
          t.text
        ),
      )}
    </>
  );
}

export interface EmbedPanelProps {
  asset: Pick<VideoAsset, 'id' | 'accessTier' | 'status'>;
  /**
   * The video's playback IDs, when the page has them loaded. Without them the
   * panel loads them itself (the same query, so nothing is fetched twice).
   */
  playbackIds?: PlaybackId[];
  /** Tighter spacing, for the upload rows and other narrow places. */
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
 * Embed code for one video, laid out like the board's Share card: pick what
 * to play by (the video ID or one of its playback IDs) with a note on who
 * can play it, the code with React, HTML and Stream URL segments (the server
 * signing code first for a private video) and Copy, then the install
 * command and the API reference. The samples come from lib/embed.ts, which
 * typechecks them against the real sdk and player.
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
      className={cn('flex min-w-0 flex-col text-sm', compact ? 'gap-3' : 'gap-3.5', className)}
    >
      <div className="flex flex-wrap items-center gap-3">
        <label htmlFor={selectId} className="font-semibold">
          Play by
        </label>
        <Select value={picked ? picked.playbackId : VIDEO} onValueChange={setByKey}>
          <SelectTrigger id={selectId} className="max-w-full min-w-40">
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
        <span className="min-w-0 text-muted-foreground">
          {signed ? (
            <>
              {asset.accessTier === 'private'
                ? 'Private videos play only through signed URLs.'
                : 'This playback ID plays only through signed URLs.'}{' '}
              Your server creates them with an API key. Never put a key in browser code.
            </>
          ) : picked ? (
            'Open playback ID: anyone with the code can play it.'
          ) : (
            'Public video: anyone with the code can play it.'
          )}
        </span>
      </div>

      {playbackIds === undefined && (
        <InlineError
          what="playback IDs"
          error={own.error}
          onRetry={own.refetch}
          retrying={own.isFetching}
        />
      )}

      <Tabs
        value={selected.label}
        onValueChange={setTab}
        className="min-w-0 gap-0 overflow-hidden rounded-lg border"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2 border-b bg-background p-1.5">
          <TabsList aria-label="Code" className="max-w-full min-w-0 overflow-x-auto">
            {samples.map((s) => (
              <TabsTrigger key={s.label} value={s.label}>
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>
          <CopyButton
            value={selected.code}
            label={`Copy embed code (${selected.label})`}
            withText
            variant="outline"
            className="ml-auto h-7.5 px-2.5"
          />
        </div>
        {samples.map((s) => (
          // the code is the focus stop; a focusable panel too would be two for one snippet
          <TabsContent key={s.label} value={s.label} tabIndex={-1} className="min-w-0 rounded-none">
            <pre
              tabIndex={0}
              role="region"
              aria-label="embed code"
              className={cn(
                // no ligatures: code people copy should show !== and => as typed
                'overflow-x-auto bg-card p-4 font-mono text-[13px] leading-[1.7] [font-variant-ligatures:none] outline-none focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring',
                compact ? 'max-h-64' : 'max-h-80',
              )}
            >
              <code>
                <Highlighted code={s.code} language={s.language} />
              </code>
            </pre>
          </TabsContent>
        ))}
      </Tabs>

      <div className="flex flex-wrap items-center gap-2 text-muted-foreground">
        {npm && (
          <>
            <code className="min-w-0 truncate rounded-[6px] border px-2 py-0.5 font-mono text-foreground">
              {EMBED_INSTALL}
            </code>
            <CopyButton
              value={EMBED_INSTALL}
              label="Copy install command"
              withText
              variant="outline"
              className="h-7 px-2.5"
            />
          </>
        )}
        <a
          href={API_REFERENCE_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="ml-auto rounded-sm font-semibold text-primary hover:text-primary-hover"
        >
          API reference
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>
    </div>
  );
}
