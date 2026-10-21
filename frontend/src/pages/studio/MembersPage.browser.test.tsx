import '@/index.css';
import { cleanup, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Member, PendingInvite } from '@/hooks/useMembers';
import { renderPage } from '@/test/render';
import { WithSession, testSession } from '@/test/session';
import MembersPage from './MembersPage';

// loaded by a specifier typescript does not follow, as in Sidebar.browser.test:
// its types redeclare jest-dom's matchers for the whole project
const browser = () =>
  import('vitest/browser' as string) as Promise<{
    page: { viewport(width: number, height: number): Promise<void> };
  }>;

const start: Member[] = [
  {
    id: testSession.id,
    name: 'Mert Köklü',
    role: 'admin',
    status: 'active',
    sign_in: [
      { provider: 'password', username: 'mert.koklu.with.a.long.address@example.com' },
      { provider: 'github', username: 'justmert' },
    ],
    created_at: '2026-10-01T00:00:00.000Z',
    last_sign_in_at: new Date().toISOString(),
  },
  {
    id: 'm2',
    name: 'Bea',
    role: 'member',
    status: 'active',
    sign_in: [{ provider: 'github', username: 'bea' }],
    created_at: '2026-10-02T00:00:00.000Z',
    last_sign_in_at: null,
  },
];

const invites: PendingInvite[] = [
  {
    id: 'i1',
    role: 'member',
    created_at: '2026-10-18T09:00:00.000Z',
    expires_at: new Date(Date.now() + 3 * 86_400_000).toISOString(),
    max_uses: 1,
    uses: 0,
    created_by: { id: testSession.id, name: 'Mert Köklü' },
  },
];

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

let patched: unknown[];
let members: Member[];

beforeEach(() => {
  patched = [];
  members = start;
  vi.stubGlobal('fetch', async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = new URL(String(input), location.origin).pathname;
    const method = init?.method ?? 'GET';
    if (path === '/api/v1/members' && method === 'GET') return json({ data: members });
    if (path === '/api/v1/invites' && method === 'GET') return json({ data: invites });
    if (path === '/api/v1/members/m2' && method === 'PATCH') {
      patched.push(JSON.parse(String(init?.body)));
      members = [members[0], { ...members[1], role: 'admin' }];
      return json(members[1]);
    }
    if (path === '/api/v1/invites' && method === 'POST') {
      return json(
        {
          id: 'i2',
          url: `${location.origin}/studio/join/${'x'.repeat(43)}`,
          role: 'member',
          expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
        },
        201,
      );
    }
    return json({ error: `unexpected ${method} ${path}` }, 501);
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function draw(width: number) {
  await (await browser()).page.viewport(width, 900);
  renderPage(
    <WithSession admin name="Mert Köklü">
      <MembersPage />
    </WithSession>,
    { route: '/studio/members' },
  );
  await screen.findAllByText('Bea');
}

describe('Members in a real browser', () => {
  it('fits a phone without scrolling sideways', async () => {
    await draw(390);
    expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(390);
  });

  it('changes a role with the select', async () => {
    await draw(1280);
    const table = screen.getByRole('table', { name: 'Members' });
    await userEvent.click(within(table).getByRole('combobox', { name: 'Role of Bea' }));
    await userEvent.click(await screen.findByRole('option', { name: 'Admin' }));
    await expect.poll(() => patched).toEqual([{ role: 'admin' }]);
    // while the list closes, radix hides the rest of the page from the
    // accessibility tree, and webkit takes the longest to finish closing
    await expect.poll(() => screen.queryByRole('listbox'), { timeout: 5_000 }).toBeNull();
    await expect
      .poll(() => within(table).getByRole('combobox', { name: 'Role of Bea' }).textContent, {
        timeout: 5_000,
      })
      .toContain('Admin');
  });

  it('shows a new invite link inside the dialog at phone width', async () => {
    await draw(390);
    await userEvent.click(screen.getByRole('button', { name: 'Invite people' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create link' }));
    const copy = await within(dialog).findByRole('button', { name: 'Copy invite link' });
    const box = dialog.getBoundingClientRect();
    const button = copy.getBoundingClientRect();
    // the copy button stays inside the dialog however long the link is
    expect(button.right).toBeLessThanOrEqual(box.right);
    expect(box.right).toBeLessThanOrEqual(390);
    expect(dialog.textContent).toContain('Send it to one person.');
  });
});
