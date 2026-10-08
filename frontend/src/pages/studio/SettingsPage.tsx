import { useState } from 'react';
import { useSearchParams } from 'react-router';
import * as m from 'motion/react-m';
import { AlertTriangle, KeyRound, LogOut, Monitor, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { AnimatedItem, AnimatedList } from '@/components/motion';
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
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ResponsiveCell, ResponsiveTable } from '@/components/ui/responsive-table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { TableHead, TableHeader, TableRow } from '@/components/ui/table';
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
import { useFrozen } from '@/hooks/useFrozen';
import { useSystemStatus } from '@/hooks/useStats';
import { useRevokeAllSessions, useRevokeSession, useSessions } from '@/hooks/useSessions';
import { statusOf } from '@/lib/api-client';
import { formatDate, formatRelativeTime, formatTimeLeft } from '@/lib/formatters';
import { fadeUp } from '@/lib/motion';
import { loadPage } from '@/lib/navigation';
import { useSession } from '@/lib/session';
import { THEME_OPTIONS, useTheme, type Theme } from '@/lib/theme';

const SCOPES: { value: KeyScope; label: string; detail: string }[] = [
  { value: 'upload', label: 'upload', detail: 'Upload videos through tus' },
  { value: 'read', label: 'read', detail: 'Read assets, playback urls, storage details' },
  { value: 'manage', label: 'manage', detail: 'Edit and delete assets, keys and webhooks' },
];

const DEFAULT_SCOPES: KeyScope[] = ['upload', 'read'];
const DEFAULT_RATE = '100';

const GRACE_OPTIONS = [
  { value: '0', label: 'Immediately' },
  { value: '3600', label: 'After 1 hour' },
  { value: '86400', label: 'After 24 hours' },
  { value: '604800', label: 'After 7 days' },
];

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// a spinner inside a button that already says what is happening in words
const ButtonSpinner = () => <Spinner role={undefined} aria-hidden="true" />;

/** Shows a freshly issued secret, which the server never returns again. */
function SecretDialog({ issued, onClose }: { issued: IssuedKey | null; onClose: () => void }) {
  const open = issued !== null;
  // the page clears `issued` on close; keep showing it while the dialog fades
  const shown = useFrozen(issued, open);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {shown?.rotated_from ? 'Key rotated' : 'Key created'}: {shown?.name}
          </DialogTitle>
          <DialogDescription>
            Copy the secret now. It is stored only as a hash and cannot be shown again.
          </DialogDescription>
        </DialogHeader>
        <m.div
          variants={fadeUp}
          initial="hidden"
          animate="visible"
          className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center"
        >
          <code className="min-w-0 flex-1 font-mono text-xs break-all" data-testid="issued-key">
            {shown?.key}
          </code>
          {shown && (
            <CopyButton
              value={shown.key}
              label="Copy API key"
              withText
              variant="outline"
              className="min-w-24 self-start sm:self-auto"
            />
          )}
        </m.div>
        {shown?.previous_key_expires_at && (
          <p className="text-sm text-muted-foreground">
            The previous key stops working{' '}
            {/* both times are the server's, set in the same transaction */}
            {Date.parse(shown.previous_key_expires_at) - Date.parse(shown.created_at) < 5_000
              ? 'now'
              : `on ${new Date(shown.previous_key_expires_at).toLocaleString()}`}
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

interface KeyForm {
  name: string;
  scopes: KeyScope[];
  rateLimit: string;
}

function keyFormErrors(f: KeyForm) {
  const rate = Number(f.rateLimit);
  return {
    name: f.name.trim() === '' ? 'Give the key a name, so you can tell it apart later.' : null,
    scopes: f.scopes.length === 0 ? 'Pick at least one scope.' : null,
    rateLimit:
      f.rateLimit.trim() === '' || !Number.isInteger(rate) || rate < 1
        ? 'Use a whole number of requests, 1 or more.'
        : null,
  };
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
  const [form, setForm] = useState<KeyForm>({
    name: '',
    scopes: DEFAULT_SCOPES,
    rateLimit: DEFAULT_RATE,
  });
  // errors show once a field was left or a submit was tried, not while typing the first letter
  const [touched, setTouched] = useState<Partial<Record<keyof KeyForm, boolean>>>({});
  const [wasOpen, setWasOpen] = useState(open);

  // every open starts from the defaults, not from the last key's scopes
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm({ name: '', scopes: DEFAULT_SCOPES, rateLimit: DEFAULT_RATE });
      setTouched({});
    }
  }

  const errors = keyFormErrors(form);
  const shownError = (field: keyof KeyForm) => (touched[field] ? errors[field] : null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (errors.name || errors.scopes || errors.rateLimit) {
      setTouched({ name: true, scopes: true, rateLimit: true });
      const first = errors.name ? 'key-name' : errors.scopes ? 'scope-upload' : 'key-rate';
      document.getElementById(first)?.focus();
      return;
    }
    try {
      const issued = await create.mutateAsync({
        name: form.name.trim(),
        scopes: form.scopes,
        rate_limit: Number(form.rateLimit),
      });
      // the secret now lives only in the dialog that shows it once
      create.reset();
      onOpenChange(false);
      onIssued(issued);
    } catch {
      // shown in the dialog, next to what the user can change
    }
  };

  const close = (o: boolean) => {
    if (!o) create.reset();
    onOpenChange(o);
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Create API key</DialogTitle>
            <DialogDescription>
              Keys act for your account with the scopes you pick.
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={!!shownError('name') || undefined}>
              <FieldLabel htmlFor="key-name">Name</FieldLabel>
              <Input
                id="key-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                placeholder="production web app"
                maxLength={100}
                aria-invalid={!!shownError('name') || undefined}
                aria-describedby={shownError('name') ? 'key-name-error' : undefined}
                autoFocus
              />
              <FieldError id="key-name-error">{shownError('name')}</FieldError>
            </Field>
            <FieldSet data-invalid={!!shownError('scopes') || undefined}>
              <FieldLegend variant="label">Scopes</FieldLegend>
              {SCOPES.map((s) => (
                <Field key={s.value} orientation="horizontal">
                  <Checkbox
                    id={`scope-${s.value}`}
                    checked={form.scopes.includes(s.value)}
                    onCheckedChange={(on) => {
                      setTouched((t) => ({ ...t, scopes: true }));
                      setForm((f) => ({
                        ...f,
                        scopes:
                          on === true
                            ? [...f.scopes, s.value]
                            : f.scopes.filter((x) => x !== s.value),
                      }));
                    }}
                  />
                  <Label htmlFor={`scope-${s.value}`} className="font-normal">
                    <span className="font-mono">{s.label}</span>
                    <span className="text-muted-foreground">{s.detail}</span>
                  </Label>
                </Field>
              ))}
              <FieldError>{shownError('scopes')}</FieldError>
            </FieldSet>
            <Field data-invalid={!!shownError('rateLimit') || undefined}>
              <FieldLabel htmlFor="key-rate">Rate limit</FieldLabel>
              <Input
                id="key-rate"
                type="number"
                inputMode="numeric"
                min={1}
                step={1}
                value={form.rateLimit}
                onChange={(e) => setForm((f) => ({ ...f, rateLimit: e.target.value }))}
                onBlur={() => setTouched((t) => ({ ...t, rateLimit: true }))}
                aria-invalid={!!shownError('rateLimit') || undefined}
                aria-describedby="key-rate-help"
                className="w-32"
              />
              <FieldDescription id="key-rate-help">Requests per minute.</FieldDescription>
              <FieldError>{shownError('rateLimit')}</FieldError>
            </Field>
          </FieldGroup>
          {create.isError && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>
                {statusOf(create.error) === 409 ? 'Key limit reached' : 'Could not create the key'}
              </AlertTitle>
              <AlertDescription>{create.error.message}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <ButtonSpinner />}
              {create.isPending ? 'Creating...' : 'Create key'}
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
  const open = target !== null;
  const shown = useFrozen(target, open);
  const [grace, setGrace] = useState('0');
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setGrace('0');
  }

  const confirm = async () => {
    if (!target) return;
    try {
      const issued = await rotate.mutateAsync({ id: target.id, graceSeconds: Number(grace) });
      rotate.reset();
      onClose();
      onIssued(issued);
    } catch (err) {
      rotate.reset();
      const status = statusOf(err);
      // the list was stale: the key is gone or was rotated elsewhere, and the
      // mutation already refreshed it, so there is nothing left to do here
      if (status === 404) {
        onClose();
        toast.error(`${target.name} no longer exists; the list is refreshed`);
      } else if (status === 409) {
        onClose();
        toast.error(`${target.name} was already rotated; rotate its replacement instead`);
      } else {
        toast.error(`Could not rotate ${target.name}: ${errorText(err)}`);
      }
    }
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && !rotate.isPending && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rotate {shown?.name}</DialogTitle>
          <DialogDescription>
            A new secret is issued with the same scopes and rate limit. Keep the old one working for
            a while if deployments still use it.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="rotate-grace">Old key stops working</FieldLabel>
          <Select value={grace} onValueChange={setGrace} disabled={rotate.isPending}>
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
          <Button variant="outline" onClick={onClose} disabled={rotate.isPending}>
            Cancel
          </Button>
          <Button onClick={() => void confirm()} disabled={rotate.isPending}>
            {rotate.isPending ? <ButtonSpinner /> : <RefreshCw />}
            {rotate.isPending ? 'Rotating...' : 'Rotate key'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KeyStatus({ k }: { k: ApiKeyRecord }) {
  if (k.pending) {
    return (
      <Badge variant="secondary">
        <ButtonSpinner />
        Creating
      </Badge>
    );
  }
  if (k.expires_at) {
    return (
      <Badge variant="warning" title={new Date(k.expires_at).toLocaleString()}>
        Expires {formatTimeLeft(k.expires_at)}
      </Badge>
    );
  }
  return <Badge variant="success">Active</Badge>;
}

function ApiKeysCard() {
  const keys = useApiKeys();
  const revoke = useRevokeApiKey();
  const [createOpen, setCreateOpen] = useState(false);
  // ?create=key opens the dialog straight away, e.g. from the command palette
  const [params, setParams] = useSearchParams();
  const creating = createOpen || params.get('create') === 'key';
  const setCreating = (open: boolean) => {
    setCreateOpen(open);
    if (!open && params.has('create')) {
      setParams(
        (p) => {
          p.delete('create');
          return p;
        },
        { replace: true },
      );
    }
  };
  const [rotating, setRotating] = useState<ApiKeyRecord | null>(null);
  const [revoking, setRevoking] = useState<ApiKeyRecord | null>(null);
  const shownRevoke = useFrozen(revoking, revoking !== null);
  const [issued, setIssued] = useState<IssuedKey | null>(null);
  const rows = keys.data?.data ?? [];

  const confirmRevoke = async () => {
    const target = revoking;
    setRevoking(null);
    if (!target) return;
    // the row leaves at once; a failure puts it back and says why
    try {
      await revoke.mutateAsync(target.id);
      toast.success(`Revoked ${target.name}. Requests with it now fail.`);
    } catch (err) {
      toast.error(`Could not revoke ${target.name}: ${errorText(err)}`);
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
          <div className="flex flex-col gap-2 px-4" aria-hidden="true">
            <Skeleton className="h-9" />
            <Skeleton className="h-12" />
            <Skeleton className="h-12" />
          </div>
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
          <ResponsiveTable className="max-sm:[&_tbody>tr]:px-4">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Name</TableHead>
                <TableHead>Scopes</TableHead>
                <TableHead className="hidden 2xl:table-cell">Created</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="pr-4 text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <AnimatedList as="tbody" data-slot="table-body" className="[&_tr:last-child]:border-0">
              {rows.map((k) => (
                <AnimatedItem
                  key={k.id}
                  as="tr"
                  data-slot="table-row"
                  aria-busy={k.pending || undefined}
                  className="border-b transition-colors hover:bg-muted/50"
                >
                  <ResponsiveCell cell="primary" className="pl-4 whitespace-normal">
                    <div className="min-w-0">
                      <div className="font-medium break-words">{k.name}</div>
                      {/* the secret is stored only as a hash, so the id is what tells
                          a rotated pair apart */}
                      <div className="text-xs font-normal text-muted-foreground">
                        {!k.pending && (
                          <>
                            <span className="font-mono" title={k.id}>
                              id {k.id.slice(0, 8)}
                            </span>
                            {', '}
                          </>
                        )}
                        <span className="tabular-nums">{k.rate_limit}/min</span>
                      </div>
                    </div>
                  </ResponsiveCell>
                  <ResponsiveCell label="Scopes">
                    <div className="flex flex-wrap gap-1">
                      {k.scopes.map((s) => (
                        <Badge key={s} variant="secondary" className="font-mono">
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </ResponsiveCell>
                  <ResponsiveCell
                    label="Created"
                    className="hidden text-muted-foreground 2xl:table-cell"
                  >
                    <span title={formatDate(k.created_at)}>{formatRelativeTime(k.created_at)}</span>
                  </ResponsiveCell>
                  <ResponsiveCell label="Status">
                    <KeyStatus k={k} />
                  </ResponsiveCell>
                  <ResponsiveCell cell="actions" className="pr-4 text-right">
                    <div className="flex justify-end gap-1">
                      {!k.expires_at && (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={k.pending}
                          aria-label={`Rotate ${k.name}`}
                          title="Rotate"
                          onClick={() => setRotating(k)}
                        >
                          <RefreshCw />
                          <span className="max-lg:sr-only">Rotate</span>
                        </Button>
                      )}
                      <Button
                        variant="ghost"
                        size="sm"
                        className="text-destructive"
                        disabled={k.pending}
                        aria-label={`Revoke ${k.name}`}
                        title="Revoke"
                        onClick={() => setRevoking(k)}
                      >
                        <Trash2 />
                        <span className="max-lg:sr-only">Revoke</span>
                      </Button>
                    </div>
                  </ResponsiveCell>
                </AnimatedItem>
              ))}
            </AnimatedList>
          </ResponsiveTable>
        )}
      </CardContent>

      <CreateKeyDialog open={creating} onOpenChange={setCreating} onIssued={setIssued} />
      <RotateDialog target={rotating} onClose={() => setRotating(null)} onIssued={setIssued} />
      <SecretDialog issued={issued} onClose={() => setIssued(null)} />
      <AlertDialog open={revoking !== null} onOpenChange={(o) => !o && setRevoking(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke {shownRevoke?.name}?</AlertDialogTitle>
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
        loadPage('/studio');
        return;
      }
      toast.success('Session ended. That browser has to sign in again.');
    } catch (err) {
      toast.error(`Could not end the session: ${errorText(err)}`);
    }
  };

  const endAll = async () => {
    try {
      await revokeAll.mutateAsync();
      setConfirmAll(false);
      loadPage('/studio');
    } catch (err) {
      setConfirmAll(false);
      toast.error(`Could not sign out: ${errorText(err)}`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Sessions</CardTitle>
        <CardDescription>
          {session.authDisabled
            ? 'Sign-in is off on this server, so nobody signs in and there are no sessions.'
            : `Browsers signed in to the Studio as ${session.username}.`}
        </CardDescription>
        {!session.authDisabled && rows.length > 0 && (
          <CardAction>
            <Button variant="outline" size="sm" onClick={() => setConfirmAll(true)}>
              <LogOut />
              <span className="max-sm:sr-only">Sign out everywhere</span>
            </Button>
          </CardAction>
        )}
      </CardHeader>
      {!session.authDisabled && (
        <CardContent className="px-0">
          {sessions.isLoading ? (
            <div className="flex flex-col gap-2 px-4" aria-hidden="true">
              <Skeleton className="h-9" />
              <Skeleton className="h-12" />
            </div>
          ) : sessions.isError ? (
            <Alert variant="destructive" className="mx-4 w-auto">
              <AlertTriangle />
              <AlertTitle>Could not load sessions</AlertTitle>
              <AlertDescription>{sessions.error.message}</AlertDescription>
            </Alert>
          ) : (
            <ResponsiveTable className="max-sm:[&_tbody>tr]:px-4">
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-4">Browser</TableHead>
                  <TableHead className="hidden md:table-cell">Signed in</TableHead>
                  <TableHead className="hidden sm:table-cell">Expires</TableHead>
                  <TableHead className="pr-4 text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <AnimatedList
                as="tbody"
                data-slot="table-body"
                className="[&_tr:last-child]:border-0"
              >
                {rows.map((s) => {
                  const ending = revoke.isPending && revoke.variables === s.id;
                  return (
                    <AnimatedItem
                      key={s.id}
                      as="tr"
                      data-slot="table-row"
                      className="border-b transition-colors hover:bg-muted/50"
                    >
                      <ResponsiveCell
                        cell="primary"
                        className="max-w-[280px] pl-4 max-sm:max-w-none"
                      >
                        <div className="flex min-w-0 flex-wrap items-center gap-2">
                          <Monitor className="size-4 shrink-0 text-muted-foreground" />
                          <span
                            className="min-w-0 truncate text-xs font-normal"
                            title={s.user_agent ?? undefined}
                          >
                            {s.user_agent ?? 'Unknown browser'}
                          </span>
                          {s.current && <Badge variant="secondary">This browser</Badge>}
                        </div>
                      </ResponsiveCell>
                      <ResponsiveCell
                        label="Signed in"
                        className="hidden text-muted-foreground md:table-cell"
                      >
                        <span title={formatDate(s.created_at)}>
                          {formatRelativeTime(s.created_at)}
                        </span>
                      </ResponsiveCell>
                      <ResponsiveCell
                        label="Expires"
                        className="hidden text-muted-foreground sm:table-cell"
                      >
                        {formatTimeLeft(s.expires_at)}
                      </ResponsiveCell>
                      <ResponsiveCell cell="actions" className="pr-4 text-right">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-destructive"
                          disabled={ending}
                          onClick={() => void end(s.id, s.current)}
                        >
                          {ending ? <ButtonSpinner /> : <LogOut />}
                          {s.current ? 'Sign out' : 'End'}
                        </Button>
                      </ResponsiveCell>
                    </AnimatedItem>
                  );
                })}
              </AnimatedList>
            </ResponsiveTable>
          )}
        </CardContent>
      )}
      <AlertDialog
        open={confirmAll}
        onOpenChange={(o) => {
          if (!revokeAll.isPending) setConfirmAll(o);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out everywhere?</AlertDialogTitle>
            <AlertDialogDescription>
              Every browser signed in as {session.username} is signed out right away, this one
              included. API keys keep working.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={revokeAll.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={revokeAll.isPending}
              onClick={(e) => {
                // stay open with a spinner until the server answered
                e.preventDefault();
                void endAll();
              }}
            >
              {revokeAll.isPending && <ButtonSpinner />}
              {revokeAll.isPending ? 'Signing out...' : 'Sign out everywhere'}
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
          className="w-full max-w-sm"
        >
          {THEME_OPTIONS.map(({ value, label, icon: Icon }) => (
            <ToggleGroupItem key={value} value={value} className="min-w-0 flex-1 gap-2 px-3">
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
        {session.username}
      </span>,
    ],
    [
      'API base URL',
      <span key="b" className="flex min-w-0 items-center justify-end gap-1 font-mono">
        <span className="min-w-0 text-xs [overflow-wrap:anywhere]">{window.location.origin}</span>
        <CopyButton value={window.location.origin} label="Copy base URL" className="size-6" />
      </span>,
    ],
    ['Role', session.operator ? 'Operator: sees deployment status and metrics' : 'Account'],
    ['Backend version', status.data ? `v${status.data.version}` : status.isError ? '-' : '...'],
    ['Sia network', status.data?.indexer.network ?? (status.isError ? '-' : '...')],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Account</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2.5">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-4 text-sm">
            <span className="shrink-0 text-muted-foreground">{label}</span>
            <span className="min-w-0 text-right break-words">{value}</span>
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
      {/* three columns only once the key table has room for its columns */}
      <div className="grid gap-4 xl:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-4 xl:col-span-2">
          <ApiKeysCard />
          <SessionsCard />
        </div>
        <div className="grid min-w-0 items-start gap-4 md:grid-cols-2 xl:flex xl:flex-col">
          <AppearanceCard />
          <AccountCard />
        </div>
      </div>
    </PageContainer>
  );
}
