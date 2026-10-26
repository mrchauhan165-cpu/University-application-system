import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { App } from '../../App';
import { DEMO_PASSWORD } from '../../backend/seed';
import { makeBackend } from '../../backend/__tests__/helpers';
import './testing-library-setup';

async function openStructure() {
  const backend = makeBackend();
  await backend.signIn('sysadmin@demo.university', DEMO_PASSWORD);
  window.location.hash = '#/admin/structure';
  render(<App backend={backend} />);
  await waitFor(() => expect(document.querySelector('.teacher-chip')).toBeTruthy());
  return backend;
}

function buttonsLabelled(label: string): HTMLElement[] {
  return Array.from(document.querySelectorAll('button')).filter(
    (b) => (b.textContent ?? '').trim().toLowerCase() === label.toLowerCase(),
  ) as HTMLElement[];
}

beforeEach(() => {
  cleanup();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
});

describe('teacher administration from the departments table', () => {
  it('moves a teacher to another department and audits the change', async () => {
    const backend = await openStructure();
    fireEvent.click(document.querySelector('.teacher-chip') as HTMLElement);
    await waitFor(() => expect(document.body.textContent).toContain('Change department'));

    fireEvent.click(buttonsLabelled('Change department')[0]);
    await waitFor(() => expect(document.body.textContent).toContain('Move department'));

    fireEvent.change(document.querySelector('#move-dept') as HTMLSelectElement, { target: { value: 'dep_ece' } });
    fireEvent.click(buttonsLabelled('Move department')[0]);

    await waitFor(() => expect(document.body.textContent).toMatch(/is now in/i));
    const audit = backend.peek().audit.find((a) => a.action === 'user.department_change');
    expect(audit?.meta).toMatchObject({ to: 'Electronics & Communication' });
  });

  it('adds a teacher straight into the department and offers the invite link', async () => {
    const backend = await openStructure();
    const cellButtons = Array.from(document.querySelectorAll('.teacher-cell button')) as HTMLElement[];
    fireEvent.click(cellButtons[1]);

    await waitFor(() => expect(document.querySelector('#t-name')).toBeTruthy());
    fireEvent.change(document.querySelector('#t-name') as HTMLInputElement, { target: { value: 'Dr. Nisha Rao' } });
    fireEvent.change(document.querySelector('#t-email') as HTMLInputElement, {
      target: { value: 'nisha.rao@demo.university' },
    });
    fireEvent.click(buttonsLabelled('Add teacher')[0]);

    await waitFor(() => expect(document.body.textContent).toMatch(/Activation link/i));
    const created = backend.peek().profiles.find((p) => p.email === 'nisha.rao@demo.university');
    expect(created?.kind).toBe('teacher');
    expect(created?.home_department_id).toBe('dep_cse');
  });

  it('explains why a teacher with a live post cannot be moved yet', async () => {
    const backend = await openStructure();
    fireEvent.click(document.querySelector('.teacher-chip') as HTMLElement);
    await waitFor(() => expect(document.body.textContent).toContain('Change department'));

    // Dr. Gita Menon heads CSE, so moving her to ECE must be refused with a reason.
    const rows = Array.from(document.querySelectorAll('table.data tbody tr')) as HTMLElement[];
    const row = rows.find((r) => r.textContent?.includes('Dr. Gita Menon'))!;
    fireEvent.click(Array.from(row.querySelectorAll('button'))[0]);
    await waitFor(() => expect(document.body.textContent).toContain('Move department'));
    fireEvent.change(document.querySelector('#move-dept') as HTMLSelectElement, { target: { value: 'dep_ece' } });
    fireEvent.click(buttonsLabelled('Move department')[0]);

    await waitFor(() => expect(document.body.textContent).toMatch(/still holds/i));
    const hod = backend.peek().profiles.find((p) => p.email === 'hod.cse@demo.university')!;
    expect(hod.home_department_id).toBe('dep_cse');
  });
});
