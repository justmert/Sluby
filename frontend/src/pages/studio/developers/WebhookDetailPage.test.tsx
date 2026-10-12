import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, renderPage, reply, type RecordedCall } from '@/test/render';
import { WithSession } from '@/test/session';
import WebhookDetailPage from './WebhookDetailPage';

type Rec = Record<string, unknown>;

const hook = (over: Rec = {}): Rec => ({
  id: 'w1',
  url: 'https://example.com/sluby-hook',
  events: ['asset.ready', 'asset.errored'],
  is_active: true,
  created_at: '2026-10-01T00:00:00Z',
  last_delivery_at: new Date(Date.now() - 3 * 60_000).toISOString(),
  last_delivery_ok: true,
  ...over,
});

const delivery = (over: Rec = {}): Rec => ({
  id: 'd1',
  event_id: 'evt_1',
  event: 'asset.ready',
  status_code: 200,
  delivered: true,
  error: null,
  attempt: 1,
  created_at: new Date(Date.now() - 3 * 60_000).toISOString(),
  payload: { event: 'asset.ready', data: { id: 'vid_1' } },
  manual: false,
  ...over,
});

let current: Rec;
let deliveries: Rec[];
let routes: Record<string, unknown>;
let fetchStub: ReturnType<typeof jsonFetch>;

beforeEach(() => {
  current = hook();
  deliveries = [
    delivery(),
    delivery({
      id: 'd2',
      event: 'asset.errored',
      status_code: 500,
      delivered: false,
      error: 'Your endpoint answered 500',
      attempt: 3,
      created_at: new Date(Date.now() - 3_600_000).toISOString(),
    }),
  ];
  routes = {
    '/api/v1/webhooks/w1': () => current,
    '/api/v1/webhooks/w1/deliveries': () => ({ data: deliveries }),
    '/api/v1/webhooks': () => ({ data: [current] }),
  };
  fetchStub = jsonFetch(new Proxy({}, { get: (_, k) => routes[k as string] }));
  vi.stubGlobal('fetch', vi.fn(fetchStub));
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => vi.unstubAllGlobals());

const render = (id = 'w1') =>
  renderPage(
    <WithSession>
      <Routes>
        <Route path="/studio/developers/webhooks/:id" element={<WebhookDetailPage />} />
        <Route path="/studio/developers/webhooks" element={<h1>Webhooks list</h1>} />
      </Routes>
    </WithSession>,
    { route: `/studio/developers/webhooks/${id}` },
  );

const calls = (method: string, path: string) =>
  fetchStub.calls.filter((c) => c.method === method && c.path === path);

describe('webhook page', () => {
  it('names the webhook by host and path, with its state and last delivery', async () => {
    render();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'example.com/sluby-hook' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Active')[0]).toBeInTheDocument();
    expect(screen.getByText('Added Oct 1, 2026')).toBeInTheDocument();
    expect(screen.getAllByText('https://example.com/sluby-hook')[0]).toBeInTheDocument();
    expect(calls('GET', '/api/v1/webhooks/w1')).toHaveLength(1);
  });

  it('separates the header facts with middle dots, like the video page', async () => {
    render();
    const added = await screen.findByText('Added Oct 1, 2026');
    expect(added.previousElementSibling).toHaveTextContent('·');
    expect(added.nextElementSibling).toHaveTextContent('·');
  });

  it('says when the webhook does not exist', async () => {
    routes['/api/v1/webhooks/gone'] = reply(404, { error: 'Webhook endpoint not found' });
    render('gone');
    expect(await screen.findByRole('heading', { name: 'Webhook not found' })).toBeInTheDocument();
    expect(screen.getByText('It may have been deleted.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to webhooks' })).toHaveAttribute(
      'href',
      '/studio/developers/webhooks',
    );
  });

  it('offers Try again when it does not load', async () => {
    routes['/api/v1/webhooks/w1'] = reply(503, { error: 'Service Unavailable' });
    render();
    expect(
      await screen.findByRole('heading', { name: 'Could not load this webhook' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });

  it('pauses and resumes from the header', async () => {
    routes['PATCH /api/v1/webhooks/w1'] = ({ body }: RecordedCall) => {
      current = hook({ is_active: (body as { is_active: boolean }).is_active });
      return current;
    };
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    expect(await screen.findByText('Webhook paused')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(screen.getAllByText('Paused')[0]).toBeInTheDocument();
  });

  it('saves edited events with PATCH, and only offers Save when they changed', async () => {
    routes['PATCH /api/v1/webhooks/w1'] = ({ body }: RecordedCall) => {
      current = hook({ events: (body as { events: string[] }).events });
      return current;
    };
    render();
    const box = await screen.findByLabelText('upload.started');
    expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument();
    await userEvent.click(box);
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Events saved')).toBeInTheDocument();
    expect(calls('PATCH', '/api/v1/webhooks/w1')[0].body).toEqual({
      events: ['upload.started', 'asset.ready', 'asset.errored'],
    });
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument(),
    );
  });

  it('refuses to save no events at all', async () => {
    render();
    for (const e of ['asset.ready', 'asset.errored']) {
      await userEvent.click(await screen.findByLabelText(e));
    }
    expect(screen.getByText('Choose at least one event.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });

  it('rotates the signing secret after asking, and shows the new one once', async () => {
    routes['POST /api/v1/webhooks/w1/rotate-secret'] = { id: 'w1', secret: 'whsec_Fresh' };
    render();
    await userEvent.click(
      await screen.findByRole('button', { name: 'More actions for this webhook' }),
    );
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Rotate signing secret' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Rotate the signing secret?' });
    expect(ask).toHaveTextContent(
      'Requests are signed with the new secret right away, and checks with the old one start failing. This cannot be undone.',
    );
    await userEvent.click(within(ask).getByRole('button', { name: 'Rotate secret' }));
    const shown = await screen.findByRole('dialog', { name: 'Signing secret rotated' });
    expect(shown).toHaveTextContent('export SLUBY_WEBHOOK_SECRET=whsec_Fresh');
    // the dialog title and the toast
    expect(await screen.findAllByText('Signing secret rotated')).toHaveLength(2);
    // focus goes back to the menu that opened it, not to the page (A11Y-03)
    await userEvent.click(within(shown).getByRole('button', { name: 'I copied it' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'More actions for this webhook' })).toHaveFocus(),
    );
  });

  it('deletes and goes back to the list', async () => {
    routes['DELETE /api/v1/webhooks/w1'] = { success: true };
    render();
    await userEvent.click(
      await screen.findByRole('button', { name: 'More actions for this webhook' }),
    );
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete webhook' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Delete this webhook?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('heading', { name: 'Webhooks list' })).toBeInTheDocument();
    expect(await screen.findByText('Webhook deleted')).toBeInTheDocument();
  });

  it('shows the receive and verify snippet', async () => {
    render();
    const code = await screen.findByRole('region', { name: 'verify webhook requests code' });
    expect(code).toHaveTextContent('verifyRequest(body, req.headers, secret)');
  });
});

describe('deliveries', () => {
  it('lists status, event, attempt and time in a named table (A11Y-19, A11Y-36)', async () => {
    render();
    const region = await screen.findByRole('region', { name: 'Recent deliveries' });
    const table = within(region).getByRole('table', { name: 'Deliveries' });
    const failed = within(table).getByText('asset.errored').closest('tr')!;
    expect(within(failed).getByText('500')).toBeInTheDocument();
    expect(within(failed).getByText('3')).toBeInTheDocument();
    expect(within(failed).getByText('1 hour ago')).toBeInTheDocument();
  });

  it('opens a row to the payload and error, and resends it (B-05, B-06)', async () => {
    routes['POST /api/v1/webhooks/w1/deliveries/d2/redeliver'] = reply(202, {
      delivery_id: 'd3',
    });
    render();
    const toggle = await screen.findByRole('button', { name: /^Details for asset.errored/ });
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'));
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(
      within(panel).getByRole('region', { name: 'asset.errored payload code' }),
    ).toHaveTextContent('"vid_1"');
    expect(panel).toHaveTextContent('Your endpoint answered 500');
    expect(panel).toHaveTextContent('evt_1');
    await userEvent.click(within(panel).getByRole('button', { name: 'Resend' }));
    expect(await screen.findByText('Delivery queued')).toBeInTheDocument();
    expect(calls('POST', '/api/v1/webhooks/w1/deliveries/d2/redeliver')).toHaveLength(1);
  });

  it('cannot resend while paused, and says why', async () => {
    current = hook({ is_active: false });
    render();
    const toggle = await screen.findByRole('button', { name: /^Details for asset.errored/ });
    await userEvent.click(toggle);
    const resend = await screen.findByRole('button', { name: 'Resend' });
    expect(resend).toBeDisabled();
    expect(resend).toHaveAccessibleDescription('Resume the webhook to resend.');
  });

  it('says why a resend failed', async () => {
    routes['POST /api/v1/webhooks/w1/deliveries/d1/redeliver'] = reply(409, {
      error: 'This webhook is paused. Resume it to resend.',
    });
    render();
    await userEvent.click(await screen.findByRole('button', { name: /^Details for asset.ready/ }));
    await userEvent.click(await screen.findByRole('button', { name: 'Resend' }));
    expect(
      await screen.findByText('Could not resend. This webhook is paused. Resume it to resend.'),
    ).toBeInTheDocument();
  });

  it('marks resends', async () => {
    deliveries = [delivery({ manual: true })];
    render();
    expect(await screen.findByText('Resent')).toBeInTheDocument();
  });

  it('says when there are none yet', async () => {
    deliveries = [];
    render();
    expect(await screen.findByText('No deliveries yet.')).toBeInTheDocument();
  });

  it('keeps the header when only the deliveries fail, with Try again (partial)', async () => {
    routes['/api/v1/webhooks/w1/deliveries'] = reply(500, { error: 'boom' });
    render();
    expect(
      await screen.findByRole('heading', { level: 1, name: 'example.com/sluby-hook' }),
    ).toBeInTheDocument();
    const alert = await screen.findByText('Could not load deliveries');
    expect(
      within(alert.closest('[role=alert]')!).getByRole('button', { name: 'Try again' }),
    ).toBeInTheDocument();
  });

  it('polls every 10 seconds and tints a delivery that just arrived (MOT-11)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    try {
      render();
      const region = await screen.findByRole('region', { name: 'Recent deliveries' });
      expect(calls('GET', '/api/v1/webhooks/w1/deliveries')).toHaveLength(1);
      deliveries = [
        delivery({ id: 'd5', event: 'upload.started', created_at: new Date().toISOString() }),
        ...deliveries,
      ];
      await act(async () => vi.advanceTimersByTime(10_000));
      const row = (await within(region).findByText('upload.started')).closest('tr')!;
      expect(row.querySelector('[aria-hidden=true].bg-primary\\/10')).not.toBeNull();
      // rows that were already there get no tint
      const old = within(region).getByText('asset.errored').closest('tr')!;
      expect(old.querySelector('.bg-primary\\/10')).toBeNull();
      expect(calls('GET', '/api/v1/webhooks/w1/deliveries').length).toBeGreaterThanOrEqual(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('marks test sends in the log', async () => {
    deliveries = [delivery({ event: 'webhook.test', status_code: 204 })];
    render();
    const region = await screen.findByRole('region', { name: 'Recent deliveries' });
    expect(within(region).getByText('Test')).toBeInTheDocument();
  });
});

describe('a paused webhook', () => {
  it('says a test is still delivered while events are paused', async () => {
    current = hook({ is_active: false });
    routes['POST /api/v1/webhooks/w1/test'] = { delivered: true, status_code: 204, error: null };
    render();
    const send = await screen.findByRole('button', { name: 'Send test' });
    expect(send).toHaveAccessibleDescription(
      'Paused. No events are sent to this endpoint. Send test still delivers a test request, so you can check your receiver before you resume.',
    );
    await userEvent.click(send);
    expect(
      await screen.findByText('Test delivered while paused (your endpoint answered 204)'),
    ).toBeInTheDocument();
  });

  it('says nothing about pausing on an active webhook', async () => {
    routes['POST /api/v1/webhooks/w1/test'] = { delivered: true, status_code: 204, error: null };
    render();
    const send = await screen.findByRole('button', { name: 'Send test' });
    expect(send).not.toHaveAttribute('aria-describedby');
    await userEvent.click(send);
    expect(
      await screen.findByText('Test delivered (your endpoint answered 204)'),
    ).toBeInTheDocument();
  });
});
