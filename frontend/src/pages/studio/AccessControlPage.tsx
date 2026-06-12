import { useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import {
  Shield, Lock, CreditCard, Ticket, Plus, Trash2, Users,
  AlertCircle, Send, X, Copy, Check, ExternalLink, UserPlus,
  ChevronDown, ChevronUp, Film, Loader2,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import { PageContainer } from '@/components/layout/PageContainer';
import { useAssets, type VideoAsset } from '@/hooks/useAssets';
import {
  useAllowlists, useSubscriptions, useViewingTickets,
  useCreateAllowlist, useAddAllowlistMember,
  useDeleteAllowlist, useRemoveAllowlistMember,
  usePurchaseSubscription, usePurchaseTicket,
  type AllowlistResponse,
} from '@/hooks/useAccessControl';
import { formatAddress, formatRelativeTime, formatDate, formatDuration } from '@/lib/formatters';
import { siaObjectUrl } from '@/lib/sia';
import { cn } from '@/lib/cn';

// ---------------------------------------------------------------------------
// Shared
// ---------------------------------------------------------------------------

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button onClick={handleCopy} className="text-zinc-500 hover:text-zinc-300 transition-colors" title="Copy">
      {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
    </button>
  );
}

function EmptyState({ icon: Icon, title, description }: { icon: React.ElementType; title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/[0.08] flex flex-col items-center justify-center py-16 text-center">
      <div className="w-10 h-10 rounded-xl bg-white/[0.04] flex items-center justify-center mb-3">
        <Icon className="w-5 h-5 text-zinc-500" />
      </div>
      <p className="text-sm font-medium text-zinc-300">{title}</p>
      <p className="text-xs text-zinc-500 mt-1 max-w-xs">{description}</p>
    </div>
  );
}

function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-red-500/10 border border-red-500/20 px-3 py-2">
      <AlertCircle className="w-3.5 h-3.5 text-red-400 shrink-0" />
      <p className="text-xs text-red-400">{message}</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Allowlist Card
// ---------------------------------------------------------------------------

function AllowlistCard({
  allowlist,
  videoAsset,
  onDelete,
  isDeleting,
}: {
  allowlist: AllowlistResponse;
  videoAsset?: VideoAsset;
  onDelete: (id: string) => void;
  isDeleting: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [newAddress, setNewAddress] = useState('');
  const addMember = useAddAllowlistMember();
  const removeMember = useRemoveAllowlistMember();
  const [localMembers, setLocalMembers] = useState<string[]>(allowlist.allowed);

  const handleAdd = async () => {
    if (!newAddress.trim()) return;
    await addMember.mutateAsync({ allowlistId: allowlist.id, address: newAddress.trim() });
    setLocalMembers((prev) => [...prev, newAddress.trim()]);
    setNewAddress('');
  };

  const handleRemove = async (addr: string) => {
    await removeMember.mutateAsync({ allowlistId: allowlist.id, address: addr });
    setLocalMembers((prev) => prev.filter((a) => a !== addr));
  };

  return (
    <div className="rounded-2xl border border-white/[0.08] bg-white/[0.02] overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-teal-500/10 flex items-center justify-center shrink-0">
          <Lock className="w-4 h-4 text-teal-400" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium text-zinc-100 truncate">{allowlist.name}</h3>
          <div className="flex items-center gap-2 mt-0.5">
            {allowlist.created_at && (
              <span className="text-[10px] text-zinc-600">{formatRelativeTime(allowlist.created_at)}</span>
            )}
          </div>
        </div>
        <Badge variant="secondary" className="shrink-0 tabular-nums">
          <Users className="w-3 h-3 mr-1" />
          {localMembers.length}
        </Badge>
        <button
          onClick={() => setExpanded(!expanded)}
          className="p-1.5 rounded-lg hover:bg-white/[0.06] text-zinc-400 hover:text-zinc-200 transition-colors"
        >
          {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>
      </div>

      {/* Expanded body */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="border-t border-white/[0.06] px-4 py-3 space-y-3">
              {/* Add member row */}
              <div className="flex gap-2">
                <Input
                  placeholder="Enter Sia address (0x...)"
                  value={newAddress}
                  onChange={(e) => setNewAddress(e.target.value)}
                  className="font-mono text-xs h-9"
                  onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
                />
                <Button
                  size="sm"
                  onClick={handleAdd}
                  disabled={!newAddress.trim() || addMember.isPending}
                  className="shrink-0 gap-1.5 h-9"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  {addMember.isPending ? '...' : 'Add'}
                </Button>
              </div>

              {addMember.error && <ErrorBanner message={addMember.error.message} />}

              {/* Members list */}
              <div className="space-y-1 max-h-48 overflow-y-auto">
                {localMembers.map((addr) => (
                  <div
                    key={addr}
                    className="flex items-center justify-between px-3 py-2 rounded-lg bg-white/[0.02] border border-white/[0.06] group"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <div className="w-5 h-5 rounded-full bg-gradient-to-br from-teal-500/30 to-cyan-500/30 flex items-center justify-center text-[8px] font-mono text-teal-400 shrink-0">
                        {addr.slice(2, 4).toUpperCase()}
                      </div>
                      <code className="text-xs font-mono text-zinc-300 truncate">{formatAddress(addr, 10)}</code>
                      <CopyButton text={addr} />
                    </div>
                    <button
                      onClick={() => handleRemove(addr)}
                      disabled={removeMember.isPending}
                      className="opacity-0 group-hover:opacity-100 p-1 rounded-md hover:bg-red-500/10 text-zinc-500 hover:text-red-400 transition-all disabled:opacity-50"
                      title="Remove member"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
                {localMembers.length === 0 && (
                  <p className="text-xs text-zinc-500 text-center py-3">No members — add a Sia address above</p>
                )}
              </div>

              {/* Footer actions */}
              <div className="flex items-center justify-between pt-2 border-t border-white/[0.04]">
                <Link
                  to={`/watch/${allowlist.video_id}`}
                  className="flex items-center gap-2 min-w-0 rounded-lg px-2 py-1.5 -ml-2 hover:bg-white/[0.04] transition-colors group"
                >
                  {videoAsset?.thumbnail_object_ids?.[0] ? (
                    <img
                      src={siaObjectUrl(videoAsset.thumbnail_object_ids[0])}
                      alt=""
                      className="w-8 h-5 rounded object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-8 h-5 rounded bg-white/[0.06] flex items-center justify-center shrink-0">
                      <Film className="w-3 h-3 text-zinc-600" />
                    </div>
                  )}
                  <span className="text-xs text-zinc-400 group-hover:text-zinc-200 truncate transition-colors">
                    {videoAsset?.title || formatAddress(allowlist.video_id)}
                  </span>
                  <ExternalLink className="w-3 h-3 text-zinc-600 group-hover:text-zinc-400 shrink-0 transition-colors" />
                </Link>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(allowlist.id)}
                  disabled={isDeleting}
                  className="h-7 px-2 text-xs text-red-400/70 hover:text-red-400 hover:bg-red-500/10 gap-1"
                >
                  <Trash2 className="w-3 h-3" />
                  Delete
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Allowlist Tab
// ---------------------------------------------------------------------------

function AllowlistsTab() {
  const assets = useAssets({ accessTier: 'private', limit: 50 });
  const allAssets = useAssets({ limit: 100 });
  const allowlistsQuery = useAllowlists();
  const createAllowlist = useCreateAllowlist();
  const deleteAllowlist = useDeleteAllowlist();

  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [videoId, setVideoId] = useState('');
  const [addresses, setAddresses] = useState('');

  const allowlists = allowlistsQuery.data ?? [];
  const assetList = assets.data?.data ?? [];

  // Map video IDs to assets for card display
  const assetMap = useMemo(() => {
    const map = new Map<string, VideoAsset>();
    for (const a of allAssets.data?.data ?? []) {
      map.set(a.id, a);
    }
    return map;
  }, [allAssets.data]);

  const selectedAsset = assetList.find((a) => a.id === videoId);

  const handleCreate = async () => {
    const initial = addresses.split('\n').map((a) => a.trim()).filter(Boolean);
    await createAllowlist.mutateAsync({
      video_asset_id: videoId,
      name,
      ...(initial.length > 0 ? { initial_addresses: initial } : {}),
    });
    setCreateOpen(false);
    setName('');
    setVideoId('');
    setAddresses('');
  };

  const handleVideoSelect = (id: string) => {
    setVideoId(id);
    // Auto-suggest name if empty
    if (!name) {
      const asset = assetList.find((a) => a.id === id);
      if (asset) setName(`${asset.title} Viewers`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-zinc-400">Control who can view your private videos with on-chain allowlists</p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="w-3.5 h-3.5" />
          Create Allowlist
        </Button>
      </div>

      {/* Stats */}
      {allowlists.length > 0 && (
        <div className="grid grid-cols-3 gap-3">
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Allowlists</p>
            <p className="text-xl font-semibold text-zinc-100 mt-0.5">{allowlists.length}</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Total Members</p>
            <p className="text-xl font-semibold text-zinc-100 mt-0.5">{allowlists.reduce((sum, al) => sum + al.allowed.length, 0)}</p>
          </div>
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-3">
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Active</p>
            <p className="text-xl font-semibold text-teal-400 mt-0.5">{allowlists.length}</p>
          </div>
        </div>
      )}

      {/* Allowlist cards */}
      {allowlists.length > 0 ? (
        <div className="space-y-3">
          {allowlists.map((al) => (
            <AllowlistCard
              key={al.id}
              allowlist={al}
              videoAsset={assetMap.get(al.video_id)}
              onDelete={(id) => deleteAllowlist.mutate(id)}
              isDeleting={deleteAllowlist.isPending}
            />
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Shield}
          title="No allowlists yet"
          description="Create an allowlist to restrict video access to specific Sia wallet addresses"
        />
      )}

      {/* Create Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-lg p-0 gap-0 overflow-hidden">
          {/* Header */}
          <div className="px-6 pt-6 pb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-teal-500/15 to-cyan-500/15 border border-teal-500/20 flex items-center justify-center">
                <Shield className="w-5 h-5 text-teal-400" />
              </div>
              <div>
                <DialogHeader className="p-0 space-y-0.5">
                  <DialogTitle className="text-base">Create Allowlist</DialogTitle>
                  <DialogDescription className="text-xs">Deploy an on-chain allowlist to gate video access</DialogDescription>
                </DialogHeader>
              </div>
            </div>
          </div>

          <div className="px-6 pb-6 space-y-5">
            {/* Step 1: Video */}
            <div>
              <div className="flex items-center gap-2 mb-2.5">
                <span className="w-5 h-5 rounded-full bg-teal-500/15 text-teal-400 text-[10px] font-bold flex items-center justify-center">1</span>
                <span className="text-xs font-medium text-zinc-300">Select Video</span>
              </div>
              {!selectedAsset ? (
                <div className="grid grid-cols-2 gap-2 max-h-[180px] overflow-y-auto pr-1">
                  {assetList.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => handleVideoSelect(a.id)}
                      className="group flex flex-col rounded-xl border border-white/[0.06] bg-white/[0.02] hover:border-teal-500/30 hover:bg-teal-500/[0.04] transition-all overflow-hidden text-left"
                    >
                      <div className="relative aspect-video w-full bg-zinc-900 overflow-hidden">
                        {a.thumbnail_object_ids?.[0] ? (
                          <img
                            src={siaObjectUrl(a.thumbnail_object_ids[0])}
                            alt=""
                            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Film className="w-5 h-5 text-zinc-700" />
                          </div>
                        )}
                        {a.duration_ms > 0 && (
                          <span className="absolute bottom-1 right-1 bg-black/80 text-white text-[9px] font-mono px-1 py-0.5 rounded">
                            {formatDuration(a.duration_ms)}
                          </span>
                        )}
                      </div>
                      <div className="px-2 py-1.5">
                        <p className="text-[11px] font-medium text-zinc-300 line-clamp-1 group-hover:text-zinc-100 transition-colors">
                          {a.title || formatAddress(a.id)}
                        </p>
                      </div>
                    </button>
                  ))}
                  {assetList.length === 0 && (
                    <div className="col-span-2 rounded-xl border border-dashed border-white/[0.08] py-8 text-center">
                      <Film className="w-5 h-5 text-zinc-600 mx-auto mb-1.5" />
                      <p className="text-xs text-zinc-500">No private assets found</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="rounded-xl border border-teal-500/20 bg-teal-500/[0.04] p-3 flex items-center gap-3">
                  {selectedAsset.thumbnail_object_ids?.[0] ? (
                    <img
                      src={siaObjectUrl(selectedAsset.thumbnail_object_ids[0])}
                      alt=""
                      className="w-20 h-12 rounded-lg object-cover shrink-0"
                    />
                  ) : (
                    <div className="w-20 h-12 rounded-lg bg-white/[0.06] flex items-center justify-center shrink-0">
                      <Film className="w-5 h-5 text-zinc-600" />
                    </div>
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-zinc-100 truncate">{selectedAsset.title}</p>
                    <div className="flex items-center gap-2 mt-0.5">
                      {selectedAsset.resolution && (
                        <span className="text-[10px] text-zinc-500">{selectedAsset.resolution}</span>
                      )}
                      {selectedAsset.duration_ms > 0 && (
                        <span className="text-[10px] text-zinc-500">{formatDuration(selectedAsset.duration_ms)}</span>
                      )}
                      <Badge variant="secondary" className="text-[9px] h-4 px-1.5">
                        <Lock className="w-2.5 h-2.5 mr-0.5" />
                        Private
                      </Badge>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setVideoId(''); setName(''); }}
                    className="p-1.5 rounded-lg hover:bg-white/[0.08] text-zinc-500 hover:text-zinc-300 transition-colors shrink-0"
                    title="Change video"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Step 2: Name */}
            <div>
              <div className="flex items-center gap-2 mb-2.5">
                <span className={cn(
                  'w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center',
                  videoId ? 'bg-teal-500/15 text-teal-400' : 'bg-white/[0.05] text-zinc-600',
                )}>2</span>
                <span className={cn('text-xs font-medium', videoId ? 'text-zinc-300' : 'text-zinc-600')}>Name</span>
              </div>
              <Input
                placeholder="e.g. VIP Viewers, Beta Testers"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={!videoId}
                className="h-9"
              />
            </div>

            {/* Step 3: Members */}
            <div>
              <div className="flex items-center gap-2 mb-2.5">
                <span className={cn(
                  'w-5 h-5 rounded-full text-[10px] font-bold flex items-center justify-center',
                  name ? 'bg-teal-500/15 text-teal-400' : 'bg-white/[0.05] text-zinc-600',
                )}>3</span>
                <span className={cn('text-xs font-medium', name ? 'text-zinc-300' : 'text-zinc-600')}>
                  Initial Members
                </span>
                <span className="text-[10px] text-zinc-600">(optional)</span>
              </div>
              <Textarea
                placeholder={"0xabc123...\n0xdef456...\n\nOne address per line"}
                value={addresses}
                onChange={(e) => setAddresses(e.target.value)}
                disabled={!name}
                className="font-mono text-xs h-20 resize-none"
              />
              {addresses.trim() && (
                <p className="text-[10px] text-zinc-500 mt-1.5">
                  {addresses.split('\n').map((a) => a.trim()).filter(Boolean).length} address(es) will be added
                </p>
              )}
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-white/[0.06] px-6 py-4 flex items-center justify-between bg-white/[0.01]">
            <Button variant="ghost" size="sm" onClick={() => setCreateOpen(false)} className="text-zinc-400 hover:text-zinc-200">
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!name || !videoId || createAllowlist.isPending}
              size="sm"
              className="gap-2"
            >
              {createAllowlist.isPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Shield className="w-3.5 h-3.5" />
              )}
              {createAllowlist.isPending ? 'Deploying...' : 'Deploy Allowlist'}
            </Button>
          </div>

          {createAllowlist.error && (
            <div className="px-6 pb-4">
              <ErrorBanner message={createAllowlist.error.message} />
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Subscriptions Tab
// ---------------------------------------------------------------------------

function SubscriptionsTab() {
  const [createOpen, setCreateOpen] = useState(false);
  const [subscriberAddress, setSubscriberAddress] = useState('');
  const [tier, setTier] = useState('1');
  const [duration, setDuration] = useState('30');
  const [revenueConfigId, setRevenueConfigId] = useState(import.meta.env.VITE_REVENUE_CONFIG_ID ?? '');
  const [paymentCoinId, setPaymentCoinId] = useState(import.meta.env.VITE_PAYMENT_COIN_ID ?? '');
  const subscriptionsQuery = useSubscriptions();
  const purchaseSubscription = usePurchaseSubscription();

  const subscriptions = subscriptionsQuery.data ?? [];

  const handleCreate = async () => {
    await purchaseSubscription.mutateAsync({
      subscriber_address: subscriberAddress,
      duration_days: Number(duration),
      tier: Number(tier),
      revenue_config_id: revenueConfigId,
      payment_coin_id: paymentCoinId,
    });
    setCreateOpen(false);
    setSubscriberAddress('');
  };

  const tierLabel = (t: number) => t === 1 ? 'Basic' : t === 2 ? 'Premium' : 'VIP';
  const tierColor = (t: number) => t === 2 ? 'text-amber-400 bg-amber-500/10' : 'text-zinc-300 bg-white/[0.06]';
  const isExpired = (date: string) => new Date(date).getTime() < Date.now();
  const durationLabels: Record<string, string> = { '7': '7 days', '30': '30 days', '90': '90 days', '365': '1 year' };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-400">Issue time-limited subscription passes for your viewers</p>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="w-3.5 h-3.5" />
          Create Subscription
        </Button>
      </div>

      {subscriptions.length > 0 ? (
        <div className="space-y-2">
          {subscriptions.map((sub) => {
            const expired = isExpired(sub.expires_at);
            return (
              <div
                key={sub.id}
                className={cn(
                  'rounded-xl border bg-white/[0.02] px-4 py-3 flex items-center gap-4',
                  expired ? 'border-white/[0.04] opacity-60' : 'border-white/[0.08]',
                )}
              >
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500/20 to-pink-500/20 flex items-center justify-center shrink-0">
                  <CreditCard className="w-4 h-4 text-purple-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <code className="text-xs font-mono text-zinc-200">{formatAddress(sub.subscriber, 8)}</code>
                    <CopyButton text={sub.subscriber} />
                  </div>
                  <p className="text-[10px] text-zinc-500 mt-0.5">
                    Expires {formatRelativeTime(sub.expires_at)} &middot; {formatDate(sub.expires_at)}
                  </p>
                </div>
                <Badge className={cn('text-[10px]', tierColor(sub.tier))}>{tierLabel(sub.tier)}</Badge>
                <Badge variant={expired ? 'destructive' : 'success'} className="text-[10px]">
                  {expired ? 'Expired' : 'Active'}
                </Badge>
              </div>
            );
          })}
        </div>
      ) : (
        <EmptyState
          icon={CreditCard}
          title="No subscriptions yet"
          description="Create subscription passes for viewers to access your gated content"
        />
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Subscription</DialogTitle>
            <DialogDescription>Issue a time-limited subscription pass for a viewer</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <label className="text-xs text-zinc-400 font-medium mb-1.5 block">Subscriber Address</label>
              <Input placeholder="0x..." value={subscriberAddress} onChange={(e) => setSubscriberAddress(e.target.value)} className="font-mono text-xs" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-zinc-400 font-medium mb-1.5 block">Tier</label>
                <Select value={tier} onValueChange={setTier}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="1">Basic</SelectItem>
                    <SelectItem value="2">Premium</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-xs text-zinc-400 font-medium mb-1.5 block">Duration</label>
                <Select value={duration} onValueChange={setDuration}>
                  <SelectTrigger className="h-10"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="7">7 days</SelectItem>
                    <SelectItem value="30">30 days</SelectItem>
                    <SelectItem value="90">90 days</SelectItem>
                    <SelectItem value="365">1 year</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="rounded-xl bg-white/[0.03] border border-white/[0.06] px-3 py-2.5 flex items-center gap-2">
              <CreditCard className="w-3.5 h-3.5 text-zinc-500" />
              <p className="text-xs text-zinc-400">
                <span className="font-medium text-zinc-200">{tierLabel(Number(tier))}</span> for <span className="font-medium text-zinc-200">{durationLabels[duration]}</span>
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} className="bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300">Cancel</Button>
            <Button onClick={handleCreate} disabled={!subscriberAddress || purchaseSubscription.isPending} className="gap-2">
              <Send className="w-3.5 h-3.5" />
              {purchaseSubscription.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
          {purchaseSubscription.error && <ErrorBanner message={purchaseSubscription.error.message} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Viewing Tickets Tab
// ---------------------------------------------------------------------------

function ViewingTicketsTab() {
  const assets = useAssets({ accessTier: 'pay_per_view', limit: 50 });
  const ticketsQuery = useViewingTickets();
  const purchaseTicket = usePurchaseTicket();

  const [createOpen, setCreateOpen] = useState(false);
  const [viewerAddress, setViewerAddress] = useState('');
  const [videoId, setVideoId] = useState('');
  const [revenueConfigId] = useState(import.meta.env.VITE_REVENUE_CONFIG_ID ?? '');
  const [paymentCoinId] = useState(import.meta.env.VITE_PAYMENT_COIN_ID ?? '');

  const tickets = ticketsQuery.data ?? [];
  const assetList = assets.data?.data ?? [];

  const handleCreate = async () => {
    await purchaseTicket.mutateAsync({
      viewer_address: viewerAddress,
      video_asset_id: videoId,
      revenue_config_id: revenueConfigId,
      payment_coin_id: paymentCoinId,
    });
    setCreateOpen(false);
    setViewerAddress('');
    setVideoId('');
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-zinc-400">Issue single-use viewing tickets for pay-per-view content</p>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-2">
          <Plus className="w-3.5 h-3.5" />
          Issue Ticket
        </Button>
      </div>

      {tickets.length > 0 ? (
        <div className="space-y-2">
          {tickets.map((ticket) => (
            <div
              key={ticket.id}
              className="rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3 flex items-center gap-4"
            >
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-orange-500/20 to-amber-500/20 flex items-center justify-center shrink-0">
                <Ticket className="w-4 h-4 text-orange-400" />
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <code className="text-xs font-mono text-zinc-200">{formatAddress(ticket.viewer, 8)}</code>
                  <CopyButton text={ticket.viewer} />
                </div>
                <p className="text-[10px] text-zinc-500 mt-0.5">
                  Video: {formatAddress(ticket.video_id)}
                  {ticket.created_at && <> &middot; {formatRelativeTime(ticket.created_at)}</>}
                </p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState
          icon={Ticket}
          title="No viewing tickets yet"
          description="Issue tickets for pay-per-view video content"
        />
      )}

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Issue Viewing Ticket</DialogTitle>
            <DialogDescription>Create a single-use viewing ticket for a specific video</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-4">
            <div>
              <label className="text-xs text-zinc-400 font-medium mb-1.5 block">Recipient Address</label>
              <Input placeholder="0x..." value={viewerAddress} onChange={(e) => setViewerAddress(e.target.value)} className="font-mono text-xs" />
            </div>
            <div>
              <label className="text-xs text-zinc-400 font-medium mb-1.5 block">Video Asset</label>
              <Select value={videoId} onValueChange={setVideoId}>
                <SelectTrigger className="h-10">
                  <SelectValue placeholder="Select a PPV asset" />
                </SelectTrigger>
                <SelectContent>
                  {assetList.map((a) => (
                    <SelectItem key={a.id} value={a.id}>{a.title || a.id}</SelectItem>
                  ))}
                  {assetList.length === 0 && (
                    <SelectItem value="_none" disabled>No PPV assets found</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)} className="bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300">Cancel</Button>
            <Button onClick={handleCreate} disabled={!viewerAddress || !videoId || purchaseTicket.isPending} className="gap-2">
              <Ticket className="w-3.5 h-3.5" />
              {purchaseTicket.isPending ? 'Issuing...' : 'Issue Ticket'}
            </Button>
          </DialogFooter>
          {purchaseTicket.error && <ErrorBanner message={purchaseTicket.error.message} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main Page
// ---------------------------------------------------------------------------

export default function AccessControlPage() {
  return (
    <PageContainer>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2 }}>
        <div className="mb-6">
          <h1 className="text-2xl font-semibold text-[#f0f0f0] font-heading mb-1">Access Control</h1>
          <p className="text-sm text-zinc-400">Manage on-chain allowlists, subscriptions, and viewing tickets</p>
        </div>

        <Tabs defaultValue="allowlists">
          <TabsList className="bg-white/[0.04] rounded-lg p-0.5 mb-6">
            <TabsTrigger value="allowlists" className="gap-1.5 rounded-md data-[state=active]:bg-white/[0.08] data-[state=active]:text-zinc-100">
              <Lock className="w-3.5 h-3.5" /> Allowlists
            </TabsTrigger>
            <TabsTrigger value="subscriptions" className="gap-1.5 rounded-md data-[state=active]:bg-white/[0.08] data-[state=active]:text-zinc-100">
              <CreditCard className="w-3.5 h-3.5" /> Subscriptions
            </TabsTrigger>
            <TabsTrigger value="tickets" className="gap-1.5 rounded-md data-[state=active]:bg-white/[0.08] data-[state=active]:text-zinc-100">
              <Ticket className="w-3.5 h-3.5" /> Tickets
            </TabsTrigger>
          </TabsList>

          <TabsContent value="allowlists">
            <AllowlistsTab />
          </TabsContent>
          <TabsContent value="subscriptions">
            <SubscriptionsTab />
          </TabsContent>
          <TabsContent value="tickets">
            <ViewingTicketsTab />
          </TabsContent>
        </Tabs>
      </motion.div>
    </PageContainer>
  );
}
