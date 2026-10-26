import type {
  AppData,
  Application,
  ApplicationType,
  Assignment,
  DocumentMeta,
  Notice,
  SessionUser,
  WorkflowVersion,
} from '../../domain/types';
import { SCOPE_LABEL_FALLBACK } from './constants';

export function typeById(data: AppData, id: string | null | undefined): ApplicationType | undefined {
  return id ? data.applicationTypes.find((t) => t.id === id) : undefined;
}

export function typeName(data: AppData, id: string): string {
  return typeById(data, id)?.name ?? 'Application';
}

export function workflowOf(data: AppData, app: Application): WorkflowVersion | undefined {
  return data.workflows.find((w) => w.id === app.workflow_version_id);
}

export function postName(data: AppData, code: string | null | undefined): string {
  if (!code) return '—';
  return data.posts.find((p) => p.code === code)?.name ?? code;
}

export function profileById(data: AppData, id: string | null | undefined) {
  return id ? data.profiles.find((p) => p.id === id) : undefined;
}

export function facultyName(data: AppData, id: string | null | undefined): string {
  return data.faculties.find((f) => f.id === id)?.name ?? SCOPE_LABEL_FALLBACK;
}

export function departmentName(data: AppData, id: string | null | undefined): string {
  return data.departments.find((d) => d.id === id)?.name ?? SCOPE_LABEL_FALLBACK;
}

export function batchLabel(data: AppData, id: string | null | undefined): string {
  return data.batches.find((b) => b.id === id)?.label ?? SCOPE_LABEL_FALLBACK;
}

export function sectionName(data: AppData, id: string | null | undefined): string {
  const section = data.sections.find((s) => s.id === id);
  return section ? `Section ${section.name}` : SCOPE_LABEL_FALLBACK;
}

export function applicationOrgText(_data: AppData, app: Application): string {
  const parts: string[] = [];
  if (app.org.batch_label) parts.push(app.org.batch_label);
  if (app.org.section_name) parts.push(`Section ${app.org.section_name}`);
  if (app.org.department_name) parts.push(app.org.department_name);
  if (app.org.faculty_name) parts.push(app.org.faculty_name);
  return parts.join(' · ') || 'University-wide';
}

export function assignmentScopeText(data: AppData, assignment: Assignment): string {
  const s = assignment.scope;
  const parts: string[] = [];
  const batch = data.batches.find((b) => b.id === s.batch_id);
  const section = data.sections.find((x) => x.id === s.section_id);
  const dept = data.departments.find((d) => d.id === s.department_id);
  const fac = data.faculties.find((f) => f.id === s.faculty_id);
  if (batch) parts.push(batch.label);
  if (section) parts.push(`Section ${section.name}`);
  if (dept) parts.push(dept.name);
  if (fac) parts.push(fac.name);
  return parts.length ? parts.join(' · ') : 'University-wide';
}

export function scopeText(
  data: AppData,
  scope: { faculty_id?: string | null; department_id?: string | null; batch_id?: string | null; section_id?: string | null },
  scopeType?: string,
): string {
  if (scopeType === 'university') return 'University-wide';
  const parts: string[] = [];
  const batch = data.batches.find((b) => b.id === scope.batch_id);
  const section = data.sections.find((x) => x.id === scope.section_id);
  const dept = data.departments.find((d) => d.id === scope.department_id);
  const fac = data.faculties.find((f) => f.id === scope.faculty_id);
  if (batch) parts.push(batch.label);
  if (section) parts.push(`Section ${section.name}`);
  if (dept) parts.push(dept.name);
  if (fac) parts.push(fac.name);
  return parts.length ? parts.join(' · ') : 'University-wide';
}

/** Applications currently sitting at one of the user's posts (their action queue). */
export function pendingForSession(data: AppData, session: SessionUser): Application[] {
  return data.applications
    .filter(
      (a) =>
        a.current_post &&
        session.postCodes.includes(a.current_post) &&
        a.applicant_id !== session.profile.id &&
        ['submitted', 'under_review', 'resubmitted', 'further_pending'].includes(a.status),
    )
    .sort((a, b) => (a.submitted_at ?? '') < (b.submitted_at ?? '') ? -1 : 1);
}

/** Applications that have passed through one of the user's current posts. */
export function historyForSession(data: AppData, session: SessionUser): Application[] {
  return data.applications
    .filter(
      (a) =>
        a.applicant_id !== session.profile.id &&
        a.post_codes_seen.some((code) => session.postCodes.includes(code)),
    )
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

export function myApplications(data: AppData, session: SessionUser): Application[] {
  return data.applications
    .filter((a) => a.applicant_id === session.profile.id)
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

export function noticesUnread(data: AppData, session: SessionUser): Notice[] {
  const readIds = new Set(data.noticeReads.map((r) => r.notice_id));
  return data.notices.filter((n) => n.status === 'published' && !readIds.has(n.id) && n.created_by !== session.profile.id);
}

export function documentsOf(data: AppData, appId: string): DocumentMeta[] {
  return data.documents.filter((d) => d.application_id === appId);
}

export function canActOn(_data: AppData, session: SessionUser, app: Application): boolean {
  if (app.applicant_id === session.profile.id) return false;
  if (!app.current_post || !session.postCodes.includes(app.current_post)) return false;
  if (!['submitted', 'under_review', 'resubmitted', 'further_pending'].includes(app.status)) return false;
  return session.grants.some(
    (g) =>
      g.post.code === app.current_post &&
      g.permissions.includes('application.act') &&
      scopeMatches(g.post.scope_type, g.scope, app),
  );
}

function scopeMatches(
  _scopeType: string,
  scope: { faculty_id?: string | null; department_id?: string | null; batch_id?: string | null; section_id?: string | null },
  app: Application,
): boolean {
  const s = scope;
  if (s.section_id) return app.org.section_id === s.section_id;
  if (s.batch_id) return app.org.batch_id === s.batch_id;
  if (s.department_id) return app.org.department_id === s.department_id;
  if (s.faculty_id) return app.org.faculty_id === s.faculty_id;
  return true;
}

export function currentMentor(data: AppData, sectionId: string | null | undefined): string | null {
  if (!sectionId) return null;
  const assignment = data.assignments.find(
    (a) => a.active && a.post_code === 'MENTOR' && a.scope.section_id === sectionId,
  );
  return assignment ? profileById(data, assignment.user_id)?.full_name ?? null : null;
}

export function statsFor(apps: Application[]) {
  const open = apps.filter((a) => ['submitted', 'under_review', 'resubmitted', 'further_pending'].includes(a.status));
  const returned = apps.filter((a) => a.status === 'returned');
  const done = apps.filter((a) => a.status === 'completed' || a.status === 'approved');
  const rejected = apps.filter((a) => a.status === 'rejected');
  const drafts = apps.filter((a) => a.status === 'draft');
  return { open, returned, done, rejected, drafts };
}

/** Deterministic pseudo-chart data from real counts (no fabricated metrics). */
export function countBy<T>(items: T[], key: (t: T) => string): { key: string; count: number }[] {
  const map = new Map<string, number>();
  for (const item of items) map.set(key(item), (map.get(key(item)) ?? 0) + 1);
  return [...map.entries()].map(([k, count]) => ({ key: k, count })).sort((a, b) => b.count - a.count);
}

/* ------------------------------------------------------------ route progress */

export type StepState = 'done' | 'current' | 'attention' | 'upcoming';

export interface RouteStep {
  key: string;
  /** stage name shown to the reader, e.g. "Mentor review" */
  label: string;
  /** post that holds this stage, e.g. "Mentor" */
  post: string;
  state: StepState;
  /** who acted and when, when the stage has been decided */
  actor?: string;
  /** short state word for screen readers and captions */
  caption: string;
}

const DECIDING_ACTIONS = ['approve', 'approve_forward', 'finalise', 'reject', 'return', 'clarify', 'system_skip'];

/**
 * The approval route of one application, expressed as steps for the status view
 * and the dashboard progress dots. Derived only from stored state — no guessing:
 * a stage counts as decided when an action was recorded against its post.
 */
export function applicationSteps(data: AppData, app: Application): RouteStep[] {
  const workflow = workflowOf(data, app);
  if (!workflow) return [];

  const closed = app.status === 'completed' || app.status === 'withdrawn';
  const rejected = app.status === 'rejected';
  const acts = data.actions.filter((a) => a.application_id === app.id);

  const steps: RouteStep[] = workflow.stages.map((stage, index) => {
    const decision = [...acts]
      .reverse()
      .find((a) => a.post_code === stage.post_code && DECIDING_ACTIONS.includes(a.action));
    const done = closed || index < app.stage_index;
    const isCurrent = !closed && !rejected && app.stage_index === index && app.current_post === stage.post_code;

    let state: StepState = done ? 'done' : isCurrent ? 'current' : 'upcoming';
    let caption = done ? 'Completed' : isCurrent ? 'Awaiting decision' : 'Not reached yet';
    if (isCurrent && app.status === 'returned') {
      state = 'attention';
      caption = 'Returned for correction';
    }
    if (rejected && app.stage_index === index) {
      state = 'attention';
      caption = 'Rejected here';
    }

    return {
      key: stage.key,
      label: stage.label || postName(data, stage.post_code),
      post: postName(data, stage.post_code),
      state,
      actor: decision ? `${decision.actor_name} · ${decision.post_name ?? postName(data, decision.post_code)}` : undefined,
      caption,
    };
  });

  if (workflow.beyond_final) {
    const beyond = workflow.beyond_final;
    const decision = [...acts].reverse().find((a) => a.post_code === beyond.post_code && DECIDING_ACTIONS.includes(a.action));
    const isCurrent = app.beyond_active || (app.status === 'further_pending' && app.current_post === beyond.post_code);
    steps.push({
      key: 'beyond_final',
      label: beyond.label,
      post: postName(data, beyond.post_code),
      state: app.beyond_done ? 'done' : isCurrent ? 'current' : 'upcoming',
      actor: decision ? `${decision.actor_name} · ${decision.post_name ?? postName(data, decision.post_code)}` : undefined,
      caption: app.beyond_done ? 'Completed' : isCurrent ? 'Awaiting decision' : 'Not reached yet',
    });
  }

  return steps;
}
