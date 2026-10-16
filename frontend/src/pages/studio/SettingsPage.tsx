import { useState } from 'react';
import { AlertTriangle, KeyRound, LogOut, Monitor, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { useSession } from '@/components/AuthGate';
import { useTheme, type Theme } from '@/components/theme-provider';
import { THEME_OPTIONS } from '@/components/theme-toggle';
import { CopyButton } from '@/components/shared/CopyButton';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  useRotateApiKey,
  type ApiKeyRecord,
  type IssuedKey,
  type KeyScope,
} from '@/hooks/useApiKeys';
import { useSystemStatus } from '@/hooks/useStats';
import { useRevokeAllSessions, useRevokeSession, useSessions } from '@/hooks/useSessions';
import { formatDate, formatRelativeTime } from '@/lib/formatters';

const SCOPES: { value: KeyScope; label: string; detail: string }[] = [
  { value: 'upload', label: 'upload', detail: 'Upload videos through tus' },
  { value: 'read', label: 'read', detail: 'Read assets, playback urls, storage details' },
  { value: 'manage', label: 'manage', detail: 'Edit and delete assets, keys and webhooks' },
];

const GRACE_OPTIONS = [
  { value: '0', label: 'Immediately' },
  { value: '3600', label: 'After 1 hour' },
  { value: '86400', label: 'After 24 hours' },
  { value: '604800', label: 'After 7 days' },
];

export function timeLeft(iso: string, now = Date.now()): string {
  const minutes = Math.ceil((new Date(iso).getTime() - now) / 60_000);
  if (minutes <= 0) return 'now';
  if (minutes < 60) return `in ${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours >= 24) return `in ${Math.floor(hours / 24)}d ${hours % 24}h`;
  return `in ${hours}h ${minutes % 60}m`;
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

/** Shows a freshly issued secret, which the server never returns again. */
function SecretDialog({ issued, onClose }: { issued: IssuedKey | null; onClose: () => void }) {
  return (
    <Dialog open={issued !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {issued?.rotated_from ? 'Key rotated' : 'Key created'}: {issued?.name}
          </DialogTitle>
          <DialogDescription>
            Copy the secret now. It is stored only as a hash and cannot be shown again.
          </DialogDescription>
        </DialogHeader>
        <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
          <code className="min-w-0 flex-1 font-mono text-xs break-all" data-testid="issued-key">
            {issued?.key}
          </code>
          {issued && <CopyButton value={issued.key} label="Copy API key" />}
        </div>
        {issued?.previous_key_expires_at && (
          <p className="text-sm text-muted-foreground">
            The previous key stops working{' '}
            {new Date(issued.previous_key_expires_at).getTime() <= Date.now() + 5_000
              ? 'now'
              : `on ${new Date(issued.previous_key_expires_at).toLocaleString()}`}
            .
          </p>
        )}
        <DialogFooter>
          <Button onClick={onClose}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CreateKeyDialog({
  open,
  onOpenChange,
  onIssued,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onIssued: (k: IssuedKey) => void;
}) {
  const create = useCreateApiKey();
  const [name, setName] = useState('');
  const [scopes, setScopes] = useState<KeyScope[]>(['upload', 'read']);
  const [rateLimit, setRateLimit] = useState('100');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const issued = await create.mutateAsync({
        name: name.trim(),
        scopes,
        rate_limit: Number(rateLimit),
      });
      onOpenChange(false);
      setName('');
      onIssued(issued);
    } catch (err) {
      toast.error(`Could not create key: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const rate = Number(rateLimit);
  const valid = name.trim() !== '' && scopes.length > 0 && Number.isInteger(rate) && rate > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              Keys act for your account with the scopes you pick.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="key-name">Name</FieldLabel>
              <Input
                id="key-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="production web app"
                maxLength={100}
                autoFocus
              />
            </Field>
            <FieldSet>
              <FieldLegend variant="label">Scopes</FieldLegend>
              {SCOPES.map((s) => (
                <Field key={s.value} orientation="horizontal">
                  <Checkbox
                    id={`scope-${s.value}`}
                    checked={scopes.includes(s.value)}
                    onCheckedChange={(on) =>
                      setScopes((prev) =>
                        on === true ? [...prev, s.value] : prev.filter((x) => x !== s.value),
                      )
                    }
                  />
                  <Label htmlFor={`scope-${s.value}`} className="font-normal">
                    <span className="font-mono">{s.label}</span>
                    <span className="text-muted-foreground">{s.detail}</span>
                  </Label>
                </Field>
              ))}
            </FieldSet>
            <Field>
              <FieldLabel htmlFor="key-rate">Rate limit</FieldLabel>
              <Input
                id="key-rate"
                type="number"
                min={1}
                value={rateLimit}
                onChange={(e) => setRateLimit(e.target.value)}
                className="w-32"
              />
              <FieldDescription>Requests per minute.</FieldDescription>
            </Field>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!valid || create.isPending}>
              Create key
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RotateDialog({
  target,
  onClose,
  onIssued,
}: {
  target: ApiKeyRecord | null;
  onClose: () => void;
  onIssued: (k: IssuedKey) => void;
}) {
  const rotate = useRotateApiKey();
  const [grace, setGrace] = useState('0');

  const confirm = async () => {
    if (!target) return;
    try {
      const issued = await rotate.mutateAsync({ id: target.id, graceSeconds: Number(grace) });
      onClose();
      onIssued(issued);
    } catch (err) {
      toast.error(`Could not rotate: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <Dialog open={target !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rotate {target?.name}</DialogTitle>
          <DialogDescription>
            A new secret is issued with the same scopes and rate limit. Keep the old one working for
            a while if deployments still use it.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="rotate-grace">Old key stops working</FieldLabel>
          <Select value={grace} onValueChange={setGrace}>
            <SelectTrigger id="rotate-grace" className="w-48">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GRACE_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => void confirm()} disabled={rotate.isPending}>
            <RefreshCw />
            Rotate key
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Sections
// ---------------------------------------------------------------------------

function ApiKeysCard() {
  const keys = useApiKeys();
  const revoke = useRevokeApiKey();
  const [creating, setCreating] = useState(false);
  const [rotating, setRotating] = useState<ApiKeyRecord | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyRecord | null>(null);
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const rows = keys.data?.data ?? [];

  const confirmRevoke = async () => {
    const target = revoking;
    setRevoking(null);
    if (!target) return;
    try {
      await revoke.mutateAsync(target.id);
      toast.success(`Revoked ${target.name}`);
    } catch (err) {
      toast.error(`Could not revoke: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>API keys</CardTitle>
        <CardDescription>For the REST API and @sluby/sdk. Secrets are shown once.</CardDescription>
        <CardAction>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            Create key
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="px-0">
        {keys.isLoading ? (
          <Skeleton className="mx-4 h-24" />
        ) : keys.isError ? (
          <Alert variant="destructive" className="mx-4 w-auto">
            <AlertTriangle />
            <AlertTitle>Could not load keys</AlertTitle>
            <AlertDescription>{keys.error.message}</AlertDescription>
          </Alert>
        ) : rows.length === 0 ? (
          <Empty className="border-0">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <KeyRound />
              </EmptyMedia>
              <EmptyTitle>No API keys</EmptyTitle>
              <EmptyDescription>Create one to call the API from your own apps.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead className="hidden sm:table-cell">Rate limit</TableHead>
                <TableHead className="hidden md:table-cell">Created</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((k) => (
                <TableRow key={k.id}>
                  <TableCell className="pl-4 font-medium">{k.name}</TableCell>
                  <TableCell>
                    <div className="flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <Badge key={s} variant="secondary" className="font-mono">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="hidden tabular-nums sm:table-cell">
                    {k.rate_limit}/min
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    <span title={formatDate(k.created_at)}>{formatRelativeTime(k.created_at)}</span>
                  </TableCell>
                  <TableCell>
                    {k.expires_at ? (
                      <Badge variant="warning" title={new Date(k.expires_at).toLocaleString()}>
                        Expires {timeLeft(k.expires_at)}
                      </Badge>
                    ) : (
                      <Badge variant="success">Active</Badge>
                    )}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <div className="flex justify-end gap-1">
                      {!k.expires_at && (
                        <Button variant="ghost" size="sm" onClick={() => setRotating(k)}>
                          <RefreshCw />
                          Rotate
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        onClick={() => setRevoking(k)}
                      >
                        <Trash2 />
                        Revoke
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <CreateKeyDialog open={creating} onOpenChange={setCreating} onIssued={setIssued} />
      <RotateDialog target={rotating} onClose={() => setRotating(null)} onIssued={setIssued} />
      <SecretDialog issued={issued} onClose={() => setIssued(null)} />
      <AlertDialog open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {revoking?.name}?</AlertDialogTitle>
            <AlertDialogDescription>
              Requests with this key start failing right away. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmRevoke()}>
              Revoke
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function SessionsCard() {
  const session = useSession();
  const sessions = useSessions(!session.authDisabled);
  const revoke = useRevokeSession();
  const revokeAll = useRevokeAllSessions();
  const [confirmAll, setConfirmAll] = useState(false);
  const rows = sessions.data?.data ?? [];

  const end = async (id: string, current: boolean) => {
    try {
      await revoke.mutateAsync(id);
      if (current) {
        // this browser's session is gone; let the auth gate show sign-in
        window.location.href = '/';
        return;
      }
      toast.success('Session ended');
    } catch (err) {
      toast.error(`Could not end the session: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const endAll = async () => {
    setConfirmAll(false);
    try {
      await revokeAll.mutateAsync();
      window.location.href = '/';
    } catch (err) {
      toast.error(`Could not sign out: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>Browsers signed in to the Studio as {session.login}.</CardDescription>
        {!session.authDisabled && rows.length > 0 && (
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => setConfirmAll(true)}>
              <LogOut />
              Sign out everywhere
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="px-0">
        {session.authDisabled ? (
          <p className="px-4 text-sm text-muted-foreground">
            Sign-in is disabled on this server, so there are no sessions to manage.
          </p>
        ) : sessions.isLoading ? (
          <Skeleton className="mx-4 h-16" />
        ) : sessions.isError ? (
          <Alert variant="destructive" className="mx-4 w-auto">
            <AlertTriangle />
            <AlertTitle>Could not load sessions</AlertTitle>
            <AlertDescription>{sessions.error.message}</AlertDescription>
          </Alert>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Browser</TableHead>
                <TableHead className="hidden md:table-cell">Signed in</TableHead>
                <TableHead className="hidden sm:table-cell">Expires</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="max-w-[280px] pl-4">
                    <div className="flex items-center gap-2">
                      <Monitor className="size-4 shrink-0 text-muted-foreground" />
                      <span className="truncate text-xs" title={s.user_agent ?? undefined}>
                        {s.user_agent ?? 'Unknown browser'}
                      </span>
                      {s.current && <Badge variant="secondary">This browser</Badge>}
                    </div>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">
                    <span title={formatDate(s.created_at)}>{formatRelativeTime(s.created_at)}</span>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {timeLeft(s.expires_at)}
                  </TableCell>
                  <TableCell className="pr-4 text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      disabled={revoke.isPending}
                      onClick={() => void end(s.id, s.current)}
                    >
                      <LogOut />
                      {s.current ? 'Sign out' : 'End'}
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
      <AlertDialog open={confirmAll} onOpenChange={setConfirmAll}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out everywhere?</AlertDialogTitle>
            <AlertDialogDescription>
              Every browser signed in as {session.login} is signed out right away, this one
              included. API keys keep working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void endAll()}>
              Sign out everywhere
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function AppearanceCard() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <Card>
      <CardHeader>
        <CardTitle>Appearance</CardTitle>
        <CardDescription>
          {theme === 'system'
            ? `Following your system, now ${resolvedTheme}`
            : 'Saved in this browser'}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ToggleGroup
          type="single"
          variant="outline"
          value={theme}
          onValueChange={(v) => v && setTheme(v as Theme)}
          aria-label="Theme"
        >
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <ToggleGroupItem key={value} value={value} className="gap-2 px-4">
              <Icon />
              {label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </CardContent>
    </Card>
  );
}

function AccountCard() {
  const session = useSession();
  const status = useSystemStatus();
  const rows: Array<[string, React.ReactNode]> = [
    [
      'Signed in as',
      <span key="u" className="font-mono">
        {session.login}
      </span>,
    ],
    [
      'API base URL',
      <span key="b" className="flex items-center justify-end gap-1 font-mono">
        {window.location.origin}
        <CopyButton value={window.location.origin} label="Copy base URL" className="size-6" />
      </span>,
    ],
    ['Backend version', status.data ? `v${status.data.version}` : '...'],
    ['Sia network', status.data?.indexer.network ?? '...'],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-center justify-between gap-4 text-sm">
            <span className="text-muted-foreground">{label}</span>
            <span className="min-w-0 truncate text-right">{value}</span>
          </div>
        ))}
        <div className="mt-2 flex flex-wrap gap-2 border-t pt-3">
          <Button variant="outline" size="sm" asChild>
            <a href="/api/v1/docs" target="_blank" rel="noopener noreferrer">
              API reference
            </a>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <a href="https://github.com/justmert/Sluby" target="_blank" rel="noopener noreferrer">
              Source on GitHub
            </a>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SettingsPage() {
  return (
    <PageContainer>
      <PageHeader title="Settings" description="API keys, sessions, appearance and account" />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4 lg:col-span-2">
          <ApiKeysCard />
          <SessionsCard />
        </div>
        <div className="flex flex-col gap-4">
          <AppearanceCard />
          <AccountCard />
        </div>
      </div>
    </PageContainer>
  );
}
