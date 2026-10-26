import { describe, expect, it } from 'vitest';
import { asUser, EMAILS, expectThrows, makeBackend, signInAs } from './helpers';

describe('approval route', () => {
  it('runs mentor → HOD → completed and informs the applicant', async () => {
    const be = await signInAs(makeBackend(), EMAILS.studentA);
    const draft = be.createDraft('at_student_leave', {
      leave_type: 'Medical',
      from_date: '2026-11-10',
      to_date: '2026-11-11',
      reason: 'Fever, advised rest.',
      contact: '+91 90000 00009',
    });
    be.submit(draft.id);

    let app = be.getView().applications.find((a) => a.id === draft.id)!;
    expect(app.status).toBe('submitted');
    expect(app.current_post).toBe('MENTOR');
    expect(app.reference).toMatch(/^APP-\d{4}-\d{5}$/);

    await signInAs(be, EMAILS.mentorA);
    be.act(draft.id, { action: 'approve', remarksApplicant: 'Forwarded to the HOD.' });
    app = be.getView().applications.find((a) => a.id === draft.id)!;
    expect(app.status).toBe('under_review');
    expect(app.current_post).toBe('HOD');

    await signInAs(be, EMAILS.hodCse);
    be.act(draft.id, { action: 'finalise', remarksApplicant: 'Approved.' });
    app = be.getView().applications.find((a) => a.id === draft.id)!;
    expect(app.status).toBe('completed');
    expect(app.current_post).toBeNull();

    await signInAs(be, EMAILS.studentA);
    const view = be.getView();
    const own = view.applications.find((a) => a.id === draft.id)!;
    expect(own.status).toBe('completed');
    const timeline = view.statusEvents.filter((e) => e.application_id === draft.id);
    expect(timeline.map((e) => e.status)).toContain('completed');
    expect(view.notifications.some((n) => n.body.includes(app.reference))).toBe(true);
  });

  it('requires remarks for reject and return, and keeps internal notes private', async () => {
    const be = await signInAs(makeBackend(), EMAILS.studentB);
    const draft = be.createDraft('at_student_leave', {
      leave_type: 'Family function',
      from_date: '2026-11-20',
      to_date: '2026-11-21',
      reason: 'Family event.',
    });
    be.submit(draft.id);

    await signInAs(be, EMAILS.mentorA);
    expectThrows(() => be.act(draft.id, { action: 'return' }), 'validation');
    expectThrows(() => be.act(draft.id, { action: 'reject' }), 'validation');
    be.act(draft.id, {
      action: 'return',
      remarksApplicant: 'Please attach the invitation letter.',
      remarksInternal: 'Applicant has a history of late submissions.',
    });

    await signInAs(be, EMAILS.studentB);
    const view = be.getView();
    const app = view.applications.find((a) => a.id === draft.id)!;
    expect(app.status).toBe('returned');
    expect(view.statusEvents.some((e) => e.application_id === draft.id && e.note?.includes('invitation'))).toBe(true);
    const leaked = view.actions.some(
      (a) => a.application_id === draft.id && a.remarks_internal !== null,
    );
    expect(leaked).toBe(false);

    // correction and resubmission return the case to the same post
    be.submit(draft.id);
    const resubmitted = be.getView().applications.find((a) => a.id === draft.id)!;
    expect(resubmitted.status).toBe('resubmitted');
    expect(resubmitted.current_post).toBe('MENTOR');
  });

  it('blocks actions from a post that is not the current stage', async () => {
    const be = await signInAs(makeBackend(), EMAILS.hodCse);
    const atMentor = be.peek().applications.find((a) => a.current_post === 'MENTOR' && a.org.department_id === 'dep_cse')!;
    expectThrows(() => be.act(atMentor.id, { action: 'approve' }), 'forbidden');
  });
});

describe('VC stage', () => {
  it('cannot finalise when a higher configured post must still act', async () => {
    const be = await signInAs(makeBackend(), EMAILS.studentA);
    // staff-only types are not offered to students at all
    expectThrows(
      () =>
        be.createDraft('at_faculty_leave', {
          leave_type: 'Casual leave',
          from_date: '2026-12-10',
          to_date: '2026-12-11',
          reason: 'Personal work.',
        }),
      'forbidden',
    );

    await signInAs(be, EMAILS.teacher);
    const staffDraft = be.createDraft('at_faculty_leave', {
      leave_type: 'Casual leave',
      from_date: '2026-12-10',
      to_date: '2026-12-11',
      reason: 'Personal work.',
    });
    be.submit(staffDraft.id);
    await signInAs(be, EMAILS.hodCse);
    be.act(staffDraft.id, { action: 'approve' });
    await signInAs(be, EMAILS.deanEng);
    be.act(staffDraft.id, { action: 'approve' });
    await signInAs(be, EMAILS.vc);
    const err = expectThrows(() => be.act(staffDraft.id, { action: 'finalise' }), 'invalid_action');
    expect(err.message).toMatch(/Approve and forward/i);
    expectThrows(() => be.act(staffDraft.id, { action: 'approve' }), 'invalid_action');

    be.act(staffDraft.id, {
      action: 'approve_forward',
      remarksApplicant: 'Approved; the Chancellor’s office will finalise.',
    });
    const app = be.getView().applications.find((a) => a.id === staffDraft.id)!;
    expect(app.status).toBe('further_pending');
    expect(app.vc_approved).toBe(true);
    expect(app.current_post).toBe('CHANCELLOR');
    expect(app.decided_at).toBeNull();

    // Only the configured next post can complete it.
    await signInAs(be, EMAILS.deanEng);
    expectThrows(() => be.act(staffDraft.id, { action: 'finalise' }), 'forbidden');
    await signInAs(be, EMAILS.chancellor);
    be.act(staffDraft.id, { action: 'finalise', remarksApplicant: 'Finally approved.' });
    const done = be.getView().applications.find((a) => a.id === staffDraft.id)!;
    expect(done.status).toBe('completed');
    expect(done.decided_at).not.toBeNull();
  });

  it('can finalise when the VC is the configured final authority', async () => {
    const be = await signInAs(makeBackend(), EMAILS.teacher);
    const draft = be.createDraft('at_reimbursement', {
      amount: '1200',
      incurred_on: '2026-10-01',
      purpose: 'Local travel for field work.',
    });
    // required receipt missing → submission blocked
    const err = expectThrows(() => be.submit(draft.id), 'validation');
    expect(err.message.toLowerCase()).toContain('receipt');

    const file = new File([new Uint8Array([37, 80, 68, 70])], 'receipt.pdf', { type: 'application/pdf' });
    const doc = await be.uploadDocument(draft.id, 'receipt', file);
    expect(doc.doc_key).toBe('receipt');
    be.submit(draft.id);
    await signInAs(be, EMAILS.hodCse);
    be.act(draft.id, { action: 'approve' });
    // Registrar is the last configured stage for this type
    await signInAs(be, EMAILS.registrar);
    be.act(draft.id, { action: 'finalise', remarksApplicant: 'Reimbursed.' });
    const app = be.getView().applications.find((a) => a.id === draft.id)!;
    expect(app.status).toBe('completed');
  });
});

describe('document rules', () => {
  it('rejects wrong file types and oversized files', async () => {
    const be = await asUser(EMAILS.studentA);
    const draft = be.createDraft('at_grievance', {
      subject: 'Marks issue',
      details: 'Marks not updated.',
      consent: true,
    });
    const exe = new File([new Uint8Array([1, 2, 3])], 'malware.exe', { type: 'application/x-msdownload' });
    await expect(be.uploadDocument(draft.id, 'marksheet', exe)).rejects.toMatchObject({ code: 'validation' });

    const big = new File([new Uint8Array(3 * 1024 * 1024)], 'big.pdf', { type: 'application/pdf' });
    await expect(be.uploadDocument(draft.id, 'marksheet', big)).rejects.toMatchObject({ code: 'validation' });
  });

  it('does not let another applicant upload or delete documents', async () => {
    const be = await asUser(EMAILS.studentB);
    const foreignDoc = be.peek().documents.find((d) => d.uploaded_by === 'usr_student_a')!;
    expectThrows(() => be.removeDocument(foreignDoc.id), 'forbidden');
    expectThrows(() => be.getDocumentDataUrl(foreignDoc.id), 'forbidden');
  });
});

describe('workflow versioning', () => {
  it('does not rewrite in-progress applications when a workflow changes', async () => {
    const be = await signInAs(makeBackend(), EMAILS.wfadmin);
    const before = be.peek().applications.find((a) => a.status === 'further_pending')!;
    const beforeWorkflow = before.workflow_version_id;

    be.saveWorkflow({
      application_type_id: 'at_faculty_leave',
      stages: [
        { key: 'dean', post_code: 'DEAN', label: 'Dean', optional: false },
        { key: 'vc', post_code: 'VC', label: 'VC', optional: false },
      ],
      beyond_final: null,
      notes: 'Simplified route',
    });

    const after = be.peek().applications.find((a) => a.id === before.id)!;
    expect(after.workflow_version_id).toBe(beforeWorkflow);
    expect(after.current_post).toBe('CHANCELLOR');

    const versions = be.peek().workflows.filter((w) => w.application_type_id === 'at_faculty_leave');
    expect(versions.filter((w) => w.status === 'active')).toHaveLength(1);
    expect(versions.length).toBe(2);
  });

  it('supports an explicit, audited migration of an in-progress application', async () => {
    const be = await signInAs(makeBackend(), EMAILS.wfadmin);
    const pending = be.peek().applications.find((a) => a.status === 'further_pending')!;
    const workflow = be.saveWorkflow({
      application_type_id: 'at_faculty_leave',
      stages: [{ key: 'registrar', post_code: 'REGISTRAR', label: 'Registrar', optional: false }],
      beyond_final: null,
    });
    const count = be.migrateApplications(workflow.id, [pending.id]);
    expect(count).toBe(1);
    const moved = be.peek().applications.find((a) => a.id === pending.id)!;
    expect(moved.workflow_version_id).toBe(workflow.id);
    expect(moved.current_post).toBe('REGISTRAR');
    expect(be.peek().audit.some((a) => a.action === 'workflow.migrate')).toBe(true);
  });
});
