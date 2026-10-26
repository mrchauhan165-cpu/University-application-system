import { describe, expect, it } from 'vitest';
import { browserStorageWorks, LocalPersistence, MemoryPersistence } from '../store';
import { LocalBackend } from '../local';
import { DEMO_PASSWORD } from '../seed';

describe('browser storage detection', () => {
  it('does not throw when localStorage access itself throws', () => {
    // Simulate a cross-origin iframe: touching window.localStorage throws.
    const fakeWindow = {
      get localStorage(): Storage {
        throw new Error('SecurityError: storage is blocked');
      },
    };
    const g = globalThis as unknown as { window?: unknown };
    const hadWindow = 'window' in g;
    const previous = g.window;
    g.window = fakeWindow;
    try {
      expect(() => browserStorageWorks()).not.toThrow();
      expect(browserStorageWorks()).toBe(false);
      expect(() => new LocalPersistence()).not.toThrow();
    } finally {
      if (hadWindow) g.window = previous;
      else delete g.window;
    }
  });

  it('degrades to memory instead of crashing the backend', async () => {
    const backend = new LocalBackend(new MemoryPersistence());
    expect(backend.storageMode).toBe('memory');
    const result = await backend.signIn('student.a@demo.university', DEMO_PASSWORD);
    expect(result.user.profile.user_code).toBe('STU0001');
    expect(backend.getView().applications.length).toBeGreaterThan(0);
  });
});
