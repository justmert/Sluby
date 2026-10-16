import '@/index.css';
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import MetricsPage from './MetricsPage';

// loaded by a specifier typescript does not follow, as in Sidebar.browser.test:
// its types redeclare jest-dom's matchers for the whole project
const browser = () =>
  import('vitest/browser' as string) as Promise<{
    page: { viewport(width: number, height: number): Promise<void> };
  }>;

// each read is a new sample, a second apart in server time
let reads = 0;
const metrics = () => ({
  timestamp: new Date(Date.parse('2026-10-07T12:00:00.000Z') + reads++ * 1000).toISOString(),
  metrics: [
    {
      name: 'process_start_time_seconds',
      type: 'gauge',
      values: [{ value: Date.parse('2026-10-07T11:00:00.000Z') / 1000, labels: {} }],
    },
  ],
});

beforeEach(() => {
  reads = 0;
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(metrics()), {
          headers: { 'content-type': 'application/json' },
        }),
    ),
  );
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const throughputCard = () =>
  screen.getByText('Streaming throughput').closest<HTMLElement>('[data-slot="card"]')!;

describe('MetricsPage throughput card', () => {
  for (const width of [1200, 390]) {
    it(`keeps its height at ${width} px when the first samples turn into a line`, async () => {
      await (await browser()).page.viewport(width, 900);
      renderPage(
        <WithSession operator>
          <MetricsPage />
        </WithSession>,
      );
      // the first read lands at once, the second 2 s later; a busy runner is slow to draw
      await screen.findByText('Collecting samples', {}, { timeout: 5_000 });
      await document.fonts.ready;
      const sampling = throughputCard().getBoundingClientRect().height;
      // the seed reads come 2 s apart; the line needs three
      await waitFor(() => expect(screen.queryByText('Collecting samples')).toBeNull(), {
        timeout: 10_000,
      });
      await waitFor(() => expect(throughputCard().querySelector('svg')).not.toBeNull());
      expect(throughputCard().getBoundingClientRect().height).toBe(sampling);
    });
  }
});
