import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../test-utils';
import { isWithin, readJsonFile, writeJsonAtomic } from './fs-utils';

describe('fs-utils', () => {
  it('writes atomically without leaving temp files', async () => {
    const root = await tempDir();
    try {
      const file = path.join(root.dir, 'nested', 'data.json');
      await writeJsonAtomic(file, { a: 1 });
      await writeJsonAtomic(file, { a: 2 });
      expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ a: 2 });
      expect(await readdir(path.dirname(file))).toEqual(['data.json']);
    } finally {
      await root.cleanup();
    }
  });

  it('distinguishes missing, invalid and valid JSON, tolerating a BOM', async () => {
    const root = await tempDir();
    try {
      expect(await readJsonFile(path.join(root.dir, 'missing.json'))).toEqual({ kind: 'missing' });
      await writeFile(path.join(root.dir, 'bad.json'), '{');
      expect((await readJsonFile(path.join(root.dir, 'bad.json'))).kind).toBe('invalid');
      await writeFile(path.join(root.dir, 'bom.json'), '\uFEFF{"ok":true}');
      expect(await readJsonFile(path.join(root.dir, 'bom.json'))).toEqual({
        kind: 'ok',
        value: { ok: true },
      });
      await writeFile(path.join(root.dir, 'big.json'), JSON.stringify({ data: 'x'.repeat(100) }));
      expect((await readJsonFile(path.join(root.dir, 'big.json'), 10)).kind).toBe('invalid');
    } finally {
      await root.cleanup();
    }
  });

  it('detects paths outside a parent directory', () => {
    expect(isWithin('/apps/a', '/apps/a/bin/x')).toBe(true);
    expect(isWithin('/apps/a', '/apps/a')).toBe(true);
    expect(isWithin('/apps/a', '/apps/ab/x')).toBe(false);
    expect(isWithin('/apps/a', '/apps/a/../b')).toBe(false);
  });
});
