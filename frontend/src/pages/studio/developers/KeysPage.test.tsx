import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RESTORED_DRAFT_MESSAGE } from '@/lib/drafts';
import { reportUnauthorized } from '@/lib/session-events';
import { jsonFetch, renderPage, reply, type RecordedCall } from '@/test/render';
import { WithSession, testSession } from '@/test/session';
import KeysPage from './KeysPage';

type Key = Record<string, unknown>;

const key = (over: Key = {}): Key => ({
  id: 'k1',
  name: 'Production web app',
  scopes: ['upload', 'read'],
  rate_limit: 100,
  is_active: true,
  created_at: '2026-10-01T00:00:00Z',
  expires_at: null,
  prefix: 'sluby_AbC123',
  last_used_at: new Date(Date.now() - 3 * 60_000).toISOString(),
  created_by: { id: 'u1', name: 'Ada' },
  ...over,
});

let keys: Key[];
let limits: { max_keys: number; max_rate_limit: number } | undefined;
let routes: Record<string, unknown>;
let fetchStub: ReturnType<typeof jsonFetch>;

const issued = (body: Record<string, unknown>, over: Key = {}) => ({
  ...key({ id: 'k9', prefix: 'sluby_NewKey', last_used_at: null, ...body }),
  key: 'sluby_NewKeySecretValue',
  ...over,
});

beforeEach(() => {
  keys = [key()];
  limits = { max_keys: 20, max_rate_limit: 10_000 };
  routes = {
    '/api/v1/keys': () => ({ data: keys, has_more: false, next_cursor: null, limits }),
    'POST /api/v1/keys': ({ body }: RecordedCall) => {
      const made = issued(body as Record<string, unknown>);
      keys = [{ ...made, key: undefined }, ...keys];
      return reply(201, made);
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

const render = (route = '/studio/developers/keys') =>
  renderPage(
    <WithSession>
      <KeysPage />
    </WithSession>,
    { route },
  );

const calls = (method: string, path: string) =>
  fetchStub.calls.filter((c) => c.method === method && c.path === path);

// hidden: an open dialog hides the page from the accessibility tree
const table = () => screen.getByRole('table', { name: 'API keys', hidden: true });
const rowOf = (text: string) => screen.getByText(text).closest('tr')!;

async function openMenu(rowText: string) {
  const row = rowOf(rowText);
  await userEvent.click(within(row).getByRole('button', { name: /^Actions for/ }));
  return screen.findByRole('menu');
}

describe('API keys page', () => {
  it('lists name, key prefix, what it can do, last use and status, and how many keys of the limit', async () => {
    keys = [
      key(),
      key({
        id: 'k2',
        name: 'CI uploader',
        scopes: ['upload'],
        prefix: null,
        last_used_at: null,
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    ];
    render();
    expect(screen.getByRole('heading', { level: 1, name: 'API keys' })).toBeInTheDocument();
    expect(
      await screen.findByText('Keys let your server call the API. 2 of 20 used.'),
    ).toBeInTheDocument();
    await screen.findByText('Production web app');
    const prod = rowOf('Production web app');
    expect(within(prod).getByText('sluby_AbC123…')).toBeInTheDocument();
    expect(within(prod).getByText('3 minutes ago')).toBeInTheDocument();
    expect(within(prod).getByText('Active')).toBeInTheDocument();
    // the Can column reads the scopes as words, in the order read, upload, manage
    expect(screen.getByRole('columnheader', { name: 'Can' })).toBeInTheDocument();
    expect(Array.from(prod.querySelectorAll('td span[title]')).map((c) => c.textContent)).toEqual([
      'Read',
      'Upload',
    ]);
    const ci = rowOf('CI uploader');
    expect(within(ci).getByText('Never')).toBeInTheDocument();
    expect(
      within(ci).getByLabelText(/Created before key prefixes were recorded/),
    ).toBeInTheDocument();
    expect(within(ci).getByText('Replaced · stops in 1 hour')).toBeInTheDocument();
    expect(ci).toHaveClass('text-muted-foreground');
  });

  it('names the table and lets long names wrap (A11Y-36, A11Y-30)', async () => {
    keys = [key({ name: 'a'.repeat(90) })];
    render();
    await screen.findByText('a'.repeat(90));
    expect(table()).toBeInTheDocument();
    expect(screen.getByText('a'.repeat(90))).toHaveClass('wrap-anywhere');
    expect(screen.getByText('a'.repeat(90))).toHaveAttribute('dir', 'auto');
  });

  it('offers Create key in the empty state (CPY-20, FLW-57)', async () => {
    keys = [];
    render();
    expect(await screen.findByText('No API keys yet')).toBeInTheDocument();
    expect(
      screen.getByText('Create a key to use the API or SDK from your server.'),
    ).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'Create key' });
    await userEvent.click(buttons[buttons.length - 1]);
    expect(await screen.findByRole('dialog', { name: 'Create API key' })).toBeInTheDocument();
  });

  it('says what failed and offers Try again when the keys do not load (CPY-19)', async () => {
    routes['/api/v1/keys'] = reply(502, { error: 'Bad Gateway' });
    render();
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not load your API keys');
    expect(alert).toHaveTextContent('The server ran into a problem (error 502)');
    routes['/api/v1/keys'] = () => ({ data: keys, has_more: false, next_cursor: null, limits });
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Production web app')).toBeInTheDocument();
  });
});

describe('creating a key', () => {
  it('adds the row only once the server made the key, and shows the key once (MOT-17)', async () => {
    let answer!: (v: unknown) => void;
    routes['POST /api/v1/keys'] = () => new Promise((r) => (answer = r));
    const { client } = render();
    await screen.findByText('Production web app');
    await userEvent.click(screen.getByRole('button', { name: 'Create key' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create API key' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Staging');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));
    expect(within(dialog).getByRole('button', { name: 'Creating…' })).toBeDisabled();
    // nothing in the table while the server works
    expect(within(table()).queryByText('Staging')).not.toBeInTheDocument();
    expect(within(table()).getAllByRole('row', { hidden: true })).toHaveLength(2);
    const made = issued({ name: 'Staging', scopes: ['upload', 'read'], rate_limit: 100 });
    keys = [{ ...made, key: undefined }, ...keys];
    await act(async () => answer(reply(201, made)));

    const notice = await screen.findByRole('status', { name: 'Key “Staging” created' });
    expect(notice).toHaveTextContent('Copy it now. It is shown only once.');
    // masked until asked for, and the copy takes the keyboard
    expect(within(notice).getByText('sluby_NewK…alue')).toBeInTheDocument();
    expect(within(notice).getByRole('button', { name: 'Copy key' })).toHaveFocus();
    await userEvent.click(within(notice).getByRole('button', { name: 'Show' }));
    expect(within(notice).getByText('sluby_NewKeySecretValue')).toBeInTheDocument();
    expect(await within(table()).findByText('Staging')).toBeInTheDocument();
    expect(calls('POST', '/api/v1/keys')[0].body).toEqual({
      name: 'Staging',
      scopes: ['upload', 'read'],
      rate_limit: 100,
    });
    // the secret is in no cache
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
    expect(cached).not.toContain('sluby_NewKeySecretValue');
  });

  it('a refused key never shows up in the list (MOT-17)', async () => {
    routes['POST /api/v1/keys'] = reply(500, { error: 'Internal Server Error' });
    render();
    await screen.findByText('Production web app');
    await userEvent.click(screen.getByRole('button', { name: 'Create key' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create API key' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Ghost');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));
    expect(await within(dialog).findByText('Could not create the key')).toBeInTheDocument();
    expect(screen.queryByText('Ghost', { selector: 'table *' })).not.toBeInTheDocument();
    // what was typed stays
    expect(within(dialog).getByLabelText('Name')).toHaveValue('Ghost');
  });

  it('checks the form against the server limits before sending (FLW-49, CPY-28)', async () => {
    render();
    await screen.findByText('Production web app');
    await userEvent.click(screen.getByRole('button', { name: 'Create key' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create API key' });
    expect(within(dialog).getByText('Requests per minute, up to 10,000.')).toBeInTheDocument();
    const rate = within(dialog).getByLabelText('Rate limit');
    expect(rate).toHaveAttribute('max', '10000');
    await userEvent.clear(rate);
    await userEvent.type(rate, '20000');
    for (const s of ['upload', 'read']) await userEvent.click(within(dialog).getByLabelText(s));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));
    expect(within(dialog).getByText('Enter a name.')).toBeInTheDocument();
    expect(within(dialog).getByText('Choose at least one scope.')).toBeInTheDocument();
    expect(within(dialog).getByText('Use at most 10,000 requests per minute.')).toBeInTheDocument();
    expect(within(dialog).getByLabelText('Name')).toHaveFocus();
    expect(calls('POST', '/api/v1/keys')).toHaveLength(0);
  });

  it('puts the server’s field errors next to their fields', async () => {
    routes['POST /api/v1/keys'] = reply(400, {
      error: 'name: name must not contain control characters',
      details: [{ field: 'name', message: 'name must not contain control characters' }],
    });
    render();
    await screen.findByText('Production web app');
    await userEvent.click(screen.getByRole('button', { name: 'Create key' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create API key' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Odd');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));
    const name = within(dialog).getByLabelText('Name');
    await waitFor(() => expect(name).toHaveAttribute('aria-invalid', 'true'));
    expect(
      within(dialog).getByText('Name must not contain control characters.'),
    ).toBeInTheDocument();
    expect(within(dialog).queryByText('Could not create the key')).not.toBeInTheDocument();
  });

  it('disables Create key at the cap and says why (FLW-49)', async () => {
    limits = { max_keys: 1, max_rate_limit: 10_000 };
    render();
    await screen.findByText('Production web app');
    const create = screen.getByRole('button', { name: 'Create key' });
    expect(create).toHaveAttribute('aria-disabled', 'true');
    expect(create).toHaveAccessibleDescription(
      'You have 1 keys, the most allowed. Revoke one to create another.',
    );
    await userEvent.click(create);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows the cap refusal in the server’s words', async () => {
    routes['POST /api/v1/keys'] = reply(409, {
      error:
        'This account already has 20 API keys, the most allowed. Revoke one you no longer use, then try again.',
    });
    render();
    await screen.findByText('Production web app');
    await userEvent.click(screen.getByRole('button', { name: 'Create key' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create API key' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'One more');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));
    expect(
      (await within(dialog).findAllByText(/Revoke one you no longer use, then try again/))[0],
    ).toBeInTheDocument();
  });

  it('focuses the name, and gives focus back to Create key on close (A11Y-03)', async () => {
    render();
    await screen.findByText('Production web app');
    const create = screen.getByRole('button', { name: 'Create key' });
    await userEvent.click(create);
    const dialog = await screen.findByRole('dialog', { name: 'Create API key' });
    expect(within(dialog).getByLabelText('Name')).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(create).toHaveFocus();
  });

  it('opens from ?create=key and drops the param on close', async () => {
    render('/studio/developers/keys?create=key');
    const dialog = await screen.findByRole('dialog', { name: 'Create API key' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await screen.findByText('Production web app');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps what was typed when the session ends, and restores it after sign-in (FLW-15)', async () => {
    const first = render();
    await screen.findByText('Production web app');
    await userEvent.click(screen.getByRole('button', { name: 'Create key' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create API key' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Half typed');
    act(() => reportUnauthorized());
    first.unmount();

    render();
    const restored = await screen.findByRole('dialog', { name: 'Create API key' });
    expect(within(restored).getByLabelText('Name')).toHaveValue('Half typed');
    expect(await screen.findByText(RESTORED_DRAFT_MESSAGE)).toBeInTheDocument();
    expect(testSession.id).toBeTruthy();
  });
});

describe('the new key notice', () => {
  async function createStaging() {
    render();
    await screen.findByText('Production web app');
    await userEvent.click(screen.getByRole('button', { name: 'Create key' }));
    const dialog = await screen.findByRole('dialog', { name: 'Create API key' });
    await userEvent.type(within(dialog).getByLabelText('Name'), 'Staging');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create key' }));
    return screen.findByRole('status', { name: 'Key “Staging” created' });
  }

  it('asks before closing an uncopied key, and closes at once once it was copied (FLW-50)', async () => {
    const notice = await createStaging();
    await userEvent.click(within(notice).getByRole('button', { name: 'Close without copying' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Close without copying?' });
    await userEvent.click(within(ask).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.getByRole('status', { name: 'Key “Staging” created' })).toBeInTheDocument();

    await userEvent.click(within(notice).getByRole('button', { name: 'Copy key' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('sluby_NewKeySecretValue');
    expect(notice).toHaveTextContent('Copied. Store it on your server.');
    await userEvent.click(within(notice).getByRole('button', { name: 'Done' }));
    await waitFor(() =>
      expect(
        screen.queryByRole('status', { name: 'Key “Staging” created' }),
      ).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Create key' })[0]).toHaveFocus(),
    );
  });

  it('holds a link out of the page while the key is not copied', async () => {
    await createStaging();
    const link = document.createElement('a');
    link.href = '/studio/videos';
    link.textContent = 'Videos';
    document.body.append(link);
    try {
      await userEvent.click(link);
      expect(
        await screen.findByRole('alertdialog', { name: 'Leave without the key?' }),
      ).toBeInTheDocument();
    } finally {
      link.remove();
    }
  });
});

describe('renaming, rotating and revoking', () => {
  it('renames a key in place', async () => {
    routes['PATCH /api/v1/keys/k1'] = ({ body }: RecordedCall) => {
      keys = [key({ name: (body as { name: string }).name })];
      return keys[0];
    };
    render();
    await screen.findByText('Production web app');
    await userEvent.click(screen.getByRole('button', { name: 'Edit name of Production web app' }));
    const input = screen.getByRole('textbox', { name: 'Edit name of Production web app' });
    await userEvent.clear(input);
    await userEvent.type(input, 'Web app{Enter}');
    expect(await screen.findByText('Key renamed')).toBeInTheDocument();
    expect(calls('PATCH', '/api/v1/keys/k1')[0].body).toEqual({ name: 'Web app' });
    expect(await screen.findByText('Web app')).toBeInTheDocument();
  });

  it('opens the name editor from the row menu', async () => {
    render();
    await screen.findByText('Production web app');
    const menu = await openMenu('Production web app');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Rename' }));
    expect(
      await screen.findByRole('textbox', { name: 'Edit name of Production web app' }),
    ).toBeInTheDocument();
  });

  it('rotates with a grace period and says when the old key stops', async () => {
    const until = new Date(Date.now() + 86_400_000).toISOString();
    routes['POST /api/v1/keys/k1/rotate'] = () =>
      reply(
        201,
        issued(
          { id: 'k3', name: 'Production web app' },
          { rotated_from: 'k1', previous_key_expires_at: until, key: 'sluby_Rotated' },
        ),
      );
    render();
    await screen.findByText('Production web app');
    const menu = await openMenu('Production web app');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Rotate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rotate “Production web app”?' });
    expect(dialog).toHaveTextContent(
      'You get a new key with the same name and permissions. The old one keeps working while your servers switch.',
    );
    expect(dialog).toHaveTextContent('This is “Production web app” (sluby_AbC123…).');
    expect(within(dialog).getByRole('group', { name: 'Old key keeps working for' })).toBeVisible();
    await userEvent.click(within(dialog).getByRole('radio', { name: '1 day' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rotate key' }));
    const secret = await screen.findByRole('status', { name: 'Key “Production web app” rotated' });
    expect(secret).toHaveTextContent(/The old key keeps working until .* at /);
    expect(calls('POST', '/api/v1/keys/k1/rotate')[0].body).toEqual({
      grace_period_seconds: 86400,
    });
  });

  it('keeps the old key working for 1 hour unless told otherwise, as the dialog says (QF-06)', async () => {
    const until = new Date(Date.now() + 3_600_000).toISOString();
    routes['POST /api/v1/keys/k1/rotate'] = () =>
      reply(
        201,
        issued(
          { id: 'k3', name: 'Production web app' },
          { rotated_from: 'k1', previous_key_expires_at: until, key: 'sluby_Rotated' },
        ),
      );
    render();
    await screen.findByText('Production web app');
    const menu = await openMenu('Production web app');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Rotate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rotate “Production web app”?' });
    expect(within(dialog).getByRole('radio', { name: '1 hour' })).toBeChecked();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rotate key' }));
    const secret = await screen.findByRole('status', { name: 'Key “Production web app” rotated' });
    expect(secret).toHaveTextContent(/The old key keeps working until .* at /);
    expect(calls('POST', '/api/v1/keys/k1/rotate')[0].body).toEqual({
      grace_period_seconds: 3600,
    });
  });

  it('stops the old key at once only when that is chosen', async () => {
    routes['POST /api/v1/keys/k1/rotate'] = () =>
      reply(
        201,
        issued(
          { id: 'k3', name: 'Production web app' },
          { rotated_from: 'k1', previous_key_expires_at: null, key: 'sluby_Rotated' },
        ),
      );
    render();
    await screen.findByText('Production web app');
    const menu = await openMenu('Production web app');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Rotate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rotate “Production web app”?' });
    await userEvent.click(within(dialog).getByRole('radio', { name: 'Stop now' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rotate key' }));
    expect(
      await screen.findByRole('status', { name: 'Key “Production web app” rotated' }),
    ).toHaveTextContent('The old key stopped working.');
    expect(calls('POST', '/api/v1/keys/k1/rotate')[0].body).toEqual({
      grace_period_seconds: 0,
    });
  });

  it('closes the rotate dialog and says so when the key is gone', async () => {
    routes['POST /api/v1/keys/k1/rotate'] = reply(404, { error: 'API key not found' });
    render();
    await screen.findByText('Production web app');
    const menu = await openMenu('Production web app');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Rotate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rotate “Production web app”?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rotate key' }));
    expect(
      await screen.findByText('“Production web app” no longer exists. The list is up to date now'),
    ).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('keeps the rotate dialog open with the reason when the server fails', async () => {
    routes['POST /api/v1/keys/k1/rotate'] = reply(500, { error: 'boom' });
    render();
    await screen.findByText('Production web app');
    const menu = await openMenu('Production web app');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Rotate' }));
    const dialog = await screen.findByRole('dialog', { name: 'Rotate “Production web app”?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Rotate key' }));
    expect(await within(dialog).findByText('Could not rotate the key')).toBeInTheDocument();
  });

  it('names which key a revoke means, and says a replaced key stops on its own (FLW-28)', async () => {
    keys = [
      key({ id: 'k3', prefix: 'sluby_New111' }),
      key({
        id: 'k1',
        prefix: 'sluby_Old000',
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    ];
    routes['DELETE /api/v1/keys/k1'] = () => {
      keys = keys.filter((k) => k.id !== 'k1');
      return { success: true };
    };
    render();
    await screen.findByText('sluby_Old000…');
    const menu = await openMenu('sluby_Old000…');
    expect(within(menu).queryByRole('menuitem', { name: 'Rotate' })).not.toBeInTheDocument();
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Revoke' }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Revoke this key?' });
    expect(dialog).toHaveTextContent(
      '“Production web app” (sluby_Old000…) stops working right away. This cannot be undone. It is the old key from a rotation and stops on its own in 1 hour.',
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('“Production web app” revoked')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('sluby_Old000…')).not.toBeInTheDocument());
    expect(screen.getByText('sluby_New111…')).toBeInTheDocument();
  });

  it('keeps a key whose revoke failed, with the reason in the dialog', async () => {
    routes['DELETE /api/v1/keys/k1'] = reply(500, { error: 'nope' });
    render();
    await screen.findByText('Production web app');
    const menu = await openMenu('Production web app');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Revoke' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    expect(await within(dialog).findByText('Could not revoke the key')).toBeInTheDocument();
    expect(rowOf('Production web app')).toBeInTheDocument();
  });

  it('moves focus to the next row’s menu after a revoke, or to Create key (A11Y-03)', async () => {
    keys = [key(), key({ id: 'k2', name: 'Second', prefix: 'sluby_Second' })];
    routes['DELETE /api/v1/keys/k1'] = () => {
      keys = keys.filter((k) => k.id !== 'k1');
      return { success: true };
    };
    routes['DELETE /api/v1/keys/k2'] = () => {
      keys = keys.filter((k) => k.id !== 'k2');
      return { success: true };
    };
    render();
    await screen.findByText('Second');
    let menu = await openMenu('Production web app');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Revoke' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Revoke' }),
    );
    await waitFor(() =>
      expect(
        screen.getByRole('button', { name: 'Actions for Second, sluby_Second…' }),
      ).toHaveFocus(),
    );
    menu = await openMenu('Second');
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Revoke' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Revoke' }),
    );
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: 'Create key' })[0]).toHaveFocus(),
    );
  });
});
