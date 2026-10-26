import type {
  Application,
  ApplicationType,
  Assignment,
  Grant,
  Permission,
  Post,
  Profile,
  Scope,
  ScopeType,
} from '../domain/types';

export type { Grant };

export interface SessionContext {
  profile: Profile;
  grants: Grant[];
}

/** An assignment is live when active, started and not ended (as of `now`). */
export function isAssignmentLive(a: Assignment, nowIso: string): boolean {
  if (!a.active) return false;
  if (a.starts_at && a.starts_at > nowIso) return false;
  if (a.ends_at && a.ends_at <= nowIso) return false;
  return true;
}

export function buildGrants(
  profile: Profile,
  assignments: Assignment[],
  posts: Post[],
  nowIso: string,
): Grant[] {
  const byCode = new Map(posts.map((p) => [p.code, p]));
  const now = nowIso || new Date().toISOString();
  const grants: Grant[] = [];
  for (const a of assignments) {
    if (a.user_id !== profile.id) continue;
    if (!isAssignmentLive(a, now)) continue;
    if (profile.status !== 'active') continue;
    const post = byCode.get(a.post_code);
    if (!post || !post.active) continue;
    grants.push({
      assignment_id: a.id,
      post,
      scope: a.scope,
      permissions: post.permissions,
      starts_at: a.starts_at,
      ends_at: a.ends_at,
    });
  }
  return grants;
}

export function can(
  grants: Grant[],
  permission: Permission,
  target?: Scope | null,
): boolean {
  return grants.some(
    (g) => g.permissions.includes(permission) && (!target || scopeCovers(g.post, g.scope, target)),
  );
}

/** Does the granted assignment scope cover the target scope? */
export function scopeCovers(post: Post, granted: Scope, target: Scope): boolean {
  switch (post.scope_type) {
    case 'university':
      return true;
    case 'faculty':
      if (!granted.faculty_id) return false;
      return (target.faculty_id ?? null) === granted.faculty_id;
    case 'department':
      if (!granted.department_id) return false;
      return (target.department_id ?? null) === granted.department_id;
    case 'batch':
      if (!granted.batch_id) return false;
      return (target.batch_id ?? null) === granted.batch_id;
    case 'section':
      if (!granted.section_id) return false;
      return (target.section_id ?? null) === granted.section_id;
    default:
      return false;
  }
}

/** Can this grant publish a notice covering `target`? */
export function grantCoversScopeType(post: Post, granted: Scope, target: Scope): boolean {
  return scopeCovers(post, granted, target);
}

export function scopeTypeForPost(post: Post): ScopeType {
  return post.scope_type;
}

/** Posts the user currently holds (used for self-approval detection & routing). */
export function heldPostCodes(grants: Grant[]): string[] {
  return [...new Set(grants.map((g) => g.post.code))];
}

export function holdsPostInScope(grants: Grant[], postCode: string, target: Scope): boolean {
  return grants.some((g) => g.post.code === postCode && scopeCovers(g.post, g.scope, target));
}

export function findGrant(
  grants: Grant[],
  postCode: string,
  target: Scope,
): Grant | undefined {
  return grants.find((g) => g.post.code === postCode && scopeCovers(g.post, g.scope, target));
}

/**
 * Full permission decision for viewing one application.
 * Order matters: citizens of the same record, applicants, explicitly configured
 * extra viewers, and posts the application has actually passed through.
 */
export interface AccessDecision {
  canView: boolean;
  canAct: boolean;
  canViewDocuments: boolean
  reason: string;
}

export function applicationAccess(
  session: SessionContext,
  app: Application,
  type: ApplicationType | undefined,
): AccessDecision {
  const { profile, grants } = session;
  if (app.deleted_at) return { canView: false, canAct: false, canViewDocuments: false, reason: 'Deleted' };
  if (profile.status !== 'active') {
    return { canView: false, canAct: false, canViewDocuments: false, reason: 'Account not active' };
  }
  // 1. Applicant always sees their own application (but can never act on it).
  if (app.applicant_id === profile.id) {
    return {
      canView: true,
      canAct: false,
      canViewDocuments: true,
      reason: 'Applicant',
    };
  }

  // 2. Posts that the application has passed through, or is currently sitting at,
  //    limited to the current holder of that post inside the application scope.
  const postsSeen = new Set<string>(app.post_codes_seen);
  if (app.current_post) postsSeen.add(app.current_post);
  const extra = new Set(type?.extra_viewer_posts ?? []);

  let viewGrant: Grant | undefined;
  let actGrant: Grant | undefined;

  for (const g of grants) {
    const coversApp = scopeCovers(g.post, g.scope, app.org);
    const related = postsSeen.has(g.post.code) || extra.has(g.post.code);
    if (!coversApp || !related) continue;
    if (g.permissions.includes('application.view') && !viewGrant) viewGrant = g;
    const isCurrentStagePost = app.current_post === g.post.code && !isFinal(app);
    if (isCurrentStagePost && g.permissions.includes('application.act') && !actGrant) {
      actGrant = g;
    }
  }

  // 3. Confidential applications require a separately authorised break-glass
  //    permission — being a workflow officer or the system admin is not enough.
  if (viewGrant && app.confidential) {
    const breakGlass = grants.some(
      (g) => g.permissions.includes('confidential.breakglass') && scopeCovers(g.post, g.scope, app.org),
    );
    // A confidential file may only be read by the officer who is currently
    // required to act on it, or by a separately authorised break-glass holder.
    if (!breakGlass && !actGrant) {
      return {
        canView: false,
        canAct: false,
        canViewDocuments: false,
        reason: 'Confidential — requires explicitly authorised access',
      };
    }
  }

  const canView = Boolean(viewGrant);
  const canAct = Boolean(actGrant) && app.applicant_id !== profile.id;
  const canViewDocuments =
    canView &&
    ((viewGrant && viewGrant.permissions.includes('document.view')) || app.applicant_id === profile.id);

  return {
    canView,
    canAct,
    canViewDocuments,
    reason: canView ? (actGrant ? 'Assigned post' : 'Post history') : 'No current assignment covers this record',
  };
}

export function isFinal(app: Application): boolean {
  return ['approved', 'completed', 'rejected', 'withdrawn'].includes(app.status);
}

export function inScopeForAny(grants: Grant[], permission: Permission, target: Scope): boolean {
  return grants.some((g) => g.permissions.includes(permission) && scopeCovers(g.post, g.scope, target));
}
