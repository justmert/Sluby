import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { requireAdmin, requireScope } from '../middleware/api-key.js';
import { AppError } from '../middleware/error-handler.js';
import { parseOrThrow } from '../validation.js';
import { LINK_TTL_MS, inviteUrl, newLinkToken, resetUrl } from '../auth/link-token.js';
import type { Role } from '../auth/access.js';
import type { MemberChange, MemberRecord } from '../../db/queries/members.js';
import type { PendingInvite } from '../../db/queries/invites.js';

export interface MemberRouteDeps {
  listMembers: () => Promise<MemberRecord[]>;
  /** Change a role; `last_admin` when it would leave no admin who can sign in. */
  changeMemberRole: (id: string, role: Role) => Promise<MemberChange>;
  /** Remove a member and end their sessions; `last_admin` as above. */
  removeMember: (id: string) => Promise<MemberChange>;
  restoreMember: (id: string) => Promise<MemberRecord | 'not_found'>;
  createInvite: (data: {
    tokenHash: string;
    role: Role;
    createdBy: string | null;
    expiresAt: Date;
  }) => Promise<{ id: string; createdAt: Date; expiresAt: Date }>;
  /** Null when there is no such member. */
  createResetLink: (data: {
    tokenHash: string;
    userId: string;
    createdBy: string | null;
    expiresAt: Date;
  }) => Promise<{ id: string; expiresAt: Date } | null>;
  listPendingInvites: () => Promise<PendingInvite[]>;
  /** False when there is no pending invite with this id. */
  revokeInvite: (id: string) => Promise<boolean>;
}

const ROLES = ['admin', 'member'] as const;
const roleSchema = z.enum(ROLES, { message: `role must be one of: ${ROLES.join(', ')}` });

const roleBodySchema = z.object({ role: roleSchema }).strict();

function formatMember(m: MemberRecord) {
  return {
    id: m.id,
    name: m.name,
    role: m.role,
    status: m.disabledAt ? ('removed' as const) : ('active' as const),
    sign_in: m.signIn.map((s) => ({ provider: s.provider, username: s.username })),
    created_at: m.createdAt.toISOString(),
    last_sign_in_at: m.lastSignInAt ? m.lastSignInAt.toISOString() : null,
  };
}

function formatInvite(i: PendingInvite) {
  return {
    id: i.id,
    role: i.role,
    created_at: i.createdAt.toISOString(),
    expires_at: i.expiresAt.toISOString(),
    created_by: i.createdBy ? { id: i.createdBy.id, name: i.createdBy.name } : null,
  };
}

const memberNotFound = () => new AppError(404, 'Member not found');

function changed(result: MemberChange): MemberRecord {
  if (result === 'not_found') throw memberNotFound();
  if (result === 'last_admin') {
    throw new AppError(
      409,
      'This is the last admin who can sign in. Make someone else an admin first.',
      undefined,
      { reason: 'last_admin' },
    );
  }
  return result;
}

/**
 * Members and invites, for admins only (a Studio session or an admin's key).
 * Mounted at the router root: it owns /members and /invites.
 */
export function createMemberRoutes(deps: MemberRouteDeps): Router {
  const router = Router();
  const guard = [requireScope('manage'), requireAdmin()];

  /**
   * GET /api/v1/members
   * Every member, removed ones included, with how they sign in.
   */
  router.get('/members', ...guard, async (_req: Request, res: Response) => {
    const members = await deps.listMembers();
    res.json({ data: members.map(formatMember) });
  });

  /**
   * PATCH /api/v1/members/:id
   * Change a member's role. The change applies to their sessions and keys on
   * their next request.
   */
  router.patch('/members/:id', ...guard, async (req: Request, res: Response) => {
    const body = parseOrThrow(roleBodySchema, req.body ?? {});
    const member = changed(await deps.changeMemberRole(String(req.params.id), body.role));
    res.json(formatMember(member));
  });

  /**
   * POST /api/v1/members/:id/remove
   * Remove a member: they cannot sign in, their sessions end and their keys
   * stop until they are restored. Nobody removes themselves.
   */
  router.post('/members/:id/remove', ...guard, async (req: Request, res: Response) => {
    const id = String(req.params.id);
    if (req.apiKey!.userId === id) {
      throw new AppError(409, 'You cannot remove yourself. Ask another admin.', undefined, {
        reason: 'self',
      });
    }
    res.json(formatMember(changed(await deps.removeMember(id))));
  });

  /**
   * POST /api/v1/members/:id/restore
   * Let a removed member back in with the role they had; their keys work again.
   */
  router.post('/members/:id/restore', ...guard, async (req: Request, res: Response) => {
    const result = await deps.restoreMember(String(req.params.id));
    if (result === 'not_found') throw memberNotFound();
    res.json(formatMember(result));
  });

  /**
   * POST /api/v1/members/:id/reset-link
   * A single-use link, valid for a week, where the member sets a new password
   * (their first, for a member who signs in with GitHub only). The url is
   * only shown here.
   */
  router.post('/members/:id/reset-link', ...guard, async (req: Request, res: Response) => {
    const { token, tokenHash } = newLinkToken();
    const link = await deps.createResetLink({
      tokenHash,
      userId: String(req.params.id),
      createdBy: req.apiKey!.userId,
      expiresAt: new Date(Date.now() + LINK_TTL_MS),
    });
    if (!link) throw memberNotFound();
    res.status(201).json({ url: resetUrl(token), expires_at: link.expiresAt.toISOString() });
  });

  /**
   * GET /api/v1/invites
   * Invites nobody used yet that still work, newest first. Their links are
   * not shown again.
   */
  router.get('/invites', ...guard, async (_req: Request, res: Response) => {
    const pending = await deps.listPendingInvites();
    res.json({ data: pending.map(formatInvite) });
  });

  /**
   * POST /api/v1/invites
   * A single-use invite link, valid for a week, for one new member with
   * `role`. The url is only shown here.
   */
  router.post('/invites', ...guard, async (req: Request, res: Response) => {
    const body = parseOrThrow(roleBodySchema, req.body ?? {});
    const { token, tokenHash } = newLinkToken();
    const invite = await deps.createInvite({
      tokenHash,
      role: body.role,
      createdBy: req.apiKey!.userId,
      expiresAt: new Date(Date.now() + LINK_TTL_MS),
    });
    res.status(201).json({
      id: invite.id,
      url: inviteUrl(token),
      role: body.role,
      expires_at: invite.expiresAt.toISOString(),
    });
  });

  /**
   * DELETE /api/v1/invites/:id
   * Withdraw a pending invite; its link stops working.
   */
  router.delete('/invites/:id', ...guard, async (req: Request, res: Response) => {
    if (!(await deps.revokeInvite(String(req.params.id)))) {
      throw new AppError(404, 'Invite not found');
    }
    res.json({ success: true });
  });

  return router;
}
