import type { Notice, NoticeStatus, Profile, Scope, ScopeType } from '../../domain/types';
import type { Grant } from '../authz';
import { scopeCovers } from '../authz';
import type { OpContext } from './context';
import { fail } from '../errors';
import {
  findBatch,
  findDepartment,
  findFaculty,
  findSection,
  newId,
  profileSnapshot,
  scopeLabel,
} from '../models';

export interface ScopeOption {
  scope_type: ScopeType;
  scope: Scope;
  label: string;
}

function scopeForType(type: ScopeType, seed: Scope): Scope {
  switch (type) {
    case 'university':
      return { faculty_id: null, department_id: null, batch_id: null, section_id: null };
    case 'faculty':
      return { faculty_id: seed.faculty_id ?? null };
    case 'department':
      return { faculty_id: seed.faculty_id ?? null, department_id: seed.department_id ?? null };
    case 'batch':
      return {
        faculty_id: seed.faculty_id ?? null,
        department_id: seed.department_id ?? null,
        batch_id: seed.batch_id ?? null,
      };
    case 'section':
      return {
        faculty_id: seed.faculty_id ?? null,
        department_id: seed.department_id ?? null,
        batch_id: seed.batch_id ?? null,
        section_id: seed.section_id ?? null,
      };
  }
}

/** Every concrete target a grant may publish to, most specific first. */
export function publishableScopes(
  data: OpContext['data'],
  grants: Grant[],
): ScopeOption[] {
  const out: ScopeOption[] = [];
  const seen = new Set<string>();
  const push = (type: ScopeType, scope: Scope) => {
    const key = `${type}:${scope.faculty_id ?? ''}:${scope.department_id ?? ''}:${scope.batch_id ?? ''}:${scope.section_id ?? ''}`;
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ scope_type: type, scope, label: scopeLabel(data, scope) });
  };
  for (const g of grants) {
    if (!g.permissions.includes('notice.create')) continue;
    if (g.post.scope_type === 'university' && g.permissions.includes('notice.university')) {
      push('university', {});
    }
    if (g.post.scope_type === 'faculty' && g.scope.faculty_id) {
      push('faculty', scopeForType('faculty', g.scope));
    }
    if (g.post.scope_type === 'department' && g.scope.department_id) {
      push('department', scopeForType('department', g.scope));
    }
    if (g.post.scope_type === 'batch' && g.scope.batch_id) {
      push('batch', scopeForType('batch', g.scope));
    }
    if (g.post.scope_type === 'section' && g.scope.section_id) {
      push('section', scopeForType('section', g.scope));
    }
  }
  return out;
}

export function mayPublishScope(
  grants: Grant[],
  scopeType: ScopeType,
  scope: Scope,
): boolean {
  return grants.some((g) => {
    if (!g.permissions.includes('notice.create')) return false;
    if (scopeType === 'university') {
      return g.post.scope_type === 'university' && g.permissions.includes('notice.university');
    }
    return scopeCovers(g.post, g.scope, scope);
  });
}

function normalizeScope(scopeType: ScopeType, scope: Scope): Scope {
  switch (scopeType) {
    case 'university':
      return { faculty_id: null, department_id: null, batch_id: null, section_id: null };
    case 'faculty':
      return { faculty_id: scope.faculty_id ?? null };
    case 'department':
      return { faculty_id: scope.faculty_id ?? null, department_id: scope.department_id ?? null };
    case 'batch':
      return {
        faculty_id: scope.faculty_id ?? null,
        department_id: scope.department_id ?? null,
        batch_id: scope.batch_id ?? null,
      };
    case 'section':
      return {
        faculty_id: scope.faculty_id ?? null,
        department_id: scope.department_id ?? null,
        batch_id: scope.batch_id ?? null,
        section_id: scope.section_id ?? null,
      };
  }
}

export interface NoticeInput {
  id?: string;
  title: string;
  body: string;
  scope_type: ScopeType;
  scope: Scope;
  audience: Notice['audience'];
  publish_at?: string | null;
  expires_at?: string | null;
  status?: NoticeStatus;
}

export function saveNotice(ctx: OpContext, input: NoticeInput): Notice {
  const { data, actor, now } = ctx;
  const title = input.title.trim();
  const body = input.body.trim();
  if (title.length < 3) fail('validation', 'Give the notice a title of at least 3 characters.', { fields: { title: 'Required' } });
  if (body.length < 3) fail('validation', 'Notice content is required.', { fields: { body: 'Required' } });
  if (title.length > 200) fail('validation', 'Notice title must be 200 characters or fewer.');
  if (body.length > 20000) fail('validation', 'Notice content must be 20,000 characters or fewer.');
  const scope = normalizeScope(input.scope_type, input.scope);
  if (!mayPublishScope(actor.grants, input.scope_type, scope)) {
    fail('forbidden', 'Your current post is not authorised to publish notices for that audience.');
  }
  if (input.scope_type !== 'university') {
    if (input.scope_type === 'faculty' && !findFaculty(data, scope.faculty_id)) fail('validation', 'Choose a valid faculty.');
    if (input.scope_type === 'department' && !findDepartment(data, scope.department_id)) fail('validation', 'Choose a valid department.');
    if (input.scope_type === 'batch' && !findBatch(data, scope.batch_id)) fail('validation', 'Choose a valid batch.');
    if (input.scope_type === 'section' && !findSection(data, scope.section_id)) fail('validation', 'Choose a valid section.');
  }
  const publishAt = input.publish_at ? new Date(input.publish_at).toISOString() : null;
  const expiresAt = input.expires_at ? new Date(input.expires_at).toISOString() : null;
  if (expiresAt && publishAt && expiresAt <= publishAt) {
    fail('validation', 'Expiry must be after the publish date.', { fields: { expires_at: 'Must be later than publish date' } });
  }

  const resolvedStatus = (status: NoticeStatus): NoticeStatus =>
    status === 'published' && publishAt && publishAt > now ? 'scheduled' : status;

  if (input.id) {
    const existing = data.notices.find((n) => n.id === input.id);
    if (!existing) fail('not_found', 'Notice not found.');
    // Authorship is historical: the original creator stays attributed.
    const stillAllowedForExisting =
      existing.created_by === actor.profile.id
        ? mayPublishScope(actor.grants, input.scope_type, scope)
        : false;
    const isAdminFix = actor.grants.some(
      (g) => g.permissions.includes('notice.university') && g.post.scope_type === 'university',
    );
    if (!stillAllowedForExisting && !isAdminFix) {
      fail('forbidden', 'You can no longer edit this notice with your current assignment.');
    }
    existing.title = title;
    existing.body = body;
    existing.scope_type = input.scope_type;
    existing.scope = scope;
    existing.scope_label = scopeLabel(data, scope);
    existing.audience = input.audience;
    existing.publish_at = publishAt;
    existing.expires_at = expiresAt;
    if (input.status) existing.status = resolvedStatus(input.status);
    existing.updated_at = now;
    existing.version += 1;
    ctx.audit('notice.update', 'notice', existing.id, { version: existing.version, scope: existing.scope_label });
    return refreshNoticeState(ctx, existing);
  }

  const notice: Notice = {
    id: newId('no_'),
    title,
    body,
    status: resolvedStatus(input.status ?? 'draft'),
    publish_at: publishAt,
    expires_at: expiresAt,
    created_by: actor.profile.id,
    creator_name: actor.profile.full_name,
    creator_post: actor.postCodes[0] ?? null,
    creator_code: actor.profile.user_code,
    scope,
    scope_type: input.scope_type,
    scope_label: scopeLabel(data, scope),
    audience: input.audience,
    attachments: [],
    created_at: now,
    updated_at: now,
    version: 1,
  };
  data.notices.unshift(notice);
  ctx.audit('notice.create', 'notice', notice.id, { scope_type: input.scope_type, scope: notice.scope_label });
  return refreshNoticeState(ctx, notice);
}

export function publishNotice(ctx: OpContext, noticeId: string): Notice {
  const notice = ctx.data.notices.find((n) => n.id === noticeId);
  if (!notice) fail('not_found', 'Notice not found.');
  if (!mayPublishScope(ctx.actor.grants, notice.scope_type, notice.scope)) {
    fail('forbidden', 'Your current post is not authorised to publish this notice.');
  }
  if (!notice.publish_at) notice.publish_at = ctx.now;
  notice.status = new Date(notice.publish_at) > new Date(ctx.now) ? 'scheduled' : 'published';
  notice.updated_at = ctx.now;
  ctx.audit('notice.publish', 'notice', notice.id, { status: notice.status, scope: notice.scope_label });
  if (notice.status === 'published') notifyAudience(ctx, notice);
  return notice;
}

export function archiveNotice(ctx: OpContext, noticeId: string): Notice {
  const notice = ctx.data.notices.find((n) => n.id === noticeId);
  if (!notice) fail('not_found', 'Notice not found.');
  if (!mayPublishScope(ctx.actor.grants, notice.scope_type, notice.scope)) {
    fail('forbidden', 'Your current post is not authorised to archive this notice.');
  }
  notice.status = 'archived';
  notice.updated_at = ctx.now;
  ctx.audit('notice.archive', 'notice', notice.id, null);
  return notice;
}

export function deleteNotice(ctx: OpContext, noticeId: string): void {
  const notice = ctx.data.notices.find((n) => n.id === noticeId);
  if (!notice) return;
  if (!mayPublishScope(ctx.actor.grants, notice.scope_type, notice.scope)) {
    fail('forbidden', 'Your current post is not authorised to delete this notice.');
  }
  ctx.data.notices = ctx.data.notices.filter((n) => n.id !== noticeId);
  ctx.data.documents = ctx.data.documents.filter((d) => d.notice_id !== noticeId);
  ctx.data.noticeReads = ctx.data.noticeReads.filter((r) => r.notice_id !== noticeId);
  ctx.audit('notice.delete', 'notice', noticeId, { title: notice.title });
}

/** Applies scheduled → published → expired transitions. */
export function refreshNoticeState(ctx: OpContext, notice: Notice): Notice {
  const now = ctx.now;
  if (notice.status === 'scheduled' && notice.publish_at && notice.publish_at <= now) {
    notice.status = 'published';
    notifyAudience(ctx, notice);
  }
  if (
    (notice.status === 'published' || notice.status === 'scheduled') &&
    notice.expires_at &&
    notice.expires_at <= now
  ) {
    notice.status = 'expired';
  }
  return notice;
}

export function visibleNotices(
  data: OpContext['data'],
  profile: Profile,
  grants: Grant[],
  now: string,
): Notice[] {
  const snap = profileSnapshot(data, profile);
  const isPublisher = grants.some((g) => g.permissions.includes('notice.create'));
  return data.notices.filter((n) => {
    if (n.status === 'archived') return n.created_by === profile.id;
    if (n.created_by === profile.id) return true;
    if (n.status !== 'published' && n.status !== 'expired') {
      return isPublisher && mayPublishScope(grants, n.scope_type, n.scope);
    }
    if (n.status === 'published' && n.publish_at && n.publish_at > now) return false;
    if (n.audience === 'students' && profile.kind !== 'student') return false;
    if (n.audience === 'staff' && profile.kind === 'student') return false;
    if (!scopeMatchesProfile(n.scope_type, n.scope, snap)) return false;
    return true;
  });
}

export function scopeMatchesProfile(
  scopeType: ScopeType,
  scope: Scope,
  snap: ReturnType<typeof profileSnapshot>,
): boolean {
  switch (scopeType) {
    case 'university':
      return true;
    case 'faculty':
      return Boolean(scope.faculty_id) && snap.faculty_id === scope.faculty_id;
    case 'department':
      return Boolean(scope.department_id) && snap.department_id === scope.department_id;
    case 'batch':
      return Boolean(scope.batch_id) && snap.batch_id === scope.batch_id;
    case 'section':
      return Boolean(scope.section_id) && snap.section_id === scope.section_id;
    default:
      return false;
  }
}

export function notifyAudience(ctx: OpContext, notice: Notice): void {
  const targets = ctx.data.profiles.filter(
    (p) =>
      p.status === 'active' &&
      p.id !== notice.created_by &&
      (notice.audience === 'everyone' ||
        (notice.audience === 'students' ? p.kind === 'student' : p.kind !== 'student')) &&
      scopeMatchesProfile(notice.scope_type, notice.scope, profileSnapshot(ctx.data, p)),
  );
  for (const p of targets) {
    ctx.notify({
      userId: p.id,
      title: 'New notice published',
      body: notice.title,
      link: `#/notices/${notice.id}`,
      category: 'notice',
      dedupeKey: `notice:${notice.id}:${p.id}`,
    });
  }
}

export function markNoticeRead(ctx: OpContext, noticeId: string): void {
  const notice = ctx.data.notices.find((n) => n.id === noticeId);
  if (!notice) fail('not_found', 'Notice not found.');
  const userId = ctx.actor.profile.id;
  const existing = ctx.data.noticeReads.find((r) => r.notice_id === noticeId && r.user_id === userId);
  if (existing) return;
  ctx.data.noticeReads.push({ notice_id: noticeId, user_id: userId, read_at: ctx.now });
}

export function markAllNoticesRead(ctx: OpContext, noticeIds: string[]): void {
  const userId = ctx.actor.profile.id;
  for (const id of noticeIds) {
    if (ctx.data.noticeReads.some((r) => r.notice_id === id && r.user_id === userId)) continue;
    ctx.data.noticeReads.push({ notice_id: id, user_id: userId, read_at: ctx.now });
  }
}

/**
 * Moves scheduled notices to published (and published notices to expired) when
 * their time windows pass. Returns true when anything changed so the caller can
 * persist. Runs without a user context because it is a system transition.
 */
export function sweepNotices(data: OpContext['data'], now: string): boolean {
  let changed = false;
  for (const notice of data.notices) {
    if (notice.status === 'scheduled' && notice.publish_at && notice.publish_at <= now) {
      notice.status = 'published';
      notice.updated_at = now;
      changed = true;
      for (const p of data.profiles) {
        if (p.status !== 'active' || p.id === notice.created_by) continue;
        if (notice.audience === 'students' && p.kind !== 'student') continue;
        if (notice.audience === 'staff' && p.kind === 'student') continue;
        if (!scopeMatchesProfile(notice.scope_type, notice.scope, profileSnapshot(data, p))) continue;
        const dedupe = `notice:${notice.id}:${p.id}`;
        if (data.notifications.some((n) => n.user_id === p.id && n.dedupe_key === dedupe)) continue;
        data.notifications.unshift({
          id: newId('nt_'),
          user_id: p.id,
          title: 'New notice published',
          body: notice.title,
          link: `#/notices/${notice.id}`,
          category: 'notice',
          dedupe_key: dedupe,
          read_at: null,
          created_at: now,
        });
      }
    }
    if (
      (notice.status === 'published' || notice.status === 'scheduled') &&
      notice.expires_at &&
      notice.expires_at <= now
    ) {
      notice.status = 'expired';
      notice.updated_at = now;
      changed = true;
    }
  }
  return changed;
}
