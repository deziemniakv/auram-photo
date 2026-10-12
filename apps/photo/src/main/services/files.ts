import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { FileKind, OpenedFile } from '../../shared/ipc';
import { AppError } from './errors';
import { isNotFound } from './fs-utils';

export const PROJECT_EXTENSIONS = ['.cproj'] as const;
export const IMAGE_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'] as const;

/** Upper bounds that keep a hostile or accidental choice from exhausting memory. */
export const MAX_PROJECT_BYTES = 1536 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 512 * 1024 * 1024;

export function fileKind(file: string): FileKind | null {
  const ext = path.extname(file).toLowerCase();
  if ((PROJECT_EXTENSIONS as readonly string[]).includes(ext)) return 'project';
  if ((IMAGE_EXTENSIONS as readonly string[]).includes(ext)) return 'image';
  return null;
}

/** Reads a project or image file chosen by the user. */
export async function readUserFile(file: string): Promise<OpenedFile> {
  const kind = fileKind(file);
  if (!kind || !path.isAbsolute(file))
    throw new AppError('invalid-input', 'This file type is not supported.');
  let size: number;
  try {
    const info = await stat(file);
    if (!info.isFile()) throw new AppError('invalid-input', 'Not a file.');
    size = info.size;
  } catch (error) {
    if (isNotFound(error)) throw new AppError('not-found', 'The file no longer exists.');
    throw error;
  }
  const limit = kind === 'project' ? MAX_PROJECT_BYTES : MAX_IMAGE_BYTES;
  if (size > limit)
    throw new AppError(
      'too-large',
      `The file is larger than ${Math.round(limit / 1024 / 1024)} MB.`,
    );
  const bytes = await readFile(file);
  return {
    path: file,
    name: path.basename(file),
    kind,
    bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
  };
}

/**
 * Finds a file to open in command-line arguments. Auram Launcher passes the
 * project path as a positional argument; flags and unsupported files are ignored.
 */
export function fileFromArgv(argv: readonly string[], cwd: string): string | null {
  for (const arg of argv.slice(1)) {
    if (!arg || arg.startsWith('-')) continue;
    const resolved = path.resolve(cwd, arg);
    if (fileKind(resolved)) return resolved;
  }
  return null;
}
