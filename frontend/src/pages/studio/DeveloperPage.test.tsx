import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderPage } from '@/test/render';
import DeveloperPage from './DeveloperPage';

let fetchMock: ReturnType<typeof vi.fn>;
const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

beforeEach(() => {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    if (url === '/api/v1/webhooks' && method === 'GET') return json({ data: [] });
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
