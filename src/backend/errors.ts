export class ApiError extends Error {
  code: string;
  details?: Record<string, unknown>;
  constructor(code: string, message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.details = details;
  }
}

export function fail(code: string, message: string, details?: Record<string, unknown>): never {
  throw new ApiError(code, message, details);
}

export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return String(e);
}

export function errorCode(e: unknown): string {
  if (e instanceof ApiError) return e.code;
  return 'unexpected_error';
}
