import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/render';
import DeveloperPage from './DeveloperPage';

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
