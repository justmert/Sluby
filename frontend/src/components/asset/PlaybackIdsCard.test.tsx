import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { jsonFetch, renderPage, reply, type RecordedCall } from '@/test/render';
import { checkValue, findOperation, requestSchema, responseSchema } from '@/test/openapi';
import { PlaybackIdsCard } from './PlaybackIdsCard';

const row = (playbackId: string, policy = 'public', name: string | null = null) => ({
  id: `00000000-0000-4000-8000-${playbackId.slice(-12).padStart(12, '0')}`,
  playback_id: playbackId,
  policy,
  name,
  created_at: '2026-10-01T00:00:00Z',
});

const PB_A = 'pb_aaaaaaaaaaaaaaaaaaaaa';
const PB_B = 'pb_bbbbbbbbbbbbbbbbbbbbb';
const PB_NEW = 'pb_nnnnnnnnnnnnnnnnnnnnn';

const listOp = findOperation('GET', '/api/v1/assets/a1/playback-ids')!;
const createOp = findOperation('POST', '/api/v1/assets/a1/playback-ids')!;

/** The playback ids of asset a1 as a tiny server; the create can be held back. */
function server(initial = [row(PB_A, 'public', 'Site embed')], hold?: Promise<void>) {
  let rows = [...initial];
  const stub = jsonFetch({
    '/api/v1/assets/a1/playback-ids': () => ({ data: rows }),
    'POST /api/v1/assets/a1/playback-ids': async ({ body }: RecordedCall) => {
      await hold;
      const b = body as { policy?: string; name?: string };
      const created = row(PB_NEW, b.policy ?? 'public', b.name ?? null);
      rows = [created, ...rows];
      return reply(201, created);
    },
    [`DELETE /api/v1/playback-ids/${PB_A}`]: () => {
      rows = rows.filter((r) => r.playback_id !== PB_A);
      return { success: true };
    },
    [`DELETE /api/v1/playback-ids/${PB_B}`]: reply(500, { error: 'Database unavailable' }),
  });
  vi.stubGlobal('fetch', vi.fn(stub));
  return stub;
}

const show = (accessTier: 'public' | 'private' = 'public') =>
  renderPage(<PlaybackIdsCard asset={{ id: 'a1', accessTier }} />);

afterEach(() => vi.unstubAllGlobals());

describe('PlaybackIdsCard', () => {
  it('uses fixtures that match the documented shapes', () => {
    expect(
      checkValue({ data: [row(PB_A, 'signed', 'x'), row(PB_B)] }, responseSchema(listOp)!),
    ).toEqual([]);
  });

  it('lists ids with their policy, a copyable id and a copyable stream url', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    server([row(PB_A, 'public', 'Site embed'), row(PB_B, 'signed')]);
    show();

    await screen.findByText('Site embed');
    const table = screen.getByRole('table', { name: 'Playback IDs' });
    expect(within(table).getByText('Untitled')).toBeInTheDocument();
    expect(within(table).getByText('Signed URL')).toBeInTheDocument();
    expect(within(table).getByText('Open')).toBeInTheDocument();
    expect(screen.getByText(/Players need a signed URL for these IDs\./)).toBeInTheDocument();

    await act(async () => screen.getByRole('button', { name: `Copy playback ID ${PB_A}` }).click());
    expect(writeText).toHaveBeenLastCalledWith(PB_A);
    await act(async () =>
      screen.getByRole('button', { name: `Copy stream URL for ${PB_A}` }).click(),
    );
    expect(writeText).toHaveBeenLastCalledWith(
      `${window.location.origin}/v1/stream/${PB_A}/master.m3u8`,
    );
  });

  it('says when there are none, with the way to make one', async () => {
    server([]);
    show();
    expect(await screen.findByText('No playback IDs yet')).toBeInTheDocument();
    expect(
      screen.getByText(
        'Players can use the video ID, or create a playback ID you can delete on its own.',
      ),
    ).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New playback ID' })).toHaveLength(1);
  });

  it('wraps a long name to two lines so Copy and the menu stay on screen (A11Y-08)', async () => {
    const long = 'A'.repeat(100);
    server([row(PB_A, 'public', long)]);
    show();
    const name = await screen.findByText(long);
    expect(name).toHaveClass('line-clamp-2', 'wrap-anywhere');
    expect(name).toHaveAttribute('dir', 'auto');
    expect(name.closest('td')!.className).toContain('max-w-64');
    // the created date gives way on narrow pages so the row menu stays reachable
    expect(screen.getByText(/Oct 1, 2026/).closest('td')!.className).toContain(
      '@3xl/page:table-cell',
    );
  });

  it('caps a new name at the 100 characters the server takes', async () => {
    server([]);
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'New playback ID' }));
    expect(
      within(await screen.findByRole('dialog')).getByLabelText('Name (optional)'),
    ).toHaveAttribute('maxLength', '100');
  });

  it('copies embed code for a playback ID from its row menu', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    server([row(PB_A, 'public', 'Site embed')]);
    show();
    await userEvent.click(await screen.findByRole('button', { name: 'Actions for Site embed' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Copy embed code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalled());
    expect(writeText.mock.calls[0][0]).toContain(`sluby.playback.streamUrl('${PB_A}')`);
    expect(await screen.findByText('Embed code copied')).toBeInTheDocument();
  });

  it('offers a signed URL for every ID of a private video', async () => {
    server([row(PB_A, 'public', 'Site embed')]);
    show('private');
    expect(
      await screen.findByRole('button', { name: `Copy signed URL for ${PB_A}, valid 1 hour` }),
    ).toHaveTextContent('Copy signed URL');
    expect(
      screen.getByText(/Players need a signed URL for this private video\./),
    ).toBeInTheDocument();
  });

  it('creates a signed id with a name, showing a pending row until the server answers', async () => {
    let release!: () => void;
    const stub = server(undefined, new Promise<void>((r) => (release = r)));
    show();
    await screen.findByText('Site embed');

    await userEvent.click(screen.getByRole('button', { name: 'New playback ID' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name (optional)'), '  Partner  ');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Who can play' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Signed URL required' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    // the dialog closes at once and a placeholder row stands in
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Creating…')).toBeInTheDocument();
    expect(screen.getByText('Partner')).toBeInTheDocument();

    const body = stub.calls.find((c) => c.method === 'POST')!.body;
    expect(body).toEqual({ policy: 'signed', name: 'Partner' });
    expect(checkValue(body, requestSchema(createOp)!)).toEqual([]);

    release();
    expect(await screen.findByText(PB_NEW)).toBeInTheDocument();
    expect(screen.queryByText('Creating…')).not.toBeInTheDocument();
    expect(await screen.findByText('Playback ID created')).toBeInTheDocument();
  });

  it('sends a public create with no name as just the policy', async () => {
    const stub = server([]);
    show();
    await screen.findByText(/No playback IDs yet/);
    await userEvent.click(screen.getByRole('button', { name: 'New playback ID' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Create' }),
    );
    expect(await screen.findByText(PB_NEW)).toBeInTheDocument();
    expect(stub.calls.find((c) => c.method === 'POST')!.body).toEqual({ policy: 'public' });
  });

  it('drops the placeholder and says why when a create fails', async () => {
    const stub = jsonFetch({
      '/api/v1/assets/a1/playback-ids': { data: [] },
      'POST /api/v1/assets/a1/playback-ids': reply(403, { error: 'Missing scope: manage' }),
    });
    vi.stubGlobal('fetch', vi.fn(stub));
    show();
    await screen.findByText(/No playback IDs yet/);
    await userEvent.click(screen.getByRole('button', { name: 'New playback ID' }));
    await userEvent.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Create' }),
    );
    expect(
      await screen.findByText(
        'Could not create the playback ID. You do not have access to this. Ask an operator if you need it.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('Creating…')).not.toBeInTheDocument();
  });

  it('deletes after a confirm, and the dialog keeps naming the id while it closes', async () => {
    const stub = server();
    show();
    await screen.findByText(PB_A);
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Site embed' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Delete this playback ID?')).toBeInTheDocument();
    expect(within(dialog).getByText(PB_A)).toBeInTheDocument();

    const seen: string[] = [];
    const observer = new MutationObserver((records) => {
      for (const r of records) {
        const node = r.target.nodeType === Node.TEXT_NODE ? r.target.parentElement : r.target;
        if (node instanceof Element) seen.push(node.textContent ?? '');
      }
    });
    observer.observe(document.body, { subtree: true, childList: true, characterData: true });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    observer.disconnect();

    // the description keeps naming the id while the dialog closes
    expect(seen.join('\n')).not.toMatch(/Players using\s+stop/);
    await waitFor(() => expect(screen.queryByText(PB_A)).not.toBeInTheDocument());
    expect(stub.calls.some((c) => c.method === 'DELETE' && c.path.endsWith(PB_A))).toBe(true);
    expect(await screen.findByText('Playback ID deleted')).toBeInTheDocument();
  });

  it('puts a row back when its delete fails', async () => {
    server([row(PB_B, 'signed', 'Keep me')]);
    show();
    await screen.findByText(PB_B);
    await userEvent.click(screen.getByRole('button', { name: 'Actions for Keep me' }));
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete' }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    expect(
      await screen.findByText(/^Could not delete the playback ID\. The server ran into a problem/),
    ).toBeInTheDocument();
    expect(screen.getByText(PB_B)).toBeInTheDocument();
  });

  it('offers a retry when the list does not load', async () => {
    const stub = jsonFetch({
      '/api/v1/assets/a1/playback-ids': reply(500, { error: 'Database unavailable' }),
    });
    vi.stubGlobal('fetch', vi.fn(stub));
    show();
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Could not load playback IDs')).toBeInTheDocument();
    expect(
      within(alert).getByText(/The server ran into a problem \(error 500\)/),
    ).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('copies an hour long signed stream url for a signed id', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    const stub = jsonFetch({
      '/api/v1/assets/a1/playback-ids': { data: [row(PB_B, 'signed')] },
      [`/api/v1/playback/${PB_B}/signed`]: {
        signed_url: '/v1/objects/abc?type=manifest&expires=1791489012&sig=deadbeef',
        poster_url: null,
        expires_at: '2026-10-08T19:50:12.000Z',
      },
    });
    vi.stubGlobal('fetch', vi.fn(stub));
    show();
    await userEvent.click(
      await screen.findByRole('button', {
        name: `Copy signed URL for ${PB_B}, valid 1 hour`,
      }),
    );
    await waitFor(() =>
      expect(writeText).toHaveBeenCalledWith(
        `${window.location.origin}/v1/stream/${PB_B}/master.m3u8?expires=1791489012&sig=deadbeef`,
      ),
    );
    expect(stub.calls.find((c) => c.path.endsWith('/signed'))!.query.get('expires_in')).toBe(
      '3600',
    );
    expect(await screen.findByText(/^Signed URL copied\. It works until /)).toBeInTheDocument();
  });

  it('opens the create form empty each time, with the new row on top like the server', async () => {
    server();
    show();
    await screen.findByText('Site embed');
    await userEvent.click(screen.getByRole('button', { name: 'New playback ID' }));
    let dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name (optional)'), 'First');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Who can play' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Signed URL required' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));
    await screen.findByText(PB_NEW);
    const rows = within(screen.getByRole('table')).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('First');

    await userEvent.click(screen.getByRole('button', { name: 'New playback ID' }));
    dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Name (optional)')).toHaveValue('');
    expect(within(dialog).getByRole('combobox', { name: 'Who can play' })).toHaveTextContent(
      'Anyone with the URL',
    );
  });
});
