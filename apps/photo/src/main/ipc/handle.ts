import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import type { z } from 'zod';
import type { IpcResult } from '../../shared/ipc';
import { toIpcError } from '../services/errors';
import type { Logger } from '../services/logger';
import { isTrustedRendererUrl } from '../security';

/**
 * Registers an IPC handler that:
 * - rejects calls from any frame other than the launcher's own renderer,
 * - validates the input with a Zod schema before the handler sees it,
 * - converts every failure into a typed `IpcResult` error.
 */
export function handle<S extends z.ZodType, R>(
  logger: Logger,
  channel: string,
  schema: S,
  handler: (input: z.infer<S>, event: IpcMainInvokeEvent) => Promise<R> | R,
): void {
  ipcMain.handle(channel, async (event, raw: unknown): Promise<IpcResult<R>> => {
    if (!isTrustedRendererUrl(event.senderFrame?.url)) {
      logger.warn('ipc', `Rejected ${channel} from untrusted frame`, {
        url: event.senderFrame?.url,
      });
      return { ok: false, error: { code: 'forbidden', message: 'Forbidden' } };
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      logger.warn('ipc', `Invalid input for ${channel}`, parsed.error.issues);
      return {
        ok: false,
        error: {
          code: 'invalid-input',
          message: parsed.error.issues[0]?.message ?? 'Invalid input',
        },
      };
    }
    try {
      return { ok: true, value: await handler(parsed.data, event) };
    } catch (error) {
      const ipcError = toIpcError(error);
      const log =
        ipcError.code === 'unknown' || ipcError.code === 'io' ? logger.error : logger.warn;
      log(
        'ipc',
        `${channel} failed: ${ipcError.message}`,
        ipcError.code === 'unknown' ? error : undefined,
      );
      return { ok: false, error: ipcError };
    }
  });
}
