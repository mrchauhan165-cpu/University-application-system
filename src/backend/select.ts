import type {
  AppData,
  Application,
  ApplicationType,
  AuditEntry,
  DocumentMeta,
  Notice,
  Scope,
  SessionUser,
} from '../domain/types';
import type { Grant } from './authz';
import { applicationAccess, can, scopeCovers } from './authz';
import { profileSnapshot } from './models';
import { visibleNotices } from './ops/notices';

export interface StatsBucket {
  key: string;
  label: string;
  count: number;
}

export interface Stats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  returned: number;
  withdrawn: number;
  byStatus: StatsBucket[];
  byType: StatsBucket[];
  byPost: StatsBucket[];
  avgProcessingDays: number | null;
  medianProcessingDays: number | null;
  scopeLabel: string;
  applications: Application[];
}

export function scopeOf(org: Application['org']): Scope {
  return {
    faculty_id: org.faculty_id ?? null,
    department_id: org.department_id ?? null,
    batch_id: org.batch_id ?? null,
    section_id: org.section_id ?? null,
  };
}

export function visibleApplications(
  data: AppData,
  session: SessionUser,
  opts: { includeDrafts?: boolean } = {},
): Application[] {
  const typeById = new Map(data.applicationTypes.map((t) => [t.id, t]));
  return data.applications.filter((app) => {
    if (!opts.includeDrafts && app.status === 'draft' && app.applicant_id !== session.profile.id) {
      return false;
    }
    return applicationAccess(session, app, typeById.get(app.application_type_id)).canView;
  });
}

export function viewData(data: AppData, session: SessionUser, now: string): AppData {
  const grants: Grant[] = session.grants;
  const canManageUsers = can(grants, 'user.manage');
  const canAudit = can(grants, 'audit.view');
  const canRetention = can(grants, 'retention.manage');
  const canConfigure = can(grants, 'workflow.configure');
  const typeById = new Map(data.applicationTypes.map((t) => [t.id, t]));

  const applications = data.applications.filter((app) =>
    applicationAccess(session, app, typeById.get(app.application_type_id)).canView,
  );
  const appIds = new Set(applications.map((a) => a.id));

  const noticeList = visibleNotices(data, session.profile, grants, now);
  const noticeIds = new Set(noticeList.map((n) => n.id));

  const documents = data.documents.filter((d) => {
    if (d.application_id) {
      if (!appIds.has(d.application_id)) return false;
      const app = applications.find((a) => a.id === d.application_id);
      if (!app) return false;
      return applicationAccess(session, app, typeById.get(app.application_type_id)).canViewDocuments;
    }
    if (d.notice_id) return noticeIds.has(d.notice_id);
    return false;
  });

  const selfId = session.profile.id;
  const profileVisible = (id: string): boolean => {
    if (id === selfId) return true;
    if (canManageUsers) return true;
    const p = data.profiles.find((x) => x.id === id);
    if (!p) return false;
    const target = profileSnapshot(data, p);
    return grants.some(
      (g) =>
        scopeCovers(g.post, g.scope, {
          faculty_id: target.faculty_id ?? null,
          department_id: target.department_id ?? null,
          batch_id: target.batch_id ?? null,
          section_id: target.section_id ?? null,
        }) && (g.permissions.includes('application.view') || g.permissions.includes('statistics.view') || g.permissions.includes('notice.create')),
    );
  };

  const profiles = data.profiles.filter((p) => profileVisible(p.id));

  const assignments = data.assignments.filter((a) => {
    if (a.user_id === selfId) return true;
    if (canManageUsers) return true;
    const p = data.profiles.find((x) => x.id === a.user_id);
    if (!p) return false;
    const target = profileSnapshot(data, p);
    return grants.some((g) =>
      scopeCovers(g.post, g.scope, {
        faculty_id: target.faculty_id ?? null,
        department_id: target.department_id ?? null,
        batch_id: target.batch_id ?? null,
        section_id: target.section_id ?? null,
      }),
    );
  });

  const workflows = canConfigure || can(grants, 'application.view')
    ? data.workflows
    : data.workflows.filter(
        (w) =>
          data.applications.some((a) => a.applicant_id === selfId && a.workflow_version_id === w.id),
      );

  const applicationTypes = canConfigure
    ? data.applicationTypes
    : data.applicationTypes.filter(
        (t) =>
          (t.active && t.applicant_kinds.includes(session.profile.kind)) ||
          applications.some((a) => a.application_type_id === t.id),
      );

  const audit: AuditEntry[] = canAudit ? data.audit.slice(0, 300) : [];

  return {
    profiles,
    faculties: data.faculties,
    departments: data.departments,
    batches: data.batches,
    sections: data.sections,
    posts: data.posts,
    assignments,
    applicationTypes,
    workflows,
    applications,
    actions: data.actions
      .filter((a) => appIds.has(a.application_id))
      .map((a) => {
        const app = applications.find((x) => x.id === a.application_id);
        const isOwnApplication = app?.applicant_id === selfId;
        return isOwnApplication ? { ...a, remarks_internal: null } : a;
      }),
    statusEvents: data.statusEvents.filter(
      (e) => appIds.has(e.application_id) && e.visible,
    ),
    documents,
    notifications: data.notifications.filter((n) => n.user_id === selfId),
    notices: noticeList,
    noticeReads: data.noticeReads.filter((r) => r.user_id === selfId),
    audit,
    retentionJobs: canRetention ? data.retentionJobs : [],
    legalHolds: canRetention ? data.legalHolds : [],
    deletionAudits: canRetention ? data.deletionAudits : [],
    settings: data.settings,
  };
}

export function documentsForApplication(
  data: AppData,
  session: SessionUser,
  appId: string,
): DocumentMeta[] {
  const app = data.applications.find((a) => a.id === appId);
  if (!app) return [];
  const type = data.applicationTypes.find((t) => t.id === app.application_type_id);
  const decision = applicationAccess(session, app, type);
  if (!decision.canViewDocuments) return [];
  return data.documents.filter((d) => d.application_id === appId);
}

const STATUS_GROUPS: { key: string; label: string; match: (a: Application) => boolean }[] = [
  { key: 'draft', label: 'Draft', match: (a) => a.status === 'draft' },
  { key: 'submitted', label: 'Submitted', match: (a) => a.status === 'submitted' },
  { key: 'under_review', label: 'Under review', match: (a) => a.status === 'under_review' || a.status === 'resubmitted' },
  { key: 'returned', label: 'Returned for correction', match: (a) => a.status === 'returned' },
  { key: 'further_pending', label: 'Further approval pending', match: (a) => a.status === 'further_pending' },
  { key: 'completed', label: 'Completed', match: (a) => a.status === 'completed' || a.status === 'approved' },
  { key: 'rejected', label: 'Rejected', match: (a) => a.status === 'rejected' },
  { key: 'withdrawn', label: 'Withdrawn', match: (a) => a.status === 'withdrawn' },
];

export interface StatsFilter {
  from?: string | null;
  to?: string | null;
  typeId?: string | null;
  status?: string | null;
  scope?: Scope | null;
}

export function computeStats(
  data: AppData,
  apps: Application[],
  filter: StatsFilter,
  label = 'Your scope',
): Stats {
  const types = new Map<string, ApplicationType>(data.applicationTypes.map((t) => [t.id, t]));
  let list = apps.filter((a) => a.status !== 'draft');
  if (filter.typeId) list = list.filter((a) => a.application_type_id === filter.typeId);
  if (filter.status) {
    const group = STATUS_GROUPS.find((g) => g.key === filter.status);
    if (group) list = list.filter(group.match);
  }
  const inRange = (iso: string | null): boolean => {
    if (!iso) return false;
    const t = Date.parse(iso);
    if (filter.from && t < Date.parse(filter.from)) return false;
    if (filter.to && t > Date.parse(`${filter.to}T23:59:59.999Z`)) return false;
    return true;
  };
  if (filter.from || filter.to) list = list.filter((a) => inRange(a.submitted_at));

  const count = (fn: (a: Application) => boolean) => list.filter(fn).length;

  const durations = list
    .filter((a) => ['completed', 'approved', 'rejected'].includes(a.status) && a.decided_at && a.submitted_at)
    .map((a) => (Date.parse(a.decided_at as string) - Date.parse(a.submitted_at as string)) / 86400000)
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);

  const byStatus = STATUS_GROUPS.map((g) => ({ key: g.key, label: g.label, count: list.filter(g.match).length })).filter(
    (b) => b.count > 0,
  );
  const byTypeMap = new Map<string, number>();
  for (const a of list) byTypeMap.set(a.application_type_id, (byTypeMap.get(a.application_type_id) ?? 0) + 1);
  const byType = [...byTypeMap.entries()]
    .map(([id, c]) => ({ key: id, label: types.get(id)?.name ?? 'Unknown type', count: c }))
    .sort((a, b) => b.count - a.count);
  const byPostMap = new Map<string, number>();
  for (const a of list) {
    if (!a.current_post) continue;
    byPostMap.set(a.current_post, (byPostMap.get(a.current_post) ?? 0) + 1);
  }
  const byPost = [...byPostMap.entries()]
    .map(([code, c]) => ({
      key: code,
      label: data.posts.find((p) => p.code === code)?.name ?? code,
      count: c,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    total: list.length,
    pending: count((a) => ['submitted', 'under_review', 'resubmitted', 'further_pending', 'returned'].includes(a.status)),
    approved: count((a) => a.status === 'completed' || a.status === 'approved'),
    rejected: count((a) => a.status === 'rejected'),
    returned: count((a) => a.status === 'returned'),
    withdrawn: count((a) => a.status === 'withdrawn'),
    byStatus,
    byType,
    byPost,
    avgProcessingDays: durations.length ? durations.reduce((s, n) => s + n, 0) / durations.length : null,
    medianProcessingDays: durations.length
      ? durations.length % 2
        ? durations[(durations.length - 1) / 2]
        : (durations[durations.length / 2 - 1] + durations[durations.length / 2]) / 2
      : null,
    scopeLabel: label,
    applications: list,
  };
}

/** Scope apps available to the current user for statistics, honouring grants. */
export function statisticsScope(data: AppData, session: SessionUser): { apps: Application[]; label: string } | null {
  const grants = session.grants.filter((g) => g.permissions.includes('statistics.view'));
  if (!grants.length) return null;
  const typeById = new Map(data.applicationTypes.map((t) => [t.id, t]));
  const uni = grants.find((g) => g.post.scope_type === 'university');
  if (uni) {
    const apps = data.applications.filter((a) => a.status !== 'draft' && a.applicant_id !== session.profile.id);
    return { apps, label: 'University-wide' };
  }
  const allowed = data.applications.filter((a) => {
    if (a.status === 'draft') return false;
    if (a.applicant_id === session.profile.id) return false;
    const scope = scopeOf(a.org);
    return grants.some((g) => scopeCovers(g.post, g.scope, scope));
  });
  const uniq = [...new Set(allowed)];
  const labelGrant = grants[0];
  const dept = data.departments.find((d) => d.id === labelGrant.scope.department_id);
  const fac = data.faculties.find((f) => f.id === labelGrant.scope.faculty_id);
  const batch = data.batches.find((b) => b.id === labelGrant.scope.batch_id);
  const sec = data.sections.find((s) => s.id === labelGrant.scope.section_id);
  const label =
    (sec && batch ? `${batch.label} · Section ${sec.name}` : batch?.label) ??
    dept?.name ??
    fac?.name ??
    'Your scope';
  void typeById;
  return { apps: uniq, label };
}

export function noticeStats(notices: Notice[], reads: { notice_id: string; user_id: string }[]): { total: number; published: number; unreadForAudience: number } {
  const published = notices.filter((n) => n.status === 'published');
  const readIds = new Set(reads.map((r) => r.notice_id));
  return {
    total: notices.length,
    published: published.length,
    unreadForAudience: published.filter((n) => !readIds.has(n.id)).length,
  };
}
