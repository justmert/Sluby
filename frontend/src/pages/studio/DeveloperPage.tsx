import { useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import * as m from 'motion/react-m';
import {
  AlertTriangle,
  ChevronDown,
  ExternalLink,
  Plus,
  Send,
  Trash2,
  Webhook,
} from 'lucide-react';
import { toast } from 'sonner';
import { AnimatedItem, AnimatedList, Collapse, FadeSwap } from '@/components/motion';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { CodeBlock } from '@/components/shared/CodeBlock';
import { CopyButton } from '@/components/shared/CopyButton';
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
  FieldError,
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
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  useCreateWebhook,
  useDeleteWebhook,
  useTestWebhook,
  useWebhookDeliveries,
  useWebhooks,
  type CreatedWebhook,
  type WebhookRecord,
} from '@/hooks/useWebhooks';
import { useFrozen } from '@/hooks/useFrozen';
import { ROUTES } from '@/lib/constants';
import { REQUEST_TEMPLATES, type RequestTemplate } from '@/lib/explorer-templates';
import { formatRelativeTime } from '@/lib/formatters';
import { fadeUp } from '@/lib/motion';
import { buildSnippets } from '@/lib/snippets';
import { cn } from '@/lib/utils';

const errorText = (err: unknown) => (err instanceof Error ? err.message : String(err));

// a spinner inside a button that already says what is happening in words
const ButtonSpinner = () => <Spinner role={undefined} aria-hidden="true" />;

const DEFAULT_EVENTS = ['asset.ready', 'asset.errored'];

const WEBHOOK_EVENTS = [
  { value: 'upload.started', detail: 'tus upload created' },
  { value: 'upload.completed', detail: 'all bytes received' },
  { value: 'upload.failed', detail: 'the upload could not be handed to processing' },
  { value: 'processing.started', detail: 'transcoding began' },
  { value: 'asset.ready', detail: 'stored on Sia and playable' },
  { value: 'asset.errored', detail: 'processing failed for good' },
];

export function Snippets() {
  const snippets = useMemo(() => buildSnippets(window.location.origin), []);
  const [active, setActive] = useState(snippets[0].id);
  const snippet = snippets.find((s) => s.id === active) ?? snippets[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Integrate</CardTitle>
        <CardDescription>
          Ready to copy, pointed at this server ({window.location.origin}). Create a key on the{' '}
          <Link to={ROUTES.API_KEYS} className="underline underline-offset-4">
            API keys
          </Link>{' '}
          page and export it as <code className="font-mono">SLUBY_API_KEY</code> on your server. A
          key never goes into browser code: whoever holds it can act as you.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[220px_1fr]">
        {/* ten tasks do not fit across a phone, so below lg they are a picker */}
        <Select value={active} onValueChange={setActive}>
          <SelectTrigger className="w-full lg:hidden" aria-label="Snippet">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {snippets.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.title}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <nav aria-label="Snippets" className="hidden flex-col gap-1 lg:flex">
          {snippets.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              aria-current={s.id === active ? 'true' : undefined}
              className={cn(
                'relative shrink-0 rounded-md px-3 py-2 text-left text-sm transition-colors duration-150 hover:bg-muted/60',
                s.id === active ? 'font-medium' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {/* the highlight slides to the picked task instead of jumping */}
              {s.id === active && (
                <m.span
                  layoutId="snippet-active"
                  aria-hidden="true"
                  className="absolute inset-0 rounded-md bg-muted"
                  transition={{ type: 'spring', visualDuration: 0.25, bounce: 0.1 }}
                />
              )}
              <span className="relative">{s.title}</span>
            </button>
          ))}
        </nav>
        <FadeSwap swapKey={snippet.id}>
          <p className="mb-3 text-sm text-muted-foreground">{snippet.description}</p>
          <Tabs defaultValue="js">
            <TabsList>
              <TabsTrigger value="js">JavaScript</TabsTrigger>
              <TabsTrigger value="curl">curl</TabsTrigger>
            </TabsList>
            <TabsContent value="js" className="mt-3">
              <CodeBlock code={snippet.js.code} label={`${snippet.title} JavaScript`} />
            </TabsContent>
            <TabsContent value="curl" className="mt-3">
              <CodeBlock code={snippet.curl} label={`${snippet.title} curl`} />
            </TabsContent>
          </Tabs>
        </FadeSwap>
      </CardContent>
    </Card>
  );
}

function urlProblem(raw: string): string | null {
  const url = raw.trim();
  if (url === '') return 'Enter the URL that should receive the events.';
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return 'This is not a full URL. It looks like https://example.com/sluby-hook.';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'The URL must start with https:// or http://.';
  }
  return null;
}

function CreateWebhookDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (w: CreatedWebhook) => void;
}) {
  const create = useCreateWebhook();
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>(DEFAULT_EVENTS);
  const [touched, setTouched] = useState({ url: false, events: false });
  const [wasOpen, setWasOpen] = useState(open);

  // each open starts clean instead of showing the last endpoint's choices
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setUrl('');
      setEvents(DEFAULT_EVENTS);
      setTouched({ url: false, events: false });
    }
  }

  const urlError = touched.url ? urlProblem(url) : null;
  const eventsError = touched.events && events.length === 0 ? 'Pick at least one event.' : null;

  const close = (o: boolean) => {
    if (!o) create.reset();
    onOpenChange(o);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (urlProblem(url) || events.length === 0) {
      setTouched({ url: true, events: true });
      document.getElementById(urlProblem(url) ? 'hook-url' : 'ev-upload.started')?.focus();
      return;
    }
    try {
      const created = await create.mutateAsync({ url: url.trim(), events });
      // the secret now lives only in the dialog that shows it once
      create.reset();
      onOpenChange(false);
      onCreated(created);
    } catch {
      // shown in the dialog, where the url can be fixed
    }
  };

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
          <DialogHeader>
            <DialogTitle>Add webhook</DialogTitle>
            <DialogDescription>Events for your account's assets are POSTed here.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={!!urlError || undefined}>
              <FieldLabel htmlFor="hook-url">Endpoint URL</FieldLabel>
              <Input
                id="hook-url"
                type="url"
                inputMode="url"
                autoComplete="off"
                placeholder="https://example.com/sluby-hook"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onBlur={() => setTouched((t) => ({ ...t, url: url.trim() !== '' || t.url }))}
                aria-invalid={!!urlError || undefined}
                aria-describedby={urlError ? 'hook-url-error' : undefined}
              />
              <FieldError id="hook-url-error">{urlError}</FieldError>
            </Field>
            <FieldSet data-invalid={!!eventsError || undefined}>
              <FieldLegend variant="label">Events</FieldLegend>
              {WEBHOOK_EVENTS.map((ev) => (
                <Field key={ev.value} orientation="horizontal">
                  <Checkbox
                    id={`ev-${ev.value}`}
                    checked={events.includes(ev.value)}
                    onCheckedChange={(on) => {
                      setTouched((t) => ({ ...t, events: true }));
                      setEvents((prev) =>
                        on === true ? [...prev, ev.value] : prev.filter((x) => x !== ev.value),
                      );
                    }}
                  />
                  <Label htmlFor={`ev-${ev.value}`} className="font-normal">
                    <span className="font-mono">{ev.value}</span>
                    <span className="text-muted-foreground">{ev.detail}</span>
                  </Label>
                </Field>
              ))}
              <FieldError>{eventsError}</FieldError>
            </FieldSet>
          </FieldGroup>
          {create.isError && (
            <Alert variant="destructive">
              <AlertTriangle />
              <AlertTitle>Could not add the webhook</AlertTitle>
              <AlertDescription>{create.error.message}</AlertDescription>
            </Alert>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => close(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending && <ButtonSpinner />}
              {create.isPending ? 'Adding...' : 'Add webhook'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A tint that fades out once, so a delivery that just arrived is easy to spot. */
function ArrivalFlash() {
  return (
    <m.span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 rounded-md bg-primary/10"
      initial={{ opacity: 1 }}
      animate={{ opacity: 0 }}
      transition={{ duration: 1.6, delay: 0.4, ease: 'easeOut' }}
    />
  );
}

export function Deliveries({ id, freshAfter }: { id: string; freshAfter: number | null }) {
  const deliveries = useWebhookDeliveries(id, true);
  const rows = deliveries.data?.data ?? [];
  // what was already listed when the log opened; anything after that is new
  const [known, setKnown] = useState<Set<string> | null>(null);
  if (known === null && deliveries.data) setKnown(new Set(rows.map((d) => d.id)));

  if (deliveries.isPending) return <Skeleton className="h-12" />;
  if (deliveries.isError) {
    return (
      <p className="text-xs text-destructive">
        Could not load deliveries: {deliveries.error.message}
      </p>
    );
  }
  if (rows.length === 0) {
    return <p className="text-xs text-muted-foreground">Nothing sent to this endpoint yet.</p>;
  }
  const fresh = (d: (typeof rows)[number]) =>
    (known !== null && !known.has(d.id)) ||
    (freshAfter !== null && Date.parse(d.created_at) >= freshAfter);
  return (
    <AnimatedList
      as="ul"
      className="flex max-h-72 flex-col divide-y overflow-y-auto overscroll-contain pr-1 text-xs"
      aria-label="Recent deliveries"
    >
      {rows.map((d) => (
        <AnimatedItem
          key={d.id}
          className="relative flex flex-wrap items-center gap-x-2 gap-y-1 px-1 py-1.5"
        >
          {fresh(d) && <ArrivalFlash />}
          <Badge variant={d.delivered ? 'success' : 'destructive'}>
            {d.status_code ?? 'no answer'}
          </Badge>
          <span className="font-mono">{d.event}</span>
          {d.attempt > 1 && <span className="text-muted-foreground">attempt {d.attempt}</span>}
          <span className="ml-auto text-muted-foreground">{formatRelativeTime(d.created_at)}</span>
          {d.error && <span className="w-full break-words text-destructive">{d.error}</span>}
        </AnimatedItem>
      ))}
    </AnimatedList>
  );
}

function WebhookRow({ hook: w, onDelete }: { hook: WebhookRecord; onDelete: () => void }) {
  const test = useTestWebhook();
  const [open, setOpen] = useState(false);
  // deliveries stamped after this moment came from the test just sent; a few
  // seconds of slack covers a server clock that runs behind
  const [freshAfter, setFreshAfter] = useState<number | null>(null);

  const sendTest = async () => {
    setFreshAfter(Date.now() - 5_000);
    try {
      const result = await test.mutateAsync(w.id);
      if (result.delivered) {
        toast.success(`Test delivered: the receiver answered ${result.status_code}`);
      } else {
        toast.error(`Test not delivered: ${result.error ?? 'no reason given'}`);
      }
      // the mutation refreshed the log; open it so the new attempt is in view
      setOpen(true);
    } catch (err) {
      toast.error(`Could not send a test: ${errorText(err)}`);
    }
  };

  const panelId = `deliveries-${w.id}`;

  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3" aria-busy={w.pending || undefined}>
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-mono text-sm break-all">{w.url}</p>
          <div className="mt-1.5 flex flex-wrap gap-1">
            {w.pending && (
              <Badge variant="secondary">
                <ButtonSpinner />
                Adding
              </Badge>
            )}
            {!w.is_active && <Badge variant="warning">Inactive</Badge>}
            {w.events.map((e) => (
              <Badge key={e} variant="secondary" className="font-mono">
                {e}
              </Badge>
            ))}
          </div>
          {!w.pending && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Added {formatRelativeTime(w.created_at)}
            </p>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Remove webhook ${w.url}`}
          disabled={w.pending}
          onClick={onDelete}
        >
          <Trash2 />
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void sendTest()}
          disabled={test.isPending || w.pending}
        >
          {test.isPending ? <ButtonSpinner /> : <Send />}
          {test.isPending ? 'Sending...' : 'Send test'}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          aria-expanded={open}
          aria-controls={panelId}
          disabled={w.pending}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronDown
            className={cn('transition-transform duration-200 ease-out-soft', open && 'rotate-180')}
          />
          Deliveries
        </Button>
      </div>
      <Collapse open={open} id={panelId}>
        <Deliveries id={w.id} freshAfter={freshAfter} />
      </Collapse>
    </div>
  );
}

export function Webhooks() {
  const hooks = useWebhooks();
  const remove = useDeleteWebhook();
  const [createOpen, setCreateOpen] = useState(false);
  // ?create=webhook opens the dialog straight away, e.g. from the command palette
  const [params, setParams] = useSearchParams();
  const creating = createOpen || params.get('create') === 'webhook';
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
  const [created, setCreated] = useState<CreatedWebhook | null>(null);
  const shownCreated = useFrozen(created, created !== null);
  const [deleting, setDeleting] = useState<WebhookRecord | null>(null);
  const shownDeleting = useFrozen(deleting, deleting !== null);
  const rows = hooks.data?.data ?? [];

  const confirmDelete = async () => {
    const target = deleting;
    setDeleting(null);
    if (!target) return;
    // the row leaves now; a failure brings it back and says why
    try {
      await remove.mutateAsync(target.id);
      toast.success('Webhook removed. No more events go to it.');
    } catch (err) {
      toast.error(`Could not remove the webhook: ${errorText(err)}`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhooks</CardTitle>
        <CardDescription className="max-sm:col-span-2">
          Signed with HMAC-SHA256 over the timestamp and body in{' '}
          <code className="font-mono">X-Sluby-Signature-V1</code>. The Receive webhooks snippet
          shows how to verify them. Send test posts a signed{' '}
          <code className="font-mono">webhook.test</code> event.
        </CardDescription>
        {/* on a phone the button sits under the text instead of squeezing it */}
        <CardAction className="max-sm:col-start-1 max-sm:row-span-1 max-sm:row-start-3 max-sm:mt-2 max-sm:justify-self-start">
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            Add webhook
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {hooks.isLoading ? (
          <Skeleton className="h-28" />
        ) : hooks.isError ? (
          <Alert variant="destructive">
            <AlertTriangle />
            <AlertTitle>Could not load webhooks</AlertTitle>
            <AlertDescription>{hooks.error.message}</AlertDescription>
          </Alert>
        ) : rows.length === 0 ? (
          <Empty className="border-0 p-4">
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Webhook />
              </EmptyMedia>
              <EmptyTitle>No webhooks</EmptyTitle>
              <EmptyDescription>Get told when an upload is ready or fails.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <AnimatedList as="div" className="flex flex-col gap-2">
            {rows.map((w) => (
              <AnimatedItem key={w.id} as="div">
                <WebhookRow hook={w} onDelete={() => setDeleting(w)} />
              </AnimatedItem>
            ))}
          </AnimatedList>
        )}
      </CardContent>

      <CreateWebhookDialog open={creating} onOpenChange={setCreating} onCreated={setCreated} />

      <Dialog open={created !== null} onOpenChange={(o) => !o && setCreated(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Webhook added</DialogTitle>
            <DialogDescription>
              Copy the signing secret now. It is not shown again.
            </DialogDescription>
          </DialogHeader>
          <m.div
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            className="flex flex-col gap-2 rounded-lg border bg-muted/40 p-3 sm:flex-row sm:items-center"
          >
            <code
              className="min-w-0 flex-1 font-mono text-xs break-all"
              data-testid="webhook-secret"
            >
              {shownCreated?.secret}
            </code>
            {shownCreated && (
              <CopyButton
                value={shownCreated.secret}
                label="Copy signing secret"
                withText
                variant="outline"
                className="min-w-24 self-start sm:self-auto"
              />
            )}
          </m.div>
          <DialogFooter>
            <Button onClick={() => setCreated(null)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove this webhook?</AlertDialogTitle>
            <AlertDialogDescription>
              Events stop being delivered to it right away.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <p className="rounded-md bg-muted/60 px-3 py-2 font-mono text-xs break-all">
            {shownDeleting?.url}
          </p>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={() => void confirmDelete()}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

interface ExplorerResponse {
  status: number;
  statusText: string;
  ms: number;
  headers: Array<[string, string]>;
  body: string;
  /** When it arrived, so each new response fades in. */
  at: number;
}

const SHOWN_HEADERS = [
  'content-type',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'cache-control',
];

export function ApiExplorer() {
  const [method, setMethod] = useState<RequestTemplate['method']>('GET');
  const [path, setPath] = useState('/api/v1/assets?limit=20');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [response, setResponse] = useState<ExplorerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const groups = [...new Set(REQUEST_TEMPLATES.map((t) => t.group))];

  const load = (label: string) => {
    const t = REQUEST_TEMPLATES.find((x) => x.label === label);
    if (!t) return;
    setMethod(t.method);
    setPath(t.path);
    setBody(t.body ?? '');
    setResponse(null);
  };

  const send = async () => {
    setSending(true);
    setError(null);
    const started = performance.now();
    try {
      const payload = method === 'GET' || method === 'DELETE' || !body.trim() ? undefined : body;
      // exactly the path shown, on this origin: the session cookie
      // authenticates, as it does for the rest of the studio
      const res = await fetch(path, {
        method,
        body: payload,
        headers: payload ? { 'Content-Type': 'application/json' } : undefined,
      });
      const text = await res.text();
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // not json, show as is
      }
      setResponse({
        status: res.status,
        statusText: res.statusText,
        ms: Math.round(performance.now() - started),
        headers: SHOWN_HEADERS.flatMap((h) => {
          const v = res.headers.get(h);
          return v ? [[h, v] as [string, string]] : [];
        }),
        body: pretty,
        at: Date.now(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const unfilled = /\{id\}/.test(path);
  // a path on this origin only; "//host/..." would be another site
  const sendable = path.startsWith('/') && !path.startsWith('//');

  return (
    <Card>
      <CardHeader>
        <CardTitle>API explorer</CardTitle>
        <CardDescription>
          Calls this server as you, with your session. The full reference is in the{' '}
          <a
            href="/api/v1/docs"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 underline underline-offset-4"
          >
            API docs <ExternalLink className="size-3" />
          </a>
          .
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <Select onValueChange={load}>
          <SelectTrigger className="w-full sm:w-72" aria-label="Request template">
            <SelectValue placeholder="Start from a template" />
          </SelectTrigger>
          <SelectContent>
            {groups.map((g) => (
              <SelectGroup key={g}>
                <SelectLabel>{g}</SelectLabel>
                {REQUEST_TEMPLATES.filter((t) => t.group === g).map((t) => (
                  <SelectItem key={t.label} value={t.label}>
                    {t.method} {t.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
        <div className="flex gap-2">
          <Select value={method} onValueChange={(v) => setMethod(v as RequestTemplate['method'])}>
            <SelectTrigger className="w-28" aria-label="Method">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {(['GET', 'POST', 'PATCH', 'DELETE'] as const).map((m) => (
                <SelectItem key={m} value={m}>
                  {m}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            aria-label="Path"
            value={path}
            onChange={(e) => setPath(e.target.value)}
            className="font-mono text-xs"
          />
          <Button
            onClick={() => void send()}
            disabled={sending || unfilled || !sendable}
            className="min-w-24"
          >
            {sending ? <ButtonSpinner /> : <Send />}
            {sending ? 'Sending...' : 'Send'}
          </Button>
        </div>
        {unfilled && (
          <p className="text-xs text-muted-foreground">Replace {'{id}'} with a real id first.</p>
        )}
        {(method === 'POST' || method === 'PATCH') && (
          <Textarea
            aria-label="JSON body"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            className="font-mono text-xs"
            placeholder="{}"
          />
        )}
        {error && <p className="text-sm text-destructive">Request failed: {error}</p>}
        {response && (
          <m.div
            key={response.at}
            variants={fadeUp}
            initial="hidden"
            animate="visible"
            data-testid="explorer-response"
            aria-busy={sending || undefined}
            className={cn(
              'flex flex-col gap-2 transition-opacity duration-150',
              sending && 'opacity-60',
            )}
          >
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <Badge
                variant={
                  response.status < 300
                    ? 'success'
                    : response.status < 500
                      ? 'warning'
                      : 'destructive'
                }
              >
                {response.status} {response.statusText}
              </Badge>
              <span className="text-muted-foreground">{response.ms} ms</span>
              {response.headers.map(([h, v]) => (
                <span key={h} className="font-mono text-xs text-muted-foreground">
                  {h}: {v}
                </span>
              ))}
            </div>
            <CodeBlock
              code={response.body || '(empty body)'}
              label="response"
              className="max-h-96 overflow-auto"
            />
          </m.div>
        )}
      </CardContent>
    </Card>
  );
}
