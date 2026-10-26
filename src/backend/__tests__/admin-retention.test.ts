import { describe, expect, it } from 'vitest';
import { asUser, EMAILS, expectThrows, makeBackend, signInAs } from './helpers';

describe('organisational structure', () => {
  it('rejects duplicate batch labels and section names within a scope', async () => {
    const be = await asUser(EMAILS.wfadmin);
    expectThrows(
      () =>
        be.saveBatch({
          department_id: 'dep_cse',
          label: 'cse 2024–2028',
          start_year: 2024,
          end_year: 2028,
        }),
      'conflict',
    );
    expectThrows(() => be.saveSection({ batch_id: 'bat_cse_2024', name: 'a' }), 'conflict');
    // the same label is fine in a different department
    const other = be.saveBatch({ department_id: 'dep_ece', label: 'CSE 2024–2028', start_year: 2024, end_year: 2028 });
    expect(other.id).toBeTruthy();
  });

  it('accepts new batches each year without touching existing ones', async () => {
    const be = await asUser(EMAILS.wfadmin);
    const before = be.peek().batches.length;
    const batch = be.saveBatch({
      department_id: 'dep_cse',
      label: 'CSE 2025–2029',
      start_year: 2025,
      end_year: 2029,
      status: 'active',
    });
    const section = be.saveSection({ batch_id: batch.id, name: 'A', capacity: 50 });
    expect(section.batch_id).toBe(batch.id);
    expect(be.peek().batches.length).toBe(before + 1);
    const older = be.peek().batches.find((b) => b.id === 'bat_cse_2024')!;
    expect(older.status).toBe('active');
    expect(older.label).toBe('CSE 2024–2028');
  });

  it('validates batch year ranges', async () => {
    const be = await asUser(EMAILS.wfadmin);
    expectThrows(
      () => be.saveBatch({ department_id: 'dep_cse', label: 'Bad', start_year: 2026, end_year: 2024 }),
      'validation',
    );
  });

  it('students must be enrolled into a section that belongs to their batch', async () => {
    const be = await asUser(EMAILS.wfadmin);
    expectThrows(
      () =>
        be.saveUser({
          full_name: 'Mismatched Student',
          email: 'mismatch@demo.university',
          kind: 'student',
          department_id: 'dep_cse',
          batch_id: 'bat_cse_2024',
          section_id: 'sec_ece24_a',
        }),
      'validation',
    );
  });
});

describe('accounts and assignments', () => {
  it('generates unique permanent user codes', async () => {
    const be = await asUser(EMAILS.wfadmin);
    const a = be.saveUser({
      full_name: 'First New Student',
      email: 'first.new@demo.university',
      kind: 'student',
      department_id: 'dep_cse',
      batch_id: 'bat_cse_2024',
      section_id: 'sec_cse24_a',
    });
    const b = be.saveUser({
      full_name: 'Second New Student',
      email: 'second.new@demo.university',
      kind: 'student',
      department_id: 'dep_cse',
      batch_id: 'bat_cse_2024',
      section_id: 'sec_cse24_a',
    });
    expect(a.profile.user_code).not.toBe(b.profile.user_code);
    expect(a.profile.user_code).toMatch(/^STU\d{4,}$/);
    const codes = be.peek().profiles.map((p) => p.user_code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it('requires the assignment scope to match the post type', async () => {
    const be = await asUser(EMAILS.wfadmin);
    expectThrows(
      () =>
        be.saveAssignment({
          user_id: 'usr_teacher',
          post_code: 'HOD',
          scope: {},
        }),
      'validation',
    );
    expectThrows(
      () =>
        be.saveAssignment({
          user_id: 'usr_student_a',
          post_code: 'MENTOR',
          scope: { section_id: 'sec_cse24_a' },
        }),
      'validation',
    );
    expectThrows(
      () => be.saveAssignment({ user_id: 'usr_teacher', post_code: 'NOT_A_POST', scope: {} }),
      'validation',
    );
  });

  it('replaces the holder of a post and notifies both people', async () => {
    const be = await asUser(EMAILS.wfadmin);
    be.saveAssignment({
      user_id: 'usr_teacher',
      post_code: 'HOD',
      scope: { faculty_id: 'fac_eng', department_id: 'dep_cse' },
      reason: 'Test replacement',
    });
    const hodAssignments = be
      .peek()
      .assignments.filter((a) => a.post_code === 'HOD' && a.scope.department_id === 'dep_cse' && a.active);
    expect(hodAssignments).toHaveLength(1);
    expect(hodAssignments[0].user_id).toBe('usr_teacher');
    expect(be.peek().notifications.some((n) => n.user_id === 'usr_hod_cse' && n.title.includes('Assignment ended'))).toBe(true);
    expect(be.peek().notifications.some((n) => n.user_id === 'usr_teacher' && n.title.includes('You now hold'))).toBe(true);
  });

  it('suspending an account revokes its live assignments', async () => {
    const be = await asUser(EMAILS.wfadmin);
    be.setUserStatus('usr_hod_cse', 'suspended');
    const live = be.peek().assignments.filter((a) => a.user_id === 'usr_hod_cse' && a.active);
    expect(live).toHaveLength(0);
    await signInAs(be, EMAILS.hodCse).catch(() => undefined);
    expect(be.getSession()).toBeNull();
  });

  it('only user managers can create accounts, and passwords never appear in data', async () => {
    const be = await asUser(EMAILS.mentorA);
    expectThrows(
      () =>
        be.saveUser({
          full_name: 'Unauthorised Account',
          email: 'unauth@demo.university',
          kind: 'teacher',
          department_id: 'dep_cse',
        }),
      'forbidden',
    );
    const json = JSON.stringify(be.peek());
    expect(json).not.toContain('password"');
  });
});

describe('retention workflow', () => {
  async function seedGraduatedBatchApplications() {
    const be = await signInAs(makeBackend(), EMAILS.wfadmin);
    const student = be.saveUser({
      full_name: 'Graduated Student',
      email: 'grad@demo.university',
      kind: 'student',
      department_id: 'dep_cse',
      batch_id: 'bat_cse_2020',
      section_id: 'sec_cse20_a',
    });
    return { be, student };
  }

  it('runs a dry run, requires a second approver, a typed confirmation, and leaves other batches alone', async () => {
    const { be } = await seedGraduatedBatchApplications();
    const batchId = 'bat_cse_2020';
    const job = be.createRetentionJob(batchId, 'final_deletion');
    expect(job.status).toBe('awaiting_approval');
    expect(job.dry_run).not.toBeNull();

    // the proposer cannot approve their own job
    expectThrows(() => be.approveRetentionJob(job.id, 'Approve as proposer'), 'forbidden');

    await signInAs(be, EMAILS.sysadmin);
    be.approveRetentionJob(job.id, 'Approved by the system administrator after review.');
    const approved = be.peek().retentionJobs.find((j) => j.id === job.id)!;
    expect(approved.status).toBe('approved');
    expect(be.peek().batches.find((b) => b.id === batchId)!.status).toBe('deletion_scheduled');

    expectThrows(() => be.executeRetentionJob(job.id, 'wrong label'), 'validation');
    const before = be.peek().applications.length;
    const result = be.executeRetentionJob(job.id, 'CSE 2020–2024');
    expect(result.audit.outcome).toBe('executed');
    expect(be.peek().batches.find((b) => b.id === batchId)!.status).toBe('deleted');
    expect(be.peek().applications.length).toBeLessThanOrEqual(before);
    // other batches untouched
    expect(be.peek().batches.find((b) => b.id === 'bat_cse_2024')!.status).toBe('active');
    expect(be.peek().applications.some((a) => a.batch_id === 'bat_cse_2024')).toBe(true);
  });

  it('a legal hold blocks approval and execution', async () => {
    const { be } = await seedGraduatedBatchApplications();
    const hold = be.addLegalHold('bat_cse_2020', 'Ongoing legal dispute with an alumnus');
    const job = be.createRetentionJob('bat_cse_2020', 'initial_cleanup');
    await signInAs(be, EMAILS.sysadmin);
    expectThrows(
      () => be.approveRetentionJob(job.id, 'Try to approve despite the hold'),
      'conflict',
    );
    be.releaseLegalHold(hold.id);
    be.approveRetentionJob(job.id, 'Hold released, proceeding with cleanup.');
    expect(be.peek().retentionJobs.find((j) => j.id === job.id)!.status).toBe('approved');
  });

  it('preserves protected records such as open applications', async () => {
    const { be } = await seedGraduatedBatchApplications();
    const student = be.peek().profiles.find((p) => p.email === 'grad@demo.university')!;
    const token = await be.createActivation(student.id);
    await be.activateAccount(token.token, 'StrongPass#2026');
    await signInAs(be, 'grad@demo.university', 'StrongPass#2026');
    const draft = be.createDraft('at_student_leave', {
      leave_type: 'Other',
      from_date: '2026-11-01',
      to_date: '2026-11-02',
      reason: 'Late submission of a final-year document.',
    });
    be.submit(draft.id);
    const open = be.getView().applications.find((a) => a.id === draft.id)!;
    expect(open.status).toBe('submitted');

    await signInAs(be, EMAILS.wfadmin);
    const job = be.createRetentionJob('bat_cse_2020', 'final_deletion');
    expect(job.dry_run!.protected).toBe(1);
    expect(job.dry_run!.applications).toBe(0);

    await signInAs(be, EMAILS.sysadmin);
    be.approveRetentionJob(job.id, 'Approved for the unprotected records only.');
    be.executeRetentionJob(job.id, 'CSE 2020–2024');
    // the open application survives the deletion
    expect(be.peek().applications.some((a) => a.id === draft.id)).toBe(true);
  });

  it('only retention managers can propose jobs', async () => {
    const be = await asUser(EMAILS.hodCse);
    expectThrows(() => be.createRetentionJob('bat_cse_2020', 'final_deletion'), 'forbidden');
  });

  it('refuses to delete a batch directly through the status editor', async () => {
    const be = await asUser(EMAILS.wfadmin);
    expectThrows(() => be.setBatchStatus('bat_cse_2020', 'deleted'), 'forbidden');
  });
});

describe('application type and workflow configuration', () => {
  it('validates fields, document keys and post references', async () => {
    const be = await asUser(EMAILS.wfadmin);
    const base = {
      code: 'TEST_TYPE',
      name: 'Test type',
      description: 'created in a test',
      applicant_kinds: ['student'] as const,
      confidential: false,
      allow_draft: true,
      allow_withdraw: false,
      fields: [
        { key: 'reason', label: 'Reason', type: 'textarea' as const, required: true },
      ],
      documents: [],
      retention_category: 'standard',
      extra_viewer_posts: [],
      fallback_approver_post: null,
      active: true,
    };
    expectThrows(
      () =>
        be.saveApplicationType({
          ...base,
          applicant_kinds: [...base.applicant_kinds],
          fields: [
            { key: 'reason', label: 'Reason', type: 'textarea', required: true },
            { key: 'reason', label: 'Duplicate', type: 'text', required: false },
          ],
        }),
      'validation',
    );
    const created = be.saveApplicationType({ ...base, applicant_kinds: [...base.applicant_kinds] });
    expect(created.id).toBeTruthy();
    expectThrows(
      () =>
        be.saveWorkflow({
          application_type_id: created.id,
          stages: [{ key: 'x', post_code: 'NOT_A_POST', label: 'Nope', optional: false }],
          beyond_final: null,
        }),
      'validation',
    );
    const wf = be.saveWorkflow({
      application_type_id: created.id,
      stages: [{ key: 'mentor', post_code: 'MENTOR', label: 'Mentor', optional: false }],
      beyond_final: null,
    });
    expect(wf.version).toBe(1);
    const wf2 = be.saveWorkflow({
      application_type_id: created.id,
      stages: [{ key: 'hod', post_code: 'HOD', label: 'HOD', optional: false }],
      beyond_final: null,
    });
    expect(wf2.version).toBe(2);
    expect(be.peek().workflows.filter((w) => w.application_type_id === created.id && w.status === 'active')).toHaveLength(1);
  });

  it('configurable custom posts can be added above the VC', async () => {
    const be = await asUser(EMAILS.wfadmin);
    const post = be.savePost({
      code: 'PRO_CHANCELLOR',
      name: 'Pro-Chancellor',
      scope_type: 'university',
      rank: 75,
      permissions: ['application.submit', 'application.view', 'application.act', 'document.view'],
      is_system: false,
      active: true,
      description: 'Another configurable post above the VC',
    });
    expect(post.code).toBe('PRO_CHANCELLOR');
    const assignment = be.saveAssignment({ user_id: 'usr_pvc', post_code: 'PRO_CHANCELLOR', scope: {} });
    expect(assignment.post_code).toBe('PRO_CHANCELLOR');
  });

  it('workflow managers cannot read application contents', async () => {
    const be = await asUser(EMAILS.wfadmin);
    expect(be.getView().applications).toHaveLength(0);
    expect(be.getView().audit.length).toBeGreaterThan(0);
  });
});
