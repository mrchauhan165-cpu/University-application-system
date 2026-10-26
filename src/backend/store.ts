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

export class LocalPersistence implements Persistence {
  key = STORAGE_KEY;
  private available: boolean;

  constructor() {
    this.available = typeof window !== 'undefined' && Boolean(window.localStorage);
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
