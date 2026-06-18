import { useState, useRef, useCallback, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  Upload,
  CheckCircle2,
  AlertCircle,
  Loader2,
  Cpu,
  XCircle,
  FileVideo,
  ExternalLink,
  Copy,
  Check,
  RotateCcw,
  Play,
  Eye,
  AlertTriangle,
} from 'lucide-react';
import { PageContainer } from '@/components/layout/PageContainer';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { useUpload, type UploadMetadata, type ProcessingLogEntry } from '@/hooks/useUpload';
import { formatBytes } from '@/lib/formatters';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Upload steps
// ---------------------------------------------------------------------------

const STEPS = [
  { key: 'idle', label: 'Select File' },
  { key: 'uploading', label: 'Upload' },
  { key: 'processing', label: 'Process' },
  { key: 'complete', label: 'Complete' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

const FIVE_GB = 5 * 1024 * 1024 * 1024;
const TEN_GB = 10 * 1024 * 1024 * 1024;

type FileSizeWarning = 'none' | 'large' | 'exceeded';

function getFileSizeWarning(size: number): FileSizeWarning {
  if (size > TEN_GB) return 'exceeded';
  if (size > FIVE_GB) return 'large';
  return 'none';
}

function getStepIndex(status: string): number {
  if (status === 'creating') return 1; // Map to Upload step
  const idx = STEPS.findIndex((s) => s.key === status);
  return idx >= 0 ? idx : 0;
}

// ---------------------------------------------------------------------------
// CopyButton (inline)
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <button
      onClick={handleCopy}
      className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-white/[0.06] transition-colors"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Stepper
// ---------------------------------------------------------------------------

function UploadStepper({ currentStatus }: { currentStatus: string }) {
  const currentIndex = getStepIndex(currentStatus);
  const isError = currentStatus === 'error';

  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5 mb-6">
      <div className="flex items-center">
        {STEPS.map((step, i) => {
          const isComplete = i < currentIndex;
          const isCurrent = i === currentIndex && currentStatus !== 'idle';
          const isPending = i > currentIndex || (i === currentIndex && currentStatus === 'idle');

          return (
            <div key={step.key} className="flex items-center flex-1 last:flex-none">
              <div className="flex items-center gap-2.5">
                <div
                  className={cn(
                    'flex items-center justify-center w-8 h-8 rounded-full text-xs font-semibold transition-all duration-300',
                    isComplete && 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30',
                    isCurrent && !isError && 'bg-teal-500/20 text-teal-400 ring-1 ring-teal-500/30',
                    isCurrent && isError && 'bg-red-500/20 text-red-400 ring-1 ring-red-500/30',
                    isPending && 'bg-white/[0.04] text-zinc-500 ring-1 ring-white/[0.08]',
                  )}
                >
                  {isComplete ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : isCurrent && !isError ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : isCurrent && isError ? (
                    <AlertCircle className="w-4 h-4" />
                  ) : (
                    i + 1
                  )}
                </div>
                <span
                  className={cn(
                    'text-xs font-medium whitespace-nowrap hidden sm:inline',
                    isComplete && 'text-emerald-400',
                    isCurrent && !isError && 'text-teal-400',
                    isCurrent && isError && 'text-red-400',
                    isPending && 'text-zinc-500',
                  )}
                >
                  {step.label}
                </span>
              </div>
              {i < STEPS.length - 1 && (
                <div className="flex-1 mx-3 h-px relative">
                  <div className="absolute inset-0 bg-white/[0.08]" />
                  <div
                    className={cn(
                      'absolute inset-y-0 left-0 transition-all duration-500',
                      i < currentIndex ? 'bg-gradient-to-r from-emerald-500/60 to-emerald-400/40 w-full' : 'w-0',
                    )}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Chunk Visualizer
// ---------------------------------------------------------------------------

function ChunkVisualizer({ chunks }: { chunks: Array<{ index: number; status: string }> }) {
  if (chunks.length === 0) return null;

  return (
    <div className="flex gap-[2px] rounded-lg overflow-hidden h-5">
      {chunks.map((chunk) => (
        <div
          key={chunk.index}
          className={cn(
            'flex-1 min-w-[3px] transition-colors duration-200 rounded-sm',
            chunk.status === 'complete' && 'bg-emerald-500',
            chunk.status === 'uploading' && 'bg-teal-500 animate-pulse',
            chunk.status === 'pending' && 'bg-white/[0.08]',
            chunk.status === 'error' && 'bg-red-500',
          )}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Processing Log Viewer
// ---------------------------------------------------------------------------

const STAGE_COLORS: Record<string, { badge: string; text: string }> = {
  transcode: { badge: 'bg-teal-500/20 text-teal-400 ring-1 ring-teal-500/30', text: 'text-teal-400' },
  upload: { badge: 'bg-amber-500/20 text-amber-400 ring-1 ring-amber-500/30', text: 'text-amber-400' },
  finalize: { badge: 'bg-emerald-500/20 text-emerald-400 ring-1 ring-emerald-500/30', text: 'text-emerald-400' },
};

function formatRelativeTime(isoTimestamp: string): string {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(isoTimestamp).getTime()) / 1000));
  if (diff < 5) return 'just now';
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function ProcessingLogViewer({ logs }: { logs: ProcessingLogEntry[] }) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs.length]);

  if (logs.length === 0) return null;

  return (
    <div className="rounded-2xl bg-black/40 border border-white/[0.08] backdrop-blur-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.08]">
        <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
        <span className="text-xs font-medium text-zinc-200 font-heading">Processing Logs</span>
        <span className="text-xs text-zinc-600 ml-auto">{logs.length} entries</span>
      </div>
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        className="max-h-52 overflow-y-auto p-3 space-y-1.5 scrollbar-thin scrollbar-thumb-white/10 scrollbar-track-transparent"
      >
        {logs.map((log, i) => {
          const colors = STAGE_COLORS[log.stage] ?? STAGE_COLORS.transcode;
          return (
            <div key={i} className="flex items-start gap-2.5 group">
              <span className="text-[10px] text-zinc-600 font-mono tabular-nums whitespace-nowrap mt-0.5 min-w-[52px] text-right">
                {formatRelativeTime(log.timestamp)}
              </span>
              <span className={cn(
                'text-[10px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded-md whitespace-nowrap',
                colors.badge,
              )}>
                {log.stage}
              </span>
              <span className="text-xs text-zinc-300 font-mono leading-relaxed break-all">
                {log.message}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rendition Cards
// ---------------------------------------------------------------------------

const RENDITIONS = [
  { label: '1080p', bitrate: '6 Mbps', resolution: '1920×1080', color: 'bg-emerald-500' },
  { label: '720p', bitrate: '3.5 Mbps', resolution: '1280×720', color: 'bg-teal-500' },
  { label: '540p', bitrate: '1.8 Mbps', resolution: '960×540', color: 'bg-amber-500' },
  { label: '360p', bitrate: '800 Kbps', resolution: '640×360', color: 'bg-violet-500' },
];

function RenditionStrip({ progress }: { progress: number }) {
  return (
    <div className="flex gap-2">
      {RENDITIONS.map((r, i) => {
        // Estimate per-rendition progress: each gets ~25% of the 0-80% transcode phase
        const renditionStart = i * 20;
        const renditionEnd = renditionStart + 20;
        const renditionProgress = progress <= renditionStart ? 0
          : progress >= renditionEnd ? 100
          : ((progress - renditionStart) / 20) * 100;
        const isActive = progress >= renditionStart && progress < renditionEnd;
        const isDone = progress >= renditionEnd;

        return (
          <div
            key={r.label}
            className={cn(
              'flex-1 rounded-lg border p-2.5 transition-all duration-300',
              isActive ? 'border-teal-500/30 bg-teal-500/[0.06]' :
              isDone ? 'border-emerald-500/20 bg-emerald-500/[0.04]' :
              'border-white/[0.08] bg-white/[0.03]',
            )}
          >
            <div className="flex items-center gap-2 mb-1.5">
              <div className={cn('w-1.5 h-1.5 rounded-full', r.color, isDone && 'bg-emerald-500', isActive && 'bg-teal-500 animate-pulse')} />
              <span className={cn(
                'text-xs font-semibold',
                isActive ? 'text-teal-400' : isDone ? 'text-emerald-400' : 'text-zinc-400',
              )}>
                {r.label}
              </span>
              {isDone && <CheckCircle2 className="w-3 h-3 text-emerald-400 ml-auto" />}
              {isActive && <Loader2 className="w-3 h-3 text-teal-400 animate-spin ml-auto" />}
            </div>
            <div className="h-1 rounded-full bg-white/[0.06] overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all duration-500',
                  isDone ? 'bg-emerald-500/60' : 'bg-teal-500/60',
                )}
                style={{ width: `${renditionProgress}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <span className="text-[10px] text-zinc-500">{r.resolution}</span>
              <span className="text-[10px] text-zinc-500">{r.bitrate}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload Drop Zone (inline)
// ---------------------------------------------------------------------------

function UploadDropZone({
  onFileSelect,
  file,
}: {
  onFileSelect: (file: File) => void;
  file: File | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  const sizeWarning = file ? getFileSizeWarning(file.size) : 'none';

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      const dropped = e.dataTransfer.files[0];
      if (dropped) onFileSelect(dropped);
    },
    [onFileSelect],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <div>
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onClick={() => inputRef.current?.click()}
        className={cn(
          'relative flex flex-col items-center justify-center h-52 rounded-xl border-2 border-dashed cursor-pointer transition-all duration-200',
          isDragging
            ? 'border-teal-500/60 bg-teal-500/5'
            : file
              ? sizeWarning === 'exceeded'
                ? 'border-red-500/40 bg-red-500/5'
                : 'border-emerald-500/40 bg-emerald-500/5'
              : 'border-white/[0.08] bg-white/[0.01] hover:border-white/[0.15] hover:bg-white/[0.03]',
        )}
      >
        <input
          ref={inputRef}
          type="file"
          accept="video/*"
          aria-label="Select video file to upload"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onFileSelect(f);
          }}
        />
        {file ? (
          <div className="flex flex-col items-center gap-2.5">
            <div className={cn(
              'p-3 rounded-xl',
              sizeWarning === 'exceeded' ? 'bg-red-500/10' : 'bg-emerald-500/10',
            )}>
              <FileVideo className={cn(
                'w-8 h-8',
                sizeWarning === 'exceeded' ? 'text-red-400' : 'text-emerald-400',
              )} />
            </div>
            <p className="text-sm font-medium text-zinc-200">{file.name}</p>
            <p className="text-xs text-zinc-400">{formatBytes(file.size)}</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2.5">
            <div className="p-3 rounded-xl bg-white/[0.04]">
              <Upload className="w-8 h-8 text-zinc-400" />
            </div>
            <p className="text-sm text-zinc-300">
              Drop video here or click to browse
            </p>
            <p className="text-xs text-zinc-500">
              MP4, MOV, WebM, MKV up to 10GB
            </p>
          </div>
        )}
      </div>

      {/* File size warnings */}
      {sizeWarning === 'large' && (
        <div role="alert" className="flex items-center gap-2 mt-3 px-3 py-2 rounded-xl bg-amber-500/10 border border-amber-500/20">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0" />
          <span className="text-xs text-amber-400">Large file — upload may be slow</span>
        </div>
      )}
      {sizeWarning === 'exceeded' && (
        <div role="alert" className="flex items-center gap-2 mt-3 px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="text-xs text-red-400">File exceeds 10GB limit</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page Component
// ---------------------------------------------------------------------------

export default function UploadPage() {
  const { state, startUpload, cancelUpload, reset } = useUpload();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [accessTier, setAccessTier] = useState('public');

  const handleFileSelect = (f: File) => {
    setFile(f);
    if (!title) {
      setTitle(f.name.replace(/\.[^/.]+$/, ''));
    }
  };

  const handleStartUpload = () => {
    if (!file) return;
    const metadata: UploadMetadata = {
      title: title || file.name,
      description,
      access_tier: accessTier,
    };
    startUpload(file, metadata);
  };

  const handleReset = () => {
    reset();
    setFile(null);
    setTitle('');
    setDescription('');
    setAccessTier('public');
  };

  return (
    <PageContainer className="max-w-3xl">
      {/* Stepper */}
      <UploadStepper currentStatus={state.status} />

      {/* ---- IDLE STATE ---- */}
      {(state.status === 'idle' || state.status === 'creating') && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-[#f0f0f0] font-heading mb-5">New Upload</h2>
            <div className="space-y-5">
              <UploadDropZone onFileSelect={handleFileSelect} file={file} />

              <div>
                <label className="text-xs text-zinc-400 font-medium mb-1.5 block">
                  Title
                </label>
                <Input
                  placeholder="Enter a title for the video"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="h-11"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400 font-medium mb-1.5 block">
                  Description
                </label>
                <Textarea
                  placeholder="Optional description..."
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="h-24"
                />
              </div>

              <div>
                <label className="text-xs text-zinc-400 font-medium mb-1.5 block">
                  Access Tier
                </label>
                <Select value={accessTier} onValueChange={setAccessTier}>
                  <SelectTrigger className="h-11">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="public">Public</SelectItem>
                    <SelectItem value="private">Private</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={handleStartUpload}
                disabled={!file || state.status === 'creating' || (file !== null && file.size > TEN_GB)}
                className="w-full gap-2 h-11 bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-lg"
              >
                {state.status === 'creating' ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <Upload className="w-4 h-4" />
                )}
                {state.status === 'creating' ? 'Preparing upload...' : 'Start Upload'}
              </Button>
            </div>
          </div>
        </motion.div>
      )}

      {/* ---- UPLOADING STATE ---- */}
      {state.status === 'uploading' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6">
            <div className="flex items-start gap-6 mb-5">
              {/* Big percentage display */}
              <div className="relative shrink-0">
                <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" strokeWidth="5" className="text-white/[0.08]" />
                  <circle
                    cx="40" cy="40" r="34" fill="none"
                    strokeWidth="5"
                    strokeLinecap="round"
                    className="text-teal-500"
                    stroke="currentColor"
                    strokeDasharray={`${2 * Math.PI * 34}`}
                    strokeDashoffset={`${2 * Math.PI * 34 * (1 - state.progress / 100)}`}
                    style={{ transition: 'stroke-dashoffset 0.3s ease' }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg font-bold text-[#f0f0f0] tabular-nums">{state.progress.toFixed(0)}%</span>
                </div>
              </div>

              <div className="flex-1 min-w-0 pt-1">
                <h2 className="text-lg font-semibold text-[#f0f0f0] font-heading mb-1">Uploading</h2>
                <p className="text-sm text-zinc-400 mb-2">
                  Uploading video via resumable TUS protocol
                </p>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-zinc-300 bg-white/[0.04] px-2.5 py-1 rounded-full tabular-nums">
                    {formatBytes(state.speed)}/s
                  </span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={cancelUpload}
                    className="gap-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/10 h-7 px-2.5"
                  >
                    <XCircle className="w-3.5 h-3.5" />
                    Cancel
                  </Button>
                </div>
              </div>
            </div>

            {state.chunks.length > 0 && (
              <div className="mb-3">
                <ChunkVisualizer chunks={state.chunks} />
              </div>
            )}

            <Progress value={state.progress} />
          </div>
        </motion.div>
      )}

      {/* ---- PROCESSING STATE ---- */}
      {state.status === 'processing' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
          className="space-y-4"
        >
          {/* Main progress card */}
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6">
            <div className="flex items-start gap-6 mb-6">
              {/* Big percentage display */}
              <div className="relative shrink-0">
                <svg className="w-20 h-20 -rotate-90" viewBox="0 0 80 80">
                  <circle cx="40" cy="40" r="34" fill="none" stroke="currentColor" strokeWidth="5" className="text-white/[0.08]" />
                  <circle
                    cx="40" cy="40" r="34" fill="none"
                    strokeWidth="5"
                    strokeLinecap="round"
                    className={state.processingProgress > 80 ? 'text-amber-500' : 'text-teal-500'}
                    stroke="currentColor"
                    strokeDasharray={`${2 * Math.PI * 34}`}
                    strokeDashoffset={`${2 * Math.PI * 34 * (1 - state.processingProgress / 100)}`}
                    style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-lg font-bold text-[#f0f0f0] tabular-nums">{state.processingProgress}%</span>
                </div>
              </div>

              {/* Stage info */}
              <div className="flex-1 min-w-0 pt-1">
                <h2 className="text-lg font-semibold text-[#f0f0f0] font-heading mb-1">
                  {state.processingProgress <= 80
                    ? 'Transcoding'
                    : state.processingProgress < 95
                      ? 'Uploading to Sia'
                      : 'Finalizing'}
                </h2>
                <p className="text-sm text-zinc-400 mb-3">
                  {state.processingProgress <= 80
                    ? 'Converting video to adaptive HLS renditions across 4 quality levels'
                    : state.processingProgress < 95
                      ? 'Uploading rendition files to decentralized Sia storage'
                      : 'Finalizing asset and generating manifest'}
                </p>
                {/* Stage pills */}
                <div className="flex items-center gap-2">
                  {[
                    { label: 'Transcode', threshold: 0, icon: Cpu },
                    { label: 'Upload', threshold: 80, icon: Upload },
                    { label: 'Finalize', threshold: 95, icon: CheckCircle2 },
                  ].map((s) => {
                    const isActive = state.processingProgress >= s.threshold &&
                      (s.threshold === 95 ? true : state.processingProgress < (s.threshold === 0 ? 80 : 95));
                    const isDone = s.threshold === 0
                      ? state.processingProgress > 80
                      : s.threshold === 80
                        ? state.processingProgress >= 95
                        : state.processingProgress >= 100;
                    return (
                      <div
                        key={s.label}
                        className={cn(
                          'flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium transition-all duration-300',
                          isActive && 'bg-teal-500/15 text-teal-400 ring-1 ring-teal-500/20',
                          isDone && 'bg-emerald-500/10 text-emerald-400',
                          !isActive && !isDone && 'bg-white/[0.03] text-zinc-500',
                        )}
                      >
                        {isDone ? <CheckCircle2 className="w-3 h-3" /> :
                         isActive ? <Loader2 className="w-3 h-3 animate-spin" /> :
                         <s.icon className="w-3 h-3" />}
                        {s.label}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Overall progress bar */}
            <Progress value={state.processingProgress} />
          </div>

          {/* Rendition strip */}
          <RenditionStrip progress={state.processingProgress} />

          {/* Processing logs */}
          <ProcessingLogViewer logs={state.processingLogs} />
        </motion.div>
      )}

      {/* ---- COMPLETE STATE ---- */}
      {state.status === 'complete' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6 space-y-5">
            <div className="flex flex-col items-center gap-2.5 py-4">
              <div className="w-14 h-14 rounded-full bg-emerald-500/10 flex items-center justify-center">
                <CheckCircle2 className="w-6 h-6 text-emerald-400" />
              </div>
              <h3 className="text-lg font-semibold text-[#f0f0f0] font-heading">Video ready!</h3>
              <p className="text-sm text-zinc-400">
                Upload and processing completed successfully
              </p>
            </div>

            {/* Thumbnail preview placeholder */}
            {state.asset?.thumbnail_object_ids?.[0] && (
              <div className="rounded-2xl overflow-hidden bg-white/[0.03] border border-white/[0.08] aspect-video flex items-center justify-center">
                <FileVideo className="w-12 h-12 text-zinc-600" />
              </div>
            )}

            {/* Post-upload actions */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-3 justify-center flex-wrap">
                {state.videoAssetId && (
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/studio/assets/${state.videoAssetId}`} className="gap-1.5">
                      <Eye className="w-3.5 h-3.5" />
                      View Asset
                    </Link>
                  </Button>
                )}
                {state.videoAssetId && (
                  <Button variant="outline" size="sm" asChild>
                    <Link to={`/studio/player?asset=${state.videoAssetId}`} className="gap-1.5">
                      <Play className="w-3.5 h-3.5" />
                      Play Video
                    </Link>
                  </Button>
                )}
              </div>
            </div>

            <Button
              variant="outline"
              onClick={handleReset}
              className="w-full gap-2 h-11 bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300"
            >
              <RotateCcw className="w-4 h-4" />
              Upload Another
            </Button>
          </div>
        </motion.div>
      )}

      {/* ---- ERROR STATE ---- */}
      {state.status === 'error' && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="bg-white/[0.03] border border-red-500/20 rounded-2xl p-6 space-y-4">
            <div className="flex flex-col items-center gap-2.5 py-4">
              <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center">
                <AlertCircle className="w-6 h-6 text-red-400" />
              </div>
              <h3 className="text-lg font-semibold text-[#f0f0f0] font-heading">Upload Failed</h3>
              {state.error && (
                <p className="text-sm text-red-400 text-center max-w-md">
                  {state.error}
                </p>
              )}
            </div>

            <div className="flex items-center gap-3 justify-center">
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (file) {
                    reset();
                    // Re-trigger upload with same params
                    setTimeout(() => {
                      startUpload(file, {
                        title: title || file.name,
                        description,
                        access_tier: accessTier,
                      });
                    }, 100);
                  }
                }}
                className="gap-1.5"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                Retry
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300"
              >
                Reset
              </Button>
            </div>
          </div>
        </motion.div>
      )}
    </PageContainer>
  );
}
