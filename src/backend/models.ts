import type {
  AppData,
  Application,
  Batch,
  Department,
  Faculty,
  OrgSnapshot,
  Post,
  Profile,
  Scope,
  Section,
} from '../domain/types';
import { randomToken } from './crypto';

export function newId(prefix = ''): string {
  const raw =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 14)
      : randomToken(7);
  return `${prefix}${raw}`;
}

const CODE_PREFIX: Record<Profile['kind'], string> = {
  student: 'STU',
  teacher: 'FAC',
  staff: 'STF',
};

/** Collision-safe, permanent user code: STU000001, FAC0001, … */
export function nextUserCode(data: AppData, kind: Profile['kind'], postHint?: string | null): string {
  const base = (postHint || CODE_PREFIX[kind]).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 6) || CODE_PREFIX[kind];
  const taken = new Set(data.profiles.map((p) => p.user_code.toUpperCase()));
  let max = 0;
  for (const code of taken) {
    const m = code.match(/^([A-Z]+)(\d+)$/);
    if (m && m[1] === base) max = Math.max(max, Number(m[2]));
  }
  let n = max + 1;
  let candidate = `${base}${String(n).padStart(4, '0')}`;
  while (taken.has(candidate)) {
    n += 1;
    candidate = `${base}${String(n).padStart(4, '0')}`;
  }
  return candidate;
}

export function nextApplicationReference(data: AppData, year = new Date().getFullYear()): string {
  const taken = new Set(data.applications.map((a) => a.reference));
  const prefix = `APP-${year}-`;
  let max = 0;
  for (const ref of taken) {
    if (ref.startsWith(prefix)) max = Math.max(max, Number(ref.slice(prefix.length)) || 0);
  }
  let n = max + 1;
  let ref = `${prefix}${String(n).padStart(5, '0')}`;
  while (taken.has(ref)) {
    n += 1;
    ref = `${prefix}${String(n).padStart(5, '0')}`;
  }
  return ref;
}

export function findFaculty(data: AppData, id?: string | null): Faculty | undefined {
  return id ? data.faculties.find((f) => f.id === id) : undefined;
}
export function findDepartment(data: AppData, id?: string | null): Department | undefined {
  return id ? data.departments.find((d) => d.id === id) : undefined;
}
export function findBatch(data: AppData, id?: string | null): Batch | undefined {
  return id ? data.batches.find((b) => b.id === id) : undefined;
}
export function findSection(data: AppData, id?: string | null): Section | undefined {
  return id ? data.sections.find((s) => s.id === id) : undefined;
}
export function findPost(data: AppData, code?: string | null): Post | undefined {
  return code ? data.posts.find((p) => p.code === code) : undefined;
}
export function findProfile(data: AppData, id?: string | null): Profile | undefined {
  return id ? data.profiles.find((p) => p.id === id) : undefined;
}

/** Resolve the complete organisational position of a profile at `now`. */
export function profileSnapshot(data: AppData, profile: Profile): OrgSnapshot {
  if (profile.kind === 'student') {
    const section = findSection(data, profile.section_id);
    const batch = findBatch(data, profile.batch_id ?? section?.batch_id);
    const dept = findDepartment(data, profile.department_id ?? batch?.department_id);
    const fac = findFaculty(data, dept?.faculty_id);
    return {
      faculty_id: fac?.id ?? null,
      faculty_name: fac?.name ?? null,
      department_id: dept?.id ?? null,
      department_name: dept?.name ?? null,
      batch_id: batch?.id ?? null,
      batch_label: batch?.label ?? null,
      section_id: section?.id ?? null,
      section_name: section?.name ?? null,
    };
  }
  const dept = findDepartment(data, profile.home_department_id);
  const fac = findFaculty(data, dept?.faculty_id);
  return {
    faculty_id: fac?.id ?? null,
    faculty_name: fac?.name ?? null,
    department_id: dept?.id ?? null,
    department_name: dept?.name ?? null,
    batch_id: null,
    batch_label: null,
    section_id: null,
    section_name: null,
  };
}

export function scopeFromProfile(data: AppData, profile: Profile): Scope {
  const snap = profileSnapshot(data, profile);
  return {
    faculty_id: snap.faculty_id ?? null,
    department_id: snap.department_id ?? null,
    batch_id: snap.batch_id ?? null,
    section_id: snap.section_id ?? null,
  };
}

export function scopeLabel(data: AppData, scope: Scope): string {
  const parts: string[] = [];
  const sec = findSection(data, scope.section_id);
  const batch = findBatch(data, scope.batch_id);
  const dept = findDepartment(data, scope.department_id);
  const fac = findFaculty(data, scope.faculty_id);
  if (sec && batch) parts.push(`${batch.label} · Section ${sec.name}`);
  else if (batch) parts.push(batch.label);
  if (dept) parts.push(dept.name);
  if (fac) parts.push(fac.name);
  return parts.length ? parts.join(' · ') : 'University-wide';
}

export function postScopeLabel(post: Post, scope: Scope, data: AppData): string {
  if (post.scope_type === 'university') return 'University-wide';
  return scopeLabel(data, scope);
}

export function byId<T extends { id: string }>(items: T[], id: string | null | undefined): T | undefined {
  return id ? items.find((i) => i.id === id) : undefined;
}

export function fullName(p: Profile): string {
  return p.full_name;
}

export function sortByDateDesc<T>(items: T[], key: (t: T) => string): T[] {
  return [...items].sort((a, b) => (key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : 0));
}

export function isOpen(app: Application): boolean {
  return !['approved', 'completed', 'rejected', 'withdrawn'].includes(app.status);
}

