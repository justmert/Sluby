import { useState, useCallback, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Upload,
  Lock,
  Globe,
  Film,
  CheckCircle2,
  X,
  Loader2,
  Copy,
  Check,
  Wallet,
} from 'lucide-react';
// ConnectButton removed (Sia wallet integration removed)
import { PageContainer } from '@/components/layout/PageContainer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { useWalletAuth } from '@/hooks/useWalletAuth';
import { useUpload, type UploadMetadata } from '@/hooks/useUpload';
import { truncateAddress } from '@/lib/address-helpers';
import { formatBytes } from '@/lib/formatters';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Access tier config
// ---------------------------------------------------------------------------

type TierKey = 'public' | 'private';

const TIER_OPTIONS: Array<{
  key: TierKey;
  apiValue: string;
  icon: typeof Globe;
  label: string;
  description: string;
  color: string;
  ring: string;
  bg: string;
  iconBg: string;
}> = [
  {
    key: 'public',
    apiValue: 'public',
    icon: Globe,
    label: 'Free',
    description: 'Anyone can watch for free',
    color: 'text-emerald-400',
    ring: 'ring-emerald-500/30',
    bg: 'bg-emerald-500/[0.04]',
    iconBg: 'bg-emerald-500/10',
  },
  {
    key: 'private',
    apiValue: 'private',
    icon: Lock,
    label: 'Private',
    description: 'Only invited addresses',
    color: 'text-violet-400',
    ring: 'ring-violet-500/30',
    bg: 'bg-violet-500/[0.04]',
    iconBg: 'bg-violet-500/10',
  },
];

// ---------------------------------------------------------------------------
// Wallet gate - glassmorphism
// ---------------------------------------------------------------------------

function WalletGate() {
  return (
    <div className="flex items-center justify-center min-h-[60vh]">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="max-w-md w-full bg-white/[0.03] backdrop-blur-xl border border-white/[0.08] rounded-2xl p-8 text-center shadow-2xl shadow-black/20"
      >
        <div className="relative inline-flex items-center justify-center w-16 h-16 rounded-full bg-violet-500/10 mb-5">
          <div className="absolute inset-0 rounded-full bg-violet-500/20 blur-xl" />
          <Wallet className="relative w-7 h-7 text-violet-400" />
        </div>
        <h2 className="text-lg font-semibold text-[#f0f0f0] font-heading mb-1.5">
          Connect Wallet to Upload
        </h2>
        <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
          Upload and share videos on the decentralized web.
        </p>
        <p className="text-xs text-zinc-500">Wallet connection not available</p>
      </motion.div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Upload zone
// ---------------------------------------------------------------------------

function UploadDropZone({
  onFile,
  file,
  onClear,
}: {
  onFile: (f: File) => void;
  file: File | null;
  onClear: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const accept = 'video/mp4,video/quicktime,video/webm,video/x-matroska';

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const f = e.dataTransfer.files[0];
      if (f) onFile(f);
    },
    [onFile],
  );

  if (file) {
    return (
      <div className="flex items-center gap-3 p-4 rounded-2xl border border-white/[0.08] bg-white/[0.03]">
        <div className="w-10 h-10 rounded-lg bg-teal-500/10 flex items-center justify-center shrink-0">
          <Film className="w-5 h-5 text-teal-400" />
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm text-zinc-200 truncate">{file.name}</p>
          <p className="text-xs text-zinc-500">{formatBytes(file.size)}</p>
        </div>
        <button
          onClick={onClear}
          className="p-1.5 rounded-lg hover:bg-white/[0.05] text-zinc-500 hover:text-zinc-300 transition-colors"
          aria-label="Remove file"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    );
  }

  return (
    <div
      className={cn(
        'relative h-48 rounded-xl border-2 border-dashed transition-all duration-200 flex flex-col items-center justify-center cursor-pointer',
        dragOver
          ? 'border-teal-500/60 bg-teal-500/[0.04]'
          : 'border-white/[0.08] hover:border-white/[0.15] bg-white/[0.03]',
      )}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
      onClick={() => inputRef.current?.click()}
    >
      <div className="w-12 h-12 rounded-full bg-white/[0.05] flex items-center justify-center mb-3">
        <Upload className="w-5 h-5 text-zinc-400" />
      </div>
      <p className="text-sm text-zinc-300">
        Drop video here or click to browse
      </p>
      <p className="text-xs text-zinc-600 mt-1">
        MP4, MOV, WebM, MKV up to 10GB
      </p>
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
        }}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Complete card
// ---------------------------------------------------------------------------

function CompleteCard({
  assetId,
  onReset,
}: {
  assetId: string | null;
  onReset: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const navigate = useNavigate();
  const watchUrl = assetId ? `${window.location.origin}/watch/${assetId}` : '';

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      className="text-center py-10"
    >
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: 'spring', delay: 0.1 }}
        className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-emerald-500/10 mb-5"
      >
        <CheckCircle2 className="w-8 h-8 text-emerald-400" />
      </motion.div>
      <h2 className="text-xl font-semibold text-[#f0f0f0] font-heading mb-1.5">
        Your video is live!
      </h2>
      <p className="text-sm text-zinc-400 mb-6 leading-relaxed">
        Your video has been uploaded and processed successfully.
      </p>
      <div className="flex flex-col sm:flex-row items-center justify-center gap-3">
        {assetId && (
          <Button onClick={() => navigate(`/watch/${assetId}`)}>
            Watch Video
          </Button>
        )}
        {watchUrl && (
          <Button
            variant="outline"
            onClick={() => {
              navigator.clipboard.writeText(watchUrl);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
            className="gap-1.5"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copied!' : 'Copy Share Link'}
          </Button>
        )}
        <Button variant="ghost" onClick={onReset}>
          Upload Another
        </Button>
      </div>
    </motion.div>
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

export default function CreatorUploadPage() {
  const { isConnected, address } = useWalletAuth();
  const upload = useUpload();
  const navigate = useNavigate();

  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tier, setTier] = useState<TierKey>('public');
  const [allowedAddresses, setAllowedAddresses] = useState('');

  if (!isConnected) {
    return (
      <PageContainer className="max-w-2xl mx-auto">
        <WalletGate />
      </PageContainer>
    );
  }

  const handleFileSelect = (f: File) => {
    setFile(f);
    if (!title) {
      const name = f.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
      setTitle(name);
    }
  };

  const handleSubmit = () => {
    if (!file || !title) return;

    const selectedTier = TIER_OPTIONS.find((t) => t.key === tier);
    const metadata: UploadMetadata = {
      title,
      description,
      access_tier: selectedTier?.apiValue ?? 'public',
    };

    if (tier === 'private' && allowedAddresses) {
      metadata.initial_viewer_addresses = allowedAddresses
        .split('\n')
        .map((a) => a.trim())
        .filter(Boolean)
        .join(',');
    }

    upload.startUpload(file, metadata);
  };

  const handleReset = () => {
    upload.reset();
    setFile(null);
    setTitle('');
    setDescription('');
    setTier('public');
    setAllowedAddresses('');
  };

  const isUploading = upload.state.status !== 'idle' && upload.state.status !== 'error';
  const isComplete = upload.state.status === 'complete';

  return (
    <PageContainer className="max-w-2xl mx-auto">
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
      <div className="mb-6">
        <h1 className="text-2xl font-semibold text-[#f0f0f0] font-heading mb-1">Upload Video</h1>
        <p className="text-sm text-zinc-400">Upload and publish video content to the decentralized web</p>
      </div>

      {/* Connected wallet */}
      <div className="flex items-center gap-3 mb-6 p-3 rounded-xl border border-white/[0.08] bg-white/[0.03]">
        <div className="w-8 h-8 rounded-full bg-gradient-to-br from-teal-500 to-cyan-500 flex items-center justify-center shrink-0 text-white text-xs font-bold">
          {(address ?? '').slice(2, 4).toUpperCase()}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm text-zinc-300 font-mono">
            {truncateAddress(address ?? '')}
          </span>
        </div>
        <Badge variant="success" className="text-[10px] rounded-full">Connected</Badge>
      </div>

      {/* Complete state */}
      {isComplete ? (
        <CompleteCard
          assetId={upload.state.videoAssetId}
          onReset={handleReset}
        />
      ) : isUploading ? (
        /* Progress state */
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6"
        >
          <div className="text-center mb-5">
            <div className="relative inline-flex items-center justify-center w-12 h-12 rounded-full bg-teal-500/10 mb-3">
              <Loader2 className="w-6 h-6 text-teal-400 animate-spin" />
            </div>
            <h3 className="text-sm font-medium text-zinc-200">
              {upload.state.status === 'creating'
                ? 'Creating upload session...'
                : upload.state.status === 'uploading'
                  ? 'Uploading video...'
                  : upload.state.status === 'processing'
                    ? (upload.state.processingStage ?? 'Processing...')
                    : 'Working...'}
            </h3>
          </div>
          <Progress
            value={
              upload.state.status === 'processing'
                ? upload.state.processingProgress
                : upload.progress
            }
            className="mb-2"
          />
          <div className="flex items-center justify-between text-xs text-zinc-500">
            <span>
              {Math.round(
                upload.state.status === 'processing'
                  ? upload.state.processingProgress
                  : upload.progress,
              )}
              %
            </span>
            {upload.state.status === 'uploading' && upload.speed > 0 && (
              <span>{formatBytes(upload.speed)}/s</span>
            )}
          </div>
          {upload.state.status === 'uploading' && (
            <div className="mt-4 flex justify-center">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => upload.cancelUpload()}
              >
                Cancel Upload
              </Button>
            </div>
          )}
        </motion.div>
      ) : (
        /* Upload form */
        <div className="space-y-6">
          {/* Error display */}
          {upload.state.status === 'error' && upload.error && (
            <div className="flex items-center gap-2 p-3 rounded-xl bg-red-500/10 border border-red-500/20">
              <X className="w-4 h-4 text-red-400 shrink-0" />
              <p className="text-sm text-red-300">{upload.error}</p>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleReset}
                className="ml-auto text-xs"
              >
                Reset
              </Button>
            </div>
          )}

          {/* Drop zone */}
          <UploadDropZone
            onFile={handleFileSelect}
            file={file}
            onClear={() => setFile(null)}
          />

          {/* Details section */}
          <div className="space-y-4">
            <p className="text-xs uppercase tracking-wider text-zinc-500 font-medium">Details</p>
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block font-medium">Title</label>
              <Input
                placeholder="Video title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="bg-white/[0.03] border-white/[0.08] focus:border-white/[0.15]"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-400 mb-1.5 block font-medium">
                Description <span className="text-zinc-600">(optional)</span>
              </label>
              <Textarea
                placeholder="Describe your video..."
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="h-20 bg-white/[0.03] border-white/[0.08] focus:border-white/[0.15]"
              />
            </div>
          </div>

          {/* Access Tier - card-style options with icons */}
          <div>
            <label className="text-xs text-zinc-400 mb-2.5 block font-medium">
              Access Tier
            </label>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5" role="radiogroup" aria-label="Access tier">
              {TIER_OPTIONS.map((opt, idx) => {
                const Icon = opt.icon;
                const selected = tier === opt.key;
                return (
                  <button
                    key={opt.key}
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setTier(opt.key)}
                    onKeyDown={(e) => {
                      const keys: Record<string, number> = {
                        ArrowRight: 1,
                        ArrowDown: 1,
                        ArrowLeft: -1,
                        ArrowUp: -1,
                      };
                      const dir = keys[e.key];
                      if (dir !== undefined) {
                        e.preventDefault();
                        const nextIdx = (idx + dir + TIER_OPTIONS.length) % TIER_OPTIONS.length;
                        setTier(TIER_OPTIONS[nextIdx].key);
                        const parent = (e.currentTarget as HTMLElement).parentElement;
                        const buttons = parent?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
                        buttons?.[nextIdx]?.focus();
                      }
                    }}
                    className={cn(
                      'flex flex-col items-start p-3.5 rounded-xl border transition-all duration-150 text-left',
                      selected
                        ? `ring-2 ${opt.ring} border-transparent ${opt.bg}`
                        : 'border-white/[0.08] bg-white/[0.03] hover:border-white/[0.12]',
                    )}
                  >
                    <div
                      className={cn(
                        'w-8 h-8 rounded-lg flex items-center justify-center mb-2',
                        selected ? opt.iconBg : 'bg-white/[0.05]',
                      )}
                    >
                      <Icon
                        className={cn(
                          'w-5 h-5',
                          selected ? opt.color : 'text-zinc-500',
                        )}
                      />
                    </div>
                    <span
                      className={cn(
                        'text-sm font-medium',
                        selected ? 'text-zinc-100' : 'text-zinc-400',
                      )}
                    >
                      {opt.label}
                    </span>
                    <span className="text-xs text-zinc-500 mt-0.5 leading-relaxed">
                      {opt.description}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Tier-specific inputs */}
            <AnimatePresence mode="wait">
              {tier === 'private' && (
                <motion.div
                  key="private"
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  className="overflow-hidden"
                >
                  <div className="mt-3 space-y-2">
                    <Textarea
                      placeholder="Allowed addresses (one per line, 0x...)"
                      value={allowedAddresses}
                      onChange={(e) => setAllowedAddresses(e.target.value)}
                      className="h-20 font-mono text-xs bg-white/[0.03] border-white/[0.08]"
                    />
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {/* Submit */}
          <Button
            className="w-full gap-2"
            disabled={!file || !title}
            onClick={handleSubmit}
          >
            <Upload className="w-4 h-4" />
            Upload Video
          </Button>
        </div>
      )}
      </motion.div>
    </PageContainer>
  );
}
