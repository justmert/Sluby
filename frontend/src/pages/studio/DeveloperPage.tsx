import { useState, useCallback, useMemo, useEffect } from 'react';
import {
  Key, Plus, Trash2, Copy, Check, AlertCircle, Eye, EyeOff,
  Terminal, Sparkles, Play, Clock, Shield, Webhook,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { PageContainer } from '@/components/layout/PageContainer';
import { useApiKeys, useCreateApiKey, useDeleteApiKey, type CreateApiKeyParams } from '@/hooks/useApiKeys';
import { useWebhooks, useCreateWebhook, useDeleteWebhook } from '@/hooks/useWebhooks';
import { getStoredApiKey } from '@/lib/api-key-store';
import { sdkTemplates, type SdkTemplate, webhookVerify } from '@/lib/code-snippets';
import { formatRelativeTime } from '@/lib/formatters';
import { cn } from '@/lib/cn';
import { BASE_URL } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// API Keys Tab
// ---------------------------------------------------------------------------

const SCOPE_DESCRIPTIONS: Record<string, string> = {
  upload: 'Create upload sessions and upload video files',
  read: 'Read assets, playback info, metrics, and cache stats',
  manage: 'Update/delete assets, manage API keys and webhooks',
};

function ApiKeysTab() {
  const apiKeys = useApiKeys();
  const createApiKey = useCreateApiKey();
  const deleteApiKey = useDeleteApiKey();

  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<string[]>(['upload', 'read']);
  const [rateLimit, setRateLimit] = useState(100);
  const [newKey, setNewKey] = useState<{ id: string; key: string } | null>(null);
  const [copiedKey, setCopiedKey] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

  const toggleScope = (scope: string) => {
    setScopes((prev) =>
      prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]
    );
  };

  const handleCreate = async () => {
    const result = await createApiKey.mutateAsync({ name, scopes, rate_limit: rateLimit });
    setNewKey({ id: result.id, key: result.key });
    setName('');
    setScopes(['upload', 'read']);
    setRateLimit(100);
  };

  const handleCopyKey = async () => {
    if (!newKey) return;
    await navigator.clipboard.writeText(newKey.key);
    setCopiedKey(true);
    setTimeout(() => setCopiedKey(false), 2000);
  };

  const handleDelete = (id: string) => {
    deleteApiKey.mutate(id);
    setDeleteConfirm(null);
  };

  const keys = apiKeys.data?.data ?? [];

  return (
    <div className="space-y-4">
      {/* Create form */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6">
        <h3 className="text-lg font-semibold text-[#f0f0f0] font-heading flex items-center gap-2 mb-4">
          <Key className="w-4 h-4 text-teal-400" />
          Create API Key
        </h3>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-zinc-400 font-medium mb-1.5 block">Key Name</label>
            <Input placeholder="e.g. production-backend" value={name} onChange={(e) => setName(e.target.value)} className="h-10" />
          </div>
          <div>
            <label className="text-xs text-zinc-400 font-medium mb-2 block">Scopes</label>
            <div className="space-y-2">
              {Object.entries(SCOPE_DESCRIPTIONS).map(([scope, desc]) => (
                <label key={scope} className="flex items-start gap-3 cursor-pointer group">
                  <Checkbox
                    checked={scopes.includes(scope)}
                    onCheckedChange={() => toggleScope(scope)}
                    className="mt-0.5"
                  />
                  <div>
                    <span className="text-sm text-zinc-200 font-medium group-hover:text-zinc-100">{scope}</span>
                    <p className="text-xs text-zinc-400">{desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-400 font-medium mb-1.5 block">Rate Limit (req/min)</label>
            <Input type="number" value={rateLimit} onChange={(e) => setRateLimit(Number(e.target.value))} className="w-32 h-10" />
          </div>
          <Button onClick={handleCreate} disabled={!name || scopes.length === 0 || createApiKey.isPending} className="gap-2">
            <Plus className="w-3.5 h-3.5" />
            {createApiKey.isPending ? 'Creating...' : 'Create API Key'}
          </Button>
          {createApiKey.error && (
            <div className="flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
              <p className="text-xs text-red-400">{createApiKey.error.message}</p>
            </div>
          )}
        </div>
      </div>

      {/* New key alert */}
      {newKey && (
        <div className="bg-emerald-500/5 border border-emerald-500/20 rounded-xl p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Key className="w-4 h-4 text-emerald-400" />
            <span className="text-sm font-semibold text-emerald-300">API Key Created</span>
          </div>
          <p className="text-xs text-amber-400 font-medium">
            Copy this key now -- it will not be shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="flex-1 text-xs font-mono text-emerald-400 bg-[#0a0a0f]/80 border border-white/[0.08] rounded-lg px-2.5 py-2 truncate block overflow-hidden">
              {newKey.key}
            </code>
            <Button variant="ghost" size="sm" onClick={handleCopyKey} className="shrink-0 h-8 w-8 p-0" aria-label="Copy to clipboard">
              {copiedKey ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
          </div>
          <Button variant="ghost" size="sm" onClick={() => setNewKey(null)} className="text-xs bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300">
            I've saved this key
          </Button>
        </div>
      )}

      {/* Key list */}
      {apiKeys.isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full rounded-xl" />)}
        </div>
      ) : keys.length > 0 ? (
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/[0.08] text-left bg-white/[0.03]">
                  <th className="px-4 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider">Name</th>
                  <th className="px-4 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider">Scopes</th>
                  <th className="px-4 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider">Rate Limit</th>
                  <th className="px-4 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider">Created</th>
                  <th className="px-4 py-3 text-xs font-medium text-zinc-400 uppercase tracking-wider text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => (
                  <tr key={k.id} className="border-b border-white/[0.04] hover:bg-white/[0.05] transition-colors duration-200">
                    <td className="px-4 py-3 text-zinc-200 font-medium">{k.name}</td>
                    <td className="px-4 py-3">
                      <div className="flex gap-1 flex-wrap">
                        {k.scopes.map((s) => (
                          <Badge key={s} variant="secondary" className="text-[10px]">{s}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-xs text-zinc-400 font-mono">{k.rate_limit}/min</td>
                    <td className="px-4 py-3 text-xs text-zinc-400">{formatRelativeTime(k.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setDeleteConfirm(k.id)}
                        className="h-7 px-2 text-xs text-red-400 hover:text-red-300 gap-1"
                      >
                        <Trash2 className="w-3 h-3" /> Revoke
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl flex flex-col items-center justify-center py-12 text-center">
          <Key className="w-6 h-6 text-zinc-500 mb-3" />
          <p className="text-sm font-medium text-zinc-300">No API keys yet</p>
          <p className="text-xs text-zinc-500 mt-1">Create your first key above to authenticate API requests</p>
        </div>
      )}

      {/* Delete confirm dialog */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revoke API Key</DialogTitle>
            <DialogDescription>
              This action cannot be undone. The key will immediately stop working for all API requests.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)} className="bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300">Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)} className="gap-2">
              <Trash2 className="w-3.5 h-3.5" /> Revoke Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Webhooks Tab
// ---------------------------------------------------------------------------

const WEBHOOK_EVENT_GROUPS = [
  { label: 'Upload Events', events: ['upload.started', 'upload.completed', 'upload.failed'] },
  { label: 'Processing Events', events: ['processing.started', 'processing.progress'] },
  { label: 'Asset Events', events: ['asset.ready', 'asset.errored'] },
];

function WebhooksTab() {
  const webhooks = useWebhooks();
  const createWebhook = useCreateWebhook();
  const deleteWebhook = useDeleteWebhook();

  const [url, setUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>([]);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [revealedSecrets, setRevealedSecrets] = useState<Set<string>>(new Set());
  const [copiedSecret, setCopiedSecret] = useState<string | null>(null);

  const toggleEvent = (event: string) => {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  const handleCreate = async () => {
    await createWebhook.mutateAsync({ url, events: selectedEvents });
    setUrl('');
    setSelectedEvents([]);
  };

  const handleDelete = (id: string) => {
    deleteWebhook.mutate(id);
    setDeleteConfirm(null);
  };

  const handleCopySecret = async (secret: string, id: string) => {
    await navigator.clipboard.writeText(secret);
    setCopiedSecret(id);
    setTimeout(() => setCopiedSecret(null), 2000);
  };

  const toggleRevealSecret = (id: string) => {
    setRevealedSecrets((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const webhookList = webhooks.data?.data ?? [];
  const verifySnippet = webhookVerify();

  return (
    <div className="space-y-4">
      {/* Register form */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6">
        <h3 className="text-lg font-semibold text-[#f0f0f0] font-heading flex items-center gap-2 mb-4">
          <Webhook className="w-4 h-4 text-teal-400" />
          Register Webhook
        </h3>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-zinc-400 font-medium mb-1.5 block">Endpoint URL</label>
            <Input placeholder="https://your-app.com/webhooks/siastream" value={url} onChange={(e) => setUrl(e.target.value)} className="font-mono text-xs h-10" />
          </div>
          <div>
            <label className="text-xs text-zinc-400 font-medium mb-2 block">Events</label>
            <div className="space-y-3">
              {WEBHOOK_EVENT_GROUPS.map((group) => (
                <div key={group.label}>
                  <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-medium mb-1.5">{group.label}</p>
                  <div className="flex flex-wrap gap-2">
                    {group.events.map((event) => (
                      <label key={event} className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={selectedEvents.includes(event)}
                          onCheckedChange={() => toggleEvent(event)}
                        />
                        <span className="text-xs text-zinc-300">{event}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <Button onClick={handleCreate} disabled={!url || selectedEvents.length === 0 || createWebhook.isPending} className="gap-2">
            <Plus className="w-3.5 h-3.5" />
            {createWebhook.isPending ? 'Registering...' : 'Register Webhook'}
          </Button>
          {createWebhook.error && (
            <div className="flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2">
              <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
              <p className="text-xs text-red-400">{createWebhook.error.message}</p>
            </div>
          )}
        </div>
      </div>

      {/* Webhook list */}
      {webhooks.isLoading ? (
        <div className="space-y-2">
          {[1, 2].map((i) => <Skeleton key={i} className="h-24 w-full rounded-xl" />)}
        </div>
      ) : webhookList.length > 0 ? (
        <div className="space-y-3">
          {webhookList.map((wh) => (
            <div key={wh.id} className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4 space-y-3 hover:bg-white/[0.05] transition-colors duration-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={cn('w-2 h-2 rounded-full shrink-0', wh.is_active ? 'bg-emerald-500' : 'bg-zinc-600')} />
                  <code className="text-xs font-mono text-zinc-200 truncate">{wh.url}</code>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteConfirm(wh.id)}
                  className="h-7 px-2 text-xs text-red-400 hover:text-red-300 gap-1 shrink-0"
                >
                  <Trash2 className="w-3 h-3" /> Delete
                </Button>
              </div>
              <div className="flex flex-wrap gap-1">
                {wh.events.map((evt) => (
                  <Badge key={evt} variant="secondary" className="text-[10px]">{evt}</Badge>
                ))}
              </div>
              {wh.secret && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-zinc-400">Secret:</span>
                  <code className="text-xs font-mono text-zinc-400">
                    {revealedSecrets.has(wh.id) ? wh.secret : '**********************'}
                  </code>
                  <button onClick={() => toggleRevealSecret(wh.id)} className="text-zinc-500 hover:text-zinc-300 transition-colors duration-200" aria-label="Toggle secret visibility">
                    {revealedSecrets.has(wh.id) ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  </button>
                  <button onClick={() => handleCopySecret(wh.secret!, wh.id)} className="text-zinc-500 hover:text-zinc-300 transition-colors duration-200" aria-label="Copy to clipboard">
                    {copiedSecret === wh.id ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl flex flex-col items-center justify-center py-12 text-center">
          <Webhook className="w-6 h-6 text-zinc-500 mb-3" />
          <p className="text-sm font-medium text-zinc-300">No webhooks registered</p>
          <p className="text-xs text-zinc-500 mt-1">Register an endpoint to receive real-time event notifications</p>
        </div>
      )}

      {/* HMAC Verification example */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6">
        <h3 className="text-lg font-semibold text-[#f0f0f0] font-heading flex items-center gap-2 mb-4">
          <Shield className="w-4 h-4 text-violet-400" />
          HMAC Verification (Node.js)
        </h3>
        <div className="relative">
          <pre className="rounded-xl bg-[#0a0a0f]/80 border border-white/[0.08] p-4 overflow-x-auto text-xs font-mono text-zinc-300 leading-relaxed">
            {verifySnippet.node}
          </pre>
        </div>
      </div>

      {/* Delete confirm */}
      <Dialog open={!!deleteConfirm} onOpenChange={() => setDeleteConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Webhook</DialogTitle>
            <DialogDescription>
              This webhook will stop receiving events immediately. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteConfirm(null)} className="bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300">Cancel</Button>
            <Button variant="destructive" onClick={() => deleteConfirm && handleDelete(deleteConfirm)} className="gap-2">
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// API Explorer Tab
// ---------------------------------------------------------------------------

const METHOD_COLORS: Record<string, string> = {
  GET: 'bg-emerald-500/10 text-emerald-400 ring-emerald-500/20',
  POST: 'bg-teal-500/10 text-teal-400 ring-teal-500/20',
  PATCH: 'bg-amber-500/10 text-amber-400 ring-amber-500/20',
  DELETE: 'bg-red-500/10 text-red-400 ring-red-500/20',
};

function groupTemplates(templates: SdkTemplate[]) {
  const groups: Record<string, SdkTemplate[]> = {};
  for (const t of templates) {
    if (!groups[t.category]) groups[t.category] = [];
    groups[t.category].push(t);
  }
  return groups;
}

function ApiExplorerTab() {
  const [method, setMethod] = useState('GET');
  const [path, setPath] = useState('/api/v1/assets?limit=5');
  const [body, setBody] = useState('');
  const [response, setResponse] = useState<unknown>(null);
  const [status, setStatus] = useState<number | undefined>();
  const [duration, setDuration] = useState<number | undefined>();
  const [isLoading, setIsLoading] = useState(false);

  const grouped = useMemo(() => groupTemplates(sdkTemplates), []);

  const execute = useCallback(async () => {
    setIsLoading(true);
    setResponse(null);
    setStatus(undefined);
    setDuration(undefined);

    const start = performance.now();
    try {
      const apiKey = getStoredApiKey();
      const headers: Record<string, string> = {};
      if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
      if (body) headers['Content-Type'] = 'application/json';

      const fullUrl = path.startsWith('http') ? path : `${BASE_URL}${path}`;
      const res = await fetch(fullUrl, {
        method,
        headers,
        body: body || undefined,
      });

      const elapsed = Math.round(performance.now() - start);
      setDuration(elapsed);
      setStatus(res.status);

      const data = await res.json().catch(() => ({ error: 'Non-JSON response' }));
      setResponse(data);
    } catch (err) {
      setDuration(Math.round(performance.now() - start));
      setResponse({ error: err instanceof Error ? err.message : String(err) });
      setStatus(0);
    } finally {
      setIsLoading(false);
    }
  }, [method, path, body]);

  const loadTemplate = (template: SdkTemplate) => {
    setMethod(template.method);
    setPath(template.path);
    setBody(template.body ?? '');
    setResponse(null);
    setStatus(undefined);
    setDuration(undefined);
  };

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        execute();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [execute]);

  const statusColor = (s: number): 'success' | 'warning' | 'destructive' => {
    if (s >= 200 && s < 300) return 'success';
    if (s >= 400 && s < 500) return 'warning';
    return 'destructive';
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Templates sidebar */}
      <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-4">
        <p className="text-sm font-semibold text-[#f0f0f0] font-heading mb-3 flex items-center gap-2">
          <Terminal className="w-3.5 h-3.5 text-zinc-400" />
          API Templates
        </p>
        <div className="space-y-4">
          {Object.entries(grouped).map(([category, templates]) => (
            <div key={category}>
              <p className="text-[10px] text-zinc-500 font-semibold uppercase tracking-wider mb-1.5 px-1">
                {category}
              </p>
              <div className="space-y-0.5">
                {templates.map((template) => (
                  <button
                    key={`${template.method}-${template.path}`}
                    onClick={() => loadTemplate(template)}
                    className={cn(
                      'w-full text-left px-3 py-2 rounded-lg text-sm transition-colors duration-200',
                      path === template.path && method === template.method
                        ? 'bg-teal-500/10 text-teal-400 border-l-2 border-teal-500'
                        : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-200 border-l-2 border-transparent',
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <span className={cn('inline-flex items-center rounded px-1.5 py-0.5 text-[9px] font-semibold ring-1 ring-inset min-w-[40px] justify-center', METHOD_COLORS[template.method])}>
                        {template.method}
                      </span>
                      <span className="text-xs truncate">{template.label}</span>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Request / Response */}
      <div className="lg:col-span-2 space-y-4">
        <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-[#f0f0f0] font-heading flex items-center gap-2">
              <Terminal className="w-4 h-4" />
              Request
            </h3>
            <span className="text-[10px] text-zinc-500 font-mono">Cmd+Enter to run</span>
          </div>
          <div className="space-y-3">
            <div className="flex gap-2">
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger className="w-[100px] shrink-0 text-sm h-10">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="GET">GET</SelectItem>
                  <SelectItem value="POST">POST</SelectItem>
                  <SelectItem value="PATCH">PATCH</SelectItem>
                  <SelectItem value="DELETE">DELETE</SelectItem>
                </SelectContent>
              </Select>
              <Input
                value={path}
                onChange={(e) => setPath(e.target.value)}
                className="font-mono text-xs flex-1 h-10"
              />
              <Button onClick={execute} disabled={isLoading} className="gap-2">
                <Play className="w-3.5 h-3.5" />
                Run
              </Button>
            </div>
            {(method === 'POST' || method === 'PATCH') && (
              <Textarea
                placeholder="Request body (JSON)"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                className="font-mono text-xs h-28"
              />
            )}
          </div>
        </div>

        {response !== null ? (
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl p-5 space-y-3">
            <div className="flex items-center gap-3">
              {status !== undefined && (
                <Badge variant={statusColor(status)}>{status}</Badge>
              )}
              {duration !== undefined && (
                <span className="text-xs text-zinc-400 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {duration}ms
                </span>
              )}
            </div>
            <pre className="rounded-xl bg-[#0a0a0f]/80 border border-white/[0.08] p-4 overflow-x-auto text-[11px] font-mono text-zinc-300 leading-relaxed max-h-96 overflow-y-auto">
              {JSON.stringify(response, null, 2)}
            </pre>
          </div>
        ) : (
          <div className="bg-white/[0.03] border border-white/[0.08] rounded-2xl flex flex-col items-center justify-center py-12 text-center">
            <Sparkles className="w-5 h-5 text-zinc-500 mb-2" />
            <p className="text-sm text-zinc-400">Run a request to see the response</p>
            <p className="text-xs text-zinc-500 mt-1">Pick a template or enter a custom endpoint above</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function DeveloperPage() {
  return (
    <PageContainer>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[#f0f0f0] font-heading mb-1">Developer Tools</h1>
          <p className="text-sm text-zinc-400">Manage API keys, configure webhooks, and explore the API</p>
        </div>

        <Tabs defaultValue="keys">
          <TabsList className="bg-white/[0.04] rounded-lg p-0.5 mb-6">
            <TabsTrigger value="keys" className="gap-1.5 rounded-md data-[state=active]:bg-white/[0.08] data-[state=active]:text-zinc-100">
              <Key className="w-3.5 h-3.5" /> API Keys
            </TabsTrigger>
            <TabsTrigger value="webhooks" className="gap-1.5 rounded-md data-[state=active]:bg-white/[0.08] data-[state=active]:text-zinc-100">
              <Webhook className="w-3.5 h-3.5" /> Webhooks
            </TabsTrigger>
            <TabsTrigger value="explorer" className="gap-1.5 rounded-md data-[state=active]:bg-white/[0.08] data-[state=active]:text-zinc-100">
              <Terminal className="w-3.5 h-3.5" /> API Explorer
            </TabsTrigger>
          </TabsList>

          <TabsContent value="keys">
            <ApiKeysTab />
          </TabsContent>
          <TabsContent value="webhooks">
            <WebhooksTab />
          </TabsContent>
          <TabsContent value="explorer">
            <ApiExplorerTab />
          </TabsContent>
        </Tabs>
      </motion.div>
    </PageContainer>
  );
}
