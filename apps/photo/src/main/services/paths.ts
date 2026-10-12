import path from 'node:path';

export interface PhotoPaths {
  dataRoot: string;
  photoDir: string;
  recentFile: string;
  windowStateFile: string;
  logsDir: string;
  electronDataDir: string;
  defaultProjectsDir: string;
}

export interface ResolvePathsInput {
  platform: NodeJS.Platform;
  env: Record<string, string | undefined>;
  homeDir: string;
  documentsDir: string;
}

/**
 * Same data root as Auram Launcher (see the launcher's docs/data-locations.md):
 * Windows %LOCALAPPDATA%\Auram\Photo, projects in Documents\Auram\Projects.
 * AURAM_DATA_DIR / AURAM_DOCUMENTS_DIR override the roots for development and tests.
 */
export function resolvePhotoPaths({
  platform,
  env,
  homeDir,
  documentsDir,
}: ResolvePathsInput): PhotoPaths {
  const p = platform === 'win32' ? path.win32 : path.posix;
  let dataRoot: string;
  if (env.AURAM_DATA_DIR) dataRoot = env.AURAM_DATA_DIR;
  else if (platform === 'win32')
    dataRoot = p.join(env.LOCALAPPDATA || p.join(homeDir, 'AppData', 'Local'), 'Auram');
  else if (platform === 'darwin')
    dataRoot = p.join(homeDir, 'Library', 'Application Support', 'Auram');
  else dataRoot = p.join(env.XDG_DATA_HOME || p.join(homeDir, '.local', 'share'), 'Auram');

  const photoDir = p.join(dataRoot, 'Photo');
  return {
    dataRoot,
    photoDir,
    recentFile: p.join(photoDir, 'recent-files.json'),
    windowStateFile: p.join(photoDir, 'window-state.json'),
    logsDir: p.join(photoDir, 'logs'),
    electronDataDir: p.join(photoDir, 'cache', 'electron'),
    defaultProjectsDir: p.join(env.AURAM_DOCUMENTS_DIR || documentsDir, 'Auram', 'Projects'),
  };
}
