import { expect } from 'vitest';
import { LocalBackend } from '../local';
import { MemoryPersistence, type PersistedState } from '../store';
import { DEMO_PASSWORD } from '../seed';

/**
 * Seeding hashes one password per demo account, which costs over a second. Do it
 * once per test process and hand every test its own deep copy, so tests stay fast
 * and isolated (a fresh, unmodified data set each time) without re-hashing.
 */
let seedTemplate: PersistedState | null = null;

function templateState(): PersistedState {
  if (!seedTemplate) {
    const persistence = new MemoryPersistence();
    const primed = new LocalBackend(persistence);
    const saved = persistence.load();
    if (!saved) throw new Error(`Seeding produced no state (${primed.mode})`);
    seedTemplate = saved;
  }
  return seedTemplate;
}

/** One backend instance == one in-memory "database" for a test. */
export function makeBackend(): LocalBackend {
  const persistence = new MemoryPersistence();
  persistence.save(templateState()); // saves a deep copy
  return new LocalBackend(persistence);
}

export async function signInAs(be: LocalBackend, email: string, password = DEMO_PASSWORD): Promise<LocalBackend> {
  be.signOut();
  await be.signIn(email, password);
  return be;
}

/** Backend already signed in as the given user (used for standalone checks). */
export async function asUser(email: string, password = DEMO_PASSWORD): Promise<LocalBackend> {
  const be = makeBackend();
  await be.signIn(email, password);
  return be;
}

export const EMAILS = {
  sysadmin: 'sysadmin@demo.university',
  wfadmin: 'wfadmin@demo.university',
  vc: 'vc@demo.university',
  pvc: 'pvc@demo.university',
  chancellor: 'chancellor@demo.university',
  registrar: 'registrar@demo.university',
  deanEng: 'dean.eng@demo.university',
  deanSci: 'dean.sci@demo.university',
  hodCse: 'hod.cse@demo.university',
  hodEce: 'hod.ece@demo.university',
  mentorA: 'mentor.a@demo.university',
  mentorB: 'mentor.b@demo.university',
  teacher: 'teacher@demo.university',
  studentA: 'student.a@demo.university',
  studentB: 'student.b@demo.university',
  studentC: 'student.c@demo.university',
  auditor: 'auditor@demo.university',
  formerHod: 'former.hod@demo.university',
};

export function expectThrows(fn: () => unknown, code?: string): Error {
  try {
    fn();
  } catch (e) {
    const err = e as Error & { code?: string };
    if (code) expect(err.code).toBe(code);
    return err;
  }
  throw new Error('Expected the operation to throw, but it succeeded.');
}

export async function expectRejects(promise: Promise<unknown>, code?: string): Promise<Error> {
  try {
    await promise;
  } catch (e) {
    const err = e as Error & { code?: string };
    if (code) expect(err.code).toBe(code);
    return err;
  }
  throw new Error('Expected the operation to reject, but it succeeded.');
}
