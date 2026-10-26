import type { AppData } from '../domain/types';
import { ApiError } from './errors';

export interface AuthRecord {
  user_id: string;
  salt: string;
  hash: string;
  must_change_password: boolean;
  activation_token: string | null;
  activation_expires: string | null;
  reset_token: string | null;
  reset_expires: string | null;
  failed_attempts: number;
  locked_until: string | null;
  updated_at: string;
}

export interface PersistedState {
  data: AppData;
  auth: AuthRecord[];
}

export interface Persistence {
  load(): PersistedState | null;
  save(state: PersistedState): void;
  clear(): void;
  key: string;
}

const STORAGE_KEY = 'uas.v1.state';
const MAX_BYTES = 4_200_000;

/**
 * Reading `window.localStorage` can *throw* (cross-origin iframes, private
 * modes, storage disabled by policy). Probe it inside a try/catch so the portal
 * degrades to in-memory data instead of failing to boot.
 */
export function browserStorageWorks(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const probe = '__uas_probe__';
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

export class LocalPersistence implements Persistence {
  key = STORAGE_KEY;
  /** false when the browser blocks storage — the app still runs, in memory. */
  readonly available: boolean;

  constructor() {
    this.available = browserStorageWorks();
  }

  load(): PersistedState | null {
    if (!this.available) return null;
    try {
      const raw = window.localStorage.getItem(this.key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as PersistedState;
      if (!parsed?.data?.profiles) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  save(state: PersistedState): void {
    if (!this.available) return;
    let payload: string;
    try {
      payload = JSON.stringify(state);
    } catch {
      throw new ApiError('storage_serialise', 'The data could not be serialised for storage.');
    }
    if (payload.length > MAX_BYTES) {
      throw new ApiError(
        'storage_full',
        'This browser storage is almost full. Remove large attachments or clear demo data from Settings, then try again.',
      );
    }
    try {
      window.localStorage.setItem(this.key, payload);
    } catch (e) {
      throw new ApiError(
        'storage_full',
        'Browser storage is full. Remove some demo attachments or reset the demo data.',
        { cause: String(e) },
      );
    }
  }

  clear(): void {
    if (!this.available) return;
    try {
      window.localStorage.removeItem(this.key);
    } catch {
      /* ignore */
    }
  }
}

export class MemoryPersistence implements Persistence {
  key = 'memory';
  private state: PersistedState | null = null;
  load(): PersistedState | null {
    return this.state;
  }
  save(state: PersistedState): void {
    this.state = JSON.parse(JSON.stringify(state)) as PersistedState;
  }
  clear(): void {
    this.state = null;
  }
}

export const SESSION_KEY = 'uas.v1.session';
