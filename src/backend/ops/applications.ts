import type {
  ActionType,
  Application,
  ApplicationType,
  AppStatus,
  DocumentMeta,
  Profile,
  Scope,
  StatusEvent,
  WorkflowVersion,
} from '../../domain/types';
import { STATUS_LABEL } from '../../domain/types';
import type { OpContext } from './context';
import { grantsFor, postHasHolder } from './context';
import { can, findGrant, scopeCovers } from '../authz';
import { fail } from '../errors';
import {
  findPost,
  newId,
  nextApplicationReference,
  profileSnapshot,
  scopeFromProfile,
  scopeLabel,
} from '../models';
import { isLastStage, routeFrom, stagePost } from '../workflow';

export function activeWorkflow(data: OpContext['data'], typeId: string): WorkflowVersion | undefined {
  return data.workflows.find((w) => w.application_type_id === typeId && w.status === 'active');
}

export function availableTypes(data: OpContext['data'], profile: Profile): ApplicationType[] {
  return data.applicationTypes.filter(
    (t) => t.active && t.applicant_kinds.includes(profile.kind),
  );
}

export function maySubmit(profile: Profile, type: ApplicationType): boolean {
  if (!type.active) return false;
  if (!type.applicant_kinds.includes(profile.kind)) return false;
  if (profile.status !== 'active') return false;
  return true;
}

export function validateValues(
  type: ApplicationType,
  values: Record<string, unknown>,
  opts: { requireAll: boolean },
): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of type.fields) {
    const raw = values[field.key];
    const empty =
      raw === undefined ||
      raw === null ||
      (typeof raw === 'string' && raw.trim() === '') ||
      raw === false;
    if (field.required && opts.requireAll && empty) {
      errors[field.key] = `${field.label} is required.`;
      continue;
    }
    if (empty) continue;
    if (typeof raw === 'string') {
      const max = field.max_length ?? (field.type === 'textarea' ? 4000 : 200);
      if (raw.length > max) errors[field.key] = `${field.label} must be ${max} characters or fewer.`;
      if (field.type === 'select' && field.options && !field.options.includes(raw)) {
        errors[field.key] = `Choose a valid option for ${field.label}.`;
      }
      if (field.type === 'date' && Number.isNaN(Date.parse(raw))) {
        errors[field.key] = `${field.label} must be a valid date.`;
      }
    }
    if (field.type === 'number' && typeof raw === 'string' && Number.isNaN(Number(raw))) {
      errors[field.key] = `${field.label} must be a number.`;
    }
  }
  return errors;
}

export function missingDocuments(
  data: OpContext['data'],
  type: ApplicationType,
  appId: string,
): string[] {
  return type.documents
    .filter((d) => d.required)
    .filter((d) => !data.documents.some((doc) => doc.application_id === appId && doc.doc_key === d.key))
    .map((d) => d.label);
}

function orgScope(app: Application): Scope {
  return {
    faculty_id: app.org.faculty_id ?? null,
    department_id: app.org.department_id ?? null,
    batch_id: app.org.batch_id ?? null,
    section_id: app.org.section_id ?? null,
  };
}

export function createApplication(
  ctx: OpContext,
  typeId: string,
  values: Record<string, unknown>,
): Application {
  const { data, actor } = ctx;
  const profile = actor.profile;
  const type = data.applicationTypes.find((t) => t.id === typeId);
  if (!type) fail('not_found', 'Application type not found.');
  if (!maySubmit(profile, type)) {
    fail('forbidden', 'This application type is not available to your account.');
  }
  const branchGrants = actor.grants;
  if (branchGrants.length > 0 && !can(branchGrants, 'application.submit', scopeFromProfile(data, profile))) {
    fail('forbidden', 'Your current post does not include permission to submit this application.');
  }
  const workflow = activeWorkflow(data, type.id);
  if (!workflow) fail('config_error', 'No active workflow is configured for this application type.');

  const errors = validateValues(type, values, { requireAll: false });
  if (Object.keys(errors).length) fail('validation', 'Please correct the highlighted fields.', { fields: errors });

  const org = profileSnapshot(data, profile);
  const now = ctx.now;
  const app: Application = {
    id: newId('ap_'),
    reference: nextApplicationReference(data, new Date(now).getFullYear()),
    application_type_id: type.id,
    workflow_version_id: workflow.id,
    applicant_id: profile.id,
    applicant_name: profile.full_name,
    applicant_code: profile.user_code,
    applicant_kind: profile.kind,
    org,
    data: { ...values },
    status: 'draft',
    stage_index: -1,
    current_post: null,
    beyond_active: false,
    beyond_done: false,
    post_codes_seen: [],
    vc_approved: false,
    confidential: type.confidential,
    retention_category: type.retention_category,
    created_at: now,
    submitted_at: null,
    updated_at: now,
    decided_at: null,
    batch_id: org.batch_id ?? null,
  };
  data.applications.unshift(app);
  return app;
}

function pushStatus(ctx: OpContext, app: Application, status: AppStatus, label: string, note: string | null, visible = true) {
  const ev: StatusEvent = {
    id: newId('se_'),
    application_id: app.id,
    status,
    label,
    note,
    visible,
    created_at: ctx.now,
  };
  ctx.data.statusEvents.push(ev);
}

function recordAction(
  ctx: OpContext,
  app: Application,
  input: {
    action: ActionType;
    toStatus: AppStatus;
    postCode: string | null;
    remarksInternal?: string | null;
    remarksApplicant?: string | null;
    actorOverride?: { id: string; name: string; code: string };
  },
) {
  const { data, actor, now } = ctx;
  const post = input.postCode ? findPost(data, input.postCode) : undefined;
  const grant = input.postCode
    ? findGrant(actor.grants, input.postCode, orgScope(app))
    : undefined;
  data.actions.push({
    id: newId('ac_'),
    application_id: app.id,
    actor_id: input.actorOverride?.id ?? actor.profile.id,
    actor_name: input.actorOverride?.name ?? actor.profile.full_name,
    actor_code: input.actorOverride?.code ?? actor.profile.user_code,
    post_code: input.postCode,
    post_name: post?.name ?? null,
    assignment_id: grant?.assignment_id ?? null,
    scope_label: grant ? scopeLabel(data, grant.scope) : null,
    action: input.action,
    from_status: app.status,
    to_status: input.toStatus,
    remarks_internal: input.remarksInternal?.trim() || null,
    remarks_applicant: input.remarksApplicant?.trim() || null,
    created_at: now,
  });
}

export function updateDraft(
  ctx: OpContext,
  appId: string,
  values: Record<string, unknown>,
): Application {
  const app = ctx.data.applications.find((a) => a.id === appId);
  if (!app) fail('not_found', 'Application not found.');
  if (app.applicant_id !== ctx.actor.profile.id) fail('forbidden', 'You did not create this draft.');
  if (app.status !== 'draft' && app.status !== 'returned') {
    fail('invalid_state', 'Only drafts and returned applications can be edited.');
  }
  const type = ctx.data.applicationTypes.find((t) => t.id === app.application_type_id);
  if (!type) fail('not_found', 'Application type not found.');
  const errors = validateValues(type, values, { requireAll: false });
  if (Object.keys(errors).length) fail('validation', 'Please correct the highlighted fields.', { fields: errors });
  app.data = { ...app.data, ...values };
  app.updated_at = ctx.now;
  return app;
}

export function submitApplication(ctx: OpContext, appId: string): Application {
  const { data, actor, now } = ctx;
  const app = data.applications.find((a) => a.id === appId);
  if (!app) fail('not_found', 'Application not found.');
  if (app.applicant_id !== actor.profile.id) fail('forbidden', 'You are not the applicant.');
  if (!['draft', 'returned'].includes(app.status)) {
    fail('invalid_state', `A ${STATUS_LABEL[app.status].toLowerCase()} application cannot be submitted.`);
  }
  const type = data.applicationTypes.find((t) => t.id === app.application_type_id);
  if (!type) fail('not_found', 'Application type not found.');
  const workflow = data.workflows.find((w) => w.id === app.workflow_version_id);
  if (!workflow) fail('config_error', 'The workflow version used by this application is unavailable.');
  if (type.confidential === false && app.confidential) app.confidential = false;

  const errors = validateValues(type, app.data, { requireAll: true });
  if (Object.keys(errors).length) fail('validation', 'Some required fields are missing.', { fields: errors });
  const missing = missingDocuments(data, type, app.id);
  if (missing.length) {
    fail('validation', `Attach the required document(s): ${missing.join(', ')}.`, { documents: missing });
  }

  const org = orgScope(app);
  const applicantGrants = actor.grants;
  const isResubmission = app.status === 'returned';

  if (isResubmission && app.current_post) {
    // Return to the post that requested the correction.
    app.status = 'resubmitted';
    app.submitted_at = app.submitted_at ?? now;
    app.updated_at = now;
    recordAction(ctx, app, { action: 'resubmit', toStatus: 'resubmitted', postCode: null });
    pushStatus(ctx, app, 'resubmitted', 'Resubmitted by applicant', null);
    ctx.notify({
      userId: app.applicant_id,
      title: 'Application resubmitted',
      body: `${app.reference} was resubmitted and is with the reviewing officer.`,
      link: `#/applications/${app.id}`,
      category: 'application',
      dedupeKey: `resubmit:${app.id}:${now}`,
    });
    ctx.notifyPost(app.current_post, app.org, {
      title: 'Corrected application resubmitted',
      body: `${app.reference} has been corrected and resubmitted for your action.`,
      link: `#/applications/${app.id}`,
      category: 'application',
      dedupeKey: `resubmit-holder:${app.id}`,
    });
    return app;
  }

  const routed = routeFrom(workflow, 0, applicantGrants, org, ctx.hooks);
  let stageIndex = routed.stageIndex;
  let currentPost = stagePost(workflow, stageIndex);
  let beyondActive = false;

  if (currentPost && !postHasHolder(data, currentPost, org, now)) {
    // A required stage with nobody assigned would strand the application.
    currentPost = null;
  }
  if (!currentPost) {
    const fallback = type.fallback_approver_post;
    if (fallback && postHasHolder(data, fallback, org, now)) {
      currentPost = fallback;
      stageIndex = workflow.stages.length;
      beyondActive = true;
    } else {
      fail(
        'no_approver',
        'No authorised approver is currently assigned for this application. Please contact the university administrator.',
      );
    }
  }

  const fromStatus: AppStatus | null = app.status;
  app.status = 'submitted';
  app.stage_index = stageIndex;
  app.current_post = currentPost;
  app.beyond_active = beyondActive;
  app.submitted_at = now;
  app.updated_at = now;
  app.reference = app.reference || nextApplicationReference(data, new Date(now).getFullYear());
  if (currentPost) app.post_codes_seen = [...new Set([...app.post_codes_seen, currentPost])];

  data.actions.push({
    id: newId('ac_'),
    application_id: app.id,
    actor_id: actor.profile.id,
    actor_name: actor.profile.full_name,
    actor_code: actor.profile.user_code,
    post_code: null,
    post_name: null,
    assignment_id: null,
    scope_label: null,
    action: 'submit',
    from_status: fromStatus,
    to_status: 'submitted',
    remarks_internal: null,
    remarks_applicant: null,
    created_at: now,
  });

  for (const skipped of routed.skipped) {
    data.actions.push({
      id: newId('ac_'),
      application_id: app.id,
      actor_id: actor.profile.id,
      actor_name: actor.profile.full_name,
      actor_code: actor.profile.user_code,
      post_code: skipped.post_code,
      post_name: findPost(data, skipped.post_code)?.name ?? skipped.post_code,
      assignment_id: null,
      scope_label: null,
      action: 'system_skip',
      from_status: null,
      to_status: 'submitted',
      remarks_internal: 'Stage skipped automatically (self-approval protection or no current holder for an optional stage).',
      remarks_applicant: null,
      created_at: now,
    });
  }

  pushStatus(ctx, app, 'submitted', 'Submitted', null);
  ctx.audit('application.submit', 'application', app.id, {
    reference: app.reference,
    type: type.code,
    workflow: workflow.version,
  });

  ctx.notify({
    userId: app.applicant_id,
    title: 'Application submitted',
    body: `${app.reference} (${type.name}) was submitted successfully.`,
    link: `#/applications/${app.id}`,
    category: 'application',
    dedupeKey: `submit:${app.id}`,
  });
  if (currentPost) {
    ctx.notifyPost(currentPost, app.org, {
      title: 'Application awaiting your action',
      body: `${app.reference} (${type.name}) from ${app.applicant_name}.`,
      link: `#/applications/${app.id}`,
      category: 'application',
      dedupeKey: `pending:${app.id}:${stageIndex}`,
    });
  }
  return app;
}

export interface ActInput {
  action: 'approve' | 'approve_forward' | 'finalise' | 'reject' | 'return' | 'clarify' | 'remark';
  remarksApplicant?: string;
  remarksInternal?: string;
  visibleToApplicant?: boolean;
}

export function actOnApplication(ctx: OpContext, appId: string, input: ActInput): Application {
  const { data, actor, now } = ctx;
  const app = data.applications.find((a) => a.id === appId);
  if (!app) fail('not_found', 'Application not found.');
  if (app.deleted_at) fail('not_found', 'Application not found.');
  if (app.applicant_id === actor.profile.id) {
    fail('forbidden', 'You cannot act on your own application (self-approval is blocked).');
  }
  const type = data.applicationTypes.find((t) => t.id === app.application_type_id);
  if (!type) fail('not_found', 'Application type not found.');
  const workflow = data.workflows.find((w) => w.id === app.workflow_version_id);
  if (!workflow) fail('config_error', 'Workflow version unavailable.');

  const org = orgScope(app);
  const postCode = app.current_post;

  // Authorisation is checked before state, so a closed or unrelated record never
  // confirms its own existence to an unauthorised caller.
  const related = actor.grants.some((g) => {
    const involved =
      app.post_codes_seen.includes(g.post.code) ||
      (type.extra_viewer_posts ?? []).includes(g.post.code);
    return involved && scopeCovers(g.post, g.scope, org);
  });
  if (!postCode || ['approved', 'completed', 'rejected', 'withdrawn', 'draft'].includes(app.status)) {
    if (!related) fail('forbidden', 'You do not currently hold a post authorised for this application.');
    fail('invalid_state', 'This application is not awaiting an action.');
  }
  const grant = findGrant(actor.grants, postCode, org);
  if (!grant) {
    fail('forbidden', 'You do not currently hold the post that is responsible for this application.');
  }
  if (!grant.permissions.includes('application.act')) {
    fail('forbidden', 'Your post is not permitted to act on applications.');
  }
  if (!app.post_codes_seen.includes(postCode)) app.post_codes_seen.push(postCode);

  // Confidential applications: the holder of the current stage is the authorised
  // handler (enforced by the grant lookup above); no one else can see or act on it.

  const beyond = app.stage_index >= workflow.stages.length;
  const lastStage = !beyond && isLastStage(workflow, app.stage_index);
  const beyondFinal = workflow.beyond_final;
  const allowedActions: ActInput['action'][] = beyond
    ? beyondFinal
      ? [...beyondFinal.actions]
      : ['finalise', 'reject', 'return']
    : lastStage
      ? beyondFinal
        ? ['approve_forward', 'reject', 'return', 'clarify', 'remark']
        : ['finalise', 'reject', 'return', 'clarify', 'remark']
      : ['approve', 'reject', 'return', 'clarify', 'remark'];

  if (!allowedActions.includes(input.action)) {
    if (lastStage && beyondFinal && (input.action === 'approve' || input.action === 'finalise')) {
      fail(
        'invalid_action',
        `A higher post (${findPost(data, beyondFinal.post_code)?.name ?? beyondFinal.post_code}) must review this application. Use “Approve and forward” — this is not the final approval.`,
      );
    }
    if (lastStage && !beyondFinal && input.action === 'approve_forward') {
      fail('invalid_action', 'This application type has no post beyond the final authority. Use “Approve / Finalise”.');
    }
    if (input.action === 'approve_forward' && !lastStage) {
      fail('invalid_action', 'Forwarding beyond the final authority is only possible at the final stage.');
    }
    fail('invalid_action', 'That action is not available at this stage.');
  }

  const appRemarks = (input.remarksApplicant ?? '').trim();
  const intRemarks = (input.remarksInternal ?? '').trim();
  if (['reject', 'return', 'clarify'].includes(input.action) && !appRemarks) {
    fail('validation', 'Remarks for the applicant are required for this action.', {
      fields: { remarksApplicant: 'Explain the decision so the applicant can act on it.' },
    });
  }
  if (intRemarks.length > 4000 || appRemarks.length > 4000) {
    fail('validation', 'Remarks must be 4000 characters or fewer.');
  }

  const notifyApplicant = (title: string, body: string, dedupe: string, category: 'application' = 'application') =>
    ctx.notify({
      userId: app.applicant_id,
      title,
      body,
      link: `#/applications/${app.id}`,
      category,
      dedupeKey: `${dedupe}:${app.id}:${app.stage_index}:${app.status}`,
    });

  switch (input.action) {
    case 'approve': {
      const routed = routeFrom(workflow, app.stage_index + 1, grantsFor(data, app.applicant_id, now), org, ctx.hooks);
      recordAction(ctx, app, {
        action: 'approve',
        toStatus: 'under_review',
        postCode,
        remarksInternal: intRemarks || null,
        remarksApplicant: appRemarks || null,
      });
      const newStage = routed.stageIndex;
      const post = stagePost(workflow, newStage);
      const wasStatus = app.status;
      if (!post) {
        // Nothing further configured; treat as completion by the workflow's end.
        app.status = 'completed';
        app.decided_at = now;
        app.current_post = null;
        app.stage_index = workflow.stages.length;
        pushStatus(ctx, app, 'completed', 'Completed', null);
        notifyApplicant('Application completed', `${app.reference} has been completed.`, 'completed');
      } else if (!postHasHolder(data, post, org, now)) {
        fail(
          'no_approver',
          `The next stage (${findPost(data, post)?.name ?? post}) has no officer assigned. Ask the administrator to assign one before approving.`,
        );
      } else {
        app.stage_index = newStage;
        app.current_post = post;
        app.status = 'under_review';
        app.post_codes_seen = [...new Set([...app.post_codes_seen, post])];
        pushStatus(ctx, app, 'under_review', `Forwarded to ${findPost(data, post)?.name ?? post}`, null);
        notifyApplicant('Application under review', `${app.reference} has moved to the next reviewing office.`, 'forwarded');
        ctx.notifyPost(post, app.org, {
          title: 'Application awaiting your action',
          body: `${app.reference} (${type.name}) from ${app.applicant_name}.`,
          link: `#/applications/${app.id}`,
          category: 'application',
          dedupeKey: `pending:${app.id}:${newStage}`,
        });
      }
      ctx.audit('application.approve', 'application', app.id, {
        post: postCode,
        from: wasStatus,
        to: app.status,
        next_post: post,
      });
      break;
    }
    case 'finalise': {
      const from = app.status;
      recordAction(ctx, app, {
        action: 'finalise',
        toStatus: 'completed',
        postCode,
        remarksInternal: intRemarks || null,
        remarksApplicant: appRemarks || null,
      });
      app.status = 'completed';
      app.decided_at = now;
      app.current_post = null;
      app.stage_index = workflow.stages.length;
      app.beyond_done = Boolean(app.beyond_active);
      app.beyond_active = false;
      pushStatus(ctx, app, 'completed', 'Completed', appRemarks || null);
      notifyApplicant('Application completed', `${app.reference} has been completed and finally approved.`, 'completed');
      ctx.audit('application.finalise', 'application', app.id, { post: postCode, from, to: 'completed' });
      break;
    }
    case 'approve_forward': {
      if (!beyondFinal) fail('invalid_action', 'No further authority is configured for this application type.');
      recordAction(ctx, app, {
        action: 'approve_forward',
        toStatus: 'further_pending',
        postCode,
        remarksInternal: intRemarks || null,
        remarksApplicant: appRemarks || null,
      });
      app.status = 'further_pending';
      app.vc_approved = app.vc_approved || postCode === 'VC';
      app.beyond_active = true;
      app.beyond_done = false;
      app.stage_index = workflow.stages.length;
      app.current_post = beyondFinal.post_code;
      app.post_codes_seen = [...new Set([...app.post_codes_seen, beyondFinal.post_code])];
      app.updated_at = now;
      pushStatus(
        ctx,
        app,
        'further_pending',
        'Approved by the final configured authority — further approval pending',
        null,
      );
      notifyApplicant(
        'Approved at the final authority — further approval pending',
        `${app.reference} was approved by the final configured authority and is awaiting completion by a higher office. This is not yet a final approval.`,
        'forwarded-beyond',
      );
      ctx.notifyPost(beyondFinal.post_code, app.org, {
        title: 'Application forwarded for further approval',
        body: `${app.reference} (${type.name}) requires your decision.`,
        link: `#/applications/${app.id}`,
        category: 'application',
        dedupeKey: `beyond:${app.id}`,
      });
      ctx.audit('application.approve_forward', 'application', app.id, { post: postCode, next_post: beyondFinal.post_code });
      break;
    }
    case 'reject': {
      const from = app.status;
      recordAction(ctx, app, {
        action: 'reject',
        toStatus: 'rejected',
        postCode,
        remarksInternal: intRemarks || null,
        remarksApplicant: appRemarks,
      });
      app.status = 'rejected';
      app.decided_at = now;
      app.current_post = null;
      app.updated_at = now;
      pushStatus(ctx, app, 'rejected', 'Rejected', appRemarks);
      notifyApplicant('Application rejected', `${app.reference} was rejected. Open the application to read the remarks.`, 'rejected');
      ctx.audit('application.reject', 'application', app.id, { post: postCode, from });
      break;
    }
    case 'return': {
      const from = app.status;
      recordAction(ctx, app, {
        action: 'return',
        toStatus: 'returned',
        postCode,
        remarksInternal: intRemarks || null,
        remarksApplicant: appRemarks,
      });
      app.status = 'returned';
      app.updated_at = now;
      app.current_post = postCode;
      pushStatus(ctx, app, 'returned', 'Returned for correction', appRemarks);
      notifyApplicant('Correction requested', `${app.reference} was returned for correction. Please review the remarks and resubmit.`, 'returned');
      ctx.audit('application.return', 'application', app.id, { post: postCode, from });
      break;
    }
    case 'clarify': {
      recordAction(ctx, app, {
        action: 'clarify',
        toStatus: app.status,
        postCode,
        remarksInternal: intRemarks || null,
        remarksApplicant: appRemarks,
      });
      app.updated_at = now;
      pushStatus(ctx, app, app.status, 'Clarification requested', appRemarks);
      notifyApplicant('Clarification requested', `${app.reference}: the reviewing office has asked for clarification.`, 'clarify');
      ctx.audit('application.clarify', 'application', app.id, { post: postCode });
      break;
    }
    case 'remark': {
      const visible = input.visibleToApplicant !== false && Boolean(appRemarks);
      recordAction(ctx, app, {
        action: 'remark',
        toStatus: app.status,
        postCode,
        remarksInternal: intRemarks || null,
        remarksApplicant: visible ? appRemarks : null,
      });
      app.updated_at = now;
      if (visible) {
        pushStatus(ctx, app, app.status, 'Officer remark', appRemarks);
        notifyApplicant('New remark on your application', `${app.reference} has a new remark from the reviewing office.`, 'remark');
      }
      ctx.audit('application.remark', 'application', app.id, { post: postCode, visible });
      break;
    }
  }

  app.updated_at = now;
  return app;
}

export function withdrawApplication(ctx: OpContext, appId: string, reason: string): Application {
  const app = ctx.data.applications.find((a) => a.id === appId);
  if (!app) fail('not_found', 'Application not found.');
  if (app.applicant_id !== ctx.actor.profile.id) fail('forbidden', 'You are not the applicant.');
  const type = ctx.data.applicationTypes.find((t) => t.id === app.application_type_id);
  if (!type?.allow_withdraw) fail('forbidden', 'Withdrawal is not enabled for this application type.');
  if (!['draft', 'submitted', 'under_review', 'returned', 'resubmitted'].includes(app.status)) {
    fail('invalid_state', 'This application can no longer be withdrawn.');
  }
  if (reason.trim().length < 5) fail('validation', 'Please give a short reason for withdrawal.', {
    fields: { reason: 'At least 5 characters.' },
  });
  const from = app.status;
  app.stage_index = ctx.data.workflows.find((w) => w.id === app.workflow_version_id)?.stages.length ?? app.stage_index;
  recordAction(ctx, app, { action: 'withdraw', toStatus: 'withdrawn', postCode: null, remarksApplicant: reason.trim() });
  app.status = 'withdrawn';
  app.current_post = null;
  app.decided_at = ctx.now;
  app.updated_at = ctx.now;
  pushStatus(ctx, app, 'withdrawn', 'Withdrawn by applicant', reason.trim());
  ctx.audit('application.withdraw', 'application', app.id, { from, reason: reason.trim() });
  return app;
}

export function deleteDraft(ctx: OpContext, appId: string): void {
  const app = ctx.data.applications.find((a) => a.id === appId);
  if (!app) fail('not_found', 'Application not found.');
  if (app.applicant_id !== ctx.actor.profile.id) fail('forbidden', 'You did not create this draft.');
  if (app.status !== 'draft') fail('invalid_state', 'Only drafts can be deleted.');
  ctx.data.applications = ctx.data.applications.filter((a) => a.id !== appId);
  ctx.data.documents = ctx.data.documents.filter((d) => d.application_id !== appId);
  ctx.audit('application.draft_deleted', 'application', appId, { reference: app.reference });
}

export interface UploadMeta {
  fileName: string;
  mime: string;
  size: number;
  dataUrl: string;
}

export function attachDocument(
  ctx: OpContext,
  appId: string,
  docKey: string,
  meta: UploadMeta,
): DocumentMeta {
  const app = ctx.data.applications.find((a) => a.id === appId);
  if (!app) fail('not_found', 'Application not found.');
  if (app.applicant_id !== ctx.actor.profile.id) fail('forbidden', 'You are not the applicant.');
  if (!['draft', 'returned'].includes(app.status)) fail('invalid_state', 'Documents can only be added while editing.');
  const type = ctx.data.applicationTypes.find((t) => t.id === app.application_type_id);
  const req = type?.documents.find((d) => d.key === docKey);
  if (!type || !req) fail('not_found', 'Unknown document requirement.');
  const bytes = meta.size;
  if (bytes > req.max_mb * 1024 * 1024) fail('validation', `File must be ${req.max_mb} MB or smaller.`);
  if (!req.accept.some((a) => matchesMime(meta.mime, meta.fileName, a))) {
    fail('validation', `Accepted file types: ${req.accept.join(', ')}.`);
  }
  const existing = ctx.data.documents.filter((d) => d.application_id === appId && d.doc_key === docKey);
  const doc: DocumentMeta = {
    id: newId('dc_'),
    application_id: appId,
    notice_id: null,
    doc_key: docKey,
    file_name: safeFileName(meta.fileName),
    mime: meta.mime,
    size: bytes,
    storage_path: `applications/${app.applicant_id}/${app.id}/${newId('f_')}`,
    inline_data: meta.dataUrl,
    uploaded_by: ctx.actor.profile.id,
    uploaded_at: ctx.now,
    replaces_id: existing[0]?.id ?? null,
  };
  ctx.data.documents.push(doc);
  ctx.audit('document.upload', 'document', doc.id, { application: app.reference, doc_key: docKey, size: bytes });
  return doc;
}

export function removeDocument(ctx: OpContext, docId: string): void {
  const doc = ctx.data.documents.find((d) => d.id === docId);
  if (!doc) return;
  if (doc.uploaded_by !== ctx.actor.profile.id) fail('forbidden', 'You did not upload this document.');
  const app = ctx.data.applications.find((a) => a.id === doc.application_id);
  if (app && !['draft', 'returned'].includes(app.status)) fail('invalid_state', 'Documents are locked after submission.');
  ctx.data.documents = ctx.data.documents.filter((d) => d.id !== docId);
  ctx.audit('document.delete', 'document', docId, { application: app?.reference ?? null });
}

export function matchesMime(mime: string, name: string, accept: string): boolean {
  const a = accept.toLowerCase();
  const m = mime.toLowerCase();
  const n = name.toLowerCase();
  if (a === '*/*' || a === '*') return true;
  if (a.endsWith('/*')) return m.startsWith(a.slice(0, -1));
  if (a.startsWith('.')) return n.endsWith(a);
  return m === a;
}

export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? 'file';
  return base.replace(/[^\w.\-() ]+/g, '_').slice(0, 120);
}
