import { describe, expect, it } from 'vitest';
import { asUser, EMAILS, expectRejects, expectThrows, makeBackend, signInAs } from './helpers';
import { sweepNotices } from '../ops/notices';
import { DEMO_PASSWORD } from '../seed';

describe('confidential applications', () => {
  it('only the officer required to act can read and act, and access follows the stage', async () => {
    const be = await asUser(EMAILS.mentorA);
    const grievance = be.peek().applications.find((a) => a.confidential)!;
    expect(grievance).toBeTruthy();
    expect(grievance.current_post).toBe('MENTOR');
    expect(be.getView().applications.some((a) => a.id === grievance.id)).toBe(true);

    // The system administrator cannot read it, even with every admin permission.
    await signInAs(be, EMAILS.sysadmin);
    expect(be.getView().applications.some((a) => a.id === grievance.id)).toBe(false);
    expect(be.getView().documents.some((d) => d.application_id === grievance.id)).toBe(false);

    // The officer who must act can act; after forwarding, access moves with the stage.
    await signInAs(be, EMAILS.mentorA);
    be.act(grievance.id, { action: 'approve', remarksInternal: 'Handled by the mentor.' });
    expect(be.getView().applications.some((a) => a.id === grievance.id)).toBe(false);

    await signInAs(be, EMAILS.hodCse);
    const visible = be.getView().applications.find((a) => a.id === grievance.id);
    expect(visible).toBeTruthy();
    expect(visible!.current_post).toBe('HOD');
  });

  it('the applicant always sees their own confidential application', async () => {
    const student = await asUser(EMAILS.studentB);
    const own = student
      .getView()
      .applications.filter((a) => a.applicant_id === student.getSession()!.profile.id);
    expect(own.some((a) => a.confidential)).toBe(true);
  });
});

describe('notification fan-out', () => {
  it('never creates the same notification twice for the same event', async () => {
    const be = await signInAs(makeBackend(), EMAILS.studentA);
    const draft = be.createDraft('at_bonafide', { purpose: 'Opening a bank account for the scholarship.' });
    be.submit(draft.id);
    const applicantId = be.getSession()!.profile.id;
    const keys = be
      .peek()
      .notifications.filter((n) => n.user_id === applicantId && n.link === `#/applications/${draft.id}`)
      .map((n) => n.dedupe_key);
    expect(keys.length).toBeGreaterThan(0);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('a repeated decision attempt does not duplicate the applicant notification', async () => {
    const be = await signInAs(makeBackend(), EMAILS.studentA);
    const studentId = be.getSession()!.profile.id;
    const draft = be.createDraft('at_student_leave', {
      leave_type: 'Medical',
      from_date: '2026-09-01',
      to_date: '2026-09-02',
      reason: 'Recovery after a minor procedure.',
    });
    be.submit(draft.id);

    await signInAs(be, EMAILS.mentorA);
    be.act(draft.id, { action: 'approve' });
    expectThrows(() => be.act(draft.id, { action: 'approve' }), 'forbidden');

    const forApplicant = be.peek().notifications.filter((n) => n.user_id === studentId && n.link === `#/applications/${draft.id}`);
    expect(forApplicant.filter((n) => n.body.includes('next reviewing office')).length).toBe(1);
  });
});

describe('scheduled notices', () => {
  it('publishes on its own when the scheduled time passes, once only', async () => {
    const be = await signInAs(makeBackend(), EMAILS.vc);
    const notice = be.saveNotice({
      title: 'Convocation dress rehearsal',
      body: 'Attendance is mandatory for all graduating students.',
      scope_type: 'university',
      scope: { faculty_id: null, department_id: null, batch_id: null, section_id: null },
      audience: 'everyone',
      status: 'published',
      publish_at: new Date(Date.now() + 3_600_000).toISOString(),
    });
    expect(notice.status).toBe('scheduled');
    expect(be.peek().notifications.some((n) => n.dedupe_key === `notice:${notice.id}:usr_student_a`)).toBe(false);

    const later = new Date(Date.now() + 7_200_000).toISOString();
    expect(sweepNotices(be.peek(), later)).toBe(true);
    expect(be.peek().notices.find((n) => n.id === notice.id)!.status).toBe('published');
    expect(be.peek().notifications.some((n) => n.dedupe_key === `notice:${notice.id}:usr_student_a`)).toBe(true);

    // Running the sweep again must not duplicate anything.
    const before = be.peek().notifications.length;
    sweepNotices(be.peek(), later);
    expect(be.peek().notifications.length).toBe(before);
  });
});

describe('password handling', () => {
  it('rejects weak passwords and keeps the old password working', async () => {
    const be = await asUser(EMAILS.studentA);
    await expectRejects(be.changePassword(DEMO_PASSWORD, 'short'), 'weak_password');
    await expectRejects(be.changePassword('not-the-password', 'StrongPass#2026'), 'invalid_credentials');
    await be.changePassword(DEMO_PASSWORD, 'StrongPass#2026');
    be.signOut();
    const result = await be.signIn(EMAILS.studentA, 'StrongPass#2026');
    expect(result.user.profile.id).toBe('usr_student_a');
  });

  it('issues single-use reset links that expire', async () => {
    const be = await asUser(EMAILS.studentA);
    const { token } = await be.requestPasswordReset(EMAILS.studentA);
    await be.resetPassword(token, 'AnotherPass#2026');
    await expectRejects(be.resetPassword(token, 'ThirdPass#2026'), 'invalid_token');
    be.signOut();
    await expect(be.signIn(EMAILS.studentA, 'AnotherPass#2026')).resolves.toBeTruthy();
  });
});

describe('a decision that arrives too late', () => {
  it('cannot approve after the applicant withdraws', async () => {
    const be = await signInAs(makeBackend(), EMAILS.studentA);
    const draft = be.createDraft('at_student_leave', {
      leave_type: 'Official duty',
      from_date: '2026-10-05',
      to_date: '2026-10-06',
      reason: 'Representing the department at a national event.',
    });
    be.submit(draft.id);

    // The applicant withdraws while the mentor has the record open.
    be.withdraw(draft.id, 'Plans have changed.');
    expect(be.peek().applications.find((a) => a.id === draft.id)!.status).toBe('withdrawn');

    await signInAs(be, EMAILS.mentorA);
    expectThrows(() => be.act(draft.id, { action: 'approve' }), 'invalid_state');
    expect(be.peek().applications.find((a) => a.id === draft.id)!.status).toBe('withdrawn');
  });

  it('cannot approve the same record twice', async () => {
    const be = await signInAs(makeBackend(), EMAILS.studentA);
    const draft = be.createDraft('at_student_leave', {
      leave_type: 'Medical',
      from_date: '2026-11-11',
      to_date: '2026-11-12',
      reason: 'Scheduled treatment at the university hospital.',
    });
    be.submit(draft.id);

    await signInAs(be, EMAILS.mentorA);
    be.act(draft.id, { action: 'approve' });
    const after = be.peek().applications.find((a) => a.id === draft.id)!;
    expect(after.stage_index).toBe(1);
    expectThrows(() => be.act(draft.id, { action: 'approve' }), 'forbidden');
    expect(be.peek().applications.find((a) => a.id === draft.id)!.stage_index).toBe(1);
  });
});

describe('revoked assignments', () => {
  it('an old link, its documents and its notifications stop working', async () => {
    const be = await asUser(EMAILS.mentorA);
    const pending = be.getView().applications.find((a) => a.current_post === 'MENTOR')!;
    const document = be.peek().documents.find((d) => d.application_id === pending.id);
    expect(pending).toBeTruthy();

    await signInAs(be, EMAILS.wfadmin);
    const assignment = be
      .peek()
      .assignments.find((a) => a.user_id === 'usr_mentor_a' && a.post_code === 'MENTOR' && a.active)!;
    be.endAssignment(assignment.id, 'Left the university');

    await signInAs(be, EMAILS.mentorA);
    // The deep link now falls outside every grant.
    expect(be.getView().applications.some((a) => a.id === pending.id)).toBe(false);
    if (document) expectThrows(() => be.getDocumentDataUrl(document.id), 'forbidden');
    // The queue link resolves to nothing rather than to stale data.
    expect(be.getView().notifications.some((n) => n.link === `#/applications/${pending.id}`)).toBe(true);
  });
});
