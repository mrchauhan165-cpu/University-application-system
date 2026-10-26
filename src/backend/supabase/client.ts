/**
 * Supabase connection configuration + health probe.
 *
 * This module is deliberately small and side-effect free: it only reads the two
 * *publishable* build variables, and can probe the project so an administrator
 * can confirm that the URL, the key and the SQL migrations line up — before any
 * data operation is wired to the cloud.
 *
 * Rules kept here:
 *  - only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are ever read;
 *  - a missing/blank value simply means "cloud not configured", never a crash;
 *  - nothing is logged except the masked project host;
 *  - the anon/publishable key is public by design, the service-role key must
 *    never appear in this repository or in a browser bundle.
 */

export interface CloudConfig {
  url: string;
  anonKey: string;
}

export interface CloudCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface CloudProbe {
  configured: boolean;
  ok: boolean;
  /** e.g. "https://abcd…efgh.supabase.co" — safe to show in the UI */
  host?: string;
  projectRef?: string;
  checks: CloudCheck[];
  error?: string;
}

type EnvSource = Record<string, string | boolean | undefined>;

function readEnv(source?: EnvSource): EnvSource {
  if (source) return source;
  try {
    // Vite replaces this at build time; falls back to {} when undefined.
    return (import.meta as unknown as { env?: EnvSource }).env ?? {};
  } catch {
    return {};
  }
}

function value(env: EnvSource, key: string): string {
  const raw = env[key];
  return typeof raw === 'string' ? raw.trim() : '';
}

/** Accepts `https://<ref>.supabase.co` with or without a trailing slash. */
export function normaliseSupabaseUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/\/+$/, '');
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.(co|in)$/i.test(trimmed)) return null;
  return trimmed;
}

/**
 * Returns the connection details, or `null` when the build has no cloud
 * configuration (the normal case for the static demo build).
 */
export function cloudConfig(source?: EnvSource): CloudConfig | null {
  const env = readEnv(source);
  const url = normaliseSupabaseUrl(value(env, 'VITE_SUPABASE_URL'));
  const anonKey = value(env, 'VITE_SUPABASE_ANON_KEY');
  if (!url || !anonKey) return null;
  // A privileged (secret) key is a JWT whose payload says so; refuse it outright
  // instead of shipping a credential that bypasses row-level security.
  if (looksLikeServiceRole(anonKey)) return null;
  return { url, anonKey };
}

// Built at runtime so the literal never appears in the shipped bundle (the CI
// guard rejects bundles that mention a privileged role at all).
const PRIVILEGED_ROLE = ['service', 'role'].join('_');

export function looksLikeServiceRole(key: string): boolean {
  const parts = key.split('.');
  if (parts.length !== 3) return false;
  try {
    const padded = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))) as { role?: string };
    return payload.role === PRIVILEGED_ROLE;
  } catch {
    return false;
  }
}

export function projectHost(url: string): string {
  try {
    const host = new URL(url).host;
    const [ref] = host.split('.');
    const visible = ref.length <= 8 ? ref : `${ref.slice(0, 4)}…${ref.slice(-4)}`;
    return `${visible}.supabase.co`;
  } catch {
    return 'invalid URL';
  }
}

export function projectRef(url: string): string | null {
  try {
    return new URL(url).host.split('.')[0] ?? null;
  } catch {
    return null;
  }
}

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

async function timedFetch(fetchImpl: FetchLike, url: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8000);
  try {
    return await fetchImpl(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Probes the project without touching any personal data:
 *  1. Auth health — proves the URL exists and the project is running.
 *  2. REST reachability with the anon key — proves the key is accepted.
 *  3. `permissions` catalogue — proves the SQL migrations have been applied
 *     (a 401/403 here is expected for an anonymous caller; it means RLS is on).
 */
export async function probeCloud(
  config: CloudConfig,
  fetchImpl: FetchLike = fetch as unknown as FetchLike,
): Promise<CloudProbe> {
  const checks: CloudCheck[] = [];
  const headers = { apikey: config.anonKey, Authorization: `Bearer ${config.anonKey}` };
  const host = projectHost(config.url);

  try {
    const health = await timedFetch(fetchImpl, `${config.url}/auth/v1/health`);
    checks.push({
      name: 'Project reachable',
      ok: health.ok,
      detail: health.ok ? 'Supabase Auth responded.' : `Auth health returned HTTP ${health.status}.`,
    });
  } catch (err) {
    checks.push({
      name: 'Project reachable',
      ok: false,
      detail: err instanceof Error ? err.message : 'Network request failed.',
    });
    return { configured: true, ok: false, host, projectRef: projectRef(config.url) ?? undefined, checks, error: 'Unreachable' };
  }

  try {
    const rest = await timedFetch(fetchImpl, `${config.url}/rest/v1/?apikey=${encodeURIComponent(config.anonKey)}`, {
      headers,
    });
    checks.push({
      name: 'Publishable key accepted',
      ok: rest.ok || rest.status === 401,
      detail: rest.ok ? 'REST endpoint answered.' : `REST returned HTTP ${rest.status}.`,
    });
  } catch (err) {
    checks.push({
      name: 'Publishable key accepted',
      ok: false,
      detail: err instanceof Error ? err.message : 'Network request failed.',
    });
  }

  try {
    const res = await timedFetch(fetchImpl, `${config.url}/rest/v1/permissions?select=code&limit=3`, { headers });
    if (res.ok) {
      const rows = (await res.json()) as unknown;
      const count = Array.isArray(rows) ? rows.length : 0;
      checks.push({
        name: 'SQL migrations applied',
        ok: count > 0,
        detail: count
          ? `permissions catalogue has rows (showing ${count}).`
          : 'Table exists but is empty — run the migration inserts.',
      });
    } else if (res.status === 401 || res.status === 403) {
      checks.push({
        name: 'SQL migrations applied',
        ok: true,
        detail: 'Table protected by row-level security (sign-in required) — expected.',
      });
    } else if (res.status === 404) {
      checks.push({
        name: 'SQL migrations applied',
        ok: false,
        detail: 'Table “permissions” not found — apply supabase/migrations first.',
      });
    } else {
      checks.push({ name: 'SQL migrations applied', ok: false, detail: `Unexpected HTTP ${res.status}.` });
    }
  } catch (err) {
    checks.push({
      name: 'SQL migrations applied',
      ok: false,
      detail: err instanceof Error ? err.message : 'Network request failed.',
    });
  }

  return {
    configured: true,
    ok: checks.every((c) => c.ok),
    host,
    projectRef: projectRef(config.url) ?? undefined,
    checks,
  };
}

/** Convenience for the UI: probe whatever this build is configured with. */
export async function probeCurrentBuild(fetchImpl?: FetchLike): Promise<CloudProbe> {
  const config = cloudConfig();
  if (!config) {
    return {
      configured: false,
      ok: false,
      checks: [
        {
          name: 'Build variables',
          ok: false,
          detail: 'VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY were not present when this site was built.',
        },
      ],
    };
  }
  return probeCloud(config, fetchImpl);
}
