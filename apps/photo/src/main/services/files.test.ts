import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { tempDir } from '../test-utils';
import { fileFromArgv, fileKind, readUserFile } from './files';
import { resolvePhotoPaths } from './paths';
import { RecentFiles } from './recent-files';
import { nullLogger } from './logger';

describe('files', () => {
  it('recognises projects and images only', () => {
    expect(fileKind('/a/Poster.CPROJ')).toBe('project');
    expect(fileKind('/a/photo.jpeg')).toBe('image');
    expect(fileKind('/a/notes.txt')).toBeNull();
  });

  it('finds the project path Auram Launcher passes on the command line', () => {
    expect(fileFromArgv(['Auram Photo.exe', '--flag', 'C:/p/a.cproj'], '/cwd')).toBe(
      path.resolve('/cwd', 'C:/p/a.cproj'),
    );
    expect(fileFromArgv(['electron', '.', '--no-sandbox'], '/cwd')).toBeNull();
    expect(fileFromArgv(['app', 'relative.png'], '/work')).toBe(
      path.resolve('/work', 'relative.png'),
    );
  });

  it('reads supported files and rejects others', async () => {
    const root = await tempDir();
    try {
      const png = path.join(root.dir, 'a.png');
      await writeFile(png, 'data');
      expect(await readUserFile(png)).toMatchObject({ name: 'a.png', kind: 'image' });
      await expect(readUserFile(path.join(root.dir, 'missing.cproj'))).rejects.toMatchObject({
        code: 'not-found',
      });
      await expect(readUserFile(path.join(root.dir, 'x.exe'))).rejects.toMatchObject({
        code: 'invalid-input',
      });
      await expect(readUserFile('relative.png')).rejects.toMatchObject({ code: 'invalid-input' });
    } finally {
      await root.cleanup();
    }
  });

  it('keeps a bounded, de-duplicated recent list across restarts', async () => {
    const root = await tempDir();
    try {
      const file = path.join(root.dir, 'recent.json');
      const recent = new RecentFiles(file, 'linux', nullLogger);
      await recent.init();
      await recent.add('/p/a.cproj', 'project');
      await recent.add('/p/b.png', 'image');
      await recent.add('/p/a.cproj', 'project');
      const reloaded = new RecentFiles(file, 'linux', nullLogger);
      await reloaded.init();
      expect((await reloaded.list()).map((item) => item.path)).toEqual(['/p/a.cproj', '/p/b.png']);
      expect(reloaded.has('/p/b.png')).toBe(true);
      await reloaded.remove('/p/b.png');
      expect(reloaded.has('/p/b.png')).toBe(false);
    } finally {
      await root.cleanup();
    }
  });

  it('stores data next to the launcher and projects in Documents', () => {
    const paths = resolvePhotoPaths({
      platform: 'win32',
      env: { LOCALAPPDATA: 'C:\\Users\\Ada\\AppData\\Local' },
      homeDir: 'C:\\Users\\Ada',
      documentsDir: 'C:\\Users\\Ada\\Documents',
    });
    expect(paths.photoDir).toBe('C:\\Users\\Ada\\AppData\\Local\\Auram\\Photo');
    expect(paths.defaultProjectsDir).toBe('C:\\Users\\Ada\\Documents\\Auram\\Projects');
  });
});
