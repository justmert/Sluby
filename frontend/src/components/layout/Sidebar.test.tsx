import { screen, within } from '@testing-library/react';
import { useLocation } from 'react-router';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SidebarProvider } from '@/components/ui/sidebar';
import { jsonFetch, renderPage, reply } from '@/test/render';
import { WithSession } from '@/test/session';
import { AppSidebar } from './Sidebar';

const okStatus = {
  status: 'ok',
  scope: 'account',
  checked_at: '2026-10-09T08:00:00Z',
  version: '0.2.0',
  database: { ok: true, latency_ms: 2 },
  redis: { ok: true, latency_ms: 1 },
  indexer: { ok: true, latency_ms: 40, network: 'mainnet', hosts: null },
};
const stats = (processing = 0, uploading = 0) => ({
  total: 5,
  by_status: { created: 1, uploading, processing, ready: 3, failed: 0 },
  stored_bytes: 0,
  ready_duration_ms: 0,
  object_count: 0,
});

let routes: Record<string, unknown>;
let server: ReturnType<typeof jsonFetch>;
beforeEach(() => {
  routes = {
    '/api/v1/system/status': okStatus,
    '/api/v1/stats': stats(),
    '/api/v1/webhooks': { data: [] },
  };
});
afterEach(() => vi.unstubAllGlobals());

const render = (operator: boolean, route = '/studio') => {
  server = jsonFetch(routes);
  vi.stubGlobal('fetch', server);
  return renderPage(
    <WithSession operator={operator}>
      <SidebarProvider>
        <AppSidebar />
        <Where />
      </SidebarProvider>
    </WithSession>,
    { route },
  );
};

const nav = () => within(screen.getByRole('navigation', { name: 'Studio' }));

function Where() {
  return <output data-testid="where">{useLocation().pathname}</output>;
}

describe('AppSidebar', () => {
  it('lists the pages in their groups, without deployment for a member', () => {
    render(false);
    expect(nav().getByRole('group', { name: 'Developers' })).toBeInTheDocument();
    expect(nav().queryByText('Deployment')).not.toBeInTheDocument();
    expect(
      nav()
        .getAllByRole('link')
        .map((a) => [a.textContent, a.getAttribute('href')]),
    ).toEqual([
      ['Sluby Studio', '/studio'],
      ['Upload video', '/studio/videos/upload'],
      ['Overview', '/studio'],
      ['Videos', '/studio/videos'],
      ['Quickstart', '/studio/developers'],
      ['API keys', '/studio/developers/keys'],
      ['Webhooks', '/studio/developers/webhooks'],
      ['API explorer', '/studio/developers/explorer'],
      ['Settings', '/studio/settings'],
    ]);
  });

  it('goes to the upload page from Upload video, which is then the current page', async () => {
    render(false, '/studio/videos');
    const upload = nav().getByRole('link', { name: 'Upload video' });
    expect(upload).not.toHaveAttribute('aria-current');
    await userEvent.click(upload);
    expect(screen.getByTestId('where')).toHaveTextContent('/studio/videos/upload');
    expect(nav().getByRole('link', { name: 'Upload video' })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('shows health and metrics to an operator, under a group marked Operator (RDS-16)', async () => {
    render(true);
    const group = nav().getByRole('group', { name: 'Deployment, operators only' });
    expect(await within(group).findByRole('link', { name: 'Health, operational' })).toHaveAttribute(
      'href',
      '/studio/deployment',
    );
    expect(within(group).getByRole('link', { name: 'Metrics' })).toHaveAttribute(
      'href',
      '/studio/deployment/metrics',
    );
  });

  it('labels the deployment group as the design does, with operators only for screen readers', () => {
    render(true);
    const group = nav().getByRole('group', { name: 'Deployment, operators only' });
    expect(within(group).queryByText('Operator')).not.toBeInTheDocument();
    expect(within(group).getByText(', operators only')).toHaveClass('sr-only');
  });

  it('puts Settings on its own at the bottom, after the groups', () => {
    render(false);
    const settings = nav().getByRole('link', { name: 'Settings' });
    expect(settings.closest('[data-slot=sidebar-group]')).toBeNull();
    expect(settings.closest('div.mt-auto')).not.toBeNull();
  });

  it('marks only the page itself current, and a detail page under its list', () => {
    render(true, '/studio/developers/keys');
    expect(nav().getByRole('link', { name: 'API keys' })).toHaveAttribute('aria-current', 'page');
    expect(nav().getByRole('link', { name: 'Quickstart' })).not.toHaveAttribute('aria-current');
  });

  it('keeps the list current on a detail page', () => {
    render(false, '/studio/developers/webhooks/w1');
    expect(nav().getByRole('link', { name: 'Webhooks' })).toHaveAttribute('aria-current', 'page');
  });

  it('marks health current only on its own path', () => {
    render(true, '/studio/deployment/metrics');
    expect(nav().getByRole('link', { name: 'Metrics' })).toHaveAttribute('aria-current', 'page');
    expect(nav().getByRole('link', { name: /^Health/ })).not.toHaveAttribute('aria-current');
  });

  it('tells U as the shortcut of Upload video', () => {
    render(false);
    expect(nav().getByRole('link', { name: 'Upload video' })).toHaveAttribute(
      'aria-keyshortcuts',
      'U',
    );
  });
});

describe('AppSidebar signals (D-14)', () => {
  it.each([
    ['degraded', 'Health, degraded', 'warning'],
    ['down', 'Health, down', 'danger'],
  ])('puts a %s health dot on Health, in its name too', async (status, name, tone) => {
    routes['/api/v1/system/status'] = { ...okStatus, status };
    render(true);
    const link = await nav().findByRole('link', { name });
    expect(link.querySelector('[data-tone]')).toHaveAttribute('data-tone', tone);
    // the text shades clear 3:1 on the sidebar; the warning fill was 1.75:1 in light
    expect(link.querySelector('[data-tone]')).toHaveClass(
      tone === 'warning' ? 'bg-warning-foreground' : 'bg-destructive',
    );
  });

  it('shows a neutral dot while health is not known yet', () => {
    routes['/api/v1/system/status'] = () => new Promise(() => {});
    render(true);
    const link = nav().getByRole('link', { name: 'Health, not checked yet' });
    expect(link.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'neutral');
    expect(link.querySelector('[data-tone]')).toHaveClass('bg-muted-foreground');
  });

  it('says it could not check when the status call fails', async () => {
    routes['/api/v1/system/status'] = reply(500, { error: 'Internal Server Error' });
    render(true);
    expect(await nav().findByRole('link', { name: 'Health, could not check' })).toBeInTheDocument();
  });

  it('counts the videos being processed on Videos', async () => {
    routes['/api/v1/stats'] = stats(2);
    render(false);
    const link = await nav().findByRole('link', { name: 'Videos, 2 processing' });
    expect(within(link).getByText('2')).toBeInTheDocument();
  });

  it('leaves out an upload no tab of this browser is sending, which may have stopped for good (FLW-12)', async () => {
    routes['/api/v1/stats'] = stats(2, 1);
    render(false);
    expect(await nav().findByRole('link', { name: 'Videos, 2 processing' })).toBeInTheDocument();
  });

  it('shows no count when nothing is moving', async () => {
    render(false);
    await vi.waitFor(() =>
      expect(server.calls.map((c) => c.path)).toEqual(
        expect.arrayContaining(['/api/v1/stats', '/api/v1/webhooks']),
      ),
    );
    expect(nav().getByRole('link', { name: 'Videos' })).toBeInTheDocument();
  });

  it('marks Webhooks when an active endpoint failed its last delivery (B-07)', async () => {
    routes['/api/v1/webhooks'] = {
      data: [
        {
          id: 'w1',
          url: 'https://a.example/h',
          events: [],
          is_active: true,
          created_at: '',
          last_delivery_ok: false,
        },
      ],
    };
    render(false);
    const link = await nav().findByRole('link', { name: 'Webhooks, a delivery failed' });
    expect(link.querySelector('[data-tone]')).toHaveAttribute('data-tone', 'danger');
  });

  it('ignores a paused endpoint and a server without delivery health', async () => {
    routes['/api/v1/webhooks'] = {
      data: [
        {
          id: 'w1',
          url: 'https://a.example/h',
          events: [],
          is_active: false,
          created_at: '',
          last_delivery_ok: false,
        },
        { id: 'w2', url: 'https://b.example/h', events: [], is_active: true, created_at: '' },
      ],
    };
    render(false);
    await vi.waitFor(() =>
      expect(server.calls.map((c) => c.path)).toEqual(
        expect.arrayContaining(['/api/v1/stats', '/api/v1/webhooks']),
      ),
    );
    expect(nav().getByRole('link', { name: 'Webhooks' })).toBeInTheDocument();
  });
});
