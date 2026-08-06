import { useState } from 'react';
import {
  Sun,
  Moon,
  Monitor,
  Key,
  Globe,
  Check,
  ExternalLink,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer } from '@/components/layout/PageContainer';
import { useTheme, type Theme } from '@/lib/theme';
import { useHealthCheck } from '@/hooks/useHealthCheck';
import { getStoredApiKey, setStoredApiKey } from '@/lib/api-key-store';
import { BASE_URL } from '@/lib/api-client';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Appearance Section
// ---------------------------------------------------------------------------

function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  const themes: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Light', icon: Sun },
    { value: 'dark', label: 'Dark', icon: Moon },
    { value: 'system', label: 'System', icon: Monitor },
  ];

  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6">
      <h3 className="text-lg font-semibold text-[#f0f0f0] font-heading mb-1">Appearance</h3>
      <p className="text-sm text-zinc-400 mb-4">Choose your preferred theme</p>
      <div className="flex gap-2">
        {themes.map(({ value, label, icon: Icon }) => (
          <button
            key={value}
            onClick={() => setTheme(value)}
            className={cn(
              'flex items-center gap-2 px-4 py-2.5 rounded-lg border transition-all',
              theme === value
                ? 'border-teal-500/50 bg-teal-500/10 text-teal-400'
                : 'border-white/[0.08] bg-white/[0.03] text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200',
            )}
          >
            <Icon className="w-4 h-4" />
            <span className="text-sm font-medium">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// API Configuration Section
// ---------------------------------------------------------------------------

function ApiConfigSection() {
  const health = useHealthCheck(10000);
  const [apiKey, setApiKey] = useState(getStoredApiKey() ?? '');
  const [showKey, setShowKey] = useState(false);
  const [saved, setSaved] = useState(false);

  const handleSave = () => {
    setStoredApiKey(apiKey);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6">
      <h3 className="text-lg font-semibold text-[#f0f0f0] font-heading mb-1">API Configuration</h3>
      <p className="text-sm text-zinc-400 mb-4">Manage your API key and view connection status</p>
      <div className="space-y-4">
        <div>
          <label className="text-xs text-zinc-400 font-medium mb-1.5 block">Active API Key</label>
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                type={showKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your API key"
                className="font-mono text-xs pr-8 h-10"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                {showKey ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
              </button>
            </div>
            <Button
              size="sm"
              onClick={handleSave}
              className="gap-1.5 bg-gradient-to-r from-teal-500 to-teal-600 text-white rounded-lg"
            >
              {saved ? <Check className="w-3.5 h-3.5" /> : <Key className="w-3.5 h-3.5" />}
              {saved ? 'Saved' : 'Save'}
            </Button>
          </div>
        </div>
        <div>
          <label className="text-xs text-zinc-400 font-medium mb-1.5 block">Backend URL</label>
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-xl border border-white/[0.08] bg-white/[0.03]">
            <Globe className="w-3.5 h-3.5 text-zinc-400" />
            <code className="text-xs font-mono text-zinc-300">{BASE_URL}</code>
          </div>
        </div>
        <div>
          <label className="text-xs text-zinc-400 font-medium mb-1.5 block">
            Connection Status
          </label>
          <div className="flex items-center gap-2">
            {health.isLoading ? (
              <Skeleton className="h-5 w-24" />
            ) : health.data?.status === 'ok' ? (
              <>
                <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                <span className="text-sm text-emerald-400 font-medium">Connected</span>
                {health.data.version && (
                  <Badge variant="secondary" className="text-[10px]">
                    v{health.data.version}
                  </Badge>
                )}
              </>
            ) : (
              <>
                <XCircle className="w-4 h-4 text-red-400" />
                <span className="text-sm text-red-400 font-medium">Disconnected</span>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// About Section
// ---------------------------------------------------------------------------

function AboutSection() {
  return (
    <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6">
      <h3 className="text-lg font-semibold text-[#f0f0f0] font-heading mb-4">About</h3>
      <div className="space-y-3">
        <div className="flex items-center justify-between text-sm py-2 border-b border-white/[0.04]">
          <span className="text-zinc-400">Version</span>
          <Badge variant="secondary">1.0.0</Badge>
        </div>
        <div className="flex items-center justify-between text-sm py-2 border-b border-white/[0.04]">
          <span className="text-zinc-400">License</span>
          <span className="text-zinc-200">Apache 2.0</span>
        </div>
        <div className="flex items-center gap-3 pt-2">
          <a
            href="https://github.com/justmert/sluby"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-teal-400 hover:text-teal-300 flex items-center gap-1 transition-colors"
          >
            GitHub <ExternalLink className="w-3 h-3" />
          </a>
          <a
            href="https://docs.sluby.app"
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-teal-400 hover:text-teal-300 flex items-center gap-1 transition-colors"
          >
            Documentation <ExternalLink className="w-3 h-3" />
          </a>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function SettingsPage() {
  return (
    <PageContainer>
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
      >
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[#f0f0f0] font-heading mb-1">Settings</h1>
          <p className="text-sm text-zinc-400">Configure appearance and API access</p>
        </div>

        <div className="space-y-6">
          <AppearanceSection />
          <ApiConfigSection />
          <AboutSection />
        </div>
      </motion.div>
    </PageContainer>
  );
}
