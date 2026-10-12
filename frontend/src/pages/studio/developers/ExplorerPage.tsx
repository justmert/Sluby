import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ExternalLink, Send, TriangleAlert } from 'lucide-react';
import { PageContainer, PageHeader } from '@/components/layout/PageContainer';
import { InlineError } from '@/components/shared/InlineError';
import { JsonViewer } from '@/components/shared/JsonViewer';
import { HttpStatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Spinner } from '@/components/ui/spinner';
import { Textarea } from '@/components/ui/textarea';
import { RequestTimeoutError } from '@/lib/api-client';
import {
  EXPLORER_TIMEOUT_MS,
  METHODS,
  REQUEST_TEMPLATES,
  needsConfirm,
  pathProblem,
  type Method,
} from '@/lib/explorer-templates';
import { reportUnauthorized } from '@/lib/session-events';
import { cn } from '@/lib/utils';
import { PAGE_HEADS } from '@/components/layout/page-heads';

const SHOWN_HEADERS = [
  'content-type',
  'x-ratelimit-limit',
  'x-ratelimit-remaining',
  'x-ratelimit-reset',
  'cache-control',
];

// what a successful write may have changed elsewhere in the studio
const CHANGED_BY_WRITES = [['webhooks'], ['assets'], ['api-keys'], ['stats']];

function isJson(text: string): boolean {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
}

interface Answer {
  /** the request this answers, so a later edit never relabels it */
  method: Method;
  path: string;
  status: number;
  statusText: string;
  ms: number;
  headers: Array<[string, string]>;
  body: string;
}

type Failure = { method: Method; path: string; error: unknown; timedOut: boolean };

const groups = [...new Set(REQUEST_TEMPLATES.map((t) => t.group))];
const hasBody = (m: Method) => m === 'POST' || m === 'PATCH';

export default function ExplorerPage() {
  const qc = useQueryClient();
  const [method, setMethod] = useState<Method>('GET');
  const [path, setPath] = useState('/api/v1/assets?limit=20');
  const [body, setBody] = useState('');
  const [template, setTemplate] = useState<string | undefined>(undefined);
  // the template select starts over after a manual edit, so its label never
  // names a request that is no longer what will be sent
  const [templateKey, setTemplateKey] = useState(0);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [answer, setAnswer] = useState<Answer | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const inflight = useRef<AbortController | null>(null);
  const seq = useRef(0);
  const confirmRef = useRef<HTMLButtonElement>(null);

  useEffect(() => () => inflight.current?.abort(), []);
  useEffect(() => {
    if (confirming) confirmRef.current?.focus();
  }, [confirming]);

  const problem = pathProblem(path);
  // caught here, before the confirm for a write, instead of as the server's parse error
  const bodyProblem =
    hasBody(method) && body.trim() && !isJson(body) ? 'This is not valid JSON.' : null;

  // a new request replaces the one in flight: abort it and ignore its answer
  const cancelInflight = () => {
    seq.current++;
    inflight.current?.abort();
    inflight.current = null;
    setSending(false);
  };

  const edited = () => {
    cancelInflight();
    setConfirming(false);
    if (template !== undefined) {
      setTemplate(undefined);
      setTemplateKey((k) => k + 1);
    }
  };

  const load = (label: string) => {
    const t = REQUEST_TEMPLATES.find((x) => x.label === label);
    if (!t) return;
    cancelInflight();
    setConfirming(false);
    setTemplate(label);
    setMethod(t.method);
    setPath(t.path);
    setBody(t.body ?? '');
  };

  const send = async () => {
    cancelInflight();
    setConfirming(false);
    const id = seq.current;
    const controller = new AbortController();
    inflight.current = controller;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, EXPLORER_TIMEOUT_MS);
    const request = { method, path };
    setSending(true);
    setFailure(null);
    const started = performance.now();
    try {
      const payload = hasBody(method) && body.trim() ? body : undefined;
      // exactly the path shown, on this origin: the session cookie
      // authenticates, as it does for the rest of the studio
      const res = await fetch(path, {
        method,
        body: payload,
        headers: payload ? { 'Content-Type': 'application/json' } : undefined,
        signal: controller.signal,
      });
      const text = await res.text();
      if (id !== seq.current) return;
      if (res.status === 401) reportUnauthorized();
      if (method !== 'GET' && res.status < 300) {
        for (const queryKey of CHANGED_BY_WRITES) void qc.invalidateQueries({ queryKey });
      }
      setAnswer({
        ...request,
        status: res.status,
        statusText: res.statusText,
        ms: Math.round(performance.now() - started),
        headers: SHOWN_HEADERS.flatMap((h) => {
          const v = res.headers.get(h);
          return v ? [[h, v] as [string, string]] : [];
        }),
        body: text,
      });
    } catch (err) {
      if (id !== seq.current) return;
      // the last answer belongs to another request; under this failure it would read as its answer
      setAnswer(null);
      setFailure({
        ...request,
        timedOut,
        error: timedOut ? new RequestTimeoutError(EXPLORER_TIMEOUT_MS) : err,
      });
    } finally {
      clearTimeout(timer);
      if (id === seq.current) {
        inflight.current = null;
        setSending(false);
      }
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (problem || sending) return;
    if (needsConfirm(method, path) && !confirming) {
      setConfirming(true);
      return;
    }
    void send();
  };

  return (
    <PageContainer>
      <PageHeader {...PAGE_HEADS.explorer} />
      <div className="grid items-start gap-4 @4xl/page:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Request</CardTitle>
            <CardDescription>
              Sent with your session, so it can change real data. See the{' '}
              <a
                href="/api/v1/docs"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-sm underline underline-offset-4 focus-visible:ring-3 focus-visible:ring-ring focus-visible:outline-none"
              >
                API reference
                <ExternalLink aria-hidden="true" className="size-3" />
                <span className="sr-only">(opens in a new tab)</span>
              </a>{' '}
              for every endpoint.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
              <div className="grid gap-2">
                <Label htmlFor="explorer-template">Template</Label>
                <Select key={templateKey} value={template} onValueChange={load}>
                  <SelectTrigger id="explorer-template" className="w-full min-w-0">
                    <SelectValue placeholder="Start from a template" />
                  </SelectTrigger>
                  <SelectContent>
                    {groups.map((g) => (
                      <SelectGroup key={g}>
                        <SelectLabel>{g}</SelectLabel>
                        {REQUEST_TEMPLATES.filter((t) => t.group === g).map((t) => (
                          <SelectItem key={t.label} value={t.label}>
                            <span className="w-14 font-mono text-xs text-muted-foreground">
                              {t.method}
                            </span>
                            {t.label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-1 items-end gap-2 @[16rem]/page:grid-cols-[7rem_minmax(0,1fr)] @lg/page:grid-cols-[7rem_minmax(0,1fr)_auto]">
                <div className="grid gap-2">
                  <Label htmlFor="explorer-method">Method</Label>
                  <Select
                    value={method}
                    onValueChange={(v) => {
                      edited();
                      setMethod(v as Method);
                    }}
                  >
                    <SelectTrigger id="explorer-method" className="w-full font-mono text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {METHODS.map((m) => (
                        <SelectItem key={m} value={m} className="font-mono text-xs">
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="grid min-w-0 gap-2">
                  <Label htmlFor="explorer-path">Path</Label>
                  <Input
                    id="explorer-path"
                    value={path}
                    onChange={(e) => {
                      edited();
                      setPath(e.target.value);
                    }}
                    spellCheck={false}
                    autoComplete="off"
                    className="font-mono text-xs"
                    aria-invalid={problem && !path.includes('{id}') ? true : undefined}
                    aria-describedby={problem ? 'explorer-path-help' : undefined}
                  />
                </div>
                <Button
                  type="submit"
                  disabled={!!problem || !!bodyProblem || sending}
                  aria-busy={sending || undefined}
                  className="@[16rem]/page:col-span-2 @lg/page:col-span-1 @lg/page:min-w-24"
                >
                  {sending ? <Spinner data-icon="inline-start" aria-hidden="true" /> : <Send />}
                  {sending ? 'Sending…' : 'Send'}
                </Button>
              </div>
              {problem && (
                <p id="explorer-path-help" className="-mt-2 text-xs text-muted-foreground">
                  {problem}
                </p>
              )}
              {hasBody(method) && (
                <div className="grid gap-2">
                  <Label htmlFor="explorer-body">JSON body</Label>
                  <Textarea
                    id="explorer-body"
                    value={body}
                    onChange={(e) => {
                      edited();
                      setBody(e.target.value);
                    }}
                    rows={6}
                    spellCheck={false}
                    className="font-mono text-xs"
                    placeholder="{}"
                    aria-invalid={bodyProblem ? true : undefined}
                    aria-describedby={bodyProblem ? 'explorer-body-help' : undefined}
                  />
                  {bodyProblem && (
                    <p id="explorer-body-help" className="text-xs text-destructive">
                      {bodyProblem}
                    </p>
                  )}
                </div>
              )}
              {confirming && (
                <div
                  role="alert"
                  className="flex flex-col gap-3 rounded-lg border border-warning/60 bg-card p-3 text-sm"
                >
                  <p className="flex gap-2">
                    <TriangleAlert
                      aria-hidden="true"
                      className="mt-0.5 size-4 shrink-0 text-warning-foreground"
                    />
                    <span className="min-w-0 wrap-anywhere">
                      This changes real data on this server. Send{' '}
                      <span className="font-mono text-xs">
                        {method} {path}
                      </span>
                      ?
                    </span>
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setConfirming(false)}
                    >
                      Cancel
                    </Button>
                    <Button ref={confirmRef} type="submit" size="sm">
                      Send
                    </Button>
                  </div>
                </div>
              )}
            </form>
          </CardContent>
        </Card>

        <Card aria-busy={sending || undefined}>
          <CardHeader>
            <CardTitle>Response</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {/* focus stays on Send, so the answer is said here; a failure is an alert */}
            <p className="sr-only" role="status">
              {answer && !sending
                ? `Answer: ${answer.status}${answer.statusText ? ` ${answer.statusText}` : ''} in ${answer.ms} ms`
                : ''}
            </p>
            {failure && (
              <InlineError
                error={failure.error}
                title={
                  failure.timedOut
                    ? `No answer to ${failure.method} ${failure.path} after 30 seconds`
                    : `Could not send ${failure.method} ${failure.path}`
                }
              />
            )}
            {answer ? (
              <div
                data-testid="explorer-response"
                className={cn(
                  'flex min-w-0 flex-col gap-3 transition-opacity duration-150',
                  sending && 'opacity-60',
                )}
              >
                <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="min-w-0 font-mono text-xs wrap-anywhere">
                    {answer.method} {answer.path}
                  </span>
                  <span aria-hidden="true" className="text-muted-foreground">
                    ·
                  </span>
                  <span className="inline-flex items-center gap-1.5">
                    <HttpStatusBadge code={answer.status} />
                    {answer.statusText}
                  </span>
                  <span aria-hidden="true" className="text-muted-foreground">
                    ·
                  </span>
                  <span className="text-muted-foreground tabular-nums">{answer.ms} ms</span>
                </p>
                {answer.headers.length > 0 && (
                  <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-0.5 font-mono text-xs text-muted-foreground">
                    {answer.headers.map(([h, v]) => (
                      <div key={h} className="contents">
                        <dt>{h}</dt>
                        <dd className="wrap-anywhere">{v}</dd>
                      </div>
                    ))}
                  </dl>
                )}
                {answer.body ? (
                  <JsonViewer
                    text={answer.body}
                    label="Response body"
                    bodyClassName="max-h-[32rem]"
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">The response has no body.</p>
                )}
              </div>
            ) : (
              !failure && (
                <p className="py-8 text-center text-sm text-muted-foreground">
                  {sending ? 'Waiting for the answer…' : 'Send a request to see the answer here.'}
                </p>
              )
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
