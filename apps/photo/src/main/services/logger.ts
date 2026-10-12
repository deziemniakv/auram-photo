import { appendFile, mkdir, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import type { LogLevel } from '../../shared/ipc';
import { isNotFound } from './fs-utils';

const LEVEL_ORDER: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

export interface LoggerOptions {
  dir: string;
  fileName?: string;
  level?: LogLevel;
  /** Rotate when the active file would exceed this size. */
  maxBytes?: number;
  /** Number of rotated files kept in addition to the active file. */
  maxFiles?: number;
  /** Mirror entries to the console (development). */
  console?: boolean;
}

export interface Logger {
  error(scope: string, message: string, details?: unknown): void;
  warn(scope: string, message: string, details?: unknown): void;
  info(scope: string, message: string, details?: unknown): void;
  debug(scope: string, message: string, details?: unknown): void;
  setLevel(level: LogLevel): void;
  /** Resolves when every queued entry has been written. */
  flush(): Promise<void>;
  readonly file: string;
}

function formatDetails(details: unknown): string {
  if (details === undefined) return '';
  if (details instanceof Error) return ` ${details.stack ?? details.message}`;
  try {
    return ` ${JSON.stringify(details)}`;
  } catch {
    return ` ${String(details)}`;
  }
}

/**
 * Small append-only file logger with size-based rotation. Writes are queued so
 * the main process never blocks on disk I/O and entries keep their order.
 */
export function createFileLogger(options: LoggerOptions): Logger {
  const fileName = options.fileName ?? 'launcher.log';
  const file = path.join(options.dir, fileName);
  const maxBytes = options.maxBytes ?? 1024 * 1024;
  const maxFiles = options.maxFiles ?? 5;
  const base = fileName.replace(/\.log$/, '');
  let level: LogLevel = options.level ?? 'info';
  let size: number | null = null;
  let queue: Promise<void> = Promise.resolve();

  async function currentSize(): Promise<number> {
    if (size !== null) return size;
    try {
      size = (await stat(file)).size;
    } catch (error) {
      if (!isNotFound(error)) throw error;
      size = 0;
    }
    return size;
  }

  async function rotate(): Promise<void> {
    await rm(path.join(options.dir, `${base}.${maxFiles}.log`), { force: true });
    for (let i = maxFiles - 1; i >= 1; i--) {
      try {
        await rename(
          path.join(options.dir, `${base}.${i}.log`),
          path.join(options.dir, `${base}.${i + 1}.log`),
        );
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
    try {
      await rename(file, path.join(options.dir, `${base}.1.log`));
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    size = 0;
  }

  function write(entryLevel: LogLevel, scope: string, message: string, details?: unknown): void {
    if (LEVEL_ORDER[entryLevel] > LEVEL_ORDER[level]) return;
    const line = `${new Date().toISOString()} ${entryLevel.toUpperCase().padEnd(5)} [${scope}] ${message}${formatDetails(details)}\n`;
    if (options.console) {
      (entryLevel === 'error' ? console.error : console.log)(line.trimEnd());
    }
    queue = queue
      .then(async () => {
        await mkdir(options.dir, { recursive: true });
        const bytes = Buffer.byteLength(line);
        if ((await currentSize()) + bytes > maxBytes) await rotate();
        await appendFile(file, line, 'utf8');
        size = (size ?? 0) + bytes;
      })
      .catch((error: unknown) => {
        // Logging must never crash the launcher.
        size = null;
        console.error('Failed to write log entry', error);
      });
  }

  return {
    file,
    error: (scope, message, details) => write('error', scope, message, details),
    warn: (scope, message, details) => write('warn', scope, message, details),
    info: (scope, message, details) => write('info', scope, message, details),
    debug: (scope, message, details) => write('debug', scope, message, details),
    setLevel: (next) => {
      level = next;
    },
    flush: () => queue,
  };
}

/** A logger that discards everything; for tests. */
export const nullLogger: Logger = {
  file: '',
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {},
  setLevel: () => {},
  flush: () => Promise.resolve(),
};
