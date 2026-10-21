import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { env } from '../config/env.js';
import { createMemberRoutes, type MemberRouteDeps } from '../api/routes/members.js';
import { hashLinkToken } from '../api/auth/link-token.js';
import { createTestApp, withApiKey } from './helpers/express-helpers.js';
import type { MemberRecord } from '../db/queries/members.js';
import type { PendingInvite } from '../db/queries/invites.js';

const ADA = '00000000-0000-4000-8000-00000000000a';
const BOB = '00000000-0000-4000-8000-00000000000b';
const CREATED = new Date('2026-10-01T10:00:00.000Z');

const saved = { ...env };

/** Members and invites in memory, with the guards the queries apply. */
function memoryMembers() {
  const members = new Map<string, MemberRecord>([
    [
      ADA,
      {
        id: ADA,
        name: 'Ada',
        role: 'admin',
        disabledAt: null,
        createdAt: CREATED,
        lastSignInAt: new Date('2026-10-18T09:00:00.000Z'),
        signIn: [{ provider: 'password', username: 'ada@example.com' }],
      },
    ],
    [
      BOB,
      {
        id: BOB,
        name: 'Bob',
        role: 'member',
        disabledAt: null,
        createdAt: CREATED,
        lastSignInAt: null,
        signIn: [{ provider: 'github', username: 'bob' }],
      },
    ],
  ]);
  const links: Array<{
    id: string;
    kind: 'invite' | 'reset';
    tokenHash: string;
    role: 'admin' | 'member' | null;
    userId: string | null;
    createdBy: string | null;
    createdAt: Date;
    expiresAt: Date;
    revokedAt: Date | null;
    maxUses?: number | null;
  }> = [];
  const removed: string[] = [];
  let seq = 0;

  const otherAdmin = (id: string) =>
    [...members.values()].some((m) => m.id !== id && m.role === 'admin' && !m.disabledAt);

  const deps: MemberRouteDeps = {
    listMembers: async () => [...members.values()],
    changeMemberRole: async (id, role) => {
      const m = members.get(id);
      if (!m) return 'not_found';
      if (m.role === 'admin' && role !== 'admin' && !m.disabledAt && !otherAdmin(id)) {
        return 'last_admin';
      }
      m.role = role;
      return m;
    },
    removeMember: async (id) => {
      const m = members.get(id);
      if (!m) return 'not_found';
      if (m.role === 'admin' && !m.disabledAt && !otherAdmin(id)) return 'last_admin';
      m.disabledAt ??= new Date();
      removed.push(id);
      return m;
    },
    restoreMember: async (id) => {
      const m = members.get(id);
      if (!m) return 'not_found';
      m.disabledAt = null;
      return m;
    },
    createInvite: async (data) => {
      const row = {
        id: `invite-${++seq}`,
        kind: 'invite' as const,
        userId: null,
        createdAt: new Date(),
        revokedAt: null,
        ...data,
      };
      links.push(row);
      return row;
    },
    createResetLink: async (data) => {
      if (!members.has(data.userId)) return null;
      const row = {
        id: `reset-${++seq}`,
        kind: 'reset' as const,
        role: null,
        createdAt: new Date(),
        revokedAt: null,
        ...data,
      };
      links.push(row);
      return row;
    },
    listPendingInvites: async () =>
      links
        .filter((l) => l.kind === 'invite' && !l.revokedAt)
        .map((l): PendingInvite => ({
          id: l.id,
          role: l.role ?? 'member',
          createdAt: l.createdAt,
          expiresAt: l.expiresAt,
          maxUses: l.maxUses === undefined ? 1 : l.maxUses,
          uses: 0,
          createdBy: l.createdBy ? { id: l.createdBy, name: members.get(l.createdBy)!.name } : null,
        })),
    revokeInvite: async (id) => {
      const l = links.find((x) => x.id === id && x.kind === 'invite' && !x.revokedAt);
      if (!l) return false;
      l.revokedAt = new Date();
      return true;
    },
  };
  return { members, links, removed, deps };
}

let store: ReturnType<typeof memoryMembers>;

beforeEach(() => {
  env.PUBLIC_URL = 'https://video.example.com/';
  store = memoryMembers();
});

afterEach(() => {
  Object.assign(env, saved);
});

type As = { admin?: boolean; userId?: string | null; scopes?: string[] };

function app(as: As = {}) {
  return withApiKey(createTestApp(createMemberRoutes(store.deps), '/api/v1'), {
    id: as.userId === undefined ? `session:${ADA}` : `key-1`,
    name: 'caller',
    scopes: as.scopes ?? ['upload', 'read', 'manage'],
    rateLimit: 100,
    creatorAddress: 'workspace',
    admin: as.admin ?? true,
    userId: as.userId === undefined ? ADA : as.userId,
  });
}

/** The token at the end of a link url, checked against what was stored. */
function tokenOf(url: string) {
  return url.split('/').pop()!;
}

describe('members api', () => {
  it('lists every member with role, status and sign-in methods', async () => {
    store.members.get(BOB)!.disabledAt = new Date();
    const res = await request(app()).get('/api/v1/members');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      data: [
        {
          id: ADA,
          name: 'Ada',
          role: 'admin',
          status: 'active',
          sign_in: [{ provider: 'password', username: 'ada@example.com' }],
          created_at: '2026-10-01T10:00:00.000Z',
          last_sign_in_at: '2026-10-18T09:00:00.000Z',
        },
        {
          id: BOB,
          name: 'Bob',
          role: 'member',
          status: 'removed',
          sign_in: [{ provider: 'github', username: 'bob' }],
          created_at: '2026-10-01T10:00:00.000Z',
          last_sign_in_at: null,
        },
      ],
    });
  });

  it('is for admins only, by session or key, with the manage scope', async () => {
    for (const [method, path] of [
      ['get', '/api/v1/members'],
      ['patch', `/api/v1/members/${BOB}`],
      ['post', `/api/v1/members/${BOB}/remove`],
      ['post', `/api/v1/members/${BOB}/restore`],
      ['post', `/api/v1/members/${BOB}/reset-link`],
      ['get', '/api/v1/invites'],
      ['post', '/api/v1/invites'],
      ['delete', '/api/v1/invites/invite-1'],
    ] as const) {
      const member = await request(app({ admin: false, userId: BOB }))
        [method](path)
        .send({});
      expect(member.status, `${method} ${path}`).toBe(403);
      expect(member.body.error).toBe('Only an admin may use this endpoint');
      const narrow = await request(app({ scopes: ['read'] }))
        [method](path)
        .send({});
      expect(narrow.status, `${method} ${path}`).toBe(403);
    }
    // an admin's key and a key with no creator both work
    expect((await request(app({ userId: ADA })).get('/api/v1/members')).status).toBe(200);
    expect((await request(app({ userId: null })).get('/api/v1/members')).status).toBe(200);
    expect(store.members.get(BOB)).toMatchObject({ role: 'member', disabledAt: null });
  });

  it('changes a role, but not the last admin’s', async () => {
    const demoteLast = await request(app())
      .patch(`/api/v1/members/${ADA}`)
      .send({ role: 'member' });
    expect(demoteLast.status).toBe(409);
    expect(demoteLast.body.reason).toBe('last_admin');

    const promote = await request(app()).patch(`/api/v1/members/${BOB}`).send({ role: 'admin' });
    expect(promote.status).toBe(200);
    expect(promote.body).toMatchObject({ id: BOB, role: 'admin', status: 'active' });

    const demoteSelf = await request(app())
      .patch(`/api/v1/members/${ADA}`)
      .send({ role: 'member' });
    expect(demoteSelf.status).toBe(200);
    expect(demoteSelf.body.role).toBe('member');
  });

  it('checks the role and the member', async () => {
    const bad = await request(app()).patch(`/api/v1/members/${BOB}`).send({ role: 'owner' });
    expect(bad.status).toBe(400);
    expect(bad.body.details).toEqual([
      { field: 'role', message: 'role must be one of: admin, member' },
    ]);
    const unknown = await request(app())
      .patch('/api/v1/members/00000000-0000-4000-8000-000000000999')
      .send({ role: 'admin' });
    expect(unknown.status).toBe(404);
  });

  it('removes and restores a member', async () => {
    const res = await request(app()).post(`/api/v1/members/${BOB}/remove`);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ id: BOB, status: 'removed' });
    expect(store.removed).toEqual([BOB]);
    const back = await request(app()).post(`/api/v1/members/${BOB}/restore`);
    expect(back.status).toBe(200);
    expect(back.body).toMatchObject({ id: BOB, status: 'active', role: 'member' });
    const unknown = await request(app()).post(
      '/api/v1/members/00000000-0000-4000-8000-000000000999/restore',
    );
    expect(unknown.status).toBe(404);
  });

  it('refuses to remove yourself, and the last admin through a key with no creator', async () => {
    store.members.get(BOB)!.role = 'admin';
    const self = await request(app()).post(`/api/v1/members/${ADA}/remove`);
    expect(self.status).toBe(409);
    expect(self.body.reason).toBe('self');
    expect(store.removed).toEqual([]);

    await request(app()).post(`/api/v1/members/${BOB}/remove`);
    const last = await request(app({ userId: null })).post(`/api/v1/members/${ADA}/remove`);
    expect(last.status).toBe(409);
    expect(last.body.reason).toBe('last_admin');
  });

  it('makes a reset link on the studio, shown once, and stores only its hash', async () => {
    const res = await request(app()).post(`/api/v1/members/${BOB}/reset-link`);
    expect(res.status).toBe(201);
    expect(res.body.url).toMatch(
      /^https:\/\/video\.example\.com\/studio\/reset\/[A-Za-z0-9_-]{43}$/,
    );
    const stored = store.links[0];
    expect(stored).toMatchObject({ kind: 'reset', userId: BOB, createdBy: ADA });
    expect(stored.tokenHash).toBe(hashLinkToken(tokenOf(res.body.url)));
    expect(res.body.expires_at).toBe(stored.expiresAt.toISOString());
    const week = Date.now() + 7 * 24 * 3600_000;
    expect(Math.abs(stored.expiresAt.getTime() - week)).toBeLessThan(10_000);

    const unknown = await request(app()).post(
      '/api/v1/members/00000000-0000-4000-8000-000000000999/reset-link',
    );
    expect(unknown.status).toBe(404);
  });
});

describe('invites api', () => {
  it('creates an invite with a join url, lists it and revokes it', async () => {
    const created = await request(app()).post('/api/v1/invites').send({ role: 'admin' });
    expect(created.status).toBe(201);
    expect(created.body).toEqual({
      id: 'invite-1',
      url: expect.stringMatching(
        /^https:\/\/video\.example\.com\/studio\/join\/[A-Za-z0-9_-]{43}$/,
      ),
      role: 'admin',
      max_uses: 1,
      uses: 0,
      expires_at: store.links[0].expiresAt.toISOString(),
    });
    expect(store.links[0].tokenHash).toBe(hashLinkToken(tokenOf(created.body.url)));
    expect(store.links[0].createdBy).toBe(ADA);

    const list = await request(app()).get('/api/v1/invites');
    expect(list.body).toEqual({
      data: [
        {
          id: 'invite-1',
          role: 'admin',
          created_at: store.links[0].createdAt.toISOString(),
          expires_at: store.links[0].expiresAt.toISOString(),
          max_uses: 1,
          uses: 0,
          created_by: { id: ADA, name: 'Ada' },
        },
      ],
    });
    // the url is never listed again
    expect(JSON.stringify(list.body)).not.toContain(tokenOf(created.body.url));

    expect((await request(app()).delete('/api/v1/invites/invite-1')).body).toEqual({
      success: true,
    });
    expect((await request(app()).delete('/api/v1/invites/invite-1')).status).toBe(404);
    expect((await request(app()).get('/api/v1/invites')).body.data).toEqual([]);
  });

  it('lasts a week for one person unless told otherwise', async () => {
    const before = Date.now();
    await request(app()).post('/api/v1/invites').send({ role: 'member' });
    const link = store.links[0];
    expect(link.maxUses).toBe(1);
    const week = 7 * 24 * 3600 * 1000;
    expect(link.expiresAt.getTime()).toBeGreaterThanOrEqual(before + week);
    expect(link.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + week);
  });

  it('makes a member link for many people, or for anyone until it ends', async () => {
    const ten = await request(app())
      .post('/api/v1/invites')
      .send({ role: 'member', max_uses: 10, expires_in_days: 30 });
    expect(ten.status).toBe(201);
    expect(ten.body).toMatchObject({ role: 'member', max_uses: 10, uses: 0 });
    const days = (Date.parse(ten.body.expires_at) - Date.now()) / (24 * 3600 * 1000);
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThanOrEqual(30);

    const open = await request(app())
      .post('/api/v1/invites')
      .send({ role: 'member', max_uses: null, expires_in_days: 1 });
    expect(open.status).toBe(201);
    expect(open.body.max_uses).toBeNull();
    expect(store.links[1].maxUses).toBeNull();

    const list = await request(app()).get('/api/v1/invites');
    expect(list.body.data.map((i: { max_uses: number | null }) => i.max_uses)).toEqual([10, null]);
  });

  it('lets an admin invite only one person', async () => {
    for (const max_uses of [2, null]) {
      const res = await request(app()).post('/api/v1/invites').send({ role: 'admin', max_uses });
      expect(res.status).toBe(400);
      expect(res.body.reason).toBe('admin_multi_use');
    }
    expect(store.links).toEqual([]);
    const one = await request(app()).post('/api/v1/invites').send({ role: 'admin', max_uses: 1 });
    expect(one.status).toBe(201);
  });

  it('refuses limits and lifetimes it does not offer', async () => {
    for (const body of [
      { role: 'member', max_uses: 0 },
      { role: 'member', max_uses: 1001 },
      { role: 'member', max_uses: 2.5 },
      { role: 'member', max_uses: '10' },
      { role: 'member', expires_in_days: 3 },
      { role: 'member', uses: 5 },
    ]) {
      const res = await request(app()).post('/api/v1/invites').send(body);
      expect(res.status, JSON.stringify(body)).toBe(400);
    }
    expect(store.links).toEqual([]);
  });

  it('needs a role', async () => {
    const res = await request(app()).post('/api/v1/invites').send({});
    expect(res.status).toBe(400);
    expect(res.body.details[0].field).toBe('role');
  });

  it('records no creator for a key with none', async () => {
    await request(app({ userId: null }))
      .post('/api/v1/invites')
      .send({ role: 'member' });
    expect(store.links[0].createdBy).toBeNull();
    const list = await request(app()).get('/api/v1/invites');
    expect(list.body.data[0].created_by).toBeNull();
  });
});
