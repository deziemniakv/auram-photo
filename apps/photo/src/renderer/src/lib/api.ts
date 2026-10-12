import type { ErrorCode, IpcResult, PhotoApi } from '../../../shared/ipc';

export class ApiError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export function getApi(): PhotoApi {
  if (!window.auramPhoto) throw new ApiError('unknown', 'Application bridge unavailable');
  return window.auramPhoto;
}

export async function call<T>(request: (api: PhotoApi) => Promise<IpcResult<T>>): Promise<T> {
  const result = await request(getApi());
  if (!result.ok) throw new ApiError(result.error.code, result.error.message);
  return result.value;
}

export function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
