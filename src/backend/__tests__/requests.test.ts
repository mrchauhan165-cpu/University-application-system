import { describe, expect, it } from 'vitest';
import { asUser, EMAILS, expectThrows, signInAs } from './helpers';
import { DEMO_PASSWORD } from '../seed';

/**
 * Two rules added after the first release:
 *  1. Dean level and above approve but never raise applications (enforced by the
 *     server, not merely hidden in the UI).
 *  2. Anyone can raise a free-text "Other request"; staff have no section, so the
 *     mentor stage is not applicable and routing must move on to the HOD.
 */

const OTHER = {
  subject: 'Permission to attend a robotics workshop',
  details: 'The workshop runs for two days at IIT Delhi. I will share notes with my class afterwards.',
};

describe('approve-only posts', () => {
  it.each([
    ['dean', EMAILS.deanEng],
    ['dean of science', EMAILS.deanSci],
    ['registrar', EMAILS.registrar],
    ['pro-vice-chancellor', EMAILS.pvc],
    ['vice-chancellor', EMAILS.vc],
    ['chancellor', EMAILS.chancellor],
  ])('a %s cannot create or submit an application', async (_label, email) => {
    const be = await asUser(email);
    expect(be.getSession()!.canSubmit).toBe(false);
    expectThrows(() => be.createDraft('at_other', OTHER), 'forbidden');
    expectThrows(() => be.createDraft('at_faculty_leave', { leave_type: 'Casual leave' }), 'forbidden');
  });

  it.each([
    ['student', EMAILS.studentA],
    ['teacher without a post', EMAILS.teacher],
    ['mentor', EMAILS.mentorA],
    ['head of department', EMAILS.hodCse],
  ])('a %s can still apply', async (_label, email) => {
    const be = await asUser(email);
    expect(be.getSession()!.canSubmit).toBe(true);
    const draft = be.createDraft('at_other', OTHER);
    expect(draft.id).toMatch(/^ap_/);
  });

  it('a post that loses the submit permission can no longer submit a saved draft', async () => {
    const be = await asUser(EMAILS.hodCse);
    const draft = be.createDraft('at_other', OTHER);
    be.signOut();
    await be.signIn(EMAILS.sysadmin, DEMO_PASSWORD);
    const post = be.peek().posts.find((p) => p.code === 'HOD')!;
    be.savePost({ ...post, permissions: post.permissions.filter((p) => p !== 'application.submit') });
    be.signOut();
    await be.signIn(EMAILS.hodCse, DEMO_PASSWORD);
    expect(be.getSession()!.canSubmit).toBe(false);
    expectThrows(() => be.submit(draft.id), 'forbidden');
  });

  it('an approve-only post can still take decisions', async () => {
    const be = await asUser(EMAILS.deanEng);
    const view = be.getView();
    expect(view.applications.length).toBeGreaterThan(0);
    expect(be.getSession()!.permissions).toContain('application.act');
  });
});

describe('other request', () => {
  it('is offered to students, teachers and staff only', async () => {
    const be = await asUser(EMAILS.studentA);
    const type = be.getView().applicationTypes.find((t) => t.id === 'at_other')!;
    expect(type.applicant_kinds).not.toContain('admin');
    expect(type.fields.map((f) => f.key)).toEqual(expect.arrayContaining(['subject', 'details']));
    expect(type.documents[0].required).toBe(false);
  });

  it('a student application starts with the mentor and then reaches the HOD', async () => {
    const be = await asUser(EMAILS.studentA);
    const draft = be.createDraft('at_other', OTHER);
    const submitted = be.submit(draft.id);
    expect(submitted.current_post).toBe('MENTOR');
    expect(submitted.status).toBe('submitted');

    await signInAs(be, EMAILS.mentorA);
    const queue = be.getView().applications.find((a) => a.id === draft.id)!;
    expect(queue.current_post).toBe('MENTOR');
    be.act(draft.id, { action: 'approve', remarksApplicant: 'Recommended.' });

    await signInAs(be, EMAILS.hodCse);
    const withHod = be.getView().applications.find((a) => a.id === draft.id)!;
    expect(withHod.current_post).toBe('HOD');
  });

  it('a teacher application skips the mentor stage and lands with the HOD', async () => {
    const be = await asUser(EMAILS.teacher);
    const draft = be.createDraft('at_other', OTHER);
    const submitted = be.submit(draft.id);
    expect(submitted.current_post).toBe('HOD');
    expect(submitted.post_codes_seen).toContain('HOD');
    expect(submitted.post_codes_seen).not.toContain('MENTOR');
  });

  it('a teacher application can be sent back and resubmitted', async () => {
    const be = await asUser(EMAILS.teacher);
    const draft = be.createDraft('at_other', OTHER);
    be.submit(draft.id);

    await signInAs(be, EMAILS.hodCse);
    const pending = be.getView().applications.find((a) => a.id === draft.id)!;
    expect(pending.current_post).toBe('HOD');
    be.act(draft.id, { action: 'return', remarksApplicant: 'Please attach the workshop brochure.' });

    await signInAs(be, EMAILS.teacher);
    const returned = be.getView().applications.find((a) => a.id === draft.id)!;
    expect(returned.status).toBe('returned');
    be.updateDraft(draft.id, { details: 'Updated: brochure attached below.' });
    const again = be.submit(draft.id);
    expect(again.current_post).toBe('HOD');
  });

  it('rejects an empty subject or details and an over-long subject', async () => {
    const be = await asUser(EMAILS.studentA);
    expectThrows(() => be.createDraft('at_other', { subject: 'x'.repeat(161), details: 'ok' }), 'validation');
    // an empty draft is allowed, but it cannot be submitted until both fields are filled
    const empty = be.createDraft('at_other', {});
    expectThrows(() => be.submit(empty.id), 'validation');
    be.updateDraft(empty.id, { subject: OTHER.subject });
    expectThrows(() => be.submit(empty.id), 'validation');
    be.updateDraft(empty.id, { details: OTHER.details });
    expect(be.submit(empty.id).current_post).toBe('MENTOR');
  });
});

describe('moving a teacher to another department', () => {
  it('updates the profile, writes the audit trail and notifies the person', async () => {
    const admin = await asUser(EMAILS.wfadmin);
    const teacher = admin.peek().profiles.find((p) => p.email === EMAILS.teacher)!;
    const moved = admin.changeUserDepartment({ user_id: teacher.id, department_id: 'dep_ece', reason: 'Transfer' });

    expect(moved.home_department_id).toBe('dep_ece');
    expect(admin.peek().profiles.find((p) => p.id === teacher.id)?.home_department_id).toBe('dep_ece');
    const audit = admin.peek().audit.find((a) => a.action === 'user.department_change');
    expect(audit?.meta).toMatchObject({ to: 'Electronics & Communication', reason: 'Transfer' });
    expect(admin.peek().notifications.some((n) => n.user_id === teacher.id && n.title === 'Department updated')).toBe(true);
  });

  it('refuses to move a teacher who still holds a post in the old department', async () => {
    const admin = await asUser(EMAILS.wfadmin);
    const mentor = admin.peek().profiles.find((p) => p.email === EMAILS.mentorA)!;
    const err = expectThrows(
      () => admin.changeUserDepartment({ user_id: mentor.id, department_id: 'dep_ece' }),
      'conflict',
    );
    expect(err.message).toMatch(/still holds/i);
    expect(admin.peek().profiles.find((p) => p.id === mentor.id)?.home_department_id).toBe('dep_cse');
  });

  it('allows the move once the post is handed over', async () => {
    const admin = await asUser(EMAILS.wfadmin);
    const mentor = admin.peek().profiles.find((p) => p.email === EMAILS.mentorA)!;
    const assignment = admin.peek().assignments.find((a) => a.user_id === mentor.id && a.active)!;
    admin.endAssignment(assignment.id, 'Mentor role handed over before transfer');
    const moved = admin.changeUserDepartment({ user_id: mentor.id, department_id: 'dep_ece' });
    expect(moved.home_department_id).toBe('dep_ece');
  });

  it('the same guard applies to the generic profile editor', async () => {
    const admin = await asUser(EMAILS.wfadmin);
    const hod = admin.peek().profiles.find((p) => p.email === EMAILS.hodCse)!;
    expectThrows(
      () =>
        admin.saveUser({
          id: hod.id,
          full_name: hod.full_name,
          email: hod.email,
          kind: 'teacher',
          department_id: 'dep_ece',
        }),
      'conflict',
    );
  });

  it('students cannot be moved with this operation and need an active department', async () => {
    const admin = await asUser(EMAILS.wfadmin);
    const student = admin.peek().profiles.find((p) => p.email === EMAILS.studentA)!;
    expectThrows(() => admin.changeUserDepartment({ user_id: student.id, department_id: 'dep_ece' }), 'validation');
    const teacher = admin.peek().profiles.find((p) => p.email === EMAILS.teacher)!;
    expectThrows(() => admin.changeUserDepartment({ user_id: teacher.id, department_id: 'nope' }), 'validation');
    expectThrows(() => admin.changeUserDepartment({ user_id: teacher.id, department_id: 'dep_cse' }), 'validation');
  });
});
