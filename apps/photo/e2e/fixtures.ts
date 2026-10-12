import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const appDir = path.resolve(__dirname, '..');

export interface Sandbox {
  root: string;
  dataDir: string;
  documentsDir: string;
  projectsDir: string;
  cleanup: () => Promise<void>;
}

/** Isolated data and documents folders so tests never touch real user files. */
export async function createSandbox(): Promise<Sandbox> {
  const root = await mkdtemp(path.join(os.tmpdir(), 'auram-photo-e2e-'));
  const documentsDir = path.join(root, 'documents');
  return {
    root,
    dataDir: path.join(root, 'data'),
    documentsDir,
    projectsDir: path.join(documentsDir, 'Auram', 'Projects'),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
}

export async function launch(
  sandbox: Sandbox,
  args: string[] = [],
): Promise<{ app: ElectronApplication; window: Page }> {
  const app = await electron.launch({
    args: [appDir, ...(process.platform === 'linux' ? ['--no-sandbox'] : []), ...args],
    env: {
      ...process.env,
      AURAM_DATA_DIR: sandbox.dataDir,
      AURAM_DOCUMENTS_DIR: sandbox.documentsDir,
      AURAM_LANGUAGE: 'en',
    },
  });
  const window = await app.firstWindow();
  await window.getByRole('menubar').waitFor();
  return { app, window };
}

/** Makes the next native save dialog return `filePath` (test-only stub in the main process). */
export async function stubSaveDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = (async () => ({
      canceled: false,
      filePath: target,
    })) as typeof dialog.showSaveDialog;
  }, filePath);
}

/** Makes the next native open dialog return `filePath`. */
export async function stubOpenDialog(app: ElectronApplication, filePath: string): Promise<void> {
  await app.evaluate(({ dialog }, target) => {
    dialog.showOpenDialog = (async () => ({
      canceled: false,
      filePaths: [target],
    })) as typeof dialog.showOpenDialog;
  }, filePath);
}

export async function newImage(
  window: Page,
  width: number,
  height: number,
  background: 'White' | 'Transparent' = 'White',
) {
  await window.keyboard.press('Control+N');
  const dialog = window.getByRole('dialog', { name: 'New image' });
  await dialog.getByLabel('Width (px)').fill(String(width));
  await dialog.getByLabel('Height (px)').fill(String(height));
  await dialog.getByLabel(background).check();
  await dialog.getByRole('button', { name: 'Create' }).click();
  await window.getByTestId('canvas').waitFor();
}

/** Closes every window without the unsaved-changes prompt, then quits. */
export async function forceClose(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ BrowserWindow }) => {
    for (const window of BrowserWindow.getAllWindows()) window.destroy();
  });
  await app.close();
}
