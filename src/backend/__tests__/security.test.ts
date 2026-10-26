import { describe, expect, it } from 'vitest';
import { asUser, EMAILS, expectRejects, expectThrows, makeBackend, signInAs } from './helpers';
import { DEMO_PASSWORD } from '../seed';

describe('authentication', () => {
  it('rejects a wrong password and accepts the demo password', async () => {
    const be = makeBackend();
    await expectRejects(be.signIn(EMAILS.studentA, 'wrong-password-1'), 'invalid_credentials');
    const result = await be.signIn(EMAILS.studentA, DEMO_PASSWORD);
    expect(result.user.profile.user_code).toBe('STU0001');
  });

  it('locks after repeated failures', async () => {
    const be = makeBackend();
    for (let i = 0; i < 5; i++) {
      await expectRejects(be.signIn(EMAILS.studentA, `bad-password-${i}`), 'invalid_credentials');
    }
    await expectRejects(be.signIn(EMAILS.studentA, DEMO_PASSWORD), 'locked');
  });

  it('an invited account cannot sign in until activated', async () => {
    const be = await signInAs(makeBackend(), EMAILS.wfadmin);
    const created = be.saveUser({
      full_name: 'New Teacher',
      email: 'new.teacher@demo.university',
      kind: 'teacher',
      department_id: 'dep_cse',
      designation: 'Assistant Professor',
    });
    const token = await be.createActivation(created.profile.id);
    be.signOut();
    await expectRejects(be.signIn('new.teacher@demo.university', 'Whatever#123'), 'invited');
    await be.activateAccount(token.token, 'StrongPass#2026');
    const signed = await be.signIn('new.teacher@demo.university', 'StrongPass#2026');
    expect(signed.user.profile.status).toBe('active');
  });

  it('a student can change their own username, and the old one stops working', async () => {
    const be = await asUser(EMAILS.studentA);
    await be.changeUsername('aarav.new@demo.university', DEMO_PASSWORD);
    expect(be.getSession()!.profile.email).toBe('aarav.new@demo.university');
    expect(be.peek().profiles.find((p) => p.id === be.getSession()!.profile.id)?.email).toBe(
      'aarav.new@demo.university',
    );
    be.signOut();
    await expectRejects(be.signIn(EMAILS.studentA, DEMO_PASSWORD), 'invalid_credentials');
    const signed = await be.signIn('aarav.new@demo.university', DEMO_PASSWORD);
    expect(signed.user.profile.user_code).toBe('STU0001');
    const audit = be.peek().audit.find((a) => a.action === 'user.username_change');
    expect(audit?.meta).toMatchObject({ before: EMAILS.studentA, after: 'aarav.new@demo.university' });
  });

  it('rejects a username change with a wrong password, a taken username or an invalid address', async () => {
    const be = await asUser(EMAILS.studentA);
    await expectRejects(be.changeUsername('aarav.other@demo.university', 'WrongPass#123'), 'invalid_credentials');
    await expectRejects(be.changeUsername(EMAILS.studentB, DEMO_PASSWORD), 'conflict');
    await expectRejects(be.changeUsername('not-an-email', DEMO_PASSWORD), 'validation');
    await expectRejects(be.changeUsername(EMAILS.studentA, DEMO_PASSWORD), 'validation');
    expect(be.getSession()!.profile.email).toBe(EMAILS.studentA);
  });

  it('staff cannot change their own username, and nobody can change another profile', async () => {
    const teacher = await asUser(EMAILS.teacher);
    await expectRejects(teacher.changeUsername('teacher.new@demo.university', DEMO_PASSWORD), 'forbidden');
    const student = await asUser(EMAILS.studentA);
    await expectRejects(student.changeUsername(EMAILS.studentB, `x#${'Yz9'.repeat(4)}`), 'invalid_credentials');
    expect(student.peek().profiles.find((p) => p.email === EMAILS.studentB)).toBeTruthy();
    expect(student.peek().profiles.find((p) => p.email === EMAILS.studentA)).toBeTruthy();
  });

  it('never exposes existing passwords through the data set', async () => {
    const be = await signInAs(makeBackend(), EMAILS.sysadmin);
    const exported = be.exportState();
    expect(exported).not.toContain(DEMO_PASSWORD);
  });
});

describe('record level access', () => {
  it('student sees only their own applications', async () => {
    const be = await asUser(EMAILS.studentA);
    const view = be.getView();
    expect(view.applications.length).toBeGreaterThan(0);
    for (const app of view.applications) {
      expect(app.applicant_id).toBe(be.getSession()!.profile.id);
    }
    const other = be.peek().applications.find((a) => a.applicant_code === 'STU0002');
    expect(other).toBeTruthy();
    expect(view.applications.some((a) => a.id === other!.id)).toBe(false);
  });

  it('student cannot open another student’s document', async () => {
    const be = await asUser(EMAILS.studentA);
    const foreignDoc = be.peek().documents.find((d) => d.uploaded_by !== be.getSession()!.profile.id);
    expect(foreignDoc).toBeTruthy();
    expectThrows(() => be.getDocumentDataUrl(foreignDoc!.id), 'forbidden');
  });

  it('student cannot act on their own application', async () => {
    const be = await asUser(EMAILS.studentA);
    const own = be.getView().applications[0];
    expect(own).toBeTruthy();
    const err = expectThrows(() => be.act(own.id, { action: 'approve' }));
    expect(err.message.toLowerCase()).toContain('own application');
  });

  it('mentor sees only their own section and cannot act in another section', async () => {
    const be = await asUser(EMAILS.mentorA);
    const view = be.getView();
    const apps = view.applications.filter((a) => a.applicant_kind === 'student');
    expect(apps.length).toBeGreaterThan(0);
    for (const app of apps) {
      expect(app.org.section_id).toBe('sec_cse24_a');
    }
    const otherSection = be
      .peek()
      .applications.find((a) => a.org.section_id === 'sec_cse24_b' && a.current_post === 'MENTOR');
    expect(otherSection).toBeTruthy();
    expect(view.applications.some((a) => a.id === otherSection!.id)).toBe(false);
    expectThrows(
      () => be.act(otherSection!.id, { action: 'approve' }),
      'forbidden',
    );
  });

  it('HOD cannot read another department’s records', async () => {
    const be = await asUser(EMAILS.hodCse);
    const view = be.getView();
    for (const app of view.applications) {
      expect(app.org.department_id === null || app.org.department_id === 'dep_cse').toBe(true);
    }
    const ece = be.peek().applications.find((a) => a.org.department_id === 'dep_ece');
    if (ece) expect(view.applications.some((a) => a.id === ece.id)).toBe(false);
  });

  it('dean cannot read another faculty’s records', async () => {
    const be = await asUser(EMAILS.deanSci);
    const view = be.getView();
    for (const app of view.applications) {
      expect(app.org.faculty_id === null || app.org.faculty_id === 'fac_sci').toBe(true);
    }
  });

  it('system administrator cannot read application contents', async () => {
    const be = await asUser(EMAILS.sysadmin);
    const view = be.getView();
    expect(view.applications).toHaveLength(0);
    expect(view.documents).toHaveLength(0);
    const anyApp = be.peek().applications[0];
    expectThrows(() => be.act(anyApp.id, { action: 'approve' }), 'forbidden');
  });

  it('auditor has audit rights but no access to application contents', async () => {
    const be = await asUser(EMAILS.auditor);
    const view = be.getView();
    expect(view.audit.length).toBeGreaterThan(0);
    expect(view.applications).toHaveLength(0);
  });

  it('confidential applications are visible only to the officer who must act', async () => {
    const confidential = (be: ReturnType<typeof makeBackend>) =>
      be.peek().applications.find((a) => a.confidential)!;

    const mentor = await asUser(EMAILS.mentorA);
    const target = confidential(mentor);
    expect(target.current_post).toBe('MENTOR');
    expect(mentor.getView().applications.some((a) => a.id === target.id)).toBe(true);

    const hod = await asUser(EMAILS.hodCse);
    expect(hod.getView().applications.some((a) => a.id === target.id)).toBe(false);

    const admin = await asUser(EMAILS.sysadmin);
    expect(admin.getView().applications.some((a) => a.id === target.id)).toBe(false);
  });
});

describe('post handover and history', () => {
  it('a new HOD can read the post history created by the previous HOD, the old HOD cannot', async () => {
    const be = await signInAs(makeBackend(), EMAILS.wfadmin);
    const created = be.saveUser({
      full_name: 'Dr. New Head',
      email: 'new.hod@demo.university',
      kind: 'teacher',
      department_id: 'dep_cse',
      designation: 'Professor',
    });
    const token = await be.createActivation(created.profile.id);
    be.saveAssignment({
      user_id: created.profile.id,
      post_code: 'HOD',
      scope: { faculty_id: 'fac_eng', department_id: 'dep_cse' },
      reason: 'Handover in test',
    });

    const pendingAtHod = be.peek().applications.filter((a) => a.current_post === 'HOD');
    const historyPost = be.peek().actions.filter((a) => a.post_code === 'HOD');
    expect(pendingAtHod.length).toBeGreaterThan(0);
    expect(historyPost.length).toBeGreaterThan(0);

    // new holder sees the queue and the previous holder's decisions
    await signInAs(be, 'new.hod@demo.university', DEMO_PASSWORD).catch(async () => {
      await be.activateAccount(token.token, 'StrongPass#2026');
      await signInAs(be, 'new.hod@demo.university', 'StrongPass#2026');
    });
    const newHodView = be.getView();
    expect(be.getSession()!.postCodes).toContain('HOD');
    for (const app of pendingAtHod) {
      expect(newHodView.applications.some((a) => a.id === app.id)).toBe(true);
    }
    const historyApp = historyPost[0].application_id;
    const shown = newHodView.actions.filter((a) => a.application_id === historyApp && a.post_code === 'HOD');
    expect(shown.some((a) => a.actor_name.includes('Head CSE'))).toBe(true);

    // the replaced holder lost the post and its history
    await signInAs(be, EMAILS.hodCse);
    expect(be.getSession()!.postCodes).not.toContain('HOD');
    expect(be.getView().applications.some((a) => a.current_post === 'HOD')).toBe(false);
    expectThrows(() => be.act(historyPost[0].application_id, { action: 'approve' }), 'forbidden');
  });

  it('ending an assignment revokes access immediately, other assignments keep working', async () => {
    const be = await signInAs(makeBackend(), EMAILS.mentorA);
    const before = be.getView().applications.length;
    expect(before).toBeGreaterThan(0);
    const mentorProfileId = be.getSession()!.profile.id;

    await signInAs(be, EMAILS.wfadmin);
    const mentorAssignment = be
      .peek()
      .assignments.find((a) => a.user_id === mentorProfileId && a.post_code === 'MENTOR')!;
    be.endAssignment(mentorAssignment.id, 'Test revocation');

    // A second, independent post keeps working for the same employee.
    be.saveAssignment({
      user_id: mentorProfileId,
      post_code: 'HOD',
      scope: { faculty_id: 'fac_eng', department_id: 'dep_cse' },
      reason: 'Test: independent assignment',
    });

    await signInAs(be, EMAILS.mentorA);
    const session = be.getSession()!;
    expect(session.postCodes).not.toContain('MENTOR');
    expect(session.postCodes).toContain('HOD');
    const after = be.getView();
    // section-scoped queue is gone; department-level queue is accessible
    const sectionB = be.peek().applications.find((a) => a.org.section_id === 'sec_cse24_b' && a.current_post === 'MENTOR');
    expect(sectionB).toBeTruthy();
    expect(after.applications.some((a) => a.id === sectionB!.id)).toBe(false);
    const deptPending = be.peek().applications.find((a) => a.current_post === 'HOD');
    expect(deptPending).toBeTruthy();
    expect(after.applications.some((a) => a.id === deptPending!.id)).toBe(true);
  });

  it('a former HOD (assignment already ended in seed data) has no HOD access', async () => {
    const be = await asUser(EMAILS.formerHod);
    expect(be.getSession()!.postCodes).not.toContain('HOD');
    expect(be.getView().applications).toHaveLength(0);
    const hodAction = be.peek().actions.find((a) => a.post_code === 'HOD');
    expect(hodAction).toBeTruthy();
    expectThrows(() => be.act(hodAction!.application_id, { action: 'approve' }), 'forbidden');
  });

  it('the current post holder still sees earlier holders’ decisions in the audit trail', async () => {
    const be = await asUser(EMAILS.hodCse);
    const view = be.getView();
    const withHistory = view.applications.find((a) =>
      view.actions.some((x) => x.application_id === a.id && x.post_code === 'MENTOR'),
    );
    expect(withHistory).toBeTruthy();
    const actions = view.actions.filter((a) => a.application_id === withHistory!.id);
    expect(actions.some((a) => a.post_code === 'MENTOR' || a.post_code === 'HOD')).toBe(true);
  });
});

describe('self approval', () => {
  it('an HOD’s own leave skips the HOD stage and never returns to them', async () => {
    const be = await asUser(EMAILS.hodCse);
    const draft = be.createDraft('at_faculty_leave', {
      leave_type: 'Casual leave',
      from_date: '2026-11-02',
      to_date: '2026-11-03',
      reason: 'Family commitment out of station.',
    });
    be.submit(draft.id);
    const app = be.getView().applications.find((a) => a.id === draft.id)!;
    expect(app.current_post).toBe('DEAN');
    expect(app.status).toBe('submitted');
    expectThrows(() => be.act(draft.id, { action: 'approve' }), 'forbidden');
  });

  it('a Dean’s own leave routes above the Dean', async () => {
    const be = await asUser(EMAILS.deanEng);
    const draft = be.createDraft('at_faculty_leave', {
      leave_type: 'Duty leave',
      from_date: '2026-12-01',
      to_date: '2026-12-02',
      reason: 'Official delegation to a partner university.',
    });
    be.submit(draft.id);
    const app = be.getView().applications.find((a) => a.id === draft.id)!;
    expect(['VC', 'HOD']).toContain(app.current_post);
    expect(app.current_post).not.toBe('DEAN');
  });
});
