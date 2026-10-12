import type { ErrorCode, IpcError } from '../../shared/ipc';

/** An error with a stable code that can be shown to the user. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = 'AppError';
  }
}

export function toIpcError(error: unknown): IpcError {
  if (error instanceof AppError) return { code: error.code, message: error.message };
  if (error instanceof Error && error.name === 'AbortError') {
    return { code: 'cancelled', message: 'The operation was cancelled.' };
  }
  return { code: 'unknown', message: error instanceof Error ? error.message : String(error) };
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
