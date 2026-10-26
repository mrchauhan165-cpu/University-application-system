import type { Application, Batch, DeletionAudit, LegalHold, RetentionJob } from '../../domain/types';
import type { OpContext } from './context';
import { can } from '../authz';
import { fail } from '../errors';
import { findBatch, newId } from '../models';

const PROTECTED_CATEGORIES = new Set(['legal', 'permanent', 'disciplinary']);
const OPEN_STATUSES = new Set(['draft', 'submitted', 'under_review', 'returned', 'resubmitted', 'further_pending']);

function requireRetention(ctx: OpContext, message = 'You are not authorised to run retention workflows.'): void {
  if (!can(ctx.actor.grants, 'retention.manage')) fail('forbidden', message);
}

export function batchApplications(data: OpContext['data'], batchId: string): Application[] {
  return data.applications.filter((a) => (a.batch_id ?? a.org.batch_id ?? null) === batchId);
}

export function isProtected(app: Application): boolean {
  return PROTECTED_CATEGORIES.has(app.retention_category) || OPEN_STATUSES.has(app.status);
}

export function activeHold(data: OpContext['data'], batchId: string): LegalHold | undefined {
  return data.legalHolds.find((h) => h.batch_id === batchId && h.active);
}

export interface RetentionDates {
  eligibleFrom: string | null;
  finalFrom: string | null;
}

export function retentionDates(batch: Batch): RetentionDates {
  if (!batch.graduated_on) return { eligibleFrom: null, finalFrom: null };
  const base = new Date(batch.graduated_on);
  const eligible = new Date(base);
  eligible.setMonth(eligible.getMonth() + (batch.retention_months ?? 0));
  const final = new Date(eligible);
  final.setMonth(final.getMonth() + (batch.final_months ?? 0));
  return { eligibleFrom: eligible.toISOString(), finalFrom: final.toISOString() };
}

export function dryRun(ctx: OpContext, batchId: string, stage: RetentionJob['stage']): NonNullable<RetentionJob['dry_run']> {
  const { data } = ctx;
  const batch = findBatch(data, batchId);
  if (!batch) fail('not_found', 'Batch not found.');
  const apps = batchApplications(data, batchId);
  const protectedApps = apps.filter(isProtected);
  const eligibleApps = apps.filter((a) => !isProtected(a));
  const appIds = new Set(eligibleApps.map((a) => a.id));
  const docs = data.documents.filter(
    (d) =>
      (d.application_id && appIds.has(d.application_id)) ||
      (d.notice_id && data.notices.some((n) => n.id === d.notice_id && n.scope.batch_id === batchId)),
  );
  const notices = data.notices.filter((n) => n.scope_type === 'batch' && n.scope.batch_id === batchId);
  const bytes = docs.reduce((sum, d) => sum + (d.inline_data ? Math.floor((d.inline_data.length * 3) / 4) : d.size), 0);
  return {
    applications: stage === 'final_deletion' ? eligibleApps.length : 0,
    documents: docs.length,
    notices: stage === 'final_deletion' ? notices.length : 0,
    protected: protectedApps.length,
    bytes,
    generated_at: ctx.now,
  };
}

export function createRetentionJob(
  ctx: OpContext,
  batchId: string,
  stage: RetentionJob['stage'],
): RetentionJob {
  requireRetention(ctx);
  const batch = findBatch(ctx.data, batchId);
  if (!batch) fail('not_found', 'Batch not found.');
  if (!['graduated', 'archived', 'retention_review', 'deletion_approval'].includes(batch.status)) {
    fail('invalid_state', 'Only graduated or archived batches enter the retention workflow.');
  }
  const existing = ctx.data.retentionJobs.find(
    (j) => j.batch_id === batchId && j.stage === stage && !['executed', 'declined'].includes(j.status),
  );
  if (existing) fail('conflict', 'A retention job for this batch and stage is already open.');
  const job: RetentionJob = {
    id: newId('rj_'),
    batch_id: batchId,
    stage,
    status: 'awaiting_approval',
    dry_run: dryRun(ctx, batchId, stage),
    requested_by: ctx.actor.profile.id,
    approved_by: null,
    approved_at: null,
    executed_at: null,
    notes: null,
    created_at: ctx.now,
  };
  ctx.data.retentionJobs.unshift(job);
  ctx.audit('retention.propose', 'retention_job', job.id, { batch: batch.label, stage, dry_run: job.dry_run });
  const officerIds = [
    ...new Set(
      ctx.data.assignments
        .filter((a) => a.active && ctx.now >= a.starts_at && (!a.ends_at || a.ends_at > ctx.now))
        .filter((a) => {
          const post = ctx.data.posts.find((p) => p.code === a.post_code);
          return post?.permissions.includes('retention.manage');
        })
        .map((a) => a.user_id),
    ),
  ];
  for (const userId of officerIds) {
    ctx.notify({
      userId,
      title: 'Retention job awaiting approval',
      body: `A ${stage === 'final_deletion' ? 'final deletion' : 'initial cleanup'} job was proposed for batch ${batch.label}. A second authorised officer must approve it.`,
      link: '#/admin/retention',
      category: 'retention',
      dedupeKey: `retention-proposed:${job.id}:${userId}`,
    });
  }
  return job;
}

export function approveRetentionJob(ctx: OpContext, jobId: string, notes: string): RetentionJob {
  requireRetention(ctx);
  const job = ctx.data.retentionJobs.find((j) => j.id === jobId);
  if (!job) fail('not_found', 'Retention job not found.');
  if (job.status !== 'awaiting_approval') fail('invalid_state', 'This retention job is not awaiting approval.');
  if (job.requested_by === ctx.actor.profile.id) {
    fail('forbidden', 'A second authorised officer must approve a retention job (separation of duties).');
  }
  const batch = findBatch(ctx.data, job.batch_id);
  if (!batch) fail('not_found', 'Batch not found.');
  if (activeHold(ctx.data, job.batch_id)) {
    fail('conflict', 'An active legal hold blocks this retention job. Release the hold first.');
  }
  if (notes.trim().length < 5) {
    fail('validation', 'Record the approval justification.', { fields: { notes: 'At least 5 characters' } });
  }
  job.status = 'approved';
  job.approved_by = ctx.actor.profile.id;
  job.approved_at = ctx.now;
  job.notes = notes.trim();
  job.dry_run = dryRun(ctx, job.batch_id, job.stage);
  batch.status = job.stage === 'final_deletion' ? 'deletion_scheduled' : 'retention_review';
  ctx.audit('retention.approve', 'retention_job', job.id, {
    batch: batch.label,
    stage: job.stage,
    dry_run: job.dry_run,
  });
  return job;
}

export function declineRetentionJob(ctx: OpContext, jobId: string, notes: string): RetentionJob {
  requireRetention(ctx);
  const job = ctx.data.retentionJobs.find((j) => j.id === jobId);
  if (!job) fail('not_found', 'Retention job not found.');
  if (!['awaiting_approval', 'approved'].includes(job.status)) fail('invalid_state', 'This job cannot be declined.');
  if (notes.trim().length < 5) fail('validation', 'Give a reason for declining.');
  job.status = 'declined';
  job.notes = notes.trim();
  const batch = findBatch(ctx.data, job.batch_id);
  if (batch) batch.status = 'archived';
  ctx.audit('retention.decline', 'retention_job', job.id, { notes: notes.trim() });
  return job;
}

export function executeRetentionJob(
  ctx: OpContext,
  jobId: string,
  confirmation: string,
): { job: RetentionJob; audit: DeletionAudit } {
  requireRetention(ctx);
  const job = ctx.data.retentionJobs.find((j) => j.id === jobId);
  if (!job) fail('not_found', 'Retention job not found.');
  if (job.status !== 'approved') fail('invalid_state', 'Only approved retention jobs can be executed.');
  const batch = findBatch(ctx.data, job.batch_id);
  if (!batch) fail('not_found', 'Batch not found.');
  if (confirmation.trim().toUpperCase() !== batch.label.trim().toUpperCase()) {
    fail('validation', 'Type the batch label exactly to confirm permanent deletion.', {
      fields: { confirmation: `Type “${batch.label}”` },
    });
  }
  if (activeHold(ctx.data, job.batch_id)) {
    fail('conflict', 'An active legal hold blocks deletion.');
  }
  const summary = dryRun(ctx, job.batch_id, job.stage);
  const apps = batchApplications(ctx.data, job.batch_id);
  const eligibleApps = apps.filter((a) => !isProtected(a));
  const eligibleIds = new Set(eligibleApps.map((a) => a.id));

  if (job.stage === 'initial_cleanup') {
    // Remove attachments only; application rows and decisions stay for the
    // additional retention period and for audit.
    ctx.data.documents = ctx.data.documents.filter(
      (d) => !(d.application_id && eligibleIds.has(d.application_id)),
    );
    for (const app of eligibleApps) {
      app.data = stripAttachments(app.data);
    }
  } else {
    ctx.data.documents = ctx.data.documents.filter(
      (d) => !(d.application_id && eligibleIds.has(d.application_id)),
    );
    ctx.data.actions = ctx.data.actions.filter((a) => !eligibleIds.has(a.application_id));
    ctx.data.statusEvents = ctx.data.statusEvents.filter((e) => !eligibleIds.has(e.application_id));
    ctx.data.applications = ctx.data.applications.filter((a) => !eligibleIds.has(a.id));
    const noticeIds = new Set(
      ctx.data.notices.filter((n) => n.scope_type === 'batch' && n.scope.batch_id === job.batch_id).map((n) => n.id),
    );
    ctx.data.documents = ctx.data.documents.filter((d) => !(d.notice_id && noticeIds.has(d.notice_id)));
    ctx.data.notices = ctx.data.notices.filter((n) => !noticeIds.has(n.id));
    ctx.data.noticeReads = ctx.data.noticeReads.filter((r) => !noticeIds.has(r.notice_id));
    batch.status = 'deleted';
  }

  job.status = 'executed';
  job.executed_at = ctx.now;
  const audit: DeletionAudit = {
    id: newId('da_'),
    batch_id: job.batch_id,
    batch_label: batch.label,
    stage: job.stage,
    approved_by_name: ctx.data.profiles.find((p) => p.id === job.approved_by)?.full_name ?? 'unknown',
    approved_by_id: job.approved_by ?? '',
    counts: {
      applications: summary.applications,
      documents: summary.documents,
      notices: summary.notices,
      protected_preserved: summary.protected,
      bytes: summary.bytes,
    },
    outcome: 'executed',
    notes: job.notes,
    created_at: ctx.now,
  };
  ctx.data.deletionAudits.unshift(audit);
  ctx.audit('retention.execute', 'retention_job', job.id, {
    batch: batch.label,
    stage: job.stage,
    counts: audit.counts,
    executed_by: ctx.actor.profile.full_name,
  });
  return { job, audit };
}

function stripAttachments(values: Record<string, unknown>): Record<string, unknown> {
  const copy: Record<string, unknown> = { ...values };
  for (const key of Object.keys(copy)) {
    const value = copy[key];
    if (typeof value === 'string' && value.startsWith('data:')) copy[key] = null;
  }
  return copy;
}

export function addLegalHold(ctx: OpContext, batchId: string, reason: string): LegalHold {
  requireRetention(ctx, 'You are not authorised to manage legal holds.');
  const batch = findBatch(ctx.data, batchId);
  if (!batch) fail('not_found', 'Batch not found.');
  if (reason.trim().length < 5) fail('validation', 'Describe the reason for the legal hold.');
  if (activeHold(ctx.data, batchId)) fail('conflict', 'This batch already has an active legal hold.');
  const hold: LegalHold = {
    id: newId('lh_'),
    batch_id: batchId,
    reason: reason.trim(),
    active: true,
    created_by: ctx.actor.profile.id,
    created_at: ctx.now,
    released_at: null,
  };
  ctx.data.legalHolds.unshift(hold);
  ctx.audit('retention.hold', 'legal_hold', hold.id, { batch: batch.label, reason: hold.reason });
  return hold;
}

export function releaseLegalHold(ctx: OpContext, holdId: string): LegalHold {
  requireRetention(ctx, 'You are not authorised to manage legal holds.');
  const hold = ctx.data.legalHolds.find((h) => h.id === holdId);
  if (!hold) fail('not_found', 'Legal hold not found.');
  if (!hold.active) fail('invalid_state', 'This hold is already released.');
  hold.active = false;
  hold.released_at = ctx.now;
  ctx.audit('retention.hold_release', 'legal_hold', hold.id, { reason: hold.reason });
  return hold;
}
