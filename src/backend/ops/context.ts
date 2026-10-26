import type {
  AppData,
  AuditEntry,
  Notification,
  Post,
  Scope,
  SessionUser,
} from '../../domain/types';
import type { RoutingHooks } from '../workflow';
import type { Grant } from '../authz';
import { newId } from '../models';
import { scopeCovers } from '../authz';
import { isAssignmentLive } from '../authz';

export interface NotifyInput {
  userId: string;
  title: string;
  body: string;
  link?: string | null;
  category?: Notification['category'];
  dedupeKey?: string | null;
}

export interface OpContext {
  /** mutable draft of the whole data set */
  data: AppData;
  actor: SessionUser;
  now: string;
  hooks: RoutingHooks;
  audit: (
    action: string,
    entity: string,
    entityId: string | null,
    meta?: Record<string, unknown> | null,
    actorOverride?: { id: string | null; name: string },
  ) => void;
  notify: (input: NotifyInput) => void;
  notifyPost: (postCode: string, scope: Scope, input: Omit<NotifyInput, 'userId'>) => string[];
}

export function makeContext(
  data: AppData,
  actor: SessionUser,
  now: string,
): OpContext {
  const audit: OpContext['audit'] = (action, entity, entityId, meta, actorOverride) => {
    const entry: AuditEntry = {
      id: newId('au_'),
      actor_id: actorOverride ? actorOverride.id : actor.profile.id,
      actor_name: actorOverride ? actorOverride.name : actor.profile.full_name,
      action,
      entity,
      entity_id: entityId,
      meta: meta ?? null,
      created_at: now,
    };
    data.audit.unshift(entry);
    if (data.audit.length > 800) data.audit.length = 800;
  };

  const notify: OpContext['notify'] = (input) => {
    if (!input.userId) return;
    if (input.dedupeKey && data.notifications.some((n) => n.dedupe_key === input.dedupeKey && n.user_id === input.userId)) {
      return;
    }
    data.notifications.unshift({
      id: newId('nt_'),
      user_id: input.userId,
      title: input.title,
      body: input.body,
      link: input.link ?? null,
      category: input.category ?? 'system',
      dedupe_key: input.dedupeKey ?? null,
      read_at: null,
      created_at: now,
    });
    if (data.notifications.length > 400) data.notifications.length = 400;
  };

  const hooks: RoutingHooks = {
    postHasHolder: (postCode: string, scope: Scope) => postHasHolder(data, postCode, scope, now),
    postScopeType: (postCode: string) => data.posts.find((p) => p.code === postCode)?.scope_type ?? null,
  };

  const notifyPost: OpContext['notifyPost'] = (postCode, scope, input) => {
    const holders = data.assignments.filter(
      (a) => a.post_code === postCode && isAssignmentLive(a, now) && scopeCovers(postByCode(data, postCode), a.scope, scope),
    );
    const ids = [...new Set(holders.map((h) => h.user_id))];
    for (const userId of ids) notify({ ...input, userId, dedupeKey: input.dedupeKey ? `${input.dedupeKey}:${postCode}:${userId}` : null });
    return ids;
  };

  return { data, actor, now, hooks, audit, notify, notifyPost };
}

function postByCode(data: AppData, code: string): Post {
  return (
    data.posts.find((p) => p.code === code) ?? {
      code,
      name: code,
      scope_type: 'university',
      rank: 0,
      permissions: [],
      is_system: false,
      active: false,
    }
  );
}

export function postHasHolder(data: AppData, postCode: string, scope: Scope, now: string): boolean {
  const post = postByCode(data, postCode);
  return data.assignments.some(
    (a) =>
      a.post_code === postCode &&
      isAssignmentLive(a, now) &&
      scopeCovers(post, a.scope, scope) &&
      data.profiles.some((p) => p.id === a.user_id && p.status === 'active'),
  );
}

export function holderIds(data: AppData, postCode: string, scope: Scope, now: string): string[] {
  const post = postByCode(data, postCode);
  return [
    ...new Set(
      data.assignments
        .filter(
          (a) =>
            a.post_code === postCode &&
            isAssignmentLive(a, now) &&
            scopeCovers(post, a.scope, scope) &&
            data.profiles.some((p) => p.id === a.user_id && p.status === 'active'),
        )
        .map((a) => a.user_id),
    ),
  ];
}

export function grantsFor(data: AppData, userId: string, now: string): Grant[] {
  const profile = data.profiles.find((p) => p.id === userId);
  if (!profile) return [];
  return data.assignments
    .filter((a) => a.user_id === userId && isAssignmentLive(a, now))
    .map((a) => {
      const post = postByCode(data, a.post_code);
      return {
        assignment_id: a.id,
        post,
        scope: a.scope,
        permissions: post.permissions,
        starts_at: a.starts_at,
        ends_at: a.ends_at,
      };
    })
    .filter((g) => g.post.active);
}
