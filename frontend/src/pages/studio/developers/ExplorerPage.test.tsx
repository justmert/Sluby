import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { onUnauthorized } from '@/lib/session-events';
import { renderPage } from '@/test/render';
import ExplorerPage from './ExplorerPage';

type Answer = { status?: number; body?: unknown; headers?: Record<string, string> };
let answers: Record<string, () => Promise<Response> | Response>;
let fetchMock: ReturnType<typeof vi.fn>;

const respond = ({ status = 200, body = {}, headers = {} }: Answer = {}) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    statusText: status === 200 ? 'OK' : status === 204 ? 'No Content' : '',
    headers: { 'content-type': 'application/json', ...headers },
  });

beforeEach(() => {
  answers = {};
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${String(input)}`;
    const make = answers[key];
    if (!make) return respond({ status: 404, body: { error: `no answer for ${key}` } });
    const signal = init?.signal;
    return new Promise<Response>((resolve, reject) => {
      signal?.addEventListener('abort', () =>
        reject(new DOMException('The operation was aborted.', 'AbortError')),
      );
      void Promise.resolve(make()).then(resolve, reject);
    });
  });
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const render = () => renderPage(<ExplorerPage />);
const path = () => screen.getByLabelText('Path');
const response = () => screen.getByTestId('explorer-response');

async function pickTemplate(label: RegExp) {
  await userEvent.click(screen.getByRole('combobox', { name: 'Template' }));
  await userEvent.click(await screen.findByRole('option', { name: label }));
}

describe('API explorer', () => {
  it('puts the request and the response in named sections, each with its heading', () => {
    render();
    for (const name of ['Request', 'Response']) {
      const region = screen.getByRole('region', { name });
      expect(within(region).getByRole('heading', { level: 2, name })).toBeInTheDocument();
    }
    expect(screen.getByRole('region', { name: 'Response' })).toHaveTextContent(
      'Send a request to see the answer here.',
    );
  });

  it('sends with Enter in the path, and labels the answer with its request (A11Y-40)', async () => {
    answers['GET /api/v1/assets?limit=20'] = () =>
      respond({ body: { data: [] }, headers: { 'x-ratelimit-remaining': '99' } });
    render();
    expect(screen.getByRole('heading', { level: 1, name: 'API explorer' })).toBeInTheDocument();
    await userEvent.type(path(), '{Enter}');
    await screen.findByTestId('explorer-response');
    expect(response()).toHaveTextContent('GET /api/v1/assets?limit=20');
    expect(response()).toHaveTextContent('200');
    expect(response()).toHaveTextContent(/\d+ ms/);
    expect(response()).toHaveTextContent('x-ratelimit-remaining99');
  });

  it('shows a JSON answer as a tree, other text as it came, and says when there is no body', async () => {
    answers['GET /api/v1/assets?limit=20'] = () =>
      respond({ body: { data: [{ id: 'a1' }], has_more: false } });
    render();
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const tree = await within(await screen.findByTestId('explorer-response')).findByRole('tree', {
      name: 'Response body',
    });
    expect(within(tree).getByText('false')).toHaveClass('text-code-keyword');
    expect(within(tree).getByRole('treeitem', { name: 'data, 1 item' })).toBeInTheDocument();

    answers['GET /api/v1/assets?limit=20'] = () =>
      respond({ status: 502, body: '<h1>Bad gateway</h1>' });
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(response()).toHaveTextContent('Not valid JSON, shown as text.'));
    expect(
      within(response()).getByRole('region', { name: 'Response body code' }),
    ).toHaveTextContent('<h1>Bad gateway</h1>');

    answers['GET /api/v1/assets?limit=20'] = () => respond({ body: '' });
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(response()).toHaveTextContent('The response has no body.'));
  });

  it('says the status of the answer in a status region, since focus stays on Send', async () => {
    answers['GET /api/v1/assets?limit=20'] = () => respond({ body: { data: [] } });
    render();
    const region = screen.getByRole('status', { name: '' });
    expect(region).toBeEmptyDOMElement();
    await userEvent.type(path(), '{Enter}');
    await screen.findByTestId('explorer-response');
    expect(region).toHaveTextContent(/^Answer: 200 OK in \d+ ms$/);
  });

  it('never shows a late answer under a newer request (FLW-18)', async () => {
    let slow!: (r: Response) => void;
    answers['GET /api/v1/assets?limit=20'] = () => new Promise((r) => (slow = r));
    answers['GET /api/v1/webhooks'] = () => respond({ body: { data: ['hooks'] } });
    render();
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(screen.getByRole('button', { name: 'Sending…' })).toBeDisabled();
    await pickTemplate(/List webhooks/);
    // switching aborted the first request
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await waitFor(() => expect(response()).toHaveTextContent('GET /api/v1/webhooks'));
    await act(async () => slow(respond({ body: { sia: true } })));
    expect(response()).toHaveTextContent('"hooks"');
    expect(response()).not.toHaveTextContent('"sia"');
  });

  it('asks before a DELETE, and refreshes the lists it may have changed (FLW-18)', async () => {
    answers['DELETE /api/v1/webhooks/w1'] = () => respond({ body: { success: true } });
    const { client } = render();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await userEvent.clear(path());
    await userEvent.type(path(), '/api/v1/webhooks/w1');
    await userEvent.click(screen.getByRole('combobox', { name: 'Method' }));
    await userEvent.click(await screen.findByRole('option', { name: 'DELETE' }));
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const ask = await screen.findByRole('alert');
    expect(ask).toHaveTextContent(
      'This changes real data on this server. Send DELETE /api/v1/webhooks/w1?',
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(within(ask).getByRole('button', { name: 'Send' })).toHaveFocus();
    await userEvent.click(within(ask).getByRole('button', { name: 'Send' }));
    await screen.findByTestId('explorer-response');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    for (const key of [['webhooks'], ['assets'], ['api-keys'], ['stats']]) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: key });
    }
  });

  it('asks before writing to a video, and Cancel sends nothing', async () => {
    render();
    await pickTemplate(/Update asset/);
    await userEvent.clear(path());
    await userEvent.type(path(), '/api/v1/assets/a1');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const ask = await screen.findByRole('alert');
    await userEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends a GET without asking and refreshes nothing', async () => {
    answers['GET /api/v1/keys'] = () => respond({ body: { data: [] } });
    const { client } = render();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    await pickTemplate(/List API keys/);
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByTestId('explorer-response');
    expect(invalidate).not.toHaveBeenCalled();
  });

  it('says how to fix a path it will not send, and starts the template over on edits (FLW-54)', async () => {
    render();
    await pickTemplate(/Get asset/);
    expect(screen.getByRole('combobox', { name: 'Template' })).toHaveTextContent('Get asset');
    expect(path()).toHaveAccessibleDescription('Replace {id} with a real ID first.');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.clear(path());
    await userEvent.type(path(), 'api/v1/assets');
    expect(path()).toHaveAccessibleDescription(
      'Start the path with /, for example /api/v1/assets.',
    );
    expect(screen.getByRole('combobox', { name: 'Template' })).toHaveTextContent(
      'Start from a template',
    );
    await userEvent.clear(path());
    await userEvent.type(path(), '//evil.example/x');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('says a body is not json before sending anything', async () => {
    render();
    await userEvent.click(screen.getByRole('combobox', { name: 'Method' }));
    await userEvent.click(await screen.findByRole('option', { name: 'PATCH' }));
    const body = screen.getByLabelText('JSON body');
    await userEvent.type(body, '{{title: "oops"');
    expect(body).toHaveAccessibleDescription('This is not valid JSON.');
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
    await userEvent.clear(body);
    await userEvent.type(body, '{{"title": "fine"}');
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('gives up after 30 seconds and says so (FLW-18)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    answers['GET /api/v1/assets?limit=20'] = () => new Promise(() => {});
    render();
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await act(async () => vi.advanceTimersByTime(30_000));
    expect(
      await screen.findByText('No answer to GET /api/v1/assets?limit=20 after 30 seconds'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled();
  });

  it('does not leave an earlier answer under a request that failed', async () => {
    let calls = 0;
    answers['GET /api/v1/assets?limit=20'] = () =>
      ++calls === 1
        ? respond({ status: 200, body: { data: [] } })
        : Promise.reject(new TypeError('Failed to fetch'));
    render();
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByTestId('explorer-response');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not send GET');
    expect(screen.queryByTestId('explorer-response')).not.toBeInTheDocument();
  });

  it('hands a 401 to the sign-in gate (FLW-18)', async () => {
    const signedOut = vi.fn();
    const off = onUnauthorized(signedOut);
    answers['GET /api/v1/assets?limit=20'] = () =>
      respond({ status: 401, body: { error: 'Not signed in' } });
    render();
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByTestId('explorer-response');
    expect(signedOut).toHaveBeenCalledTimes(1);
    off();
  });

  it('says what failed when nothing came back', async () => {
    answers['GET /api/v1/assets?limit=20'] = () => Promise.reject(new TypeError('Failed to fetch'));
    render();
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not send GET /api/v1/assets?limit=20');
    expect(alert).toHaveTextContent('Could not reach the server');
  });

  it('keeps the last answer, marked busy, while a new request runs', async () => {
    let second!: (r: Response) => void;
    let n = 0;
    answers['GET /api/v1/assets?limit=20'] = () =>
      ++n === 1 ? respond({ body: { first: true } }) : new Promise((r) => (second = r));
    render();
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    await screen.findByTestId('explorer-response');
    await userEvent.click(screen.getByRole('button', { name: 'Send' }));
    expect(response()).toHaveClass('opacity-60');
    expect(response()).toHaveTextContent('"first"');
    await act(async () => second(respond({ body: { second: true } })));
    await waitFor(() => expect(response()).toHaveTextContent('"second"'));
  });

  it('stacks method over path and lets the template shrink when large text leaves no room (1.4.4)', () => {
    render();
    expect(screen.getByRole('combobox', { name: 'Template' })).toHaveClass('min-w-0');
    const row = path().closest('.items-end');
    expect(row).toHaveClass('grid-cols-1', '@[16rem]/page:grid-cols-[7rem_minmax(0,1fr)]');
    expect(screen.getByRole('button', { name: 'Send' })).not.toHaveClass('col-span-2');
  });
});
