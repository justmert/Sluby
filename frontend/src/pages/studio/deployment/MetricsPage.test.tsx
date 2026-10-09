import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import MetricsPage from './MetricsPage';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

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

const render = () =>
  renderPage(
    <WithSession operator>
      <MetricsPage />
    </WithSession>,
  );

// a counting number is drawn twice, once aria-hidden; queries read the other
const readable = { ignore: '[aria-hidden="true"], script, style' };

const metricsCalls = () =>
  fetchMock.mock.calls.filter(([u]) => String(u) === '/api/v1/metrics').length;

const counter = (name: string, values: { value: number; labels?: Record<string, string> }[]) => ({
  name,
  type: 'counter',
  values: values.map((v) => ({ labels: {}, ...v })),
});

describe('MetricsPage', () => {
  it('reads a fresh server honestly: no hit ratio, unknown queue, server uptime', async () => {
    render();
    expect(
      await screen.findByText('Queue length unknown (job queue is down)', { exact: false }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('No lookups yet').length).toBeGreaterThan(0);
    // started an hour before the server's timestamp, whatever this machine's clock says
    expect(await screen.findByText('1 h', readable)).toBeInTheDocument();
    expect(screen.queryByText('0%', readable)).not.toBeInTheDocument();
    expect(screen.queryByText('Your library')).not.toBeInTheDocument();
  });

  it('shows long averages in minutes and hours, never raw seconds', async () => {
    routes['/api/v1/metrics'] = () =>
      json({
        ...metrics,
        metrics: [
          ...metrics.metrics,
          {
            name: 'sluby_processing_duration_seconds',
            type: 'histogram',
            values: [
              { value: 7122, labels: {}, metricName: 'sluby_processing_duration_seconds_sum' },
              { value: 2, labels: {}, metricName: 'sluby_processing_duration_seconds_count' },
            ],
          },
        ],
      });
    render();
    expect(await screen.findByText('59 min', readable)).toBeInTheDocument();
    expect(screen.getByText(/^Average of 2 jobs/)).toBeInTheDocument();
  });

  it('says the server error in a sentence with Try again, and recovers', async () => {
    routes['/api/v1/metrics'] = () => json({ error: 'Bad Gateway' }, 502);
    render();
    expect(await screen.findByText('Could not load server metrics')).toBeInTheDocument();
    expect(screen.getByText(/The server ran into a problem \(error 502\)/)).toBeInTheDocument();
    routes['/api/v1/metrics'] = () => json(metrics);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('1 h', readable)).toBeInTheDocument();
    expect(screen.queryByText('Could not load server metrics')).not.toBeInTheDocument();
  });

  it('keeps the last figures with a note when a later read fails', async () => {
    const { client } = render();
    await screen.findByText('1 h', readable);
    routes['/api/v1/metrics'] = () => json({ error: 'Internal Server Error' }, 500);
    await act(() => client.refetchQueries({ queryKey: ['metrics'] }).catch(() => {}));
    expect(await screen.findByText('Metrics are out of date')).toBeInTheDocument();
    expect(screen.getByText(/Showing the last figures that loaded\./)).toBeInTheDocument();
    expect(screen.getByText('1 h', readable)).toBeInTheDocument();
    expect(screen.getByText(/Metrics updated .*, could not refresh/)).toBeInTheDocument();
  });

  it('holds the final layout while metrics load, charts included', async () => {
    routes['/api/v1/metrics'] = () => new Promise<Response>(() => {}) as never;
    const { container } = render();
    expect(await screen.findByText('Streaming throughput')).toBeInTheDocument();
    expect(screen.getByText('Streaming requests')).toBeInTheDocument();
    for (const label of ['Uploads', 'Processing time', 'Sia upload time', 'Memory']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(container.querySelectorAll('[data-slot="stat-value"]')).toHaveLength(8);
    expect(container.querySelectorAll('[data-slot="skeleton"].h-56')).toHaveLength(2);
  });

  it('collapses empty charts to a small box with a sentence instead of bare axes', async () => {
    const { container } = render();
    expect(await screen.findByText('Nothing streamed yet')).toBeInTheDocument();
    expect(screen.getByText('Collecting samples')).toBeInTheDocument();
    // no figure for a line that is not drawn yet
    expect(screen.queryByText(/^Now/)).not.toBeInTheDocument();
    expect(container.querySelector('.recharts-cartesian-axis')).toBeNull();
    expect(container.querySelectorAll('.min-h-40')).toHaveLength(2);
    expect(container.querySelector('.h-56')).toBeNull();
  });

  it('draws the requests as an image that says its numbers, with labels on the bars', async () => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(0, 0, 358, 224),
    );
    // recharts shows the labels once its bar animation ends, which jsdom never runs;
    // under reduced motion the chart does not animate
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query.includes('reduce'),
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    routes['/api/v1/metrics'] = () =>
      json({
        ...metrics,
        metrics: [
          ...metrics.metrics,
          counter('sluby_segment_requests_total', [
            { value: 1204, labels: { kind: 'media' } },
            { value: 30, labels: { kind: 'manifest' } },
            { value: 2, labels: { kind: 'object' } },
          ]),
        ],
      });
    const { container } = render();
    const chart = await screen.findByRole('img', {
      name: 'Streaming requests: Video segments 1,204, Playlists 30, Other files 2',
    });
    // not an unnamed application widget with its own tab stop
    expect(chart).not.toHaveAttribute('tabindex');
    await vi.waitFor(
      () =>
        expect(
          [...container.querySelectorAll('.recharts-label-list text')].map((t) => t.textContent),
        ).toEqual(['1,204', '30', '2']),
      { timeout: 3000 },
    );
  });

  it('takes the first samples quickly so the throughput line shows within seconds', async () => {
    const { client } = render();
    await screen.findByText('1 h', readable);
    const query = client.getQueryCache().find({ queryKey: ['metrics'] })!;
    const interval = query.observers[0].options.refetchInterval as (q: typeof query) => number;
    expect(interval(query)).toBe(2_000);
    const data = query.state.data as { samples: unknown[] };
    query.setData({ ...data, samples: [1, 2, 3] });
    expect(interval(query)).toBe(10_000);
  });

  it('stops polling once the server says metrics are not for this caller', async () => {
    routes['/api/v1/metrics'] = () => json({ error: 'Operators only' }, 403);
    const { client } = render();
    expect(await screen.findByText('Could not load server metrics')).toBeInTheDocument();
    const query = client.getQueryCache().find({ queryKey: ['metrics'] })!;
    const interval = query.observers[0].options.refetchInterval as (q: typeof query) => unknown;
    expect(interval(query)).toBe(false);
    expect(metricsCalls()).toBe(1);
  });

  it('draws stat values at stat size through StatValue', async () => {
    render();
    const value = await screen.findByText('1 h', readable);
    expect(value.parentElement).toHaveClass('text-figure', 'tabular-nums');
  });
});
