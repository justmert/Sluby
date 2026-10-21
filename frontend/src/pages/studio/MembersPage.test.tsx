import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Member, PendingInvite } from '@/hooks/useMembers';
import { reloadPage } from '@/lib/navigation';
import { jsonFetch, renderPage, reply, type RecordedCall } from '@/test/render';
import { WithSession, testSession } from '@/test/session';
import MembersPage from './MembersPage';

vi.mock('@/lib/navigation', () => ({
  loadPage: vi.fn(),
  reloadPage: vi.fn(),
  replacePage: vi.fn(),
}));

const me: Member = {
  id: testSession.id,
  name: 'Alice',
  role: 'admin',
  status: 'active',
  sign_in: [
    { provider: 'password', username: 'alice@example.com' },
    { provider: 'github', username: 'alice' },
  ],
  created_at: '2026-10-01T00:00:00.000Z',
  last_sign_in_at: new Date(Date.now() - 5 * 60_000).toISOString(),
};

const bea: Member = {
  id: 'm2',
  name: 'Bea',
  role: 'member',
  status: 'active',
  sign_in: [{ provider: 'github', username: 'bea-gh' }],
  created_at: '2026-10-02T00:00:00.000Z',
  last_sign_in_at: null,
};

const cem: Member = { ...bea, id: 'm3', name: 'Cem', status: 'removed', sign_in: [] };

const invite: PendingInvite = {
  id: 'i1',
  role: 'member',
  created_at: '2026-10-18T09:00:00.000Z',
  expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
  max_uses: 1,
  uses: 0,
  created_by: { id: testSession.id, name: 'Alice' },
};

let members: Member[];
let invites: PendingInvite[];
let routes: Record<string, unknown>;
let fetchStub: ReturnType<typeof jsonFetch>;

beforeEach(() => {
  members = [me, bea, cem];
  invites = [invite];
  routes = {
    '/api/v1/members': () => ({ data: members }),
    '/api/v1/invites': () => ({ data: invites }),
  };
  fetchStub = jsonFetch(new Proxy({}, { get: (_, k) => routes[k as string] }));
  vi.stubGlobal('fetch', fetchStub);
  Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.mocked(reloadPage).mockClear();
});

const render = () =>
  renderPage(
    <WithSession admin name="Alice">
      <MembersPage />
    </WithSession>,
    { route: '/studio/members' },
  );

const membersTable = () => screen.getByRole('table', { name: 'Members' });
const rowOf = (name: string) =>
  within(membersTable())
    .getAllByRole('row')
    .find((r) => within(r).queryByText(name) !== null)!;

async function openRowMenu(name: string) {
  await screen.findByText('Bea');
  await userEvent.click(within(rowOf(name)).getByRole('button', { name: `Actions for ${name}` }));
}

describe('MembersPage', () => {
  it('lists members with how they sign in, their role, status and last sign-in', async () => {
    render();
    expect(await screen.findByRole('heading', { level: 1, name: 'Members' })).toBeInTheDocument();
    await screen.findByText('Bea');
    const alice = rowOf('Alice');
    expect(within(alice).getByText('You')).toBeInTheDocument();
    expect(within(alice).getByText('alice@example.com')).toBeInTheDocument();
    expect(within(alice).getByText('@alice')).toBeInTheDocument();
    expect(within(alice).getByText('5 minutes ago')).toBeInTheDocument();
    expect(within(alice).getByRole('combobox', { name: 'Role of Alice' })).toHaveTextContent(
      'Admin',
    );
    const b = rowOf('Bea');
    expect(within(b).getByText('Never')).toBeInTheDocument();
    expect(within(b).getByText('Active')).toBeInTheDocument();
    const c = rowOf('Cem');
    expect(within(c).getByText('Removed')).toBeInTheDocument();
    expect(within(c).getByRole('combobox', { name: 'Role of Cem' })).toBeDisabled();
  });

  it('lists pending invites with who made them and when they stop', async () => {
    render();
    const table = await screen.findByRole('table', { name: 'Pending invites' });
    await within(table).findByText('Alice');
    expect(within(table).getByText('Member')).toBeInTheDocument();
    expect(within(table).getByText(/^in (2|3) days/)).toBeInTheDocument();
  });

  it('changes a role from the select and says so', async () => {
    routes['PATCH /api/v1/members/m2'] = ({ body }: RecordedCall) => {
      members = members.map((m) =>
        m.id === 'm2' ? { ...m, role: (body as { role: 'admin' }).role } : m,
      );
      return members[1];
    };
    render();
    await screen.findByText('Bea');
    await userEvent.click(within(rowOf('Bea')).getByRole('combobox', { name: 'Role of Bea' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Admin' }));
    expect(await screen.findByText('Bea is now an admin.')).toBeInTheDocument();
    expect(fetchStub.calls.find((c) => c.method === 'PATCH')?.body).toEqual({ role: 'admin' });
    await waitFor(() =>
      expect(within(rowOf('Bea')).getByRole('combobox', { name: 'Role of Bea' })).toHaveTextContent(
        'Admin',
      ),
    );
  });

  it('says why the last admin cannot become a member', async () => {
    members = [me, { ...bea, role: 'admin' }];
    routes['PATCH /api/v1/members/m2'] = reply(409, {
      error: 'This is the last admin who can sign in. Make someone else an admin first.',
      reason: 'last_admin',
    });
    render();
    await openRowMenu('Bea');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Make member' }));
    expect(
      await screen.findByText(
        'Could not change the role of Bea. This is the last admin who can sign in. Make someone else an admin first.',
      ),
    ).toBeInTheDocument();
  });

  it('asks before you stop being an admin, then loads the studio again', async () => {
    routes[`PATCH /api/v1/members/${me.id}`] = { ...me, role: 'member' };
    render();
    await screen.findByText('Bea');
    await userEvent.click(within(rowOf('Alice')).getByRole('combobox', { name: 'Role of Alice' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Member' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Stop being an admin?')).toBeInTheDocument();
    expect(fetchStub.calls.some((c) => c.method === 'PATCH')).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make me a member' }));
    await waitFor(() => expect(reloadPage).toHaveBeenCalled());
  });

  it('removes a member after asking, and does not offer to remove yourself', async () => {
    routes['POST /api/v1/members/m2/remove'] = () => {
      members = members.map((m) => (m.id === 'm2' ? { ...m, status: 'removed' as const } : m));
      return members[1];
    };
    render();
    await openRowMenu('Alice');
    expect(screen.queryByRole('menuitem', { name: 'Remove' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Escape}');

    await openRowMenu('Bea');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Bea can no longer sign in.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(await screen.findByText('Bea was removed.')).toBeInTheDocument();
    await waitFor(() => expect(within(rowOf('Bea')).getByText('Removed')).toBeInTheDocument());
  });

  it('shows the server refusal in the remove dialog', async () => {
    routes['POST /api/v1/members/m2/remove'] = reply(409, {
      error: 'This is the last admin who can sign in. Make someone else an admin first.',
      reason: 'last_admin',
    });
    render();
    await openRowMenu('Bea');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Remove' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove' }));
    expect(
      await within(dialog).findByText(
        'This is the last admin who can sign in. Make someone else an admin first.',
      ),
    ).toBeInTheDocument();
  });

  it('restores a removed member', async () => {
    routes['POST /api/v1/members/m3/restore'] = () => {
      members = members.map((m) => (m.id === 'm3' ? { ...m, status: 'active' as const } : m));
      return members[2];
    };
    render();
    await openRowMenu('Cem');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Restore' }));
    expect(await screen.findByText('Cem can sign in again.')).toBeInTheDocument();
  });

  it('makes a reset link and shows it once with when it stops working', async () => {
    routes['POST /api/v1/members/m2/reset-link'] = reply(201, {
      url: 'https://studio.example/studio/reset/tok123',
      expires_at: '2026-10-26T15:04:00.000Z',
    });
    render();
    await openRowMenu('Bea');
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Create reset link' }));
    const dialog = await screen.findByRole('dialog');
    // bea signs in with github only, so the link gives her a first password
    expect(dialog).toHaveTextContent('Bea signs in without a password today.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));
    expect(
      await within(dialog).findByText('https://studio.example/studio/reset/tok123'),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      /Anyone with this link can set the password for Bea until Oct 26, 2026 at .*\. Send it only to them\./,
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Copy reset link' }));
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
      'https://studio.example/studio/reset/tok123',
    );
  });

  it('invites someone with a role and shows the link once', async () => {
    routes['POST /api/v1/invites'] = ({ body }: RecordedCall) => {
      invites = [{ ...invite, id: 'i2', role: (body as { role: 'admin' }).role }, ...invites];
      return reply(201, {
        id: 'i2',
        url: 'https://studio.example/studio/join/tok456',
        role: 'admin',
        expires_at: '2026-10-26T15:04:00.000Z',
      });
    };
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Invite people' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Role' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Admin' }));
    expect(dialog).toHaveTextContent('Also manages members and sees server health and metrics.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));
    expect(
      await within(dialog).findByText('https://studio.example/studio/join/tok456'),
    ).toBeInTheDocument();
    expect(dialog).toHaveTextContent(
      /Anyone with this link can join until Oct 26, 2026 at .*\. Send it to one person\./,
    );
    expect(
      fetchStub.calls.find((c) => c.path === '/api/v1/invites' && c.method === 'POST')?.body,
    ).toEqual({ role: 'admin', max_uses: 1, expires_in_days: 7 });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    const table = screen.getByRole('table', { name: 'Pending invites' });
    await waitFor(() => expect(within(table).getByText('Admin')).toBeInTheDocument());
  });

  it('makes a member link for a number of people, for as long as asked', async () => {
    routes['POST /api/v1/invites'] = ({ body }: RecordedCall) => {
      const b = body as { max_uses: number | null };
      invites = [{ ...invite, id: 'i2', max_uses: b.max_uses, uses: 0 }, ...invites];
      return reply(201, {
        id: 'i2',
        url: 'https://studio.example/studio/join/tok789',
        role: 'member',
        max_uses: b.max_uses,
        expires_at: '2026-11-19T15:04:00.000Z',
      });
    };
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Invite people' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Who can join' }));
    await userEvent.click(await screen.findByRole('option', { name: 'A number of people' }));
    const count = within(dialog).getByRole('spinbutton', { name: 'Number of people' });
    await userEvent.clear(count);
    await userEvent.type(count, '1');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));
    expect(within(dialog).getByText('Enter a whole number from 2 to 1000.')).toBeInTheDocument();
    expect(fetchStub.calls.some((c) => c.method === 'POST' && c.path === '/api/v1/invites')).toBe(
      false,
    );
    await userEvent.clear(count);
    await userEvent.type(count, '25');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Link works for' }));
    await userEvent.click(await screen.findByRole('option', { name: '30 days' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));
    expect(dialog).toHaveTextContent(
      /Up to 25 people can join as members with this link until Nov 19, 2026 at /,
    );
    expect(
      fetchStub.calls.find((c) => c.path === '/api/v1/invites' && c.method === 'POST')?.body,
    ).toEqual({ role: 'member', max_uses: 25, expires_in_days: 30 });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Done' }));
    const table = screen.getByRole('table', { name: 'Pending invites' });
    await waitFor(() => expect(within(table).getByText('0 of 25')).toBeInTheDocument());
  });

  it('makes a link anyone can join with until it ends, and counts who joined', async () => {
    invites = [{ ...invite, max_uses: null, uses: 4 }];
    routes['POST /api/v1/invites'] = () =>
      reply(201, {
        id: 'i2',
        url: 'https://studio.example/studio/join/tok000',
        role: 'member',
        max_uses: null,
        expires_at: '2026-10-27T15:04:00.000Z',
      });
    render();
    const table = await screen.findByRole('table', { name: 'Pending invites' });
    expect(await within(table).findByText('4 (no limit)')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Invite people' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Who can join' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Anyone with the link' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));
    expect(dialog).toHaveTextContent(
      /Anyone with this link can join as a member until .*\. Revoke it on this page to stop new people joining\./,
    );
    expect(
      fetchStub.calls.find((c) => c.path === '/api/v1/invites' && c.method === 'POST')?.body,
    ).toEqual({ role: 'member', max_uses: null, expires_in_days: 7 });
  });

  it('keeps an admin invite to one person', async () => {
    render();
    await userEvent.click(await screen.findByRole('button', { name: 'Invite people' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Who can join' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Anyone with the link' }));
    await userEvent.click(within(dialog).getByRole('combobox', { name: 'Role' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Admin' }));
    const who = within(dialog).getByRole('combobox', { name: 'Who can join' });
    expect(who).toBeDisabled();
    expect(who).toHaveTextContent('One person');
    expect(dialog).toHaveTextContent('An admin invite lets one person join.');
  });

  it('revokes a pending invite after asking', async () => {
    routes['DELETE /api/v1/invites/i1'] = () => {
      invites = [];
      return { success: true };
    };
    render();
    const table = await screen.findByRole('table', { name: 'Pending invites' });
    await within(table).findByText('Alice');
    await userEvent.click(
      within(table).getByRole('button', { name: /^Actions for Member invite/ }),
    );
    await userEvent.click(await screen.findByRole('menuitem', { name: 'Revoke' }));
    const dialog = await screen.findByRole('alertdialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Revoke' }));
    expect(await screen.findByText('No pending invites')).toBeInTheDocument();
  });
});
