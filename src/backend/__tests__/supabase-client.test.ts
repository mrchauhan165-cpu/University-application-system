import { describe, expect, it, vi } from 'vitest';
import {
  cloudConfig,
  looksLikeServiceRole,
  normaliseSupabaseUrl,
  probeCloud,
  probeCurrentBuild,
  projectHost,
  projectRef,
} from '../supabase/client';

const URL_OK = 'https://abcdefghijklmnop.supabase.co';
const KEY_OK = 'sb_publishable_abc123';

function response(status: number, body: unknown = null): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

function base64url(value: object): string {
  return Buffer.from(JSON.stringify(value))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function jwt(payload: object): string {
  return `${base64url({ alg: 'HS256', typ: 'JWT' })}.${base64url(payload)}.signature`;
}

describe('cloud configuration', () => {
  it('is not configured when the build has no variables', () => {
    expect(cloudConfig({})).toBeNull();
    expect(cloudConfig({ VITE_SUPABASE_URL: URL_OK })).toBeNull();
    expect(cloudConfig({ VITE_SUPABASE_ANON_KEY: KEY_OK })).toBeNull();
  });

  it('accepts a normal project URL and trims a trailing slash', () => {
    expect(normaliseSupabaseUrl(`${URL_OK}/`)).toBe(URL_OK);
    expect(normaliseSupabaseUrl(`  ${URL_OK}  `)).toBe(URL_OK);
    expect(cloudConfig({ VITE_SUPABASE_URL: `${URL_OK}/`, VITE_SUPABASE_ANON_KEY: KEY_OK })).toEqual({
      url: URL_OK,
      anonKey: KEY_OK,
    });
  });

  it('rejects anything that is not an https supabase project URL', () => {
    expect(normaliseSupabaseUrl('http://abcdefgh.supabase.co')).toBeNull();
    expect(normaliseSupabaseUrl('https://example.com')).toBeNull();
    expect(normaliseSupabaseUrl('https://abcdefgh.supabase.co/rest/v1')).toBeNull();
  });

  it('refuses a privileged key instead of shipping it to the browser', () => {
    const privileged = jwt({ role: 'service_role' });
    expect(looksLikeServiceRole(privileged)).toBe(true);
    expect(looksLikeServiceRole(KEY_OK)).toBe(false);
    expect(cloudConfig({ VITE_SUPABASE_URL: URL_OK, VITE_SUPABASE_ANON_KEY: privileged })).toBeNull();
  });

  it('masks the project reference in anything shown on screen', () => {
    expect(projectHost(URL_OK)).toBe('abcd…mnop.supabase.co');
    expect(projectRef(URL_OK)).toBe('abcdefghijklmnop');
    expect(projectHost('nonsense')).toBe('invalid URL');
  });
});

describe('cloud probe', () => {
  it('reports healthy when auth, REST and the SQL catalog all answer', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/auth/v1/health')) return response(200, { name: 'GoTrue' });
      if (url.includes('/permissions')) return response(200, [{ code: 'application.view' }]);
      return response(200, {});
    });

    const probe = await probeCloud({ url: URL_OK, anonKey: KEY_OK }, fetchImpl as never);
    expect(probe.configured).toBe(true);
    expect(probe.ok).toBe(true);
    expect(probe.checks.map((c) => c.name)).toEqual([
      'Project reachable',
      'Publishable key accepted',
      'SQL migrations applied',
    ]);
  });

  it('treats row-level security (401/403) as a healthy catalogue', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/auth/v1/health')) return response(200, {});
      if (url.includes('/permissions')) return response(403, { message: 'forbidden' });
      return response(200, {});
    });

    const probe = await probeCloud({ url: URL_OK, anonKey: KEY_OK }, fetchImpl as never);
    expect(probe.ok).toBe(true);
    expect(probe.checks[2].detail).toMatch(/row-level security/i);
  });

  it('flags a missing migration as not ready', async () => {
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes('/auth/v1/health')) return response(200, {});
      if (url.includes('/permissions')) return response(404, { message: 'relation does not exist' });
      return response(200, {});
    });

    const probe = await probeCloud({ url: URL_OK, anonKey: KEY_OK }, fetchImpl as never);
    expect(probe.ok).toBe(false);
    expect(probe.checks[2].detail).toMatch(/apply supabase\/migrations/i);
  });

  it('stops early with a clear error when the project is unreachable', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error('Failed to fetch');
    });

    const probe = await probeCloud({ url: URL_OK, anonKey: KEY_OK }, fetchImpl as never);
    expect(probe.ok).toBe(false);
    expect(probe.error).toBe('Unreachable');
    expect(probe.checks).toHaveLength(1);
  });

  it('explains that the build has no variables instead of pretending', async () => {
    const probe = await probeCurrentBuild(vi.fn() as never);
    // vitest runs without VITE_SUPABASE_* set, so the honest answer is "not configured".
    expect(probe.configured).toBe(false);
    expect(probe.checks[0].detail).toMatch(/VITE_SUPABASE_URL/);
  });
});
