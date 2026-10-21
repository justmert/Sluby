import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { checkValue, findOperation, responseSchema } from '@/test/openapi';
import { jsonFetch, renderPage, reply } from '@/test/render';
import { RevokeSignedUrlsCard } from './RevokeSignedUrlsCard';

const REVOKE = 'POST /api/v1/playback/a1/signed/revoke';
const revokeOp = findOperation('POST', '/api/v1/playback/a1/signed/revoke')!;
const revoked = { success: true, signing_generation: 2 };

function server(answer: unknown = revoked, hold?: Promise<void>) {
  const stub = jsonFetch({
    [REVOKE]: async () => {
      await hold;
      return answer;
    },
  });
  vi.stubGlobal('fetch', vi.fn(stub));
  return stub;
}

const show = (accessTier: 'public' | 'private' = 'private', onRevoked = vi.fn()) => {
  renderPage(<RevokeSignedUrlsCard asset={{ id: 'a1', accessTier }} onRevoked={onRevoked} />);
  return onRevoked;
};

const open = async () => {
  await userEvent.click(screen.getByRole('button', { name: 'Revoke signed URLs' }));
  return screen.findByRole('alertdialog', { name: 'Revoke signed URLs?' });
};

afterEach(() => vi.unstubAllGlobals());

describe('RevokeSignedUrlsCard', () => {
  it('uses a fixture that matches the documented answer', () => {
    expect(checkValue(revoked, responseSchema(revokeOp)!)).toEqual([]);
  });

  it('says what it is for under its heading', () => {
    server();
    show();
    const card = screen.getByRole('heading', { level: 2, name: 'Signed URLs' }).closest('section')!;
    expect(card).toHaveTextContent(
      'Stop the signed URLs given out so far without changing who can watch.',
    );
  });

  it('asks first, telling a private video that players through Sia go on for up to an hour', async () => {
    const stub = server();
    show('private');
    const dialog = await open();
    expect(dialog).toHaveTextContent(
      'Every signed URL given out for this video stops working within a minute, including the links of its signed playback IDs.',
    );
    expect(dialog).toHaveTextContent(
      'A player using one through this server stops once it has played what it already loaded; one streaming straight from Sia keeps playing until its share links expire, at most an hour.',
    );
    expect(dialog).toHaveTextContent('The video stays private');
    expect(dialog).toHaveTextContent('This cannot be undone.');
    // nothing is sent until the revoke is confirmed
    expect(stub.calls).toEqual([]);
  });

  it('tells a public video that only its signed playback IDs are affected', async () => {
    server();
    show('public');
    const dialog = await open();
    expect(dialog).toHaveTextContent(
      'Signed URLs given out for the signed playback IDs of this video stop working at once',
    );
    expect(dialog).toHaveTextContent(
      'A player already playing is not cut off, since the video’s files are public.',
    );
    expect(dialog).toHaveTextContent('Public links and embeds keep working');
  });

  it('sends nothing when cancelled', async () => {
    const stub = server();
    const onRevoked = show();
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(stub.calls).toEqual([]);
    expect(onRevoked).not.toHaveBeenCalled();
  });

  it('revokes on confirm, staying busy until the server answers, then says so', async () => {
    let release!: () => void;
    const stub = server(revoked, new Promise<void>((r) => (release = r)));
    const onRevoked = show();
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    const busy = await within(dialog).findByRole('button', { name: 'Revoking…' });
    expect(busy).toBeDisabled();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toBeDisabled();
    expect(stub.calls).toHaveLength(1);
    expect(stub.calls[0]).toMatchObject({
      method: 'POST',
      path: '/api/v1/playback/a1/signed/revoke',
    });

    release();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(await screen.findByText('Signed URLs revoked')).toBeInTheDocument();
    expect(onRevoked).toHaveBeenCalledTimes(1);
  });

  it('keeps the dialog open with the reason when the revoke fails', async () => {
    server(reply(500, { error: 'Database unavailable' }));
    const onRevoked = show();
    const dialog = await open();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));

    const alert = await within(dialog).findByRole('alert');
    expect(alert).toHaveTextContent('Could not revoke the signed URLs');
    expect(screen.getByRole('alertdialog', { name: 'Revoke signed URLs?' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: 'Revoke' })).toBeEnabled();
    expect(screen.queryByText('Signed URLs revoked')).not.toBeInTheDocument();
    expect(onRevoked).not.toHaveBeenCalled();
  });
});
