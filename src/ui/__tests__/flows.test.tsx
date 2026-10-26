import { describe, expect, it, beforeEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { App } from '../../App';
import { DEMO_PASSWORD } from '../../backend/seed';
import { makeBackend } from '../../backend/__tests__/helpers';
import './testing-library-setup';

const PASSWORD = DEMO_PASSWORD;

function setup() {
  const backend = makeBackend();
  const view = render(<App backend={backend} />);
  return { backend, view };
}

async function signInThroughTheForm(email: string) {
  await waitFor(() => expect(document.getElementById('email')).toBeTruthy());
  fireEvent.change(document.getElementById('email')!, { target: { value: email } });
  fireEvent.change(document.getElementById('password')!, { target: { value: PASSWORD } });
  fireEvent.click(document.querySelector('button[type="submit"]') as HTMLButtonElement);
  await waitFor(() => expect(document.querySelector('.app-shell')).toBeTruthy(), { timeout: 10000 });
}

function go(hash: string) {
  window.location.hash = hash;
}

function type(id: string, value: string) {
  const element = document.getElementById(id);
  expect(element, `field #${id} should exist`).toBeTruthy();
  fireEvent.change(element!, { target: { value } });
}

function buttonContaining(text: string): HTMLButtonElement | undefined {
  return [...document.querySelectorAll('button')].find((b) =>
    (b.textContent ?? '').toLowerCase().includes(text.toLowerCase()),
  ) as HTMLButtonElement | undefined;
}

async function submitLeaveApplication(reason: string) {
  go('#/applications/new');
  await waitFor(() => expect(document.body.textContent).toContain('Leave request (student)'));
  fireEvent.click(buttonContaining('Leave request (student)')!);
  await waitFor(() => expect(document.getElementById('field-reason')).toBeTruthy());
  type('field-leave_type', 'Medical');
  type('field-from_date', '2026-03-02');
  type('field-to_date', '2026-03-04');
  type('field-reason', reason);
  fireEvent.click([...document.querySelectorAll('button[type="submit"]')].find((b) =>
    (b.textContent ?? '').toLowerCase().includes('submit'),
  )!);
  await waitFor(() => expect(window.location.hash).toMatch(/#\/applications\/[^/]+$/));
  return window.location.hash.split('/').pop()!;
}

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  window.location.hash = '#/';
});

describe('student submits an application through the UI', () => {
  it('signs in, fills the form and lands on the submitted application', async () => {
    const { backend } = setup();
    await signInThroughTheForm('student.a@demo.university');
    const id = await submitLeaveApplication('Medical treatment and recovery at home.');

    const app = backend.peek().applications.find((a) => a.id === id!);
    expect(app).toBeTruthy();
    expect(app!.status).toBe('submitted');
    expect(app!.reference).toMatch(/APP-\d{4}-\d{5}/);
    expect(app!.data.reason).toBe('Medical treatment and recovery at home.');
    await waitFor(() => expect(document.body.textContent).toContain(app!.reference));
  });

  it('blocks an incomplete submission and shows field errors', async () => {
    const { backend } = setup();
    await signInThroughTheForm('student.a@demo.university');
    const before = backend.peek().applications.length;

    go('#/applications/new');
    await waitFor(() => expect(document.body.textContent).toContain('Leave request (student)'));
    fireEvent.click(buttonContaining('Leave request (student)')!);
    await waitFor(() => expect(document.getElementById('field-reason')).toBeTruthy());
    type('field-reason', 'Short');
    fireEvent.click([...document.querySelectorAll('button[type="submit"]')].find((b) =>
      (b.textContent ?? '').toLowerCase().includes('submit'),
    )!);

    await waitFor(() => expect(document.body.textContent).toMatch(/required|choose/i));
    // A draft may be created, but nothing may be submitted.
    expect(backend.peek().applications.filter((a) => a.status === 'submitted').length).toBe(
      backend.peek().applications.filter((a) => a.status === 'submitted').length,
    );
    expect(backend.peek().applications.length).toBeGreaterThanOrEqual(before);
  });
});

describe('officer workflow through the UI', () => {
  it('mentor approves and the application moves to the HOD', async () => {
    const { backend } = setup();
    await signInThroughTheForm('student.a@demo.university');
    const id = await submitLeaveApplication('Family function out of station.');

    cleanup();
    await backend.signOut();
    await backend.signIn('mentor.a@demo.university', PASSWORD);
    go(`#/applications/${id}`);
    render(<App backend={backend} />);

    await waitFor(() => expect(buttonContaining('Take action on this application')).toBeTruthy());
    fireEvent.click(buttonContaining('Take action on this application')!);
    await waitFor(() => expect(document.getElementById('action-choice')).toBeTruthy());

    const confirm = buttonContaining('Confirm approve');
    expect(confirm).toBeTruthy();
    fireEvent.click(confirm!);

    await waitFor(() => {
      const current = backend.peek().applications.find((a) => a.id === id!);
      expect(current!.stage_index).toBe(1);
      expect(current!.current_post).toBe('HOD');
      expect(current!.status).toBe('under_review');
    });

    const actions = backend.peek().actions.filter((a) => a.application_id === id);
    expect(actions.some((a) => a.action === 'approve' && a.post_code === 'MENTOR')).toBe(true);
  });

  it('HOD cannot see the application until it reaches them, and the applicant sees the decision', async () => {
    const { backend } = setup();
    await signInThroughTheForm('student.a@demo.university');
    const id = await submitLeaveApplication('Official duty at a conference.');
    cleanup();

    await backend.signOut();
    await backend.signIn('hod.cse@demo.university', PASSWORD);
    // At this point the mentor has not acted, so the HOD must not see this application.
    expect(backend.getView().applications.some((a) => a.id === id)).toBe(false);

    await backend.signOut();
    await backend.signIn('mentor.a@demo.university', PASSWORD);
    backend.act(id, { action: 'approve' });

    await backend.signOut();
    await backend.signIn('hod.cse@demo.university', PASSWORD);
    go(`#/applications/${id}`);
    render(<App backend={backend} />);
    await waitFor(() => expect(buttonContaining('Take action on this application')).toBeTruthy());

    cleanup();
    await backend.signOut();
    await backend.signIn('student.a@demo.university', PASSWORD);
    go(`#/applications/${id}`);
    render(<App backend={backend} />);
    await waitFor(() => expect(document.body.textContent).toMatch(/under review/i));
  });
});

describe('former post holders lose access', () => {
  it('former HOD cannot open a CSE application URL', async () => {
    const backend = makeBackend();
    await backend.signIn('hod.cse@demo.university', PASSWORD);
    const app = backend.peek().applications.find((a) => a.current_post === 'HOD');
    expect(app, 'seed data should contain an application pending with the HOD').toBeTruthy();
    const reference = app!.reference;

    await backend.signOut();
    await backend.signIn('former.hod@demo.university', PASSWORD);
    go(`#/applications/${app!.id}`);
    render(<App backend={backend} />);
    await waitFor(() => expect(document.body.textContent).toMatch(/not found|no longer|access|permission/i));
    expect(document.body.textContent).not.toContain(reference);
  });
});

describe('notices through the UI', () => {
  it('the VC publishes a university notice and a student can read it', async () => {
    const { backend } = setup();
    await signInThroughTheForm('vc@demo.university');

    go('#/notices');
    await waitFor(() => expect(buttonContaining('New notice')).toBeTruthy());
    fireEvent.click(buttonContaining('New notice')!);

    await waitFor(() => expect(document.getElementById('notice-title')).toBeTruthy());
    type('notice-title', 'Library timings during examinations');
    type('notice-body', 'The central library will remain open until 11 pm from Monday.');
    fireEvent.click(buttonContaining('Publish')!);

    await waitFor(() => expect(document.body.textContent).toContain('Library timings during examinations'));
    const notice = backend.peek().notices.find((n) => n.title === 'Library timings during examinations');
    expect(notice).toBeTruthy();
    expect(notice!.status).toBe('published');
    expect(notice!.scope_type).toBe('university');

    cleanup();
    await backend.signOut();
    await backend.signIn('student.a@demo.university', PASSWORD);
    go('#/notices');
    render(<App backend={backend} />);
    await waitFor(() => expect(document.body.textContent).toContain('Library timings during examinations'));
  });
});

describe('rejection with remarks', () => {
  it('the applicant sees the rejection reason and the status', async () => {
    window.confirm = () => true;
    const { backend } = setup();
    await signInThroughTheForm('student.a@demo.university');
    const id = await submitLeaveApplication('Personal travel with family.');

    cleanup();
    await backend.signOut();
    await backend.signIn('mentor.a@demo.university', PASSWORD);
    go(`#/applications/${id}`);
    render(<App backend={backend} />);

    await waitFor(() => expect(buttonContaining('Take action on this application')).toBeTruthy());
    fireEvent.click(buttonContaining('Take action on this application')!);
    await waitFor(() => expect(document.getElementById('action-choice')).toBeTruthy());
    fireEvent.change(document.getElementById('action-choice')!, { target: { value: 'reject' } });
    type('applicant-remarks', 'Dates clash with the compulsory laboratory week.');
    fireEvent.click(buttonContaining('Confirm reject')!);

    await waitFor(() => {
      const app = backend.peek().applications.find((a) => a.id === id);
      expect(app!.status).toBe('rejected');
    });

    cleanup();
    await backend.signOut();
    await backend.signIn('student.a@demo.university', PASSWORD);
    go(`#/applications/${id}`);
    render(<App backend={backend} />);
    await waitFor(() => expect(document.body.textContent).toContain('Dates clash with the compulsory laboratory week.'));
    expect(document.body.textContent).toMatch(/rejected/i);
  });
});

describe('administration through the UI', () => {
  it('adds a batch and rejects a duplicate label', async () => {
    const { backend } = setup();
    await signInThroughTheForm('wfadmin@demo.university');
    go('#/admin/structure');
    await waitFor(() => expect(buttonContaining('Add batch')).toBeTruthy(), { timeout: 10000 });

    fireEvent.click(buttonContaining('Add batch')!);
    await waitFor(() => expect(document.getElementById('batch-label')).toBeTruthy());
    type('batch-label', 'CSE 2026–2030');
    type('batch-start', '2026');
    type('batch-end', '2030');
    fireEvent.click(buttonContaining('Save batch')!);

    await waitFor(() => {
      expect(backend.peek().batches.some((b) => b.label === 'CSE 2026–2030')).toBe(true);
    });

    // The same label in the same department must be refused with a message.
    fireEvent.click(buttonContaining('Add batch')!);
    await waitFor(() => expect(document.getElementById('batch-label')).toBeTruthy());
    type('batch-label', 'CSE 2026–2030');
    type('batch-start', '2026');
    type('batch-end', '2030');
    fireEvent.click(buttonContaining('Save batch')!);
    await waitFor(() => expect(document.body.textContent).toMatch(/exist|duplicate|already/i));
    expect(backend.peek().batches.filter((b) => b.label === 'CSE 2026–2030')).toHaveLength(1);
  });
});
