import { describe, expect, it, afterEach } from 'vitest';
import { render, waitFor, cleanup, fireEvent } from '@testing-library/react';
import { App } from '../../App';
import { LocalBackend } from '../../backend/local';
import { DEMO_PASSWORD } from '../../backend/seed';

const realDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');

function blockStorage() {
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    get() {
      throw new Error('SecurityError: access to storage is blocked');
    },
  });
}

function restoreStorage() {
  if (realDescriptor) Object.defineProperty(window, 'localStorage', realDescriptor);
}

afterEach(() => {
  restoreStorage();
  cleanup();
  window.location.hash = '#/';
});

describe('embedded previews that block browser storage', () => {
  it('still boots, signs in and shows the preview warning', async () => {
    blockStorage();
    const backend = new LocalBackend(); // uses the (blocked) browser storage
    expect(backend.storageMode).toBe('memory');

    render(<App backend={backend} />);
    await waitFor(() => expect(document.getElementById('email')).toBeTruthy());

    fireEvent.change(document.getElementById('email')!, { target: { value: 'student.a@demo.university' } });
    fireEvent.change(document.getElementById('password')!, { target: { value: DEMO_PASSWORD } });
    fireEvent.click(document.querySelector('button[type="submit"]') as HTMLButtonElement);

    await waitFor(() => expect(document.querySelector('.app-shell')).toBeTruthy(), { timeout: 10000 });
    expect(document.body.textContent).toContain('data is not saved');
    expect(backend.getView().applications.length).toBeGreaterThan(0);
  });
});
