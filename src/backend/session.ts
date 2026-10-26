import type { AppData, Profile, SessionUser } from '../domain/types';
import { buildGrants } from './authz';

export function buildSession(data: AppData, profile: Profile, now: string): SessionUser {
  const assignments = data.assignments.filter((a) => a.user_id === profile.id);
  const grants = buildGrants(profile, assignments, data.posts, now);
  const permissions = [...new Set(grants.flatMap((g) => g.permissions))];
  return {
    profile,
    assignments,
    grants,
    permissions,
    postCodes: [...new Set(grants.map((g) => g.post.code))],
    isAdmin: permissions.includes('system.admin'),
    postNames: [...new Set(grants.map((g) => g.post.name))],
  };
}
