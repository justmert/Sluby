import { act, screen, waitFor } from '@testing-library/react';
import { toast } from 'sonner';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_STATUS_KEY, useSystemStatus, type SystemStatus } from '@/hooks/useSystemStatus';
import { jsonFetch, renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import { LiveAlerts, SERVICE_TOAST_ID } from './LiveAlerts';

const probe = (ok: boolean) => ({ ok, latency_ms: 3 });
const status = (
  verdict: SystemStatus['status'],
  { indexer = true, database = true, redis = true } = {},
) =>
  ({
    status: verdict,
    scope: 'account',
    checked_at: '2026-10-09T08:00:00Z',
    version: '0.2.0',
    database: probe(database),
    redis: probe(redis),
    indexer: { ...probe(indexer), network: 'mainnet', hosts: null },
  }) as SystemStatus;

afterEach(() => vi.unstubAllGlobals());

// the service toast as sonner holds it. the good news leaves on a 4 s timer,
// so on a loaded machine it can be gone from the page before a query sees it;
// sonner's record of the toast does not depend on how fast the test runs
const serviceToast = () => toast.getHistory().find((t) => t.id === SERVICE_TOAST_ID);
const toldGoodNews = () =>
  waitFor(() =>
    expect(serviceToast()).toMatchObject({
      type: 'success',
      title: 'Everything is working again',
    }),
  );

// shows which answer react has rendered, so the test can wait for each one
function Seen() {
  return <span data-testid="seen" data-at={useSystemStatus().dataUpdatedAt} />;
}

function setup(operator = false) {
  // the answers come from the test through the cache, never from the poll
  vi.stubGlobal('fetch', jsonFetch({ '/api/v1/system/status': () => new Promise(() => {}) }));
  const view = renderPage(
    <WithSession operator={operator}>
      <LiveAlerts />
      <Seen />
    </WithSession>,
  );
  // react query hands an answer to react over more than one timer tick, so two
  // answers given back to back can land in one render, which is one poll to
  // LiveAlerts. each answer waits until react has rendered it, as polls a few
  // seconds apart always are
  let at = Date.now();
  const answer = async (s: SystemStatus) => {
    const updatedAt = ++at;
    act(() => {
      view.client.setQueryData(SYSTEM_STATUS_KEY, s, { updatedAt });
    });
    await waitFor(() =>
      expect(screen.getByTestId('seen')).toHaveAttribute('data-at', String(updatedAt)),
    );
  };
  return { ...view, answer };
}

describe('LiveAlerts', () => {
  it('says nothing about the state found on load', async () => {
    const { answer } = setup();
    await answer(status('degraded', { indexer: false }));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/not working/)).not.toBeInTheDocument();
  });

  it('toasts once when a service stops working, not on every poll, and again when it is back', async () => {
    const { answer } = setup();
    await answer(status('ok'));
    await answer(status('degraded', { indexer: false }));
    await answer(status('degraded', { indexer: false }));
    expect(await screen.findByText('Sia storage is not working')).toBeInTheDocument();
    await answer(status('degraded', { indexer: false }));
    await answer(status('degraded', { indexer: false }));
    expect(screen.getAllByText('Sia storage is not working')).toHaveLength(1);
    await answer(status('ok'));
    await answer(status('ok'));
    // the same toast turns into the good news instead of a second one piling up
    await toldGoodNews();
    expect(screen.queryByText('Sia storage is not working')).not.toBeInTheDocument();
  });

  it('says nothing about a blip that one poll caught, so a flapping probe is not read out twice a minute', async () => {
    const { answer } = setup();
    await answer(status('ok'));
    await answer(status('degraded', { indexer: false }));
    await answer(status('ok'));
    await answer(status('ok'));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(/not working|working again/)).not.toBeInTheDocument();
  });

  it('names every service that is down', async () => {
    const { answer } = setup();
    await answer(status('ok'));
    await answer(status('down', { database: false, redis: false }));
    await answer(status('down', { database: false, redis: false }));
    expect(
      await screen.findByText(
        'This server is down. The database and the job queue are not working.',
      ),
    ).toBeInTheDocument();
  });

  it('offers Open health to an operator, and drops it from the good news', async () => {
    const { answer } = setup(true);
    await answer(status('ok'));
    await answer(status('degraded', { indexer: false }));
    await answer(status('degraded', { indexer: false }));
    expect(await screen.findByRole('button', { name: 'Open health' })).toBeInTheDocument();
    await answer(status('ok'));
    await answer(status('ok'));
    await toldGoodNews();
    expect(serviceToast()).toMatchObject({ action: undefined });
    expect(screen.queryByRole('button', { name: 'Open health' })).not.toBeInTheDocument();
  });

  // a test of its own: a good news toast left from an operator's run would
  // close on its timer under this one's warning, which shares its id
  it('does not offer Open health to a member', async () => {
    const { answer } = setup(false);
    await answer(status('ok'));
    await answer(status('degraded', { indexer: false }));
    await answer(status('degraded', { indexer: false }));
    expect(await screen.findByText('Sia storage is not working')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open health' })).not.toBeInTheDocument();
  });
});
