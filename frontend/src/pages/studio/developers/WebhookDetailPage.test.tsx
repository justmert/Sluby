import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Link, Route, Routes } from 'react-router';
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
let writeText: ReturnType<typeof vi.fn>;

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
  writeText = vi.fn().mockResolvedValue(undefined);
  Object.assign(navigator, { clipboard: { writeText } });
});
afterEach(() => vi.unstubAllGlobals());

const render = (id = 'w1') =>
  renderPage(
    <WithSession>
      <Routes>
        <Route
          path="/studio/developers/webhooks/:id"
          element={
            <>
              <Link to="/studio/videos">Videos</Link>
              <WebhookDetailPage />
            </>
          }
        />
        <Route path="/studio/developers/webhooks" element={<h1>Webhooks list</h1>} />
        <Route path="/studio/videos" element={<h1>Videos page</h1>} />
      </Routes>
    </WithSession>,
    { route: `/studio/developers/webhooks/${id}` },
  );

const calls = (method: string, path: string) =>
  fetchStub.calls.filter((c) => c.method === method && c.path === path);

const openMore = async () =>
  userEvent.click(await screen.findByRole('button', { name: 'More actions for this webhook' }));

describe('webhook page', () => {
  it('titles the page with the full endpoint url in mono, and its state', async () => {
    render();
    const title = await screen.findByRole('heading', {
      level: 1,
      name: 'https://example.com/sluby-hook',
    });
    expect(title).toHaveClass('font-mono');
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(calls('GET', '/api/v1/webhooks/w1')).toHaveLength(1);
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

  it('pauses and resumes from the header, with Resume first and primary when paused', async () => {
    routes['PATCH /api/v1/webhooks/w1'] = ({ body }: RecordedCall) => {
      current = hook({ is_active: (body as { is_active: boolean }).is_active });
      return current;
    };
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }));
    expect(await screen.findByText('Webhook paused')).toBeInTheDocument();
    const resume = await screen.findByRole('button', { name: 'Resume' });
    expect(resume).toHaveAttribute('data-variant', 'default');
    const actions = resume.parentElement!;
    expect(
      within(actions)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Resume', 'Send test', 'More']);
    expect(screen.getAllByText('Paused')[0]).toBeInTheDocument();
  });

  it('copies the endpoint url and the webhook id from More', async () => {
    render();
    await openMore();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Copy endpoint URL' }));
    expect(writeText).toHaveBeenCalledWith('https://example.com/sluby-hook');
    expect(await screen.findByText('Endpoint URL copied')).toBeInTheDocument();
    await openMore();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Copy webhook ID' }));
    expect(writeText).toHaveBeenCalledWith('w1');
  });

  it('deletes and goes back to the list', async () => {
    routes['DELETE /api/v1/webhooks/w1'] = { success: true };
    render();
    await openMore();
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete webhook' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Delete this webhook?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('heading', { name: 'Webhooks list' })).toBeInTheDocument();
    expect(await screen.findByText('Webhook deleted')).toBeInTheDocument();
  });
});

describe('events card', () => {
  it('lists the events by api name with what each means', async () => {
    render();
    const card = await screen.findByRole('region', { name: 'Events' });
    expect(within(card).getByText('asset.ready')).toHaveClass('font-mono');
    expect(within(card).getByText('The video is ready to play')).toBeInTheDocument();
    expect(within(card).getByText('asset.errored')).toBeInTheDocument();
    expect(within(card).queryByRole('checkbox')).not.toBeInTheDocument();
  });

  it('edits with checkboxes and saves with PATCH, only once something changed', async () => {
    routes['PATCH /api/v1/webhooks/w1'] = ({ body }: RecordedCall) => {
      current = hook({ events: (body as { events: string[] }).events });
      return current;
    };
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit events' }));
    await waitFor(() => expect(screen.getByLabelText('upload.started')).toHaveFocus());
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();
    await userEvent.click(screen.getByLabelText('upload.started'));
    await userEvent.click(save);
    expect(await screen.findByText('Events saved')).toBeInTheDocument();
    expect(calls('PATCH', '/api/v1/webhooks/w1')[0].body).toEqual({
      events: ['upload.started', 'asset.ready', 'asset.errored'],
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'Edit events' })).toHaveFocus());
    const card = screen.getByRole('region', { name: 'Events' });
    expect(within(card).getByText('upload.started')).toBeInTheDocument();
  });

  it('cancels back to the list, with nothing sent', async () => {
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit events' }));
    await userEvent.click(screen.getByLabelText('asset.ready'));
    await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(calls('PATCH', '/api/v1/webhooks/w1')).toHaveLength(0);
  });

  it('refuses to save no events at all', async () => {
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Edit events' }));
    for (const e of ['asset.ready', 'asset.errored']) {
      await userEvent.click(screen.getByLabelText(e));
    }
    expect(screen.getByText('Choose at least one event.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeDisabled();
  });
});

describe('signing secret card', () => {
  it('says the secret was shown once and shows no made-up value', async () => {
    render();
    const card = await screen.findByRole('region', { name: 'Signing secret' });
    expect(card).toHaveTextContent('X-Sluby-Signature-V1');
    expect(card).toHaveTextContent('It was shown once, when this webhook was added.');
    expect(card).not.toHaveTextContent('whsec_');
    expect(within(card).queryByRole('button', { name: 'Reveal' })).not.toBeInTheDocument();
  });

  it('rotates after asking, then shows the new secret masked with Reveal and Copy', async () => {
    routes['POST /api/v1/webhooks/w1/rotate-secret'] = { id: 'w1', secret: 'whsec_Fresh1234' };
    render();
    const card = await screen.findByRole('region', { name: 'Signing secret' });
    await userEvent.click(within(card).getByRole('button', { name: 'Rotate secret' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Rotate the signing secret?' });
    expect(ask).toHaveTextContent(
      'Requests are signed with the new secret right away, and checks with the old one start failing. This cannot be undone.',
    );
    await userEvent.click(within(ask).getByRole('button', { name: 'Rotate secret' }));
    expect(await screen.findByText('Signing secret rotated')).toBeInTheDocument();
    const masked = within(card).getByText(/^whsec_/);
    expect(masked).toHaveTextContent('whsec_••••••••••••1234');
    // focus lands on Copy, the one thing to do next
    const copy = within(card).getByRole('button', { name: 'Copy signing secret' });
    await waitFor(() => expect(copy).toHaveFocus());
    const reveal = within(card).getByRole('button', { name: 'Reveal' });
    await userEvent.click(reveal);
    expect(within(card).getByText('whsec_Fresh1234')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Hide' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await userEvent.click(copy);
    expect(writeText).toHaveBeenCalledWith('whsec_Fresh1234');
    await userEvent.click(within(card).getByRole('button', { name: 'I copied it' }));
    expect(within(card).queryByText('whsec_Fresh1234')).not.toBeInTheDocument();
    await waitFor(() =>
      expect(within(card).getByRole('button', { name: 'Rotate secret' })).toHaveFocus(),
    );
  });

  it('asks before a link leaves an uncopied secret behind, and stays on Cancel', async () => {
    routes['POST /api/v1/webhooks/w1/rotate-secret'] = { id: 'w1', secret: 'whsec_Fresh1234' };
    render();
    const card = await screen.findByRole('region', { name: 'Signing secret' });
    await userEvent.click(within(card).getByRole('button', { name: 'Rotate secret' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Rotate the signing secret?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Rotate secret' }));
    await within(card).findByText(/^whsec_/);

    await userEvent.click(screen.getByRole('link', { name: 'Videos' }));
    const leave = await screen.findByRole('alertdialog', { name: 'Leave without the secret?' });
    await userEvent.click(within(leave).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('heading', { name: 'Videos page' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('link', { name: 'Videos' }));
    const again = await screen.findByRole('alertdialog', { name: 'Leave without the secret?' });
    await userEvent.click(within(again).getByRole('button', { name: 'Leave' }));
    expect(await screen.findByRole('heading', { name: 'Videos page' })).toBeInTheDocument();
  });

  it('lets links go once the secret was copied', async () => {
    routes['POST /api/v1/webhooks/w1/rotate-secret'] = { id: 'w1', secret: 'whsec_Fresh1234' };
    render();
    const card = await screen.findByRole('region', { name: 'Signing secret' });
    await userEvent.click(within(card).getByRole('button', { name: 'Rotate secret' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Rotate the signing secret?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Rotate secret' }));
    await userEvent.click(await within(card).findByRole('button', { name: 'Copy signing secret' }));
    await userEvent.click(screen.getByRole('link', { name: 'Videos' }));
    expect(await screen.findByRole('heading', { name: 'Videos page' })).toBeInTheDocument();
  });
});

describe('deliveries', () => {
  it('lists event, result and time in a named card and table (A11Y-19, A11Y-36)', async () => {
    render();
    const region = await screen.findByRole('region', { name: 'Deliveries' });
    expect(region).toHaveTextContent('Newest first');
    const table = await within(region).findByRole('table', { name: 'Deliveries' });
    const failed = within(table).getByText('asset.errored').closest('tr')!;
    expect(within(failed).getByText('500 · after 3 tries')).toBeInTheDocument();
    expect(within(failed).getByText('1 hour ago')).toBeInTheDocument();
    const ok = within(table).getByText('asset.ready').closest('tr')!;
    expect(within(ok).getByText('200')).toBeInTheDocument();
    // a delivered row has no Send again of its own
    expect(within(ok).queryByRole('button', { name: /^Send again/ })).not.toBeInTheDocument();
  });

  it('says No answer when the endpoint never answered', async () => {
    deliveries = [delivery({ status_code: null, delivered: false, error: 'timeout' })];
    render();
    const region = await screen.findByRole('region', { name: 'Deliveries' });
    expect(await within(region).findByText('No answer')).toBeInTheDocument();
  });

  it('shows and hides a payload with its event id and error (B-05)', async () => {
    render();
    const toggle = await screen.findByRole('button', { name: /^Show payload, asset.errored/ });
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'true'));
    expect(toggle).toHaveTextContent(/^Hide payload/);
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(within(panel).getByRole('tree', { name: 'asset.errored payload' })).toHaveTextContent(
      '"vid_1"',
    );
    expect(panel).toHaveTextContent('Your endpoint answered 500');
    expect(panel).toHaveTextContent('evt_1');
    await userEvent.click(toggle);
    await waitFor(() => expect(toggle).toHaveAttribute('aria-expanded', 'false'));
  });

  it('sends a failed delivery again from its row (B-06)', async () => {
    routes['POST /api/v1/webhooks/w1/deliveries/d2/redeliver'] = reply(202, {
      delivery_id: 'd3',
    });
    render();
    await userEvent.click(
      await screen.findByRole('button', { name: /^Send again, asset.errored/ }),
    );
    expect(await screen.findByText('Delivery queued')).toBeInTheDocument();
    expect(calls('POST', '/api/v1/webhooks/w1/deliveries/d2/redeliver')).toHaveLength(1);
  });

  it('sends a delivered one again from its open payload', async () => {
    routes['POST /api/v1/webhooks/w1/deliveries/d1/redeliver'] = reply(202, {
      delivery_id: 'd3',
    });
    render();
    await userEvent.click(
      await screen.findByRole('button', { name: /^Show payload, asset.ready/ }),
    );
    await userEvent.click(await screen.findByRole('button', { name: /^Send again, asset.ready/ }));
    expect(await screen.findByText('Delivery queued')).toBeInTheDocument();
  });

  it('cannot send again while paused, and says why', async () => {
    current = hook({ is_active: false });
    render();
    const again = await screen.findByRole('button', { name: /^Send again, asset.errored/ });
    expect(again).toBeDisabled();
    expect(again).toHaveAccessibleDescription('Resume the webhook to send deliveries again.');
  });

  it('says why a resend failed', async () => {
    routes['POST /api/v1/webhooks/w1/deliveries/d2/redeliver'] = reply(409, {
      error: 'This webhook is paused. Resume it to resend.',
    });
    render();
    await userEvent.click(
      await screen.findByRole('button', { name: /^Send again, asset.errored/ }),
    );
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
      await screen.findByRole('heading', { level: 1, name: 'https://example.com/sluby-hook' }),
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
      const region = await screen.findByRole('region', { name: 'Deliveries' });
      await within(region).findByRole('table');
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
    const region = await screen.findByRole('region', { name: 'Deliveries' });
    expect(await within(region).findByText('Test')).toBeInTheDocument();
  });
});

describe('a paused webhook', () => {
  it('shows the paused note and says a test is still delivered', async () => {
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
    expect(screen.queryByText(/No events are sent/)).not.toBeInTheDocument();
    await userEvent.click(send);
    expect(
      await screen.findByText('Test delivered (your endpoint answered 204)'),
    ).toBeInTheDocument();
  });
});
