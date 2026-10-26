import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { render, waitFor, cleanup } from '@testing-library/react';
import { App } from '../../App';
import { LocalBackend } from '../../backend/local';
import { MemoryPersistence } from '../../backend/store';
import { DEMO_PASSWORD } from '../../backend/seed';

function makeBackend() {
  return new LocalBackend(new MemoryPersistence());
}

async function openAt(email: string, hash: string) {
  const backend = makeBackend();
  await backend.signIn(email, DEMO_PASSWORD);
  window.location.hash = hash;
  const view = render(<App backend={backend} />);
  return { backend, view };
}

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
  window.location.hash = '#/';
});

afterEach(() => {
  cleanup();
});

describe('every role can render its dashboard', () => {
  const shared = makeBackend();
  const emails = [
    'student.a@demo.university',
    'student.c@demo.university',
    'teacher@demo.university',
    'mentor.a@demo.university',
    'hod.cse@demo.university',
    'dean.eng@demo.university',
    'registrar@demo.university',
    'pvc@demo.university',
    'vc@demo.university',
    'chancellor@demo.university',
    'wfadmin@demo.university',
    'sysadmin@demo.university',
    'auditor@demo.university',
    'former.hod@demo.university',
  ];

  for (const email of emails) {
    it(`renders for ${email}`, async () => {
      await shared.signIn(email, DEMO_PASSWORD);
      window.location.hash = '#/';
      render(<App backend={shared} />);
      await waitFor(() => expect(document.querySelector('.app-shell')).toBeTruthy());
      await shared.signOut();
      cleanup();
    });
  }
});

describe('key pages render', () => {
  it('shows the sign-in page when signed out', async () => {
    render(<App backend={makeBackend()} />);
    await waitFor(() => expect(document.body.textContent).toContain('Sign in'));
  });

  it('renders the applicant dashboard with real counters', async () => {
    await openAt('student.a@demo.university', '#/');
    await waitFor(() => expect(document.body.textContent).toContain('Good'));
  });

  it('lists own applications with references', async () => {
    await openAt('student.a@demo.university', '#/applications');
    await waitFor(() => expect(document.body.textContent).toMatch(/APP-\d{4}-\d{5}/));
  });

  it('offers the new application type chooser', async () => {
    await openAt('student.a@demo.university', '#/applications/new');
    await waitFor(() => expect(document.body.textContent).toMatch(/Leave request|Bonafide/));
  });

  it('renders an application detail for its owner', async () => {
    const backend = makeBackend();
    await backend.signIn('student.a@demo.university', DEMO_PASSWORD);
    const app = backend.getView().applications[0];
    window.location.hash = `#/applications/${app.id}`;
    render(<App backend={backend} />);
    await waitFor(() => expect(document.body.textContent).toContain(app.reference));
  });

  it('renders the officer inbox', async () => {
    await openAt('mentor.a@demo.university', '#/inbox');
    await waitFor(() => expect(document.body.textContent).toContain('pending'));
  });

  it('denies the statistics page to a student', async () => {
    await openAt('student.a@demo.university', '#/statistics');
    await waitFor(() => expect(document.body.textContent).toMatch(/do not have access/i));
  });

  it('renders statistics for a permitted officer', async () => {
    await openAt('hod.cse@demo.university', '#/statistics');
    await waitFor(() => expect(document.body.textContent).toMatch(/received|submitted/i));
  });

  it('renders notices', async () => {
    await openAt('student.a@demo.university', '#/notices');
    await waitFor(() => expect(document.body.textContent).toContain('Notices'));
  });

  it('renders the profile with post assignments', async () => {
    await openAt('mentor.a@demo.university', '#/profile');
    await waitFor(() => expect(document.body.textContent).toContain('profile'));
  });

  it('renders help and search', async () => {
    await openAt('student.a@demo.university', '#/help');
    await waitFor(() => expect(document.body.textContent).toMatch(/Help/i));
    cleanup();
    await openAt('student.a@demo.university', '#/search?q=leave');
    await waitFor(() => expect(document.body.textContent).toContain('Search'));
  });

  it('renders an unknown route as not found', async () => {
    await openAt('student.a@demo.university', '#/does-not-exist');
    await waitFor(() => expect(document.body.textContent).toMatch(/not found|does not exist/i));
  });
});

describe('administration console renders every permitted tab', () => {
  const tabs = ['structure', 'users', 'assignments', 'posts', 'types', 'workflows', 'retention', 'audit', 'settings'];

  for (const tab of tabs) {
    it(`renders the ${tab} tab`, async () => {
      await openAt('sysadmin@demo.university', `#/admin/${tab}`);
      await waitFor(() => expect(document.body.textContent).toContain('Administration'));
      expect(document.body.textContent).not.toMatch(/do not have access/i);
      cleanup();
    });
  }

  it('blocks a student from the console', async () => {
    await openAt('student.a@demo.university', '#/admin/users');
    await waitFor(() => expect(document.body.textContent).toMatch(/do not have (access|administrative)/i));
  });
});
