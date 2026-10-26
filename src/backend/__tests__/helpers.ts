import { expect } from 'vitest';
import { LocalBackend } from '../local';
import { MemoryPersistence } from '../store';
import { DEMO_PASSWORD } from '../seed';

/** One backend instance == one in-memory "database" for a test. */
export function makeBackend(): LocalBackend {
  return new LocalBackend(new MemoryPersistence());
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
