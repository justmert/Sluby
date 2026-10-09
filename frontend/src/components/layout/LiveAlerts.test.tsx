import { act, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SYSTEM_STATUS_KEY, type SystemStatus } from '@/hooks/useSystemStatus';
import { jsonFetch, renderPage } from '@/test/render';
import { WithSession } from '@/test/session';
import { LiveAlerts } from './LiveAlerts';

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

function setup(operator = false) {
  // the answers come from the test through the cache, never from the poll
  vi.stubGlobal('fetch', jsonFetch({ '/api/v1/system/status': () => new Promise(() => {}) }));
  const view = renderPage(
    <WithSession operator={operator}>
      <LiveAlerts />
    </WithSession>,
  );
  // react query tells its observers on a timer, so each answer gets its own turn, as polls do
  const answer = (s: SystemStatus) =>
    act(async () => {
      view.client.setQueryData(SYSTEM_STATUS_KEY, s);
      await new Promise((r) => setTimeout(r, 0));
    });
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
    expect(await screen.findByText('Sia storage is not working.')).toBeInTheDocument();
    await answer(status('degraded', { indexer: false }));
    await answer(status('degraded', { indexer: false }));
    expect(screen.getAllByText('Sia storage is not working.')).toHaveLength(1);
    await answer(status('ok'));
    await answer(status('ok'));
    // the same toast turns into the good news instead of a second one piling up
    expect(await screen.findByText('Everything is working again.')).toBeInTheDocument();
    expect(screen.queryByText('Sia storage is not working.')).not.toBeInTheDocument();
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

  it('offers Open health to an operator only', async () => {
    const op = setup(true);
    await op.answer(status('ok'));
    await op.answer(status('degraded', { indexer: false }));
    await op.answer(status('degraded', { indexer: false }));
    expect(await screen.findByRole('button', { name: 'Open health' })).toBeInTheDocument();
    // the good news replaces the warning without its action
    await op.answer(status('ok'));
    await op.answer(status('ok'));
    expect(await screen.findByText('Everything is working again.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Open health' })).not.toBeInTheDocument();
    op.unmount();

    const member = setup(false);
    await member.answer(status('ok'));
    await member.answer(status('degraded', { indexer: false }));
    await member.answer(status('degraded', { indexer: false }));
    await screen.findAllByText('Sia storage is not working.');
    expect(screen.queryByRole('button', { name: 'Open health' })).not.toBeInTheDocument();
  });
});
