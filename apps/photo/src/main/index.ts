import { app, Menu } from 'electron';
import type { AppInfo, Language } from '../shared/ipc';
import { registerIpcHandlers } from './ipc/register';
import { applySecurityPolicies } from './security';
import { errorMessage } from './services/errors';
import { fileFromArgv, readUserFile } from './services/files';
import { createFileLogger } from './services/logger';
import { resolvePhotoPaths } from './services/paths';
import { RecentFiles } from './services/recent-files';
import { WindowManager } from './windows';

const REPOSITORY_URL = 'https://github.com/deziemniakv/auram-photo';

const paths = resolvePhotoPaths({
  platform: process.platform,
  env: process.env,
  homeDir: app.getPath('home'),
  documentsDir: app.getPath('documents'),
});
app.setPath('userData', paths.electronDataDir);
app.setPath('sessionData', paths.electronDataDir);
app.setAppUserModelId('com.auram.photo');

// Without a usable GPU (virtual machines, remote desktop, blocklisted drivers)
// Chromium refuses WebGL unless its software renderer is allowed. That switch is
// meant to protect browsers from untrusted pages; Auram Photo only runs its own
// code under a strict CSP, so the editor stays usable instead of failing.
app.commandLine.appendSwitch('enable-unsafe-swiftshader');

const logger = createFileLogger({
  dir: paths.logsDir,
  fileName: 'photo.log',
  console: !app.isPackaged,
});
process.on('uncaughtException', (error) => logger.error('process', 'Uncaught exception', error));
process.on('unhandledRejection', (reason) =>
  logger.error('process', 'Unhandled rejection', reason),
);

const windows = new WindowManager({ stateFile: paths.windowStateFile, logger });

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  // A second launch (e.g. opening another project from Auram Launcher) is routed here.
  app.on('second-instance', (_event, argv, workingDirectory) => {
    const file = fileFromArgv(argv, workingDirectory);
    if (file) {
      void windows
        .openFile(file, readUserFile)
        .catch((error: unknown) =>
          logger.error('files', 'Could not open file', errorMessage(error)),
        );
      return;
    }
    const [first] = windows.all();
    if (first) {
      if (first.window.isMinimized()) first.window.restore();
      first.window.focus();
    } else {
      void windows.create(null);
    }
  });
  app.on('window-all-closed', () => app.quit());
  app.whenReady().then(start, async (error: unknown) => {
    logger.error('startup', 'Electron failed to initialise', error);
    await logger.flush();
    app.exit(1);
  });
}

async function start(): Promise<void> {
  logger.info('startup', `Auram Photo ${app.getVersion()} starting`, {
    platform: process.platform,
    arch: process.arch,
    launcher: process.env.AURAM_LAUNCHER_VERSION ?? null,
  });
  if (app.isPackaged) Menu.setApplicationMenu(null);
  applySecurityPolicies(logger, () => new Set());

  const recent = new RecentFiles(paths.recentFile, process.platform, logger);
  await recent.init();

  const language: Language = app.getLocale().toLowerCase().startsWith('pl') ? 'pl' : 'en';
  const info = (): AppInfo => ({
    name: 'Auram Photo',
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    isPackaged: app.isPackaged,
    language:
      process.env.AURAM_LANGUAGE === 'pl' || process.env.AURAM_LANGUAGE === 'en'
        ? process.env.AURAM_LANGUAGE
        : language,
    launcherVersion: process.env.AURAM_LAUNCHER_VERSION ?? null,
    defaultProjectsDir: paths.defaultProjectsDir,
    logsDir: paths.logsDir,
    repositoryUrl: REPOSITORY_URL,
  });

  registerIpcHandlers({
    logger,
    windows,
    recent,
    info,
    defaultProjectsDir: paths.defaultProjectsDir,
    logsDir: paths.logsDir,
  });
  await windows.create(fileFromArgv(process.argv, process.cwd()));
  logger.info('startup', 'Window loaded');

  app.on('before-quit', () => void logger.flush());
}
