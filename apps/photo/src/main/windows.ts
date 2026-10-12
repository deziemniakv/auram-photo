import { app, BrowserWindow, screen } from 'electron';
import path from 'node:path';
import { colors } from '@auram/design-tokens';
import { z } from 'zod';
import { IPC_EVENTS, type OpenedFile } from '../shared/ipc';
import { readJsonFile, writeJsonAtomic } from './services/fs-utils';
import type { Logger } from './services/logger';

const WindowStateSchema = z.object({
  x: z.number().int(),
  y: z.number().int(),
  width: z.number().int().min(400),
  height: z.number().int().min(300),
  maximized: z.boolean(),
});

/** Per-window state kept by the main process. */
export interface EditorWindow {
  window: BrowserWindow;
  /** Paths this window may write to without asking (files it opened or saved). */
  grants: Set<string>;
  /** File to open when the window's renderer asks for it. */
  initialFile: string | null;
  hasDocument: boolean;
  allowClose: boolean;
}

export class WindowManager {
  private readonly windows = new Map<number, EditorWindow>();

  constructor(private readonly options: { stateFile: string; logger: Logger }) {}

  forContents(webContentsId: number): EditorWindow | undefined {
    return this.windows.get(webContentsId);
  }

  all(): EditorWindow[] {
    return [...this.windows.values()];
  }

  async create(initialFile: string | null): Promise<EditorWindow> {
    const saved = await this.loadState();
    const cascade = this.windows.size * 28;
    const window = new BrowserWindow({
      width: saved?.width ?? 1440,
      height: saved?.height ?? 900,
      x: saved ? saved.x + cascade : undefined,
      y: saved ? saved.y + cascade : undefined,
      minWidth: 1024,
      minHeight: 640,
      show: false,
      title: 'Auram Photo',
      backgroundColor: colors.bg,
      titleBarStyle: 'hidden',
      titleBarOverlay:
        process.platform === 'darwin'
          ? undefined
          : { color: colors.surface0, symbolColor: colors.textSecondary, height: 39 },
      trafficLightPosition: { x: 14, y: 12 },
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true,
        spellcheck: false,
        devTools: !app.isPackaged,
      },
    });
    if (saved?.maximized && this.windows.size === 0) window.maximize();

    const entry: EditorWindow = {
      window,
      grants: new Set(),
      initialFile,
      hasDocument: false,
      allowClose: false,
    };
    const id = window.webContents.id;
    this.windows.set(id, entry);

    window.once('ready-to-show', () => {
      if (!process.env.AURAM_HIDE_WINDOW) window.show();
    });
    let reloads = 0;
    window.webContents.on('render-process-gone', (_event, details) => {
      this.options.logger.error('window', 'Renderer process gone', details);
      if (details.reason !== 'clean-exit' && !window.isDestroyed() && reloads < 3) {
        reloads++;
        window.reload();
      }
    });
    // Unsaved changes are the renderer's responsibility: ask it before closing.
    window.on('close', (event) => {
      this.saveState(window);
      if (entry.allowClose) return;
      event.preventDefault();
      window.webContents.send(IPC_EVENTS.closeRequested);
    });
    window.on('closed', () => this.windows.delete(id));

    const devServerUrl = !app.isPackaged ? process.env.ELECTRON_RENDERER_URL : undefined;
    if (devServerUrl) await window.loadURL(devServerUrl);
    else await window.loadFile(path.join(__dirname, '../renderer/index.html'));
    return entry;
  }

  /** Opens a file in a window without a document, or in a new window. */
  async openFile(filePath: string, read: (file: string) => Promise<OpenedFile>): Promise<void> {
    const idle = this.all().find((entry) => !entry.hasDocument);
    if (!idle) {
      await this.create(filePath);
      return;
    }
    idle.grants.add(filePath);
    idle.window.webContents.send(IPC_EVENTS.openFile, await read(filePath));
    if (idle.window.isMinimized()) idle.window.restore();
    idle.window.focus();
  }

  private async loadState() {
    const read = await readJsonFile(this.options.stateFile, 16 * 1024).catch(() => null);
    if (!read || read.kind !== 'ok') return null;
    const parsed = WindowStateSchema.safeParse(read.value);
    if (!parsed.success) return null;
    const s = parsed.data;
    const visible = screen
      .getAllDisplays()
      .some(
        ({ workArea: w }) =>
          s.x < w.x + w.width &&
          s.x + s.width > w.x &&
          s.y < w.y + w.height &&
          s.y + s.height > w.y,
      );
    return visible ? s : null;
  }

  private saveState(window: BrowserWindow): void {
    if (window.isDestroyed()) return;
    void writeJsonAtomic(this.options.stateFile, {
      ...window.getNormalBounds(),
      maximized: window.isMaximized(),
    }).catch((error: unknown) =>
      this.options.logger.warn('window', 'Could not save window state', error),
    );
  }
}
