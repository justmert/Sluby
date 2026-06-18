import { useState, useRef, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import Hls, { type HlsConfig } from 'hls.js';
import {
  Play, Gauge, AlertTriangle, Download, Wifi, Clock,
  ArrowUpDown, Database, Radio, X, Maximize,
  ChevronDown, ChevronUp, Activity, Film, ArrowLeft,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import type { VideoAsset } from '@/hooks/useAssets';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer } from '@/components/layout/PageContainer';
import { useAssets } from '@/hooks/useAssets';
import { usePlayback } from '@/hooks/usePlayback';
import { formatBitrate, formatBytes, formatDuration } from '@/lib/formatters';
import { BASE_URL } from '@/lib/api-client';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EventKind = 'manifest' | 'level' | 'segment' | 'buffer' | 'error' | 'switch';

interface ActivityEvent {
  id: number;
  time: string;
  kind: EventKind;
  message: string;
  detail?: string;
}

interface QualityLevel {
  index: number;
  name: string;
  bitrate: number;
  width: number;
  height: number;
}

interface PlayerStats {
  bandwidth: number;
  bufferLength: number;
  currentLevel: number;
  autoLevel: boolean;
  latency: number;
  segmentsLoaded: number;
  totalBytesLoaded: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const kindColors: Record<EventKind, string> = {
  manifest: 'text-teal-400',
  level: 'text-violet-400',
  segment: 'text-emerald-400',
  buffer: 'text-amber-400',
  error: 'text-red-400',
  switch: 'text-cyan-400',
};

const kindBgColors: Record<EventKind, string> = {
  manifest: 'bg-teal-500/10',
  level: 'bg-violet-500/10',
  segment: 'bg-emerald-500/10',
  buffer: 'bg-amber-500/10',
  error: 'bg-red-500/10',
  switch: 'bg-cyan-500/10',
};

let eventIdCounter = 0;

function timeNow() {
  const now = new Date();
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;
}

// ---------------------------------------------------------------------------
// Helpers – Object ID rendering
// ---------------------------------------------------------------------------
//
// Object ids are app-layer hashes (renterd-generated) — they are not on-chain
// and the Siascan explorer cannot resolve them. We just truncate the hex for
// readability.

const OBJECT_ID_RE = /\b([A-Za-z0-9_-]{40,})\b/;

function renderDetailWithObjectId(detail: string) {
  const match = detail.match(OBJECT_ID_RE);
  if (!match) return <>{detail}</>;
  const objectId = match[1];
  const idx = match.index!;
  const before = detail.slice(0, idx);
  const after = detail.slice(idx + objectId.length);
  return (
    <>
      {before}
      <span
        title={objectId}
        className="font-mono text-zinc-300"
      >
        {objectId.slice(0, 8)}&hellip;{objectId.slice(-4)}
      </span>
      {after}
    </>
  );
}

// ---------------------------------------------------------------------------
// Stat pill
// ---------------------------------------------------------------------------

function StatPill({ icon: Icon, label, value, color }: { icon: typeof Wifi; label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center gap-3 px-3.5 py-3 rounded-lg bg-white/[0.03] border border-white/[0.08]">
      <Icon className={cn('w-4 h-4', color ?? 'text-zinc-500')} />
      <div className="min-w-0">
        <p className="text-[11px] text-zinc-500 leading-none">{label}</p>
        <p className="text-sm font-mono font-semibold text-zinc-200 tabular-nums leading-tight mt-1">{value}</p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Asset card (grid view)
// ---------------------------------------------------------------------------

function AssetCard({ asset, onSelect }: { asset: VideoAsset; onSelect: (id: string) => void }) {
  return (
    <button
      onClick={() => onSelect(asset.id)}
      className="group text-left cursor-pointer bg-white/[0.03] border border-white/[0.08] rounded-2xl hover:bg-white/[0.05] hover:border-white/[0.12] hover:shadow-lg hover:shadow-teal-500/5 transition-all duration-200 overflow-hidden card-glow"
    >
      {/* Thumbnail */}
      <div className="relative aspect-video bg-zinc-900 overflow-hidden flex items-center justify-center">
        {asset.thumbnail_object_ids?.[0] ? (
          <img
            src={`${BASE_URL}/v1/objects/${asset.thumbnail_object_ids[0]}`}
            alt={asset.title}
            className="w-full h-full object-cover"
            loading="lazy"
          />
        ) : (
          <Film className="w-8 h-8 text-zinc-600" />
        )}
        {/* Duration overlay */}
        {asset.duration_ms > 0 && (
          <span className="absolute bottom-2 right-2 bg-black/70 backdrop-blur-sm text-white text-[10px] font-mono px-1.5 py-0.5 rounded-md">
            {formatDuration(asset.duration_ms)}
          </span>
        )}
        {/* Play hover overlay */}
        <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-center justify-center">
          <div className="p-2.5 rounded-full bg-white/20 backdrop-blur-sm">
            <Play className="w-5 h-5 text-white" />
          </div>
        </div>
      </div>
      {/* Info */}
      <div className="p-3.5">
        <p className="text-sm font-medium text-zinc-200 truncate">{asset.title}</p>
        <div className="flex items-center gap-2 mt-2 text-xs text-zinc-500">
          {asset.resolution && <span>{asset.resolution}</span>}
          {asset.resolution && asset.duration_ms > 0 && <span>&middot;</span>}
          {asset.duration_ms > 0 && <span>{formatDuration(asset.duration_ms)}</span>}
        </div>
        {asset.total_storage_bytes > 0 && (
          <p className="text-[10px] text-zinc-600 mt-1.5">{formatBytes(asset.total_storage_bytes)}</p>
        )}
      </div>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function PlayerPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [selectedId, setSelectedId] = useState<string>(searchParams.get('asset') ?? '');
  const [qualityLabel, setQualityLabel] = useState<string>('Auto');
  const [qualityLevels, setQualityLevels] = useState<QualityLevel[]>([]);
  const [selectedQuality, setSelectedQuality] = useState<string>('-1');
  const [hlsError, setHlsError] = useState<string | null>(null);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [inspectorOpen, setInspectorOpen] = useState(true);
  const [stats, setStats] = useState<PlayerStats>({
    bandwidth: 0, bufferLength: 0, currentLevel: -1,
    autoLevel: true, latency: 0, segmentsLoaded: 0, totalBytesLoaded: 0,
  });

  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const videoRef = useCallback((el: HTMLVideoElement | null) => { setVideoEl(el); }, []);
  const hlsRef = useRef<Hls | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);
  const statsIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const assets = useAssets({ status: 'ready', limit: 50 });
  const playback = usePlayback(selectedId || undefined);

  const selectedAsset = assets.data?.data?.find((a) => a.id === selectedId);

  const [isLogHovered, setIsLogHovered] = useState(false);

  const readyAssets = assets.data?.data?.filter((a) => a.status === 'ready') ?? [];

  const addEvent = useCallback((kind: EventKind, message: string, detail?: string) => {
    setEvents((prev) => [
      ...prev.slice(-199),
      { id: ++eventIdCounter, time: timeNow(), kind, message, detail },
    ]);
  }, []);

  const clearEvents = useCallback(() => setEvents([]), []);

  // Auto-scroll event log (paused on hover)
  useEffect(() => {
    if (!isLogHovered) {
      logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [events, isLogHovered]);

  // Cleanup
  useEffect(() => {
    return () => {
      if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
      if (statsIntervalRef.current) clearInterval(statsIntervalRef.current);
    };
  }, []);

  // Stabilize playback URL to avoid effect re-runs on react-query refetch
  const hlsUrl = playback.data?.playback_url ?? null;

  // Initialize HLS.js
  useEffect(() => {
    if (!videoEl || !hlsUrl) return;

    // Reset state
    setEvents([]);
    setQualityLevels([]);
    setSelectedQuality('-1');
    setQualityLabel('Auto');
    setHlsError(null);
    setStats({ bandwidth: 0, bufferLength: 0, currentLevel: -1, autoLevel: true, latency: 0, segmentsLoaded: 0, totalBytesLoaded: 0 });
    eventIdCounter = 0;

    if (hlsRef.current) { hlsRef.current.destroy(); hlsRef.current = null; }
    if (statsIntervalRef.current) { clearInterval(statsIntervalRef.current); statsIntervalRef.current = null; }

    addEvent('manifest', 'Loading master playlist', hlsUrl);

    if (!Hls.isSupported()) {
      if (videoEl.canPlayType('application/vnd.apple.mpegurl')) {
        videoEl.src = hlsUrl;
        addEvent('manifest', 'Using native HLS (Safari/iOS)');
        return;
      }
      setHlsError('This browser does not support HLS playback.');
      return;
    }

    const hlsConfig: Partial<HlsConfig> = {
      enableWorker: true,
      lowLatencyMode: false,
      manifestLoadingTimeOut: 60000,
      manifestLoadingMaxRetry: 5,
      manifestLoadingRetryDelay: 3000,
      levelLoadingTimeOut: 60000,
      levelLoadingMaxRetry: 5,
      levelLoadingRetryDelay: 3000,
      fragLoadingTimeOut: 120000,
      fragLoadingMaxRetry: 5,
      fragLoadingRetryDelay: 3000,
    };

    const hls = new Hls(hlsConfig);
    hlsRef.current = hls;
    hls.attachMedia(videoEl);
    hls.loadSource(hlsUrl);

    // Poll stats
    statsIntervalRef.current = setInterval(() => {
      try {
        const h = hlsRef.current;
        const video = videoEl;
        if (!h || !video) return;

        let bufferLen = 0;
        try {
          const buffered = video.buffered;
          if (buffered.length > 0) {
            bufferLen = buffered.end(buffered.length - 1) - video.currentTime;
          }
        } catch { /* buffered not available */ }

        setStats((prev) => ({
          ...prev,
          bandwidth: h.bandwidthEstimate ?? prev.bandwidth,
          bufferLength: Math.max(0, bufferLen),
          currentLevel: h.currentLevel,
          autoLevel: h.autoLevelEnabled,
        }));
      } catch { /* ignore */ }
    }, 500);

    hls.on(Hls.Events.MANIFEST_PARSED, (_event, data) => {
      const levels: QualityLevel[] = data.levels.map((level, index) => ({
        index, name: `${level.height}p`, bitrate: level.bitrate, width: level.width, height: level.height,
      }));
      setQualityLevels(levels);
      setQualityLabel('Auto');
      addEvent('manifest', `Parsed ${data.levels.length} quality levels`, levels.map((l) => `${l.name} @ ${formatBitrate(l.bitrate)}`).join(', '));
    });

    hls.on(Hls.Events.LEVEL_LOADING, (_event, data) => {
      addEvent('level', `Loading level ${data.level} playlist`, data.url);
    });

    hls.on(Hls.Events.LEVEL_LOADED, (_event, data) => {
      const level = hls.levels[data.level];
      const segCount = data.details.fragments.length;
      addEvent('level', `Level ${data.level} loaded: ${segCount} segments`, level ? `${level.height}p -- target duration ${data.details.targetduration}s` : undefined);
    });

    hls.on(Hls.Events.FRAG_LOADING, (_event, data) => {
      const frag = data.frag;
      const filename = frag.url.split('/').pop() ?? frag.url;
      addEvent('segment', `Fetching segment #${frag.sn}`, `${filename} -- ${frag.duration.toFixed(2)}s duration`);
    });

    hls.on(Hls.Events.FRAG_LOADED, (_event, data) => {
      const frag = data.frag;
      const fragStats = frag.stats as unknown as Record<string, unknown> | undefined;
      const loading = (fragStats?.loading ?? fragStats) as { start?: number; end?: number } | undefined;
      const loadStart = loading?.start ?? 0;
      const loadEnd = loading?.end ?? 0;
      const loadTime = loadEnd > loadStart ? loadEnd - loadStart : 0;
      const size = (fragStats?.total as number) ?? 0;
      const filename = frag.url.split('/').pop() ?? frag.url;
      const speed = loadTime > 0 ? (size / (loadTime / 1000)) : 0;

      setStats((prev) => ({
        ...prev,
        segmentsLoaded: prev.segmentsLoaded + 1,
        totalBytesLoaded: prev.totalBytesLoaded + size,
        latency: loadTime,
      }));

      addEvent('segment', `Loaded ${filename}`, `${formatBytes(size)} in ${loadTime.toFixed(0)}ms${speed > 0 ? ` (${formatBytes(speed)}/s)` : ''} -- level ${frag.level}`);
    });

    hls.on(Hls.Events.LEVEL_SWITCHED, (_event, data) => {
      const level = hls.levels[data.level];
      if (level) {
        const label = hls.autoLevelEnabled
          ? `Auto (${level.height}p)`
          : `${level.height}p (${formatBitrate(level.bitrate)})`;
        setQualityLabel(label);
        addEvent('switch', `Quality switched to level ${data.level}`, `${level.height}p @ ${formatBitrate(level.bitrate)} -- ${hls.autoLevelEnabled ? 'ABR auto' : 'manual'}`);
      }
    });

    hls.on(Hls.Events.BUFFER_EOS, () => {
      addEvent('buffer', 'End of stream -- all segments buffered');
    });

    hls.on(Hls.Events.ERROR, (_event, data) => {
      addEvent('error', `${data.type}: ${data.details}`, data.fatal ? 'FATAL -- attempting recovery' : 'Non-fatal, continuing');
      if (data.fatal) {
        switch (data.type) {
          case Hls.ErrorTypes.NETWORK_ERROR:
            setHlsError(`Network error: ${data.details}`);
            hls.startLoad();
            break;
          case Hls.ErrorTypes.MEDIA_ERROR:
            setHlsError(`Media error: ${data.details}`);
            hls.recoverMediaError();
            break;
          default:
            setHlsError(`Fatal error: ${data.details}`);
            hls.destroy();
            hlsRef.current = null;
            break;
        }
      }
    });

    return () => {
      hls.destroy();
      hlsRef.current = null;
      if (statsIntervalRef.current) { clearInterval(statsIntervalRef.current); statsIntervalRef.current = null; }
    };
  }, [videoEl, hlsUrl, addEvent]);

  const handleQualityChange = useCallback((value: string) => {
    const levelIndex = parseInt(value, 10);
    setSelectedQuality(value);
    const hls = hlsRef.current;
    if (!hls) return;

    if (levelIndex === -1) {
      hls.currentLevel = -1;
      setQualityLabel('Auto');
    } else {
      hls.currentLevel = levelIndex;
      const level = hls.levels[levelIndex];
      if (level) setQualityLabel(`${level.height}p (${formatBitrate(level.bitrate)})`);
    }
  }, []);

  const handleAssetChange = useCallback((id: string) => {
    setSelectedId(id);
    if (id) {
      setSearchParams({ asset: id }, { replace: true });
    } else {
      setSearchParams({}, { replace: true });
    }
  }, [setSearchParams]);

  const handleFullscreen = useCallback(() => {
    videoEl?.requestFullscreen?.();
  }, []);

  const bufferPct = Math.min(100, (stats.bufferLength / 30) * 100);

  if (assets.isLoading) {
    return (
      <PageContainer>
        <div className="space-y-4">
          <Skeleton className="h-8 w-48" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="aspect-video w-full rounded-xl" />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
        {!selectedId ? (
          /* ── ASSET LIST VIEW ── Grid of ready-to-play assets */
          <div>
            <div className="mb-6">
              <h1 className="text-xl font-semibold text-[#f0f0f0] font-heading">HLS Player</h1>
              <p className="text-sm text-zinc-500 mt-1">Select a video to preview playback</p>
            </div>

            {readyAssets.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
                {readyAssets.map((asset) => (
                  <AssetCard key={asset.id} asset={asset} onSelect={handleAssetChange} />
                ))}
              </div>
            ) : (
              <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl flex flex-col items-center justify-center py-20 text-center">
                <Film className="w-8 h-8 text-zinc-500 mb-3" aria-hidden="true" />
                <p className="text-sm font-medium text-zinc-300">No ready assets</p>
                <p className="text-xs text-zinc-500 mt-1">Upload and process a video first, then come back to preview playback</p>
              </div>
            )}
          </div>
        ) : (
          /* ── PLAYER DETAIL VIEW ── Back button + video player + stats + inspector */
          <div>
            {/* Back button + asset title */}
            <div className="flex items-center gap-3 mb-5">
              <button
                onClick={() => handleAssetChange('')}
                aria-label="Return to videos list"
                className="flex items-center gap-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
              >
                <ArrowLeft className="w-4 h-4" />
                Back to videos
              </button>
              {selectedAsset && (
                <>
                  <span className="text-zinc-600">/</span>
                  <h1 className="text-sm font-medium text-zinc-200 truncate">{selectedAsset.title}</h1>
                </>
              )}
            </div>

            {playback.data ? (
              <div className="space-y-4">
                {/* ── TWO-COLUMN: Video + Stats sidebar ── */}
                <div className="grid grid-cols-1 lg:grid-cols-[1fr_240px] gap-4 items-stretch">
                  {/* Video */}
                  <div className="flex flex-col gap-3">
                    <div className="rounded-2xl overflow-hidden bg-black border border-white/[0.08] shadow-2xl shadow-black/50 flex-1">
                      <div className="relative group h-full">
                        <video
                          ref={videoRef}
                          poster={playback.data.poster_url ?? undefined}
                          controls
                          className="w-full h-full object-contain bg-black"
                        />
                        <button
                          onClick={handleFullscreen}
                          className="absolute top-3 right-3 p-2 rounded-lg bg-black/60 text-white/70 opacity-0 group-hover:opacity-100 transition-all hover:bg-black/80 hover:text-white"
                        >
                          <Maximize className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    {hlsError && (
                      <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-3 flex items-center gap-2 text-red-400 text-xs">
                        <AlertTriangle className="w-4 h-4 shrink-0" />
                        {hlsError}
                      </div>
                    )}
                  </div>

                  {/* Stats sidebar — stretches to match video height */}
                  <div className="flex flex-col gap-2 bg-white/[0.03] border border-white/[0.08] rounded-2xl p-3">
                    <StatPill icon={Gauge} label="Quality" value={qualityLabel} color="text-teal-400" />
                    <StatPill icon={Wifi} label="Bandwidth" value={stats.bandwidth > 0 ? formatBitrate(stats.bandwidth) : '\u2014'} color="text-emerald-400" />
                    <StatPill icon={Clock} label="Latency" value={stats.latency > 0 ? `${stats.latency.toFixed(0)}ms` : '\u2014'} color="text-amber-400" />
                    <StatPill icon={Download} label="Downloaded" value={stats.totalBytesLoaded > 0 ? formatBytes(stats.totalBytesLoaded) : '\u2014'} color="text-violet-400" />
                    <StatPill icon={ArrowUpDown} label="Segments" value={String(stats.segmentsLoaded)} color="text-cyan-400" />
                    {/* Buffer with progress */}
                    <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-white/[0.03] border border-white/[0.08]">
                      <Database className={cn('w-3.5 h-3.5', bufferPct < 20 ? 'text-red-400' : bufferPct < 50 ? 'text-amber-400' : 'text-emerald-400')} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between">
                          <p className="text-[10px] text-zinc-500 leading-none">Buffer</p>
                          <p className="text-[10px] font-mono text-zinc-400 tabular-nums">{stats.bufferLength.toFixed(1)}s</p>
                        </div>
                        <Progress
                          value={bufferPct}
                          className={cn(
                            'h-1 mt-1',
                            bufferPct < 20 ? '[&>div]:bg-red-500' : bufferPct < 50 ? '[&>div]:bg-amber-500' : '[&>div]:bg-emerald-500',
                          )}
                        />
                      </div>
                    </div>
                    {/* Spacer to push bottom items down */}
                    <div className="flex-1" />
                    {/* Quality selector */}
                    {qualityLevels.length > 0 && (
                      <Select value={selectedQuality} onValueChange={handleQualityChange}>
                        <SelectTrigger className="h-8 text-xs w-full bg-white/[0.04] border-white/[0.08] rounded-lg">
                          <SelectValue placeholder="Quality" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="-1">Auto</SelectItem>
                          {qualityLevels.map((level) => (
                            <SelectItem key={level.index} value={String(level.index)}>
                              {level.name} ({formatBitrate(level.bitrate)})
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    {/* Info pills */}
                    <div className="flex items-center gap-2 text-xs text-zinc-500">
                      <Play className="w-3 h-3" />
                      <span>{playback.data.resolution}</span>
                      <span>&middot;</span>
                      <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{playback.data.access_tier}</Badge>
                    </div>
                  </div>
                </div>

                {/* ── PIPELINE INSPECTOR ── Full width collapsible section below */}
                <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
                  <button
                    onClick={() => setInspectorOpen(!inspectorOpen)}
                    aria-expanded={inspectorOpen}
                    aria-label="Toggle pipeline inspector"
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.05] transition-colors"
                  >
                    <div className="flex items-center gap-2">
                      <Radio className="w-4 h-4 text-teal-400" />
                      <span className="text-sm font-semibold text-[#f0f0f0] font-heading">Pipeline Inspector</span>
                      <span className="relative flex h-2 w-2">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                      </span>
                      <Badge variant="secondary" className="text-[10px] ml-1">{events.length} events</Badge>
                    </div>
                    <div className="flex items-center gap-2">
                      {events.length > 0 && (
                        <button
                          onClick={(e) => { e.stopPropagation(); clearEvents(); }}
                          className="flex items-center gap-1 text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-1 rounded-md hover:bg-white/[0.05]"
                        >
                          <X className="w-3 h-3" />
                          Clear
                        </button>
                      )}
                      {inspectorOpen ? <ChevronUp className="w-4 h-4 text-zinc-400" /> : <ChevronDown className="w-4 h-4 text-zinc-400" />}
                    </div>
                  </button>

                  <AnimatePresence>
                    {inspectorOpen && (
                      <motion.div
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.2 }}
                        className="overflow-hidden"
                      >
                        <div className="border-t border-white/[0.08]">
                          <div
                            className="max-h-72 overflow-y-auto font-mono text-[11px] leading-relaxed"
                            onMouseEnter={() => setIsLogHovered(true)}
                            onMouseLeave={() => setIsLogHovered(false)}
                          >
                            {events.length === 0 ? (
                              <div className="px-4 py-8 text-zinc-500 text-center text-xs flex flex-col items-center gap-2">
                                {!selectedId ? (
                                  <>
                                    <Activity className="w-5 h-5 text-zinc-600" aria-hidden="true" />
                                    <span>Select a video to inspect its HLS pipeline</span>
                                  </>
                                ) : (
                                  <>
                                    <Gauge className="w-5 h-5 text-teal-400 animate-spin" aria-hidden="true" />
                                    <span className="text-zinc-400">Initializing HLS stream&hellip;</span>
                                  </>
                                )}
                              </div>
                            ) : (
                              <div>
                                {events.map((evt, idx) => (
                                  <div
                                    key={evt.id}
                                    className={cn(
                                      'flex items-start gap-3 px-4 py-1.5 hover:bg-white/[0.05] transition-colors',
                                      idx % 2 === 0 && 'bg-white/[0.01]',
                                    )}
                                  >
                                    <span className="text-[10px] text-zinc-600 shrink-0 tabular-nums w-[7ch] pt-0.5">{evt.time}</span>
                                    <span
                                      className={cn(
                                        'shrink-0 text-center text-[9px] font-bold uppercase rounded px-1.5 py-0.5 w-[56px]',
                                        kindColors[evt.kind],
                                        kindBgColors[evt.kind],
                                      )}
                                    >
                                      {evt.kind}
                                    </span>
                                    <div className="min-w-0 flex-1">
                                      <span className="text-zinc-300">{evt.message}</span>
                                      {evt.detail && (
                                        <div className="text-zinc-500 text-[10px] truncate mt-0.5">
                                          {evt.kind === 'segment' ? renderDetailWithObjectId(evt.detail) : evt.detail}
                                        </div>
                                      )}
                                    </div>
                                  </div>
                                ))}
                                <div ref={logEndRef} />
                              </div>
                            )}
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-20 gap-3">
                <Skeleton className="h-5 w-48" />
                <Skeleton className="h-3 w-64" />
              </div>
            )}
          </div>
        )}
      </motion.div>
    </PageContainer>
  );
}
