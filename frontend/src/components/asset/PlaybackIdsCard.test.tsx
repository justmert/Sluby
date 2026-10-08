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
      rows = [...rows, created];
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

const show = () => renderPage(<PlaybackIdsCard assetId="a1" />);

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

    const table = await screen.findByRole('table');
    expect(within(table).getByText('Site embed')).toBeInTheDocument();
    expect(within(table).getByText('Untitled')).toBeInTheDocument();
    expect(within(table).getByText('Signed')).toBeInTheDocument();
    expect(screen.getByText(/needs the/)).toBeInTheDocument();

    await act(async () => screen.getByRole('button', { name: `Copy playback ID ${PB_A}` }).click());
    expect(writeText).toHaveBeenLastCalledWith(PB_A);
    await act(async () =>
      screen.getByRole('button', { name: `Copy stream URL of ${PB_A}` }).click(),
    );
    expect(writeText).toHaveBeenLastCalledWith(
      `${window.location.origin}/v1/stream/${PB_A}/master.m3u8`,
    );
  });

  it('says when there are none', async () => {
    server([]);
    show();
    expect(await screen.findByText(/No playback IDs yet/)).toBeInTheDocument();
  });

  it('creates a signed id with a name, showing a pending row until the server answers', async () => {
    let release!: () => void;
    const stub = server(undefined, new Promise<void>((r) => (release = r)));
    show();
    await screen.findByText('Site embed');

    await userEvent.click(screen.getByRole('button', { name: 'New playback ID' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Name (optional)'), '  Partner  ');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Policy' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Signed' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create' }));

    // the dialog closes at once and a placeholder row stands in
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(screen.getByText('Creating...')).toBeInTheDocument();
    expect(screen.getByText('Partner')).toBeInTheDocument();

    const body = stub.calls.find((c) => c.method === 'POST')!.body;
    expect(body).toEqual({ policy: 'signed', name: 'Partner' });
    expect(checkValue(body, requestSchema(createOp)!)).toEqual([]);

    release();
    expect(await screen.findByText(PB_NEW)).toBeInTheDocument();
    expect(screen.queryByText('Creating...')).not.toBeInTheDocument();
    expect(await screen.findByText(`Playback ID ${PB_NEW} created`)).toBeInTheDocument();
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
      await screen.findByText('Could not create the playback ID: Missing scope: manage'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Creating...')).not.toBeInTheDocument();
  });

  it('deletes after a confirm, and the dialog keeps naming the id while it closes', async () => {
    const stub = server();
    show();
    await screen.findByText(PB_A);
    await userEvent.click(screen.getByRole('button', { name: `Delete playback ID ${PB_A}` }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(`Delete playback ID ${PB_A}?`)).toBeInTheDocument();

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

    expect(seen.join('\n')).not.toMatch(/Delete playback ID \?/);
    await waitFor(() => expect(screen.queryByText(PB_A)).not.toBeInTheDocument());
    expect(stub.calls.some((c) => c.method === 'DELETE' && c.path.endsWith(PB_A))).toBe(true);
    expect(await screen.findByText(`Playback ID ${PB_A} deleted`)).toBeInTheDocument();
  });

  it('puts a row back when its delete fails', async () => {
    server([row(PB_B, 'signed', 'Keep me')]);
    show();
    await screen.findByText(PB_B);
    await userEvent.click(screen.getByRole('button', { name: `Delete playback ID ${PB_B}` }));
    await userEvent.click(
      within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    expect(
      await screen.findByText(`Could not delete ${PB_B}: Database unavailable`),
    ).toBeInTheDocument();
    expect(screen.getByText(PB_B)).toBeInTheDocument();
  });

  it('offers a retry when the list does not load', async () => {
    const stub = jsonFetch({
      '/api/v1/assets/a1/playback-ids': reply(500, { error: 'Database unavailable' }),
    });
    vi.stubGlobal('fetch', vi.fn(stub));
    show();
    expect(
      await screen.findByText('Could not load playback IDs: Database unavailable'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });
});
