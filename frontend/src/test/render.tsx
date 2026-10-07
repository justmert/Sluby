import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router';
import { ThemeProvider } from '@/components/theme-provider';
import { Toaster } from '@/components/ui/sonner';
import { TooltipProvider } from '@/components/ui/tooltip';
import { unmockedRequests } from './unmocked';

/** Render a page with a fresh query client, an in-memory router and the toaster. */
export function renderPage(ui: ReactElement, { route = '/' }: { route?: string } = {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return {
    client,
    ...render(
      <ThemeProvider>
        <QueryClientProvider client={client}>
          <TooltipProvider>
            <MemoryRouter initialEntries={[route]}>{ui}</MemoryRouter>
            <Toaster />
          </TooltipProvider>
        </QueryClientProvider>
      </ThemeProvider>,
    ),
  };
}

export interface RecordedCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

const REPLY = Symbol('reply');

interface Reply {
  [REPLY]: true;
  status: number;
  body: unknown;
}

/** A non-200 answer for a `jsonFetch` route. */
export function reply(status: number, body?: unknown): Reply {
  return { [REPLY]: true, status, body };
}

type Handler = (call: RecordedCall) => unknown;

function toResponse(value: unknown): Response {
  if (value instanceof Response) return value;
  const r =
    value && typeof value === 'object' && REPLY in value ? (value as Reply) : reply(200, value);
  if (r.status === 204 || r.body === undefined) return new Response(null, { status: r.status });
  return new Response(JSON.stringify(r.body), {
    status: r.status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A fetch stub that answers JSON by `"METHOD /path"` (a bare `"/path"` means
 * GET). A route's value is the 200 body, a `reply(status, body)`, or a
 * function of the call returning either or a whole Response. Every call is recorded in `calls`;
 * a request no route matches fails the test.
 */
export function jsonFetch(routes: Record<string, unknown>) {
  const calls: RecordedCall[] = [];
  const fetchStub = async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(
      input instanceof Request ? input.url : String(input),
      window.location.origin,
    );
    const method = (
      init?.method ?? (input instanceof Request ? input.method : 'GET')
    ).toUpperCase();
    let body: unknown = init?.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch {
        // not json, keep the text
      }
    }
    const call: RecordedCall = { method, path: url.pathname, query: url.searchParams, body };
    calls.push(call);
    const route =
      routes[`${method} ${url.pathname}`] ?? (method === 'GET' ? routes[url.pathname] : undefined);
    if (route === undefined) {
      unmockedRequests.push(`${method} ${url.pathname}${url.search}`);
      return new Response(JSON.stringify({ error: `unmocked ${method} ${url.pathname}` }), {
        status: 501,
        headers: { 'content-type': 'application/json' },
      });
    }
    return toResponse(typeof route === 'function' ? await (route as Handler)(call) : route);
  };
  return Object.assign(fetchStub, { calls });
}
