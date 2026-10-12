import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../test-utils';
import { createFileLogger } from './logger';

describe('createFileLogger', () => {
  it('writes entries at or above the configured level', async () => {
    const root = await tempDir();
    try {
      const logger = createFileLogger({ dir: root.dir, level: 'info' });
      logger.debug('test', 'hidden');
      logger.info('test', 'visible', { a: 1 });
      logger.error('test', 'failure', new Error('boom'));
      await logger.flush();
      const content = await readFile(logger.file, 'utf8');
      expect(content).not.toContain('hidden');
      expect(content).toMatch(/INFO {2}\[test\] visible \{"a":1\}/);
      expect(content).toContain('Error: boom');

      logger.setLevel('debug');
      logger.debug('test', 'now visible');
      await logger.flush();
      expect(await readFile(logger.file, 'utf8')).toContain('now visible');
    } finally {
      await root.cleanup();
    }
  });

  it('rotates files and keeps a bounded number of them', async () => {
    const root = await tempDir();
    try {
      const logger = createFileLogger({ dir: root.dir, maxBytes: 200, maxFiles: 2 });
      for (let i = 0; i < 40; i++) logger.info('rotate', `entry ${i} ${'x'.repeat(40)}`);
      await logger.flush();
      const files = (await readdir(root.dir)).sort();
      expect(files).toEqual(['launcher.1.log', 'launcher.2.log', 'launcher.log']);
      for (const file of files) {
        expect((await readFile(path.join(root.dir, file))).length).toBeLessThanOrEqual(200);
      }
      expect(await readFile(path.join(root.dir, 'launcher.log'), 'utf8')).toContain('entry 39');
    } finally {
      await root.cleanup();
    }
  });
});
