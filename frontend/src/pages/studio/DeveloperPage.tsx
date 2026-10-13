import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ExternalLink, Plus, Send, Trash2, Webhook } from 'lucide-react';
import { toast } from 'sonner';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
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
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import {
  useCreateWebhook,
  useDeleteWebhook,
  useWebhooks,
  type CreatedWebhook,
} from '@/hooks/useWebhooks';
import { apiRawFetch } from '@/lib/api-client';
import { REQUEST_TEMPLATES, type RequestTemplate } from '@/lib/explorer-templates';
import { formatRelativeTime } from '@/lib/formatters';
import { buildSnippets } from '@/lib/snippets';
import { cn } from '@/lib/utils';

const WEBHOOK_EVENTS = [
  { value: 'upload.started', detail: 'tus upload created' },
  { value: 'upload.completed', detail: 'all bytes received' },
  { value: 'upload.failed', detail: 'the upload could not be handed to processing' },
  { value: 'processing.started', detail: 'transcoding began' },
  { value: 'asset.ready', detail: 'stored on Sia and playable' },
  { value: 'asset.errored', detail: 'processing failed for good' },
];

// ---------------------------------------------------------------------------
// Snippets
// ---------------------------------------------------------------------------

function Snippets() {
  const snippets = useMemo(() => buildSnippets(window.location.origin), []);
  const [active, setActive] = useState(snippets[0].id);
  const snippet = snippets.find((s) => s.id === active) ?? snippets[0];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Integrate</CardTitle>
        <CardDescription>
          Ready to copy, pointed at this server ({window.location.origin}). Create a key in{' '}
          <Link to="/studio/settings" className="underline underline-offset-4">
            Settings
          </Link>{' '}
          and export it as <code className="font-mono">SLUBY_API_KEY</code>.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-[220px_1fr]">
        <nav aria-label="Snippets" className="flex gap-1 overflow-x-auto lg:flex-col">
          {snippets.map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setActive(s.id)}
              aria-current={s.id === active ? 'true' : undefined}
              className={cn(
                'shrink-0 rounded-md px-3 py-2 text-left text-sm transition-colors hover:bg-muted',
                s.id === active ? 'bg-muted font-medium' : 'text-muted-foreground',
              )}
            >
              {s.title}
            </button>
          ))}
        </nav>
        <div className="min-w-0">
          <p className="mb-3 text-sm text-muted-foreground">{snippet.description}</p>
          <Tabs defaultValue="js" key={snippet.id}>
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
        </div>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Webhooks
// ---------------------------------------------------------------------------

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
  const [events, setEvents] = useState<string[]>(['asset.ready', 'asset.errored']);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const created = await create.mutateAsync({ url: url.trim(), events });
      onOpenChange(false);
      setUrl('');
      onCreated(created);
    } catch (err) {
      toast.error(`Could not add webhook: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form onSubmit={submit} className="flex flex-col gap-4">
          <DialogHeader>
            <DialogTitle>Add webhook</DialogTitle>
            <DialogDescription>Events for your account's assets are POSTed here.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field>
              <FieldLabel htmlFor="hook-url">Endpoint URL</FieldLabel>
              <Input
                id="hook-url"
                type="url"
                required
                placeholder="https://example.com/sluby-hook"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
              />
            </Field>
            <FieldSet>
              <FieldLegend variant="label">Events</FieldLegend>
              {WEBHOOK_EVENTS.map((ev) => (
                <Field key={ev.value} orientation="horizontal">
                  <Checkbox
                    id={`ev-${ev.value}`}
                    checked={events.includes(ev.value)}
                    onCheckedChange={(on) =>
                      setEvents((prev) =>
                        on === true ? [...prev, ev.value] : prev.filter((x) => x !== ev.value),
                      )
                    }
                  />
                  <Label htmlFor={`ev-${ev.value}`} className="font-normal">
                    <span className="font-mono">{ev.value}</span>
                    <span className="text-muted-foreground">{ev.detail}</span>
                  </Label>
                </Field>
              ))}
            </FieldSet>
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!url.trim() || events.length === 0 || create.isPending}>
              Add webhook
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Webhooks() {
  const hooks = useWebhooks();
  const remove = useDeleteWebhook();
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<CreatedWebhook | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const rows = hooks.data?.data ?? [];

  const confirmDelete = async () => {
    const id = deleting;
    setDeleting(null);
    if (!id) return;
    try {
      await remove.mutateAsync(id);
      toast.success('Webhook removed');
    } catch (err) {
      toast.error(`Could not remove: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Webhooks</CardTitle>
        <CardDescription>
          Signed with HMAC-SHA256 in <code className="font-mono">X-Sluby-Signature</code>. The
          Receive webhooks snippet shows how to verify them.
        </CardDescription>
        <CardAction>
          <Button size="sm" onClick={() => setCreating(true)}>
            <Plus />
            Add webhook
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {hooks.isLoading ? (
          <Skeleton className="h-16" />
        ) : hooks.isError ? (
          <p className="text-sm text-destructive">{hooks.error.message}</p>
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
          rows.map((w) => (
            <div key={w.id} className="flex items-start gap-3 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate font-mono text-sm">{w.url}</p>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {w.events.map((e) => (
                    <Badge key={e} variant="secondary" className="font-mono">
                      {e}
                    </Badge>
                  ))}
                </div>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Added {formatRelativeTime(w.created_at)}
                </p>
              </div>
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove webhook ${w.url}`}
                onClick={() => setDeleting(w.id)}
              >
                <Trash2 />
              </Button>
            </div>
          ))
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
          <div className="flex items-center gap-2 rounded-lg border bg-muted/40 p-3">
            <code
              className="min-w-0 flex-1 font-mono text-xs break-all"
              data-testid="webhook-secret"
            >
              {created?.secret}
            </code>
            {created && <CopyButton value={created.secret} label="Copy signing secret" />}
          </div>
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

// ---------------------------------------------------------------------------
// API explorer
// ---------------------------------------------------------------------------

interface ExplorerResponse {
  status: number;
  statusText: string;
  ms: number;
  headers: Array<[string, string]>;
  body: string;
}

const SHOWN_HEADERS = [
  'content-type',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'cache-control',
];

function ApiExplorer() {
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
      // same origin: the session cookie authenticates, exactly as the studio does
      const res = await apiRawFetch(path, {
        method,
        body: method === 'GET' || method === 'DELETE' || !body.trim() ? undefined : body,
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
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  const unfilled = /\{id\}/.test(path);

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
            disabled={sending || unfilled || !path.startsWith('/')}
          >
            <Send />
            Send
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
          <div className="flex flex-col gap-2">
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
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function DeveloperPage() {
  return (
    <PageContainer>
      <PageHeader
        title="Developer"
        description="Snippets for @sluby/sdk, @sluby/player and curl, plus webhooks and a live API explorer"
      />
      <div className="flex flex-col gap-4">
        <Snippets />
        <div className="grid gap-4 lg:grid-cols-2">
          <Webhooks />
          <ApiExplorer />
        </div>
      </div>
    </PageContainer>
  );
}
