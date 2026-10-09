import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESTORED_DRAFT_MESSAGE } from '@/lib/drafts';
import { reportUnauthorized } from '@/lib/session-events';
import { jsonFetch, renderPage, reply, type RecordedCall } from '@/test/render';
import { WithSession } from '@/test/session';
import WebhooksPage from './WebhooksPage';

type Hook = Record<string, unknown>;

const hook = (over: Hook = {}): Hook => ({
  id: 'w1',
  url: 'https://example.com/sluby-hook',
  events: ['asset.ready', 'asset.errored'],
  is_active: true,
  created_at: '2026-10-01T00:00:00Z',
  last_delivery_at: new Date(Date.now() - 3 * 60_000).toISOString(),
  last_delivery_ok: true,
  ...over,
});

let hooks: Hook[];
let routes: Record<string, unknown>;
let fetchStub: ReturnType<typeof jsonFetch>;

beforeEach(() => {
  hooks = [hook()];
  routes = {
    '/api/v1/webhooks': () => ({ data: hooks }),
    'POST /api/v1/webhooks': ({ body }: RecordedCall) => {
      const b = body as { url: string; events: string[] };
      hooks = [hook({ id: 'w9', ...b, last_delivery_at: null, last_delivery_ok: null }), ...hooks];
      return reply(201, { id: 'w9', ...b, secret: 'whsec_TheSigningSecret' });
    },
  };
  fetchStub = jsonFetch(new Proxy({}, { get: (_, k) => routes[k as string] }));
  vi.stubGlobal('fetch', vi.fn(fetchStub));
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});
afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

const render = (route = '/studio/developers/webhooks') =>
  renderPage(
    <WithSession>
      <WebhooksPage />
    </WithSession>,
    { route },
  );

const calls = (method: string, path: string) =>
  fetchStub.calls.filter((c) => c.method === method && c.path === path);

async function openMenu(text: string) {
  const row = screen.getByText(text).closest('tr')!;
  await userEvent.click(within(row).getByRole('button', { name: /^Actions for/ }));
  return screen.findByRole('menu');
}

describe('Webhooks page', () => {
  it('lists each endpoint with its events, last delivery and status, linked to its page', async () => {
    hooks = [
      hook(),
      hook({
        id: 'w2',
        url: 'https://api.acme.dev/hooks/video',
        is_active: false,
        last_delivery_ok: false,
        last_delivery_at: new Date(Date.now() - 3_600_000).toISOString(),
      }),
      hook({ id: 'w3', url: 'https://new.example.com/', last_delivery_at: null }),
    ];
    render();
    expect(screen.getByRole('heading', { level: 1, name: 'Webhooks' })).toBeInTheDocument();
    expect(
      screen.getByText('Requests this server sends you when a video changes'),
    ).toBeInTheDocument();
    const link = await screen.findByRole('link', { name: 'https://example.com/sluby-hook' });
    expect(link).toHaveAttribute('href', '/studio/developers/webhooks/w1');
    const first = link.closest('tr')!;
    expect(within(first).getByText('2 events')).toBeInTheDocument();
    expect(within(first).getByText('Delivered')).toBeInTheDocument();
    expect(within(first).getByText('3 minutes ago')).toBeInTheDocument();
    expect(within(first).getByText('Active')).toBeInTheDocument();
    const paused = screen.getByText('https://api.acme.dev/hooks/video').closest('tr')!;
    expect(within(paused).getByText('Not delivered')).toBeInTheDocument();
    expect(within(paused).getByText('Paused')).toBeInTheDocument();
    const fresh = screen.getByText('https://new.example.com/').closest('tr')!;
    expect(within(fresh).getByText('None yet')).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'Webhooks' })).toBeInTheDocument();
  });

  it('offers Add webhook in the empty state (CPY-20, FLW-57)', async () => {
    hooks = [];
    render();
    expect(await screen.findByText('No webhooks yet')).toBeInTheDocument();
    expect(
      screen.getByText('Get a request on your server when a video is ready or fails.'),
    ).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Add webhook' });
    await userEvent.click(buttons[buttons.length - 1]);
    expect(await screen.findByRole('dialog', { name: 'Add webhook' })).toBeInTheDocument();
  });

  it('says what failed with Try again when the list does not load (CPY-19)', async () => {
    routes['/api/v1/webhooks'] = reply(500, { error: 'Internal Server Error' });
    render();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load webhooks');
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('sends a test from the row menu and says how the endpoint answered (CPY-13)', async () => {
    routes['POST /api/v1/webhooks/w1/test'] = { delivered: true, status_code: 204, error: null };
    render();
    await screen.findByText('https://example.com/sluby-hook');
    const menu = await openMenu('https://example.com/sluby-hook');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Send test' }));
    expect(
      await screen.findByText('Test delivered (your endpoint answered 204)'),
    ).toBeInTheDocument();
  });

  it('reports a test the endpoint refused, as a sentence', async () => {
    routes['POST /api/v1/webhooks/w1/test'] = {
      delivered: false,
      status_code: 500,
      error: 'Your endpoint answered 500',
    };
    render();
    await screen.findByText('https://example.com/sluby-hook');
    const menu = await openMenu('https://example.com/sluby-hook');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Send test' }));
    expect(
      await screen.findByText('Test not delivered. Your endpoint answered 500'),
    ).toBeInTheDocument();
  });

  it('says the endpoint did not answer when a test got no response and no reason', async () => {
    routes['POST /api/v1/webhooks/w1/test'] = { delivered: false, status_code: null };
    render();
    await screen.findByText('https://example.com/sluby-hook');
    const menu = await openMenu('https://example.com/sluby-hook');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Send test' }));
    expect(
      await screen.findByText('Test not delivered. Your endpoint did not answer'),
    ).toBeInTheDocument();
  });

  it('pauses and resumes an endpoint (FLW-53)', async () => {
    routes['PATCH /api/v1/webhooks/w1'] = ({ body }: RecordedCall) => {
      hooks = [hook({ is_active: (body as { is_active: boolean }).is_active })];
      return hooks[0];
    };
    render();
    await screen.findByText('https://example.com/sluby-hook');
    let menu = await openMenu('https://example.com/sluby-hook');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Pause' }));
    expect(await screen.findByText('Webhook paused')).toBeInTheDocument();
    expect(calls('PATCH', '/api/v1/webhooks/w1')[0].body).toEqual({ is_active: false });
    expect(await screen.findByText('Paused')).toBeInTheDocument();
    menu = await openMenu('https://example.com/sluby-hook');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Resume' }));
    expect(await screen.findByText('Webhook resumed')).toBeInTheDocument();
  });

  it('deletes after a confirmation that names the URL, and says Delete (CPY-08)', async () => {
    routes['DELETE /api/v1/webhooks/w1'] = () => {
      hooks = [];
      return { success: true };
    };
    render();
    await screen.findByText('https://example.com/sluby-hook');
    const menu = await openMenu('https://example.com/sluby-hook');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Delete this webhook?' });
    expect(dialog).toHaveTextContent(
      'Events stop going to https://example.com/sluby-hook right away, and its delivery log is deleted. This cannot be undone.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('Webhook deleted')).toBeInTheDocument();
    expect(await screen.findByText('No webhooks yet')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Add webhook' })[0]).toHaveFocus(),
    );
  });
});

describe('adding a webhook', () => {
  it('focuses the URL field, and gives focus back to Add webhook on close (A11Y-03)', async () => {
    render();
    await screen.findByText('https://example.com/sluby-hook');
    const add = screen.getByRole('button', { name: 'Add webhook' });
    await userEvent.click(add);
    const dialog = await screen.findByRole('dialog', { name: 'Add webhook' });
    expect(within(dialog).getByLabelText('Endpoint URL')).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(add).toHaveFocus();
  });

  it('checks the URL and events before sending (CPY-28)', async () => {
    render();
    await screen.findByText('https://example.com/sluby-hook');
    await userEvent.click(screen.getByRole('button', { name: 'Add webhook' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add webhook' });
    expect(dialog).toHaveTextContent(
      'We send a POST request here when one of your videos changes.',
    );
    for (const e of ['asset.ready', 'asset.errored']) {
      await userEvent.click(within(dialog).getByLabelText(e));
    }
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add webhook' }));
    expect(
      within(dialog).getByText('Enter the URL that should get the events.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByText('Choose at least one event.')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Endpoint URL'), 'example.com/hook');
    expect(
      within(dialog).getByText('Enter a full URL, such as https://example.com/sluby-hook.'),
    ).toBeInTheDocument();
    expect(calls('POST', '/api/v1/webhooks')).toHaveLength(0);
  });

  it('lists every event with what it means, stacked (VIS-05, CPY-33)', async () => {
    render('/studio/developers/webhooks?create=webhook');
    const dialog = await screen.findByRole('dialog', { name: 'Add webhook' });
    expect(within(dialog).getByLabelText('upload.started')).toHaveAccessibleDescription(
      'An upload started',
    );
    expect(within(dialog).getByLabelText('asset.errored')).toHaveAccessibleDescription(
      'Processing failed and will not retry',
    );
    expect(within(dialog).getByLabelText('asset.ready')).toBeChecked();
  });

  it('warns about a URL that already gets events, without refusing it (FLW-51)', async () => {
    render();
    await screen.findByText('https://example.com/sluby-hook');
    await userEvent.click(screen.getByRole('button', { name: 'Add webhook' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add webhook' });
    const url = within(dialog).getByLabelText('Endpoint URL');
    await userEvent.type(url, 'https://example.com/sluby-hook');
    expect(url).toHaveAccessibleDescription(
      'This URL already receives events. Add it again only if you want every event twice.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add webhook' }));
    expect(await screen.findByRole('dialog', { name: 'Webhook added' })).toBeInTheDocument();
  });

  it('shows the server’s refusal as it is, with how to allow the network (CPY-11, FLW-52)', async () => {
    const refusal =
      'Webhooks can only reach public addresses, and localhost points to this machine. To allow it, add the network to WEBHOOK_ALLOWED_NETWORKS on the server.';
    routes['POST /api/v1/webhooks'] = reply(400, { error: refusal });
    render();
    await screen.findByText('https://example.com/sluby-hook');
    await userEvent.click(screen.getByRole('button', { name: 'Add webhook' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add webhook' });
    await userEvent.type(within(dialog).getByLabelText('Endpoint URL'), 'http://localhost:9999/x');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add webhook' }));
    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('Could not add the webhook');
    expect(alert).toHaveTextContent(refusal);
    expect(within(dialog).getByLabelText('Endpoint URL')).toHaveValue('http://localhost:9999/x');
  });

  it('adds the row once the server answers and shows the signing secret once', async () => {
    const { client } = render();
    await screen.findByText('https://example.com/sluby-hook');
    await userEvent.click(screen.getByRole('button', { name: 'Add webhook' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add webhook' });
    await userEvent.type(within(dialog).getByLabelText('Endpoint URL'), 'https://b.example/hook');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add webhook' }));
    const secret = await screen.findByRole('dialog', { name: 'Webhook added' });
    expect(secret).toHaveTextContent(
      'Copy the signing secret now. You will not be able to see it again.',
    );
    expect(secret).toHaveTextContent('export SLUBY_WEBHOOK_SECRET=whsec_TheSigningSecret');
    expect(
      await screen.findByText('https://b.example/hook', { selector: 'a' }),
    ).toBeInTheDocument();
    const cached = JSON.stringify([
      client
        .getQueryCache()
        .getAll()
        .map((q) => q.state.data),
      client
        .getMutationCache()
        .getAll()
        .map((m) => m.state.data),
    ]);
    expect(cached).not.toContain('whsec_TheSigningSecret');
    // the secret dialog holds until copied
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('dialog', { name: 'Webhook added' })).toBeInTheDocument();
    await userEvent.click(within(secret).getByRole('button', { name: 'I copied it' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps the typed URL across a session that ends (FLW-15)', async () => {
    const first = render();
    await screen.findByText('https://example.com/sluby-hook');
    await userEvent.click(screen.getByRole('button', { name: 'Add webhook' }));
    const dialog = await screen.findByRole('dialog', { name: 'Add webhook' });
    await userEvent.type(within(dialog).getByLabelText('Endpoint URL'), 'https://kept.example/h');
    act(() => reportUnauthorized());
    first.unmount();
    render();
    const restored = await screen.findByRole('dialog', { name: 'Add webhook' });
    expect(within(restored).getByLabelText('Endpoint URL')).toHaveValue('https://kept.example/h');
    expect(await screen.findByText(RESTORED_DRAFT_MESSAGE)).toBeInTheDocument();
  });
});
