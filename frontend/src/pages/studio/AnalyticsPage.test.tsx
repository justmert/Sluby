import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import AnalyticsPage from './AnalyticsPage';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const stats = {
  total: 3,
  by_status: { created: 0, uploading: 0, processing: 1, ready: 2, failed: 0 },
  stored_bytes: 1000,
  ready_duration_ms: 1000,
  object_count: 4,
};

const gauge = (name: string, value: number | null) => ({
  name,
  type: 'gauge',
  values: [{ value, labels: {} }],
});

// a fresh backend: no cache lookups yet, redis down (prom-client sends NaN as null)
const metrics = {
  timestamp: '2026-10-07T12:00:00.000Z',
  metrics: [
    gauge('process_start_time_seconds', Date.parse('2026-10-07T11:00:00.000Z') / 1000),
    gauge('sluby_redis_up', 0),
    gauge('sluby_processing_queue_depth', null),
    { name: 'sluby_cache_hits_total', type: 'counter', values: [{ value: 0, labels: {} }] },
    { name: 'sluby_cache_misses_total', type: 'counter', values: [{ value: 0, labels: {} }] },
  ],
};

let routes: Record<string, () => Response>;
let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  routes = {
    '/api/v1/stats': () => json(stats),
    '/api/v1/metrics': () => json(metrics),
  };
  fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const route = routes[String(input)];
    if (!route) throw new Error(`unmocked ${String(input)}`);
    return route();
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const render = (operator: boolean) =>
  renderPage(
    <WithSession operator={operator}>
      <AnalyticsPage />
    </WithSession>,
  );

// a counting number is drawn twice, once aria-hidden; queries read the other
const readable = { ignore: '[aria-hidden="true"], script, style' };

const called = (url: string) => fetchMock.mock.calls.some(([u]) => String(u) === url);

describe('AnalyticsPage', () => {
  it('shows a tenant their library and never asks for server metrics', async () => {
    render(false);
    expect(await screen.findByText('Server metrics are for operators')).toBeInTheDocument();
    expect(screen.getByText('Your library')).toBeInTheDocument();
    await vi.waitFor(() => expect(called('/api/v1/stats')).toBe(true));
    expect(called('/api/v1/metrics')).toBe(false);
  });

  it('reads a fresh backend honestly: n/a hit ratio, unknown queue, server uptime', async () => {
    render(true);
    expect(await screen.findByText('no cache lookups yet')).toBeInTheDocument();
    expect(screen.getByText(/queue depth unknown while Redis is down/)).toBeInTheDocument();
    // started an hour before the server's timestamp, whatever this machine's clock says
    expect(await screen.findByText('1:00:00', readable)).toBeInTheDocument();
    expect(screen.queryByText('0%', readable)).not.toBeInTheDocument();
  });

  it('treats a 403 from the metrics endpoint as not an operator, not as a failure', async () => {
    routes['/api/v1/metrics'] = () => json({ error: 'Operators only' }, 403);
    render(true);
    expect(await screen.findByText('Server metrics are for operators')).toBeInTheDocument();
    expect(screen.queryByText('Could not read metrics')).not.toBeInTheDocument();
  });

  it('says so when the library totals fail instead of a skeleton forever', async () => {
    routes['/api/v1/stats'] = () => json({ error: 'Internal Server Error' }, 500);
    render(false);
    expect(
      await screen.findByText('Could not load your library totals: Internal Server Error'),
    ).toBeInTheDocument();
  });

  it('lists the statuses down the side of the library chart so they never run together', async () => {
    // jsdom has no layout; give the chart a phone-width box so recharts draws its axes
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 358, 192),
    );
    const { container } = render(false);
    const labels = () => [
      ...container.querySelectorAll(
        '.recharts-yAxis-tick-labels .recharts-cartesian-axis-tick-value',
      ),
    ];
    await vi.waitFor(() => expect(labels()).toHaveLength(5));
    // the words the status badges use elsewhere, not the raw enum values
    expect(labels().map((t) => t.textContent)).toEqual([
      'Created',
      'Uploading',
      'Processing',
      'Ready',
      'Failed',
    ]);
    // one row per status, top to bottom, not side by side along the bottom
    const ys = labels().map((t) => Number(t.getAttribute('y')));
    expect(new Set(ys).size).toBe(5);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
  });

  it('holds the final layout while metrics load, charts included', async () => {
    routes['/api/v1/metrics'] = () => new Promise<Response>(() => {}) as never;
    const { container } = render(true);
    expect(await screen.findByText('Gateway throughput')).toBeInTheDocument();
    expect(screen.getByText('Gateway responses')).toBeInTheDocument();
    // the eight stat cards with their labels, each with a number-high skeleton
    for (const label of ['Uploads', 'Processing', 'Sia upload', 'Memory']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(container.querySelectorAll('[data-slot="stat-value"]')).toHaveLength(8);
    // both chart boxes are reserved at the height the charts will have
    const chartSkeletons = container.querySelectorAll('[data-slot="skeleton"].h-56');
    expect(chartSkeletons).toHaveLength(2);
  });

  it('shows empty states instead of bare axes when nothing has happened yet', async () => {
    routes['/api/v1/stats'] = () =>
      json({
        ...stats,
        total: 0,
        by_status: { created: 0, uploading: 0, processing: 0, ready: 0, failed: 0 },
      });
    const { container } = render(true);
    expect(await screen.findByText('No gateway responses yet')).toBeInTheDocument();
    expect(await screen.findByText('No videos yet')).toBeInTheDocument();
    expect(screen.getByText('Collecting samples')).toBeInTheDocument();
    expect(container.querySelector('.recharts-cartesian-axis')).toBeNull();
  });

  it('takes the first samples quickly so the throughput line shows within seconds', async () => {
    const { client } = render(true);
    await screen.findByText('no cache lookups yet');
    const query = client.getQueryCache().find({ queryKey: ['metrics'] })!;
    // the interval is an observer option, set by the page's useQuery
    const interval = query.observers[0].options.refetchInterval as (q: typeof query) => number;
    expect(interval(query)).toBe(2_000);
    const data = query.state.data as { samples: unknown[] };
    query.setData({ ...data, samples: [1, 2, 3] });
    expect(interval(query)).toBe(10_000);
  });

  it('stops polling metrics once the server says they are not for this caller', async () => {
    routes['/api/v1/metrics'] = () => json({ error: 'Operators only' }, 403);
    const { client } = render(true);
    await screen.findByText('Server metrics are for operators');
    const query = client.getQueryCache().find({ queryKey: ['metrics'] })!;
    const interval = query.observers[0].options.refetchInterval as (q: typeof query) => unknown;
    expect(interval(query)).toBe(false);
  });

  it('lets a failed metrics read be retried', async () => {
    routes['/api/v1/metrics'] = () => json({ error: 'Bad Gateway' }, 502);
    render(true);
    expect(await screen.findByText('Could not read metrics')).toBeInTheDocument();
    routes['/api/v1/metrics'] = () => json(metrics);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('no cache lookups yet')).toBeInTheDocument();
    expect(screen.queryByText('Could not read metrics')).not.toBeInTheDocument();
  });

  it('draws stat values at stat size through StatValue', async () => {
    render(true);
    const value = await screen.findByText('1:00:00', readable);
    expect(value.parentElement).toHaveClass('text-figure', 'tabular-nums');
  });
});
