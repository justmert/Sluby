import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import ExplorerPage from './ExplorerPage';
import KeysPage from './KeysPage';
import QuickstartPage from './QuickstartPage';
import WebhookDetailPage from './WebhookDetailPage';
import WebhooksPage from './WebhooksPage';

const hook = {
  id: 'w1',
  url: 'https://example.com/sluby-hook',
  events: ['asset.ready', 'asset.errored'],
  is_active: false,
  created_at: '2026-10-01T00:00:00Z',
};

let routes: Record<string, unknown>;

beforeEach(() => {
  routes = {
    '/api/v1/keys': {
      data: [
        {
          id: 'k1',
          name: 'production',
          scopes: ['upload', 'read'],
          rate_limit: 100,
          is_active: true,
          created_at: '2026-10-01T00:00:00Z',
          expires_at: null,
        },
      ],
      has_more: false,
      next_cursor: null,
    },
    '/api/v1/webhooks': { data: [hook] },
    '/api/v1/webhooks/w1/deliveries': {
      data: [
        {
          id: 'd1',
          event_id: 'evt_1',
          event: 'asset.ready',
          status_code: 204,
          delivered: true,
          error: null,
          attempt: 1,
          created_at: new Date().toISOString(),
        },
      ],
    },
  };
  vi.stubGlobal('fetch', vi.fn(jsonFetch(new Proxy({}, { get: (_, k) => routes[k as string] }))));
});
afterEach(() => vi.unstubAllGlobals());

// hidden: true, since an open dialog hides the page from the accessibility tree
const heading = (name: string) => screen.getByRole('heading', { level: 1, name, hidden: true });

describe('developers pages', () => {
  it('quickstart shows the snippets under its own title', () => {
    renderPage(<QuickstartPage />);
    expect(heading('Quickstart')).toBeInTheDocument();
    expect(screen.getByText('Connect your app to this server')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'JavaScript' })).toBeInTheDocument();
  });

  it('API keys lists the keys and opens the create dialog from ?create=key', async () => {
    renderPage(
      <WithSession>
        <KeysPage />
      </WithSession>,
      { route: '/studio/developers/keys?create=key' },
    );
    expect(heading('API keys')).toBeInTheDocument();
    expect(await screen.findByRole('dialog', { name: /create/i })).toBeInTheDocument();
    expect(await screen.findByText('production')).toBeInTheDocument();
  });

  it('webhooks lists the endpoints and opens the add dialog from ?create=webhook', async () => {
    renderPage(<WebhooksPage />, { route: '/studio/developers/webhooks?create=webhook' });
    expect(heading('Webhooks')).toBeInTheDocument();
    expect(await screen.findByRole('dialog', { name: /add/i })).toBeInTheDocument();
    expect(await screen.findByText('https://example.com/sluby-hook')).toBeInTheDocument();
  });

  it('the explorer has its own page', () => {
    renderPage(<ExplorerPage />);
    expect(heading('API explorer')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /send/i })).toBeInTheDocument();
  });
});

describe('WebhookDetailPage', () => {
  const renderAt = (id: string) =>
    renderPage(
      <Routes>
        <Route path="/studio/developers/webhooks/:id" element={<WebhookDetailPage />} />
      </Routes>,
      { route: `/studio/developers/webhooks/${id}` },
    );

  it('names the webhook by host and path and lists its deliveries', async () => {
    renderAt('w1');
    expect(
      await screen.findByRole('heading', { level: 1, name: 'example.com/sluby-hook' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Paused')).toBeInTheDocument();
    expect(screen.getByText('asset.errored')).toBeInTheDocument();
    expect(await screen.findByRole('list', { name: 'Recent deliveries' })).toBeInTheDocument();
  });

  it('says when the webhook does not exist', async () => {
    renderAt('gone');
    expect(await screen.findByRole('heading', { name: 'Webhook not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to webhooks' })).toHaveAttribute(
      'href',
      '/studio/developers/webhooks',
    );
  });

  it('offers Try again when the list fails', async () => {
    routes['/api/v1/webhooks'] = () => new Response('{"error":"boom"}', { status: 500 });
    renderAt('w1');
    expect(
      await screen.findByRole('heading', { name: 'Could not load this webhook' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
