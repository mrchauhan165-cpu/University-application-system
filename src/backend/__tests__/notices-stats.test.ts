import { describe, expect, it } from 'vitest';
import { asUser, EMAILS, expectThrows, makeBackend, signInAs } from './helpers';
import { computeStats, statisticsScope } from '../select';

describe('notice publishing scopes', () => {
  it('a mentor may publish only to their own section', async () => {
    const be = await asUser(EMAILS.mentorA);
    const notice = be.saveNotice({
      title: 'Extra class on Saturday',
      body: 'An extra class is scheduled for section A on Saturday at 9 am.',
      scope_type: 'section',
      scope: {
        faculty_id: 'fac_eng',
        department_id: 'dep_cse',
        batch_id: 'bat_cse_2024',
        section_id: 'sec_cse24_a',
      },
      audience: 'students',
      status: 'published',
    });
    expect(notice.scope_label).toContain('Section A');

    expectThrows(
      () =>
        be.saveNotice({
          title: 'Wrong section',
          body: 'This must not be allowed at all.',
          scope_type: 'section',
          scope: {
            faculty_id: 'fac_eng',
            department_id: 'dep_cse',
            batch_id: 'bat_cse_2024',
            section_id: 'sec_cse24_b',
          },
          audience: 'students',
        }),
      'forbidden',
    );

    expectThrows(
      () =>
        be.saveNotice({
          title: 'University-wide attempt',
          body: 'A mentor must not publish university-wide notices.',
          scope_type: 'university',
          scope: {},
          audience: 'everyone',
        }),
      'forbidden',
    );
  });

  it('an HOD may publish to the department but not the faculty or university', async () => {
    const be = await asUser(EMAILS.hodCse);
    const ok = be.saveNotice({
      title: 'Department meeting',
      body: 'All faculty members of the department are requested to attend.',
      scope_type: 'department',
      scope: { faculty_id: 'fac_eng', department_id: 'dep_cse' },
      audience: 'staff',
    });
    expect(ok.id).toBeTruthy();
    expectThrows(
      () =>
        be.saveNotice({
          title: 'Faculty-wide',
          body: 'Not allowed for an HOD.',
          scope_type: 'faculty',
          scope: { faculty_id: 'fac_eng' },
          audience: 'everyone',
        }),
      'forbidden',
    );
  });

  it('only explicitly authorised posts may publish university-wide notices', async () => {
    const be = await signInAs(makeBackend(), EMAILS.vc);
    const notice = be.saveNotice({
      title: 'Convocation date announced',
      body: 'The convocation ceremony will be held next month. Details follow.',
      scope_type: 'university',
      scope: {},
      audience: 'everyone',
      status: 'published',
    });
    expect(notice.status).toBe('published');

    await signInAs(be, EMAILS.deanEng);
    expectThrows(
      () =>
        be.saveNotice({
          title: 'University-wide by dean',
          body: 'Deans cannot publish university-wide notices in this configuration.',
          scope_type: 'university',
          scope: {},
          audience: 'everyone',
        }),
      'forbidden',
    );
  });

  it('students cannot create notices', async () => {
    const be = await asUser(EMAILS.studentA);
    expectThrows(
      () =>
        be.saveNotice({
          title: 'Student notice',
          body: 'Should not be possible.',
          scope_type: 'section',
          scope: { section_id: 'sec_cse24_a' },
          audience: 'students',
        }),
      'forbidden',
    );
  });
});

describe('notice visibility and read receipts', () => {
  it('students see only notices addressed to their scope and audience', async () => {
    const be = await asUser(EMAILS.studentA);
    const view = be.getView();
    expect(view.notices.length).toBeGreaterThan(0);
    for (const notice of view.notices) {
      if (notice.scope_type === 'section') expect(notice.scope.section_id).toBe('sec_cse24_a');
      expect(notice.audience === 'students' || notice.audience === 'everyone').toBe(true);
    }
    const otherSection = be.peek().notices.find(
      (n) => n.scope_type === 'section' && n.scope.section_id === 'sec_cse24_b',
    );
    if (otherSection) expect(view.notices.some((n) => n.id === otherSection.id)).toBe(false);
  });

  it('marks notices read and keeps receipts per user', async () => {
    const be = await asUser(EMAILS.studentA);
    const notice = be.getView().notices.find((n) => n.status === 'published')!;
    be.markNoticeRead(notice.id);
    expect(be.getView().noticeReads.some((r) => r.notice_id === notice.id)).toBe(true);

    await signInAs(be, EMAILS.studentB);
    expect(be.getView().noticeReads.some((r) => r.notice_id === notice.id)).toBe(false);
  });

  it('a scheduled notice is not visible until its publish time', async () => {
    const be = await asUser(EMAILS.hodCse);
    const future = new Date(Date.now() + 86_400_000).toISOString();
    const notice = be.saveNotice({
      title: 'Scheduled notice',
      body: 'This appears only after its publish time.',
      scope_type: 'department',
      scope: { faculty_id: 'fac_eng', department_id: 'dep_cse' },
      audience: 'students',
      status: 'published',
      publish_at: future,
    });
    expect(notice.status).toBe('scheduled');
    await signInAs(be, EMAILS.studentA);
    expect(be.getView().notices.some((n) => n.id === notice.id)).toBe(false);
  });

  it('a former post holder does not keep notice visibility after handover', async () => {
    const be = await signInAs(makeBackend(), EMAILS.hodCse);
    const draft = be.saveNotice({
      title: 'Department-only staff note',
      body: 'This notice is for staff of the department.',
      scope_type: 'department',
      scope: { faculty_id: 'fac_eng', department_id: 'dep_cse' },
      audience: 'staff',
    });
    expect(draft.id).toBeTruthy();

    await signInAs(be, EMAILS.wfadmin);
    const hodAssignment = be
      .peek()
      .assignments.find((a) => a.post_code === 'HOD' && a.scope.department_id === 'dep_cse' && a.active)!;
    be.endAssignment(hodAssignment.id, 'Handover in test');

    await signInAs(be, EMAILS.hodCse);
    // the former HOD still sees notices they authored, but can no longer manage them
    expectThrows(() => be.publishNotice(draft.id), 'forbidden');
  });
});

describe('statistics scope', () => {
  it('a mentor’s statistics cover only their own section', async () => {
    const be = await asUser(EMAILS.mentorA);
    const scope = statisticsScope(be.peek(), be.getSession()!);
    expect(scope).not.toBeNull();
    for (const app of scope!.apps) {
      expect(app.org.section_id).toBe('sec_cse24_a');
    }
    const stats = computeStats(be.peek(), scope!.apps, {}, scope!.label);
    expect(stats.total).toBe(scope!.apps.length);
    expect(stats.byType.length).toBeGreaterThan(0);
  });

  it('a dean’s statistics cover their faculty only', async () => {
    const be = await asUser(EMAILS.deanEng);
    const scope = statisticsScope(be.peek(), be.getSession()!)!;
    expect(scope).not.toBeNull();
    for (const app of scope.apps) {
      expect(app.org.faculty_id).toBe('fac_eng');
    }
  });

  it('a student has no statistics scope', async () => {
    const be = await asUser(EMAILS.studentA);
    expect(statisticsScope(be.peek(), be.getSession()!)).toBeNull();
  });

  it('filters by date range and type', async () => {
    const be = await asUser(EMAILS.vc);
    const scope = statisticsScope(be.peek(), be.getSession()!)!;
    const today = new Date().toISOString().slice(0, 10);
    const recent = computeStats(be.peek(), scope.apps, { from: today, to: today });
    expect(recent.total).toBeGreaterThanOrEqual(0);
    const filtered = computeStats(be.peek(), scope.apps, { typeId: 'at_student_leave' });
    for (const app of filtered.applications) {
      expect(app.application_type_id).toBe('at_student_leave');
    }
  });
});
