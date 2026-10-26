import { describe, expect, it } from 'vitest';
import { asUser, EMAILS, expectThrows, makeBackend, signInAs } from './helpers';

/**
 * Verifies the two things the portal promises about posts:
 *  - every post is data, so any post can be assigned, and its scope type decides
 *    which part of the hierarchy must be chosen;
 *  - a post belongs to its current holder only: replacing or ending an assignment
 *    removes the previous person's queue, history, files and notices at once.
 */

const SCOPE_FOR: Record<string, { faculty_id?: string; department_id?: string; batch_id?: string; section_id?: string }> = {
  university: {},
  faculty: { faculty_id: 'fac_law' },
  department: { faculty_id: 'fac_law', department_id: 'dep_law' },
  batch: { batch_id: 'bat_cse_2023' },
  section: { batch_id: 'bat_cse_2023', section_id: 'sec_cse23_a' },
};

describe('every post is configurable and assignable', () => {
  it('declares a valid scope type and refuses to be assigned without its scope', async () => {
    const posts = makeBackend().peek().posts.filter((p) => p.active);
    expect(posts.length).toBeGreaterThan(10);
    expect(new Set(posts.map((p) => p.code)).size).toBe(posts.length);

    for (const post of posts) {
      expect(['university', 'faculty', 'department', 'batch', 'section']).toContain(post.scope_type);
      const be = await signInAs(makeBackend(), EMAILS.sysadmin);
      if (post.scope_type !== 'university') {
        expectThrows(
          () => be.saveAssignment({ user_id: 'usr_teacher', post_code: post.code, scope: {} }),
          'validation',
        );
      }
      const created = be.saveAssignment({
        user_id: 'usr_teacher',
        post_code: post.code,
        scope: SCOPE_FOR[post.scope_type],
        reason: 'Scope check',
      });
      expect(created.post_code).toBe(post.code);
      expect(created.active).toBe(true);
      expect(
        be.peek().assignments.some((a) => a.id === created.id && a.post_code === post.code && a.user_id === 'usr_teacher'),
      ).toBe(true);
    }
  });

  it('a student can never hold a staff post, and a suspended account must be reactivated first', async () => {
    const be = await signInAs(makeBackend(), EMAILS.sysadmin);
    expectThrows(
      () => be.saveAssignment({ user_id: 'usr_student_a', post_code: 'MENTOR', scope: SCOPE_FOR.section }),
      'validation',
    );
    be.setUserStatus('usr_teacher', 'suspended');
    expectThrows(
      () => be.saveAssignment({ user_id: 'usr_teacher', post_code: 'HOD', scope: SCOPE_FOR.department }),
      'conflict',
    );
  });
});

describe('mentor assignment per section', () => {
  it('one mentor per section: replacing the mentor moves the section queue and history to the new person', async () => {
    const be = await signInAs(makeBackend(), EMAILS.sysadmin);
    const sectionScope = { faculty_id: 'fac_eng', department_id: 'dep_cse', batch_id: 'bat_cse_2024', section_id: 'sec_cse24_a' };
    const sectionApp = be.peek().applications.find((a) => a.org.section_id === 'sec_cse24_a' && a.current_post === 'MENTOR');
    expect(sectionApp).toBeTruthy();
    const previousHolder = be
      .peek()
      .assignments.find((a) => a.post_code === 'MENTOR' && a.scope.section_id === 'sec_cse24_a' && a.active);
    expect(previousHolder?.user_id).toBe('usr_mentor_a');

    const created = be.saveUser({
      full_name: 'Dr. New Mentor',
      email: 'new.mentor@demo.university',
      kind: 'teacher',
      department_id: 'dep_cse',
      designation: 'Assistant Professor',
    });
    const token = await be.createActivation(created.profile.id);

    // a section alone is enough input — the parents are derived and checked
    expectThrows(
      () =>
        be.saveAssignment({
          user_id: created.profile.id,
          post_code: 'MENTOR',
          scope: { section_id: 'sec_cse24_a', department_id: 'dep_ece' },
        }),
      'validation',
    );
    const assigned = be.saveAssignment({
      user_id: created.profile.id,
      post_code: 'MENTOR',
      scope: { section_id: 'sec_cse24_a' },
      reason: 'Section A mentor handover',
    });
    expect(assigned.scope).toMatchObject({
      faculty_id: sectionScope.faculty_id,
      department_id: sectionScope.department_id,
      batch_id: sectionScope.batch_id,
      section_id: sectionScope.section_id,
    });

    // the old assignment is closed, with a reason, an audit entry and a notification
    const closed = be.peek().assignments.find((a) => a.id === previousHolder!.id)!;
    expect(closed.active).toBe(false);
    expect(closed.ended_reason).toMatch(/Replaced by Dr\. New Mentor/);
    expect(be.peek().audit.some((a) => a.action === 'assignment.replace' && a.meta?.post === 'MENTOR')).toBe(true);
    expect(
      be.peek().notifications.some((n) => n.user_id === 'usr_mentor_a' && n.category === 'assignment'),
    ).toBe(true);
    // exactly one live mentor for that section
    expect(
      be
        .peek()
        .assignments.filter(
          (a) => a.post_code === 'MENTOR' && a.active && a.scope.section_id === 'sec_cse24_a',
        ).length,
    ).toBe(1);

    // the previous mentor keeps the account but loses the post and its data
    await signInAs(be, EMAILS.mentorA);
    const oldSession = be.getSession()!;
    expect(oldSession.postCodes).not.toContain('MENTOR');
    expect(be.getView().applications.some((a) => a.id === sectionApp!.id)).toBe(false);
    expectThrows(() => be.act(sectionApp!.id, { action: 'approve' }), 'forbidden');

    // section B's mentor is untouched
    await signInAs(be, EMAILS.mentorB);
    expect(be.getSession()!.postCodes).toContain('MENTOR');
    expect(be.getView().applications.every((a) => a.org.section_id !== 'sec_cse24_a')).toBe(true);

    // the new mentor gets the queue and the earlier decisions
    await be.activateAccount(token.token, 'StrongPass#2026');
    await signInAs(be, 'new.mentor@demo.university', 'StrongPass#2026');
    expect(be.getSession()!.postCodes).toContain('MENTOR');
    const newView = be.getView();
    expect(newView.applications.some((a) => a.id === sectionApp!.id)).toBe(true);
    const history = be.peek().actions.filter((a) => a.post_code === 'MENTOR' && a.application_id === sectionApp!.id);
    if (history.length) {
      expect(newView.actions.some((a) => a.application_id === sectionApp!.id && a.post_code === 'MENTOR')).toBe(true);
    }
    expect(newView.applications.some((a) => a.org.section_id === 'sec_cse24_b')).toBe(false);
  });

  it('ending a mentor assignment immediately removes the section queue, files and notice access', async () => {
    const be = await asUser(EMAILS.mentorA);
    const before = be.getView();
    const sectionApp = before.applications.find((a) => a.current_post === 'MENTOR');
    expect(sectionApp).toBeTruthy();
    const doc = before.documents.find((d) => d.application_id === sectionApp!.id);
    expect(doc).toBeTruthy();
    expect(() => be.getDocumentDataUrl(doc!.id)).not.toThrow();
    const sectionNotice = before.notices.find((n) => n.scope.section_id === 'sec_cse24_a');
    expect(sectionNotice).toBeTruthy();

    await signInAs(be, EMAILS.wfadmin);
    const assignment = be
      .peek()
      .assignments.find((a) => a.user_id === 'usr_mentor_a' && a.post_code === 'MENTOR' && a.active)!;
    be.endAssignment(assignment.id, 'Mentor retired in test');

    await signInAs(be, EMAILS.mentorA);
    expect(be.getSession()!.postCodes).not.toContain('MENTOR');
    expect(be.getView().applications).toHaveLength(0);
    expectThrows(() => be.getDocumentDataUrl(doc!.id), 'forbidden');
    // an authored notice stays readable, but the post's management rights are gone
    expectThrows(() => be.archiveNotice(sectionNotice!.id), 'forbidden');
    expectThrows(() => be.publishNotice(sectionNotice!.id), 'forbidden');
    expectThrows(() => be.act(sectionApp!.id, { action: 'approve' }), 'forbidden');
  });
});
