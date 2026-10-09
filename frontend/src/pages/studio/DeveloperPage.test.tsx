import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/render';
import { ApiExplorer, Snippets, Webhooks } from './DeveloperPage';

// the sections the quickstart, webhooks and explorer pages are made of, together
function DeveloperPage() {
  return (
    <>
      <Snippets />
      <Webhooks />
      <ApiExplorer />
    </>
  );
}

let fetchMock: ReturnType<typeof vi.fn>;
let hooks: Array<Record<string, unknown>>;
let testResult: Record<string, unknown>;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

beforeEach(() => {
  hooks = [];
  testResult = { delivered: true, status_code: 204, error: null };
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/v1/webhooks' && method === 'GET') return json({ data: hooks });
    if (url === '/api/v1/webhooks/w1/test' && method === 'POST') return json(testResult);
    if (url === '/api/v1/webhooks/w1/deliveries?limit=20') {
      return json({
        data: [
          {
            id: 'd2',
            event_id: 'evt_2',
            event: 'asset.ready',
            status_code: 500,
            delivered: false,
            error: 'the receiver answered 500',
            attempt: 2,
            created_at: new Date().toISOString(),
          },
          {
            id: 'd1',
            event_id: 'evt_1',
            event: 'webhook.test',
            status_code: 204,
            delivered: true,
            error: null,
            attempt: 1,
            created_at: new Date().toISOString(),
          },
        ],
      });
    }
    if (url === '/api/v1/webhooks' && method === 'POST') {
      return json({ id: 'w1', secret: 'a'.repeat(64), ...JSON.parse(String(init!.body)) }, 201);
    }
    if (url.startsWith('/api/v1/assets')) {
      return json({ data: [], total: 0 }, 200, { 'x-ratelimit-remaining': '999' });
    }
    return json({ error: 'unmocked' }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe('DeveloperPage', () => {
  it('shows JavaScript and curl for each task, pointed at this origin', async () => {
    renderPage(<DeveloperPage />);
    await userEvent.click(screen.getByRole('button', { name: 'Search the library' }));
    expect(screen.getByText(/sluby\.assets\.list\(\{/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('tab', { name: 'curl' }));
    expect(
      screen.getByText(new RegExp(`${window.location.origin}/api/v1/assets\\?search=keynote`)),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Copy Search the library curl' }),
    ).toBeInTheDocument();
  });

  it('adds a webhook and shows its secret once', async () => {
    renderPage(<DeveloperPage />);
    await userEvent.click(await screen.findByRole('button', { name: /add webhook/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Endpoint URL'), 'https://example.com/hook');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add webhook' }));

    expect(await screen.findByTestId('webhook-secret')).toHaveTextContent('a'.repeat(64));
    const post = fetchMock.mock.calls.find(([, i]) => (i as RequestInit)?.method === 'POST')!;
    expect(JSON.parse(String((post[1] as RequestInit).body))).toEqual({
      url: 'https://example.com/hook',
      events: ['asset.ready', 'asset.errored'],
    });
  });

  it('sends explorer requests with the session and shows status and rate limit', async () => {
    renderPage(<DeveloperPage />);
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(await screen.findByText('200')).toBeInTheDocument();
    expect(screen.getByText('x-ratelimit-remaining: 999')).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls.find(([u]) => String(u).startsWith('/api/v1/assets'))!;
    expect(url).toBe('/api/v1/assets?limit=20');
    expect(new Headers((init as RequestInit).headers).get('Authorization')).toBeNull();
  });

  it('sends exactly the path shown, also outside /api', async () => {
    fetchMock.mockImplementation(async () => json({ entries: 0 }));
    renderPage(<DeveloperPage />);
    const path = screen.getByRole('textbox', { name: 'Path' });
    await userEvent.clear(path);
    await userEvent.type(path, '/health');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(await screen.findByText('200')).toBeInTheDocument();
    expect(fetchMock.mock.calls.map(([u]) => String(u))).toContain('/health');
  });

  it('will not send to another origin', async () => {
    renderPage(<DeveloperPage />);
    const path = screen.getByRole('textbox', { name: 'Path' });
    await userEvent.clear(path);
    await userEvent.type(path, '//example.com/api/v1/assets');
    expect(screen.getByRole('button', { name: /send/i })).toBeDisabled();
  });

  it('will not send a template until its id is filled in', async () => {
    renderPage(<DeveloperPage />);
    const path = screen.getByRole('textbox', { name: 'Path' });
    await userEvent.clear(path);
    await userEvent.type(path, '/api/v1/assets/{{id}');
    await waitFor(() => expect(screen.getByRole('button', { name: /send/i })).toBeDisabled());
  });
});

const hook = {
  id: 'w1',
  url: 'https://example.com/a/very/long/receiver/path?token=abc',
  events: ['asset.ready'],
  is_active: true,
  created_at: new Date().toISOString(),
};

describe('DeveloperPage webhooks', () => {
  it('drops the signing secret from the mutation cache once it is shown', async () => {
    const { client } = renderPage(<DeveloperPage />);
    await userEvent.click(await screen.findByRole('button', { name: /add webhook/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Endpoint URL'), 'https://example.com/hook');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add webhook' }));
    await screen.findByTestId('webhook-secret');

    const cached = JSON.stringify(
      client
        .getMutationCache()
        .getAll()
        .map((m) => m.state.data),
    );
    expect(cached).not.toContain('a'.repeat(64));
  });

  it('shows the whole receiver url and sends a test event', async () => {
    hooks = [hook];
    renderPage(<DeveloperPage />);
    expect(await screen.findByText(hook.url)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send test' }));
    expect(
      await screen.findByText('Test delivered: the receiver answered 204'),
    ).toBeInTheDocument();
  });

  it('reports a test the receiver refused', async () => {
    hooks = [hook];
    testResult = { delivered: false, status_code: 500, error: 'the receiver answered 500' };
    renderPage(<DeveloperPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Send test' }));
    expect(
      await screen.findByText('Test not delivered: the receiver answered 500'),
    ).toBeInTheDocument();
  });

  it('lists recent deliveries with their status', async () => {
    hooks = [{ ...hook, is_active: false }];
    renderPage(<DeveloperPage />);
    expect(await screen.findByText('Inactive')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Deliveries' }));
    const list = await screen.findByRole('list', { name: 'Recent deliveries' });
    expect(within(list).getByText('webhook.test')).toBeInTheDocument();
    expect(within(list).getByText('the receiver answered 500')).toBeInTheDocument();
    expect(within(list).getByText('attempt 2')).toBeInTheDocument();
  });
});

function holdDialogExits() {
  const style = document.createElement('style');
  style.textContent =
    '[role=dialog][data-state=closed],[role=alertdialog][data-state=closed]{animation-name:exit}';
  document.head.append(style);
  return () => style.remove();
}

describe('DeveloperPage polish', () => {
  it('keeps the signing secret on screen while its dialog closes', async () => {
    const release = holdDialogExits();
    try {
      renderPage(<DeveloperPage />);
      await userEvent.click(await screen.findByRole('button', { name: /add webhook/i }));
      const form = await screen.findByRole('dialog');
      await userEvent.type(within(form).getByLabelText('Endpoint URL'), 'https://example.com/h');
      await userEvent.click(within(form).getByRole('button', { name: 'Add webhook' }));
      const secret = await screen.findByTestId('webhook-secret');
      const dialog = secret.closest('[role=dialog]') as HTMLElement;
      await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
      expect(dialog).toHaveAttribute('data-state', 'closed');
      expect(secret).toHaveTextContent('a'.repeat(64));
    } finally {
      release();
    }
  });

  it('offers a snippet picker that fits a phone', async () => {
    renderPage(<DeveloperPage />);
    const picker = screen.getByRole('combobox', { name: 'Snippet' });
    await userEvent.click(picker);
    await userEvent.click(await screen.findByRole('option', { name: 'Search the library' }));
    expect(screen.getByText(/sluby\.assets\.list\(\{/)).toBeInTheDocument();
  });

  it('checks the endpoint url inline before sending', async () => {
    renderPage(<DeveloperPage />);
    await userEvent.click(await screen.findByRole('button', { name: /add webhook/i }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Endpoint URL'), 'ftp://example.com/x');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add webhook' }));
    expect(within(dialog).getByText(/must start with https:\/\/ or http:\/\//)).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([, i]) => (i as RequestInit)?.method === 'POST'),
    ).toHaveLength(0);
  });

  it('removes a webhook at once and restores it when the server refuses', async () => {
    hooks = [hook];
    let answer!: (r: Response) => void;
    const base = fetchMock.getMockImplementation() as typeof fetch;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === '/api/v1/webhooks/w1' && init?.method === 'DELETE') {
        return new Promise<Response>((r) => (answer = r));
      }
      return base(input, init);
    });
    renderPage(<DeveloperPage />);
    await screen.findByText(hook.url);
    await userEvent.click(screen.getByRole('button', { name: `Remove webhook ${hook.url}` }));
    const confirm = await screen.findByRole('alertdialog');
    expect(within(confirm).getByText(hook.url)).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(screen.queryByText(hook.url)).not.toBeInTheDocument());

    answer(json({ error: 'database is down' }, 500));
    expect(await screen.findByText(hook.url)).toBeInTheDocument();
    expect(
      await screen.findByText(/Could not remove the webhook: database is down/),
    ).toBeInTheDocument();
  });

  it('opens the delivery log after a test send and shows the new delivery', async () => {
    hooks = [hook];
    renderPage(<DeveloperPage />);
    await userEvent.click(await screen.findByRole('button', { name: 'Send test' }));
    const list = await screen.findByRole('list', { name: 'Recent deliveries' });
    expect(within(list).getByText('webhook.test')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Deliveries' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
  });

  it('keeps the last response, marked busy, while a new request runs', async () => {
    let answer!: (r: Response) => void;
    let first = true;
    const base = fetchMock.getMockImplementation() as typeof fetch;
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).startsWith('/api/v1/assets')) return base(input, init);
      if (first) {
        first = false;
        return json({ ok: 1 });
      }
      return new Promise<Response>((r) => (answer = r));
    });
    renderPage(<DeveloperPage />);
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    const response = await screen.findByTestId('explorer-response');
    await userEvent.click(screen.getByRole('button', { name: /send/i }));
    expect(screen.getByRole('button', { name: /sending/i })).toBeDisabled();
    expect(response).toHaveAttribute('aria-busy', 'true');
    answer(json({ ok: 2 }));
    await waitFor(() =>
      expect(screen.getByTestId('explorer-response')).not.toHaveAttribute('aria-busy'),
    );
    expect(screen.getByTestId('explorer-response')).toHaveTextContent('"ok": 2');
  });
});
