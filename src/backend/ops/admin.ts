import type {
  ApplicationType,
  Assignment,
  Batch,
  BatchStatus,
  DocumentMeta,
  Faculty,
  Permission,
  Post,
  Profile,
  Scope,
  ScopeType,
  Section,
  UserKind,
  WorkflowStage,
  WorkflowVersion,
} from '../../domain/types';
import type { OpContext } from './context';
import type { Grant } from '../authz';
import { can } from '../authz';
import { fail } from '../errors';
import { randomToken } from '../crypto';
import {
  findBatch,
  findDepartment,
  findFaculty,
  findPost,
  findProfile,
  findSection,
  newId,
  nextUserCode,
  profileSnapshot,
  scopeLabel,
} from '../models';
import { routeFrom, stagePost } from '../workflow';

function requirePerm(ctx: OpContext, permission: Permission, message: string): void {
  if (!can(ctx.actor.grants, permission)) fail('forbidden', message);
}

/* ------------------------------------------------------------------ org */

export function saveFaculty(ctx: OpContext, input: { id?: string; name: string; code: string }): Faculty {
  requirePerm(ctx, 'user.manage', 'You are not authorised to manage the organisation structure.');
  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  if (name.length < 2) fail('validation', 'Faculty name is required.', { fields: { name: 'Required' } });
  if (!/^[A-Z0-9-]{2,12}$/.test(code)) {
    fail('validation', 'Faculty code must be 2–12 letters, digits or dashes.', { fields: { code: 'Invalid code' } });
  }
  const clash = ctx.data.faculties.find(
    (f) => f.code.toUpperCase() === code && f.id !== input.id && !f.archived,
  );
  if (clash) fail('conflict', `Faculty code ${code} is already used.`, { fields: { code: 'Already in use' } });
  if (input.id) {
    const fac = ctx.data.faculties.find((f) => f.id === input.id);
    if (!fac) fail('not_found', 'Faculty not found.');
    fac.name = name;
    fac.code = code;
    ctx.audit('org.faculty.update', 'faculty', fac.id, { name, code });
    return fac;
  }
  const fac: Faculty = { id: newId('fa_'), name, code, active: true, archived: false };
  ctx.data.faculties.push(fac);
  ctx.audit('org.faculty.create', 'faculty', fac.id, { name, code });
  return fac;
}

export function archiveFaculty(ctx: OpContext, id: string): Faculty {
  requirePerm(ctx, 'user.manage', 'You are not authorised to archive faculties.');
  const fac = ctx.data.faculties.find((f) => f.id === id);
  if (!fac) fail('not_found', 'Faculty not found.');
  const activeBatches = ctx.data.batches.filter(
    (b) => b.department_id && ctx.data.departments.some((d) => d.faculty_id === fac.id && d.id === b.department_id) && b.status === 'active',
  );
  if (activeBatches.length) {
    fail('conflict', 'Archive the faculty’s active batches first; this prevents accidental data loss.');
  }
  fac.archived = true;
  fac.active = false;
  ctx.audit('org.faculty.archive', 'faculty', fac.id, { name: fac.name });
  return fac;
}

export function saveDepartment(
  ctx: OpContext,
  input: { id?: string; faculty_id: string; name: string; code: string },
): { id: string } {
  requirePerm(ctx, 'user.manage', 'You are not authorised to manage departments.');
  const fac = findFaculty(ctx.data, input.faculty_id);
  if (!fac || fac.archived) fail('validation', 'Choose an active faculty.');
  const name = input.name.trim();
  const code = input.code.trim().toUpperCase();
  if (name.length < 2) fail('validation', 'Department name is required.', { fields: { name: 'Required' } });
  if (!/^[A-Z0-9-]{2,12}$/.test(code)) {
    fail('validation', 'Department code must be 2–12 letters, digits or dashes.', { fields: { code: 'Invalid code' } });
  }
  const clash = ctx.data.departments.find(
    (d) => d.faculty_id === fac.id && d.code.toUpperCase() === code && d.id !== input.id && !d.archived,
  );
  if (clash) fail('conflict', `Department code ${code} already exists in this faculty.`, { fields: { code: 'Already in use' } });
  if (input.id) {
    const dept = ctx.data.departments.find((d) => d.id === input.id);
    if (!dept) fail('not_found', 'Department not found.');
    dept.name = name;
    dept.code = code;
    dept.faculty_id = fac.id;
    ctx.audit('org.department.update', 'department', dept.id, { name, code });
    return dept;
  }
  const dept = {
    id: newId('de_'),
    faculty_id: fac.id,
    name,
    code,
    active: true,
    archived: false,
  };
  ctx.data.departments.push(dept);
  ctx.audit('org.department.create', 'department', dept.id, { name, code, faculty: fac.code });
  return dept;
}

export function archiveDepartment(ctx: OpContext, id: string): void {
  requirePerm(ctx, 'user.manage', 'You are not authorised to archive departments.');
  const dept = ctx.data.departments.find((d) => d.id === id);
  if (!dept) fail('not_found', 'Department not found.');
  const active = ctx.data.batches.some((b) => b.department_id === dept.id && b.status === 'active');
  if (active) fail('conflict', 'Archive the department’s active batches first.');
  dept.archived = true;
  dept.active = false;
  ctx.audit('org.department.archive', 'department', dept.id, { name: dept.name });
}

export interface BatchInput {
  id?: string;
  department_id: string;
  label: string;
  start_year: number;
  end_year: number;
  status?: BatchStatus;
  retention_months?: number;
  final_months?: number;
}

export function saveBatch(ctx: OpContext, input: BatchInput): Batch {
  requirePerm(ctx, 'user.manage', 'You are not authorised to manage batches.');
  const dept = findDepartment(ctx.data, input.department_id);
  if (!dept || dept.archived) fail('validation', 'Choose an active department.');
  const label = input.label.trim();
  if (label.length < 2) fail('validation', 'Batch label is required.', { fields: { label: 'Required' } });
  if (!Number.isInteger(input.start_year) || input.start_year < 1990 || input.start_year > 2100) {
    fail('validation', 'Start year looks invalid.', { fields: { start_year: 'Between 1990 and 2100' } });
  }
  if (!Number.isInteger(input.end_year) || input.end_year <= input.start_year) {
    fail('validation', 'Expected completion year must be after the start year.', {
      fields: { end_year: 'Must be later than start year' },
    });
  }
  const clash = ctx.data.batches.find(
    (b) => b.department_id === dept.id && b.label.toLowerCase() === label.toLowerCase() && b.id !== input.id,
  );
  if (clash) fail('conflict', 'A batch with this label already exists in the department.', { fields: { label: 'Already in use' } });
  if (input.id) {
    const batch = ctx.data.batches.find((b) => b.id === input.id);
    if (!batch) fail('not_found', 'Batch not found.');
    batch.label = label;
    batch.start_year = input.start_year;
    batch.end_year = input.end_year;
    batch.retention_months = input.retention_months ?? batch.retention_months;
    batch.final_months = input.final_months ?? batch.final_months;
    ctx.audit('org.batch.update', 'batch', batch.id, { label });
    return batch;
  }
  const batch: Batch = {
    id: newId('ba_'),
    department_id: dept.id,
    label,
    start_year: input.start_year,
    end_year: input.end_year,
    status: input.status ?? 'upcoming',
    retention_months: input.retention_months ?? ctx.data.settings.retention_months,
    final_months: input.final_months ?? ctx.data.settings.final_retention_months,
    graduated_on: null,
    archived_on: null,
    created_at: ctx.now,
  };
  ctx.data.batches.push(batch);
  ctx.audit('org.batch.create', 'batch', batch.id, { label, department: dept.code });
  return batch;
}

const BATCH_TRANSITIONS: Record<BatchStatus, BatchStatus[]> = {
  upcoming: ['active', 'archived'],
  active: ['graduated', 'archived'],
  graduated: ['retention_review', 'archived'],
  archived: ['active'],
  retention_review: ['deletion_approval', 'archived', 'graduated'],
  deletion_approval: ['deletion_scheduled', 'retention_review', 'archived'],
  deletion_scheduled: ['retention_review', 'deleted'],
  deleted: [],
};

export function setBatchStatus(ctx: OpContext, batchId: string, status: BatchStatus): Batch {
  requirePerm(ctx, 'user.manage', 'You are not authorised to change batch status.');
  const batch = ctx.data.batches.find((b) => b.id === batchId);
  if (!batch) fail('not_found', 'Batch not found.');
  if (batch.status === status) return batch;
  if (status === 'deleted') {
    fail('forbidden', 'Batches are deleted only through the approved retention workflow.');
  }
  if (status === 'active' && batch.status === 'archived') {
    // reopening is allowed for authorised admins and is audited
  } else if (!BATCH_TRANSITIONS[batch.status].includes(status)) {
    fail('invalid_state', `A ${batch.status.replace(/_/g, ' ')} batch cannot move to ${status.replace(/_/g, ' ')}.`);
  }
  const from = batch.status;
  batch.status = status;
  if (status === 'graduated') batch.graduated_on = ctx.now;
  if (status === 'archived') batch.archived_on = ctx.now;
  ctx.audit('org.batch.status', 'batch', batch.id, { from, to: status, label: batch.label });
  return batch;
}

export function saveSection(
  ctx: OpContext,
  input: { id?: string; batch_id: string; name: string; capacity?: number | null },
): Section {
  requirePerm(ctx, 'user.manage', 'You are not authorised to manage sections.');
  const batch = findBatch(ctx.data, input.batch_id);
  if (!batch) fail('validation', 'Choose an active batch.');
  if (batch.status === 'deleted') fail('validation', 'This batch no longer accepts sections.');
  const name = input.name.trim().toUpperCase();
  if (!/^[A-Z0-9-]{1,8}$/.test(name)) {
    fail('validation', 'Section name must be 1–8 letters or digits.', { fields: { name: 'Invalid name' } });
  }
  const clash = ctx.data.sections.find(
    (s) => s.batch_id === batch.id && s.name.toUpperCase() === name && s.id !== input.id,
  );
  if (clash) fail('conflict', 'This section already exists in the batch.', { fields: { name: 'Already in use' } });
  if (input.id) {
    const sec = ctx.data.sections.find((s) => s.id === input.id);
    if (!sec) fail('not_found', 'Section not found.');
    sec.name = name;
    sec.capacity = input.capacity ?? sec.capacity ?? null;
    ctx.audit('org.section.update', 'section', sec.id, { name, batch: batch.label });
    return sec;
  }
  const sec: Section = {
    id: newId('se_'),
    batch_id: batch.id,
    name,
    capacity: input.capacity ?? null,
  };
  ctx.data.sections.push(sec);
  ctx.audit('org.section.create', 'section', sec.id, { name, batch: batch.label });
  return sec;
}

/* ---------------------------------------------------------------- users */

export interface UserInput {
  id?: string;
  full_name: string;
  email: string;
  kind: UserKind;
  department_id?: string | null;
  batch_id?: string | null;
  section_id?: string | null;
  roll_no?: string | null;
  designation?: string | null;
  phone?: string | null;
  postHint?: string | null;
}

export function validateEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email);
}

export function saveUser(ctx: OpContext, input: UserInput): { profile: Profile; activationToken?: string } {
  requirePerm(ctx, 'user.manage', 'You are not authorised to manage user accounts.');
  const fullName = input.full_name.trim();
  const email = input.email.trim().toLowerCase();
  if (fullName.length < 3) fail('validation', 'Full name is required.', { fields: { full_name: 'Required' } });
  if (!validateEmail(email)) fail('validation', 'Enter a valid email address.', { fields: { email: 'Invalid email' } });
  const clash = ctx.data.profiles.find((p) => p.email.toLowerCase() === email && p.id !== input.id);
  if (clash) fail('conflict', 'That email address is already in use.', { fields: { email: 'Already in use' } });

  if (input.kind === 'student') {
    const dept = findDepartment(ctx.data, input.department_id);
    const batch = findBatch(ctx.data, input.batch_id);
    const section = findSection(ctx.data, input.section_id);
    if (!dept || dept.archived) fail('validation', 'Choose the student’s department.', { fields: { department_id: 'Required' } });
    if (!batch || batch.department_id !== dept.id) fail('validation', 'Choose a batch in that department.', { fields: { batch_id: 'Required' } });
    if (batch.status === 'deleted') fail('validation', 'That batch has been deleted.');
    if (section && section.batch_id !== batch.id) fail('validation', 'The section does not belong to the chosen batch.', { fields: { section_id: 'Mismatch' } });
  } else {
    const dept = findDepartment(ctx.data, input.department_id);
    if (!dept || dept.archived) fail('validation', 'Choose the employee’s department.', { fields: { department_id: 'Required' } });
  }

  if (input.id) {
    const p = ctx.data.profiles.find((x) => x.id === input.id);
    if (!p) fail('not_found', 'User not found.');
    p.full_name = fullName;
    p.email = email;
    p.phone = input.phone ?? p.phone;
    p.designation = input.designation ?? p.designation;
    if (p.kind === 'student') {
      p.department_id = input.department_id ?? p.department_id;
      p.batch_id = input.batch_id ?? p.batch_id;
      p.section_id = input.section_id ?? null;
      p.roll_no = input.roll_no ?? p.roll_no;
    } else {
      p.home_department_id = input.department_id ?? p.home_department_id;
      p.designation = input.designation ?? p.designation;
    }
    ctx.audit('user.update', 'profile', p.id, { email, kind: p.kind });
    return { profile: p };
  }

  if (input.kind === 'student' && input.section_id) {
    const section = findSection(ctx.data, input.section_id);
    if (section?.capacity && ctx.data.profiles.filter((p) => p.section_id === section.id && p.status !== 'suspended').length >= section.capacity) {
      fail('conflict', 'That section is at capacity. Increase the capacity or choose another section.');
    }
  }

  const profile: Profile = {
    id: newId('us_'),
    user_code: nextUserCode(ctx.data, input.kind, input.postHint),
    full_name: fullName,
    email,
    kind: input.kind,
    status: 'invited',
    phone: input.phone ?? null,
    designation: input.designation ?? null,
    department_id: input.kind === 'student' ? input.department_id ?? null : null,
    batch_id: input.kind === 'student' ? input.batch_id ?? null : null,
    section_id: input.kind === 'student' ? input.section_id ?? null : null,
    roll_no: input.kind === 'student' ? input.roll_no ?? null : null,
    home_department_id: input.kind !== 'student' ? input.department_id ?? null : null,
    joined_on: ctx.now.slice(0, 10),
    last_login_at: null,
  };
  ctx.data.profiles.push(profile);
  const activationToken = randomToken(20);
  ctx.audit('user.create', 'profile', profile.id, { email, code: profile.user_code, kind: profile.kind });
  return { profile, activationToken };
}

export function setUserStatus(ctx: OpContext, userId: string, status: Profile['status']): Profile {
  requirePerm(ctx, 'user.manage', 'You are not authorised to change account status.');
  const p = ctx.data.profiles.find((x) => x.id === userId);
  if (!p) fail('not_found', 'User not found.');
  if (p.id === ctx.actor.profile.id) fail('forbidden', 'You cannot change your own account status.');
  const from = p.status;
  p.status = status;
  if (status === 'suspended') {
    // suspension revokes every live assignment's usable access immediately
    for (const a of ctx.data.assignments) {
      if (a.user_id === p.id && a.active) {
        a.active = false;
        a.ends_at = ctx.now;
        a.ended_by = ctx.actor.profile.id;
        a.ended_reason = 'Account suspended';
      }
    }
  }
  ctx.audit('user.status', 'profile', p.id, { from, to: status });
  return p;
}

/* ---------------------------------------------------------- assignments */

export function saveAssignment(
  ctx: OpContext,
  input: {
    user_id: string;
    post_code: string;
    scope: Scope;
    starts_at?: string;
    reason?: string | null;
  },
): Assignment {
  requirePerm(ctx, 'user.manage', 'You are not authorised to manage post assignments.');
  const user = findProfile(ctx.data, input.user_id);
  if (!user) fail('validation', 'Choose a user.');
  if (user.kind === 'student') fail('validation', 'Students cannot hold staff posts.');
  if (user.status === 'suspended') fail('conflict', 'Reactivate the account before assigning a post.');
  const post = findPost(ctx.data, input.post_code);
  if (!post || !post.active) fail('validation', 'Choose an active post.');

  const scope: Scope = {
    faculty_id: input.scope.faculty_id ?? null,
    department_id: input.scope.department_id ?? null,
    batch_id: input.scope.batch_id ?? null,
    section_id: input.scope.section_id ?? null,
  };
  validateScopeForPost(ctx, post, scope);
  const fullScope = fillScopeParents(ctx, post, scope);

  const startsAt = input.starts_at ? new Date(input.starts_at).toISOString() : ctx.now;
  const sameScope = ctx.data.assignments.find(
    (a) =>
      a.post_code === post.code &&
      a.active &&
      (a.ends_at === null || a.ends_at > startsAt) &&
      sameScopeValues(a.scope, fullScope),
  );
  if (sameScope && sameScope.user_id === user.id) {
    fail('conflict', `${user.full_name} already holds the ${post.name} post for this scope.`);
  }
  if (sameScope) {
    const prevHolder = findProfile(ctx.data, sameScope.user_id);
    sameScope.active = false;
    sameScope.ends_at = startsAt;
    sameScope.ended_by = ctx.actor.profile.id;
    sameScope.ended_reason = `Replaced by ${user.full_name} (${ctx.actor.profile.user_code})`;
    ctx.audit('assignment.replace', 'assignment', sameScope.id, {
      post: post.code,
      previous_user: prevHolder?.full_name ?? sameScope.user_id,
      new_user: user.full_name,
    });
    ctx.notify({
      userId: sameScope.user_id,
      title: `Assignment ended: ${post.name}`,
      body: `Your ${post.name} assignment (${scopeLabel(ctx.data, sameScope.scope)}) ended and ${user.full_name} now holds the post. Access derived from that post has been revoked.`,
      category: 'assignment',
      dedupeKey: `assignment-ended:${sameScope.id}`,
    });
  }

  const assignment: Assignment = {
    id: newId('as_'),
    user_id: user.id,
    post_code: post.code,
    scope: fullScope,
    starts_at: startsAt,
    ends_at: null,
    active: true,
    created_by: ctx.actor.profile.id,
    reason: input.reason?.trim() || null,
    created_at: ctx.now,
  };
  ctx.data.assignments.push(assignment);
  ctx.audit('assignment.create', 'assignment', assignment.id, {
    post: post.code,
    user: user.full_name,
    scope: scopeLabel(ctx.data, fullScope),
  });

  // hand-over: tell the new holder about work waiting at that post
  const pending = ctx.data.applications.filter(
    (a) =>
      a.current_post === post.code &&
      !['draft', 'approved', 'completed', 'rejected', 'withdrawn'].includes(a.status) &&
      scopeCoversApp(post, scope, a),
  );
  ctx.notify({
    userId: user.id,
    title: `You now hold: ${post.name}`,
    body: pending.length
      ? `Scope: ${scopeLabel(ctx.data, scope)}. ${pending.length} application(s) are waiting at this post.`
      : `Scope: ${scopeLabel(ctx.data, scope)}. No applications are waiting right now.`,
    link: '#/inbox',
    category: 'assignment',
    dedupeKey: `assignment-start:${assignment.id}`,
  });
  return assignment;
}

function scopeCoversApp(post: Post, scope: Scope, app: { org: { faculty_id?: string | null; department_id?: string | null; batch_id?: string | null; section_id?: string | null } }): boolean {
  const target = {
    faculty_id: app.org.faculty_id ?? null,
    department_id: app.org.department_id ?? null,
    batch_id: app.org.batch_id ?? null,
    section_id: app.org.section_id ?? null,
  };
  switch (post.scope_type) {
    case 'university':
      return true;
    case 'faculty':
      return Boolean(scope.faculty_id) && target.faculty_id === scope.faculty_id;
    case 'department':
      return Boolean(scope.department_id) && target.department_id === scope.department_id;
    case 'batch':
      return Boolean(scope.batch_id) && target.batch_id === scope.batch_id;
    case 'section':
      return Boolean(scope.section_id) && target.section_id === scope.section_id;
    default:
      return false;
  }
}

function sameScopeValues(a: Scope, b: Scope): boolean {
  return (
    (a.faculty_id ?? null) === (b.faculty_id ?? null) &&
    (a.department_id ?? null) === (b.department_id ?? null) &&
    (a.batch_id ?? null) === (b.batch_id ?? null) &&
    (a.section_id ?? null) === (b.section_id ?? null)
  );
}

export function validateScopeForPost(ctx: OpContext, post: Post, scope: Scope): void {
  switch (post.scope_type) {
    case 'university':
      return;
    case 'faculty':
      if (!scope.faculty_id || !findFaculty(ctx.data, scope.faculty_id)) {
        fail('validation', `${post.name} must be assigned to a faculty.`, { fields: { scope: 'Choose a faculty' } });
      }
      return;
    case 'department': {
      const dept = findDepartment(ctx.data, scope.department_id);
      if (!dept) fail('validation', `${post.name} must be assigned to a department.`, { fields: { scope: 'Choose a department' } });
      if (scope.faculty_id && dept!.faculty_id !== scope.faculty_id) {
        fail('validation', 'The department does not belong to the chosen faculty.');
      }
      return;
    }
    case 'batch':
      if (!findBatch(ctx.data, scope.batch_id)) {
        fail('validation', `${post.name} must be assigned to a batch.`, { fields: { scope: 'Choose a batch' } });
      }
      return;
    case 'section':
      if (!findSection(ctx.data, scope.section_id)) {
        fail('validation', `${post.name} must be assigned to a section.`, { fields: { scope: 'Choose a section' } });
      }
      return;
  }
}


/**
 * A post's scope must describe the whole path (a section inside a batch inside a
 * department inside a faculty). Only the level required by the post matters for
 * access, but a complete scope keeps labels, filtering and audit readable, so the
 * missing parents are derived from the chosen child. Contradictory input is
 * rejected instead of being silently "fixed".
 */
function fillScopeParents(ctx: OpContext, post: Post, scope: Scope): Scope {
  const out: Scope = { ...scope };
  if (scope.section_id) {
    const section = findSection(ctx.data, scope.section_id);
    const batch = section ? findBatch(ctx.data, section.batch_id) : undefined;
    if (batch) {
      if (scope.batch_id && scope.batch_id !== batch.id) {
        fail('validation', `That section does not belong to the chosen batch (${post.name}).`);
      }
      out.batch_id = batch.id;
      out.department_id = batch.department_id;
      const dept = findDepartment(ctx.data, batch.department_id);
      if (scope.department_id && scope.department_id !== batch.department_id) {
        fail('validation', `That section does not belong to the chosen department (${post.name}).`);
      }
      if (dept) out.faculty_id = dept.faculty_id;
      if (scope.faculty_id && dept && scope.faculty_id !== dept.faculty_id) {
        fail('validation', `That section does not belong to the chosen faculty (${post.name}).`);
      }
    }
  } else if (scope.batch_id) {
    const batch = findBatch(ctx.data, scope.batch_id);
    if (batch) {
      if (scope.department_id && scope.department_id !== batch.department_id) {
        fail('validation', `That batch does not belong to the chosen department (${post.name}).`);
      }
      out.department_id = batch.department_id;
      const dept = findDepartment(ctx.data, batch.department_id);
      if (dept) out.faculty_id = dept.faculty_id;
      if (scope.faculty_id && dept && scope.faculty_id !== dept.faculty_id) {
        fail('validation', `That batch does not belong to the chosen faculty (${post.name}).`);
      }
    }
  } else if (scope.department_id) {
    const dept = findDepartment(ctx.data, scope.department_id);
    if (dept) out.faculty_id = dept.faculty_id;
  }
  return out;
}

export function endAssignment(ctx: OpContext, assignmentId: string, reason: string): Assignment {
  requirePerm(ctx, 'user.manage', 'You are not authorised to end post assignments.');
  const a = ctx.data.assignments.find((x) => x.id === assignmentId);
  if (!a) fail('not_found', 'Assignment not found.');
  if (!a.active) fail('invalid_state', 'This assignment is already inactive.');
  a.active = false;
  a.ends_at = ctx.now;
  a.ended_by = ctx.actor.profile.id;
  a.ended_reason = reason.trim() || 'Ended by administrator';
  const post = findPost(ctx.data, a.post_code);
  ctx.audit('assignment.end', 'assignment', a.id, {
    post: a.post_code,
    user: findProfile(ctx.data, a.user_id)?.full_name ?? a.user_id,
    reason: a.ended_reason,
  });
  ctx.notify({
    userId: a.user_id,
    title: `Assignment ended: ${post?.name ?? a.post_code}`,
    body: 'Access derived only from this assignment has been revoked immediately. Historical records remain preserved for the post.',
    category: 'assignment',
    dedupeKey: `assignment-end:${a.id}`,
  });
  return a;
}

/* ---------------------------------------------------------------- posts */

export function savePost(ctx: OpContext, input: Post): Post {
  requirePerm(ctx, 'user.manage', 'You are not authorised to configure posts.');
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,15}$/.test(code)) {
    fail('validation', 'Post code must start with a letter and use up to 16 characters.', { fields: { code: 'Invalid code' } });
  }
  if (!input.name.trim()) fail('validation', 'Post name is required.', { fields: { name: 'Required' } });
  if (!Array.isArray(input.permissions)) fail('validation', 'Permissions are required.');
  const existing = ctx.data.posts.find((p) => p.code === code);
  if (existing) {
    if (existing.is_system && code !== existing.code) fail('forbidden', 'System post codes cannot be changed.');
    existing.name = input.name.trim();
    existing.scope_type = input.scope_type;
    existing.rank = input.rank;
    existing.permissions = [...new Set(input.permissions)];
    existing.active = input.active;
    existing.description = input.description;
    ctx.audit('post.update', 'post', code, { permissions: existing.permissions, scope: existing.scope_type });
    return existing;
  }
  const post: Post = {
    code,
    name: input.name.trim(),
    scope_type: input.scope_type,
    rank: input.rank,
    permissions: [...new Set(input.permissions)],
    is_system: false,
    active: input.active !== false,
    description: input.description,
  };
  ctx.data.posts.push(post);
  ctx.audit('post.create', 'post', code, { name: post.name });
  return post;
}

/* -------------------------------------------------- application types */

export type ApplicationTypeInput = Omit<ApplicationType, 'id' | 'created_at' | 'version'> & { id?: string };

export function saveApplicationType(ctx: OpContext, input: ApplicationTypeInput): ApplicationType {
  requirePerm(ctx, 'workflow.configure', 'You are not authorised to configure application types.');
  const code = input.code.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9_]{1,30}$/.test(code)) {
    fail('validation', 'Type code must be upper-case letters, digits or underscores.', { fields: { code: 'Invalid code' } });
  }
  if (!input.name.trim()) fail('validation', 'Application type name is required.', { fields: { name: 'Required' } });
  if (!input.applicant_kinds.length) fail('validation', 'Select at least one applicant group.');
  const fieldKeys = new Set<string>();
  for (const f of input.fields) {
    if (!/^[a-z][a-z0-9_]{1,30}$/.test(f.key)) fail('validation', `Field key “${f.key}” must be lower-case letters, digits or underscores.`);
    if (fieldKeys.has(f.key)) fail('validation', `Duplicate field key “${f.key}”.`);
    fieldKeys.add(f.key);
    if (!f.label.trim()) fail('validation', 'Every field needs a label.');
    if (f.type === 'select' && (!f.options || f.options.length === 0)) {
      fail('validation', `Field “${f.label}” needs at least one option.`);
    }
  }
  const docKeys = new Set<string>();
  for (const d of input.documents) {
    if (docKeys.has(d.key)) fail('validation', `Duplicate document key “${d.key}”.`);
    docKeys.add(d.key);
    if (!d.accept.length) fail('validation', `Document “${d.label}” needs accepted file types.`);
    if (!(d.max_mb > 0 && d.max_mb <= 25)) fail('validation', `Document size limit for “${d.label}” must be 1–25 MB.`);
  }
  const clash = ctx.data.applicationTypes.find((t) => t.code.toUpperCase() === code && t.id !== input.id);
  if (clash) fail('conflict', 'An application type with this code already exists.', { fields: { code: 'Already in use' } });

  const payload = {
    name: input.name.trim(),
    description: input.description.trim(),
    applicant_kinds: input.applicant_kinds,
    confidential: Boolean(input.confidential),
    allow_draft: input.allow_draft !== false,
    allow_withdraw: Boolean(input.allow_withdraw),
    fields: input.fields.map((f) => ({ ...f, label: f.label.trim() })),
    documents: input.documents,
    retention_category: input.retention_category || 'standard',
    extra_viewer_posts: input.extra_viewer_posts ?? [],
    fallback_approver_post: input.fallback_approver_post ?? null,
    active: input.active !== false,
  };

  if (input.id) {
    const type = ctx.data.applicationTypes.find((t) => t.id === input.id);
    if (!type) fail('not_found', 'Application type not found.');
    Object.assign(type, payload, { code, version: type.version + 1 });
    ctx.audit('application_type.update', 'application_type', type.id, { code, version: type.version });
    return type;
  }
  const type: ApplicationType = {
    id: newId('at_'),
    code,
    ...payload,
    version: 1,
    created_at: ctx.now,
  };
  ctx.data.applicationTypes.push(type);
  ctx.audit('application_type.create', 'application_type', type.id, { code, name: type.name });
  return type;
}

export interface WorkflowInput {
  application_type_id: string;
  stages: WorkflowStage[];
  beyond_final: WorkflowVersion['beyond_final'];
  notes?: string | null;
}

export function saveWorkflow(ctx: OpContext, input: WorkflowInput): WorkflowVersion {
  requirePerm(ctx, 'workflow.configure', 'You are not authorised to configure workflows.');
  const type = ctx.data.applicationTypes.find((t) => t.id === input.application_type_id);
  if (!type) fail('not_found', 'Application type not found.');
  if (!input.stages.length) fail('validation', 'Add at least one approval stage.');
  const seen = new Set<string>();
  let previous = '';
  for (const stage of input.stages) {
    const post = findPost(ctx.data, stage.post_code);
    if (!post) fail('validation', `Unknown post “${stage.post_code}”.`);
    if (!post!.active) fail('validation', `Post “${post!.name}” is inactive.`);
    if (stage.post_code === previous) {
      fail('validation', `Stage “${post!.name}” is repeated consecutively.`);
    }
    previous = stage.post_code;
    void seen;
    if (!stage.label.trim()) stage.label = post!.name;
  }
  if (input.beyond_final) {
    const post = findPost(ctx.data, input.beyond_final.post_code);
    if (!post) fail('validation', 'The post beyond the final authority is unknown.');
    if (input.stages.some((s) => s.post_code === input.beyond_final!.post_code)) {
      fail('validation', 'The post beyond the final authority cannot also be a normal stage.');
    }
    if (!input.beyond_final.actions.length) fail('validation', 'Choose at least one action for the post beyond the final authority.');
  }

  const versionNumber = Math.max(
    0,
    ...ctx.data.workflows.filter((w) => w.application_type_id === type.id).map((w) => w.version),
  ) + 1;

  for (const w of ctx.data.workflows) {
    if (w.application_type_id === type.id && w.status === 'active') {
      w.status = 'retired';
    }
  }
  const workflow: WorkflowVersion = {
    id: newId('wf_'),
    application_type_id: type.id,
    version: versionNumber,
    stages: input.stages.map((s) => ({ ...s, label: s.label.trim() })),
    beyond_final: input.beyond_final ?? null,
    status: 'active',
    notes: input.notes ?? null,
    created_by: ctx.actor.profile.id,
    created_at: ctx.now,
  };
  ctx.data.workflows.push(workflow);
  type.version += 1;
  ctx.audit('workflow.create', 'workflow', workflow.id, {
    type: type.code,
    version: versionNumber,
    stages: workflow.stages.map((s) => s.post_code),
    beyond: workflow.beyond_final?.post_code ?? null,
  });
  return workflow;
}

/** Explicit, audited migration of in-progress applications to a new workflow. */
export function migrateApplicationsToWorkflow(
  ctx: OpContext,
  workflowId: string,
  applicationIds: string[],
): number {
  requirePerm(ctx, 'workflow.configure', 'You are not authorised to migrate applications.');
  const workflow = ctx.data.workflows.find((w) => w.id === workflowId);
  if (!workflow) fail('not_found', 'Workflow not found.');
  let count = 0;
  for (const id of applicationIds) {
    const app = ctx.data.applications.find((a) => a.id === id);
    if (!app) continue;
    if (['approved', 'completed', 'rejected', 'withdrawn', 'draft'].includes(app.status)) {
      fail('invalid_state', 'Only in-progress applications can be migrated.');
    }
    const org: Scope = {
      faculty_id: app.org.faculty_id ?? null,
      department_id: app.org.department_id ?? null,
      batch_id: app.org.batch_id ?? null,
      section_id: app.org.section_id ?? null,
    };
    const grants = ctx.data.assignments
      .filter((a) => a.user_id === app.applicant_id)
      .map<Grant>((a) => ({
        assignment_id: a.id,
        post: findPost(ctx.data, a.post_code)!,
        scope: a.scope,
        permissions: [],
        starts_at: a.starts_at,
        ends_at: a.ends_at,
      }))
      .filter((g) => Boolean(g.post));
    const routed = routeFrom(workflow, 0, grants, org, ctx.hooks);
    const post = stagePost(workflow, routed.stageIndex);
    if (!post) fail('conflict', `Workflow ${workflow.version} has no available approver for this application.`);
    const fromVersion = ctx.data.workflows.find((w) => w.id === app.workflow_version_id)?.version ?? 0;
    app.workflow_version_id = workflow.id;
    app.stage_index = routed.stageIndex;
    app.current_post = post;
    app.beyond_active = false;
    app.beyond_done = false;
    app.post_codes_seen = [...new Set([...app.post_codes_seen, post])];
    app.status = app.status === 'returned' ? 'returned' : 'under_review';
    app.updated_at = ctx.now;
    count += 1;
    ctx.audit('workflow.migrate', 'application', app.id, {
      from_version: fromVersion,
      to_version: workflow.version,
      post,
    });
    ctx.notify({
      userId: app.applicant_id,
      title: 'Application updated to a new workflow',
      body: `${app.reference} was moved to workflow version ${workflow.version} by the workflow administrator.`,
      link: `#/applications/${app.id}`,
      category: 'application',
      dedupeKey: `migrate:${app.id}:${workflow.version}`,
    });
    ctx.notifyPost(post, app.org, {
      title: 'Application routed to your post',
      body: `${app.reference} is now waiting for your action after a workflow update.`,
      link: `#/applications/${app.id}`,
      category: 'application',
      dedupeKey: `migrate-holder:${app.id}:${workflow.version}`,
    });
  }
  return count;
}

/* ------------------------------------------------------------- settings */

export function saveSettings(ctx: OpContext, patch: Partial<OpContext['data']['settings']>): void {
  requirePerm(ctx, 'system.admin', 'You are not authorised to change system settings.');
  const before = { ...ctx.data.settings };
  ctx.data.settings = { ...ctx.data.settings, ...patch };
  if (ctx.data.settings.retention_months < 0 || ctx.data.settings.final_retention_months < 0) {
    ctx.data.settings = before;
    fail('validation', 'Retention periods cannot be negative.');
  }
  ctx.audit('settings.update', 'settings', null, { changed: Object.keys(patch) });
}

/* ---------------------------------------------------------------- files */

export function noticeAttachmentMeta(
  ctx: OpContext,
  noticeId: string,
  meta: { fileName: string; mime: string; size: number; dataUrl: string },
): DocumentMeta {
  const notice = ctx.data.notices.find((n) => n.id === noticeId);
  if (!notice) fail('not_found', 'Notice not found.');
  if (!ctx.actor.grants.some((g) => g.permissions.includes('notice.create'))) {
    fail('forbidden', 'You are not authorised to attach files to notices.');
  }
  if (meta.size > 2 * 1024 * 1024) fail('validation', 'Notice attachments must be 2 MB or smaller.');
  const allowed = ['application/pdf', 'image/png', 'image/jpeg'];
  if (!allowed.includes(meta.mime)) fail('validation', 'Attach a PDF, PNG or JPEG file.');
  const doc: DocumentMeta = {
    id: newId('dc_'),
    application_id: null,
    notice_id: noticeId,
    doc_key: 'attachment',
    file_name: meta.fileName.replace(/[^\w.\-() ]+/g, '_').slice(0, 120),
    mime: meta.mime,
    size: meta.size,
    storage_path: `notices/${noticeId}/${newId('f_')}`,
    inline_data: meta.dataUrl,
    uploaded_by: ctx.actor.profile.id,
    uploaded_at: ctx.now,
  };
  notice.attachments.push(doc);
  notice.updated_at = ctx.now;
  ctx.data.documents.push(doc);
  ctx.audit('notice.attachment', 'notice', noticeId, { size: meta.size, mime: meta.mime });
  return doc;
}

export function removeNoticeAttachment(ctx: OpContext, noticeId: string, docId: string): void {
  const notice = ctx.data.notices.find((n) => n.id === noticeId);
  if (!notice) return;
  notice.attachments = notice.attachments.filter((a) => a.id !== docId);
  ctx.data.documents = ctx.data.documents.filter((d) => d.id !== docId);
  ctx.audit('notice.attachment_remove', 'notice', noticeId, { doc: docId });
}

/* --------------------------------------------------------- statistics */

export function scopeOfProfile(data: OpContext['data'], profile: Profile): Scope {
  const snap = profileSnapshot(data, profile);
  return {
    faculty_id: snap.faculty_id ?? null,
    department_id: snap.department_id ?? null,
    batch_id: snap.batch_id ?? null,
    section_id: snap.section_id ?? null,
  };
}

export function allowedStatsScope(ctx: OpContext): Scope | null {
  const grants = ctx.actor.grants.filter((g) => g.permissions.includes('statistics.view'));
  if (!grants.length) return null;
  const uni = grants.find((g) => g.post.scope_type === 'university');
  if (uni) return {};
  return grants[0].scope;
}

export type ScopeTypeName = ScopeType;

/**
 * Migrates every in-progress application of a type to a new workflow version.
 * The workflow administrator never receives application contents — only counts.
 */
export function migrateApplicationsOfType(ctx: OpContext, typeId: string, workflowId: string): number {
  requirePerm(ctx, 'workflow.configure', 'You are not authorised to migrate applications.');
  const workflow = ctx.data.workflows.find((w) => w.id === workflowId);
  if (!workflow || workflow.application_type_id !== typeId) {
    fail('validation', 'Choose an active workflow for this application type.');
  }
  const ids = ctx.data.applications
    .filter(
      (a) =>
        a.application_type_id === typeId &&
        a.workflow_version_id !== workflowId &&
        ['submitted', 'under_review', 'resubmitted', 'further_pending', 'returned'].includes(a.status),
    )
    .map((a) => a.id);
  if (!ids.length) return 0;
  return migrateApplicationsToWorkflow(ctx, workflowId, ids);
}

export function inProgressCount(ctx: OpContext, typeId: string): number {
  return ctx.data.applications.filter(
    (a) =>
      a.application_type_id === typeId &&
      ['submitted', 'under_review', 'resubmitted', 'further_pending', 'returned'].includes(a.status),
  ).length;
}
