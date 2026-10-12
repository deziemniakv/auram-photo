import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const RETRYABLE = new Set(['EPERM', 'EBUSY', 'EACCES']);

function errorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String((error as { code: unknown }).code)
    : undefined;
}

export function isNotFound(error: unknown): boolean {
  return errorCode(error) === 'ENOENT';
}

/**
 * Renames with retries. On Windows, antivirus scanners and indexers briefly hold
 * handles to fresh files, which makes an immediate rename fail with EPERM/EBUSY.
 */
export async function renameWithRetry(from: string, to: string, attempts = 6): Promise<void> {
  for (let attempt = 1; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      const code = errorCode(error);
      if (attempt >= attempts || !code || !RETRYABLE.has(code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25 * 2 ** attempt));
    }
  }
}

/**
 * Writes a file so that readers observe either the old or the new content,
 * never a partial write: write to a sibling temp file, flush, then rename.
 */
export async function writeFileAtomic(file: string, data: string | Uint8Array): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temp = `${file}.${randomUUID()}.tmp`;
  const handle = await open(temp, 'w');
  try {
    await handle.writeFile(data);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await renameWithRetry(temp, file);
  } catch (error) {
    await rm(temp, { force: true });
    throw error;
  }
}

export async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await writeFileAtomic(file, `${JSON.stringify(value, null, 2)}\n`);
}

export type JsonReadResult =
  { kind: 'missing' } | { kind: 'ok'; value: unknown } | { kind: 'invalid'; error: string };

export async function readJsonFile(file: string, maxBytes = 1024 * 1024): Promise<JsonReadResult> {
  let raw: string;
  try {
    const info = await stat(file);
    if (info.size > maxBytes) return { kind: 'invalid', error: `File exceeds ${maxBytes} bytes` };
    raw = await readFile(file, 'utf8');
  } catch (error) {
    if (isNotFound(error)) return { kind: 'missing' };
    throw error;
  }
  try {
    return { kind: 'ok', value: JSON.parse(raw.replace(/^\uFEFF/, '')) };
  } catch (error) {
    return { kind: 'invalid', error: error instanceof Error ? error.message : String(error) };
  }
}

export async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (isNotFound(error)) return false;
    throw error;
  }
}

/** True when `child` resolves to a location inside `parent` (or equals it). */
export function isWithin(parent: string, child: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

export function timestampForFileName(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-');
}
