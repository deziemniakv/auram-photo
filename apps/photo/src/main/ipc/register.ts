import { app, dialog, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import {
  IPC,
  type AppInfo,
  type ExportFormat,
  type RecentFile,
  type SavedFile,
} from '../../shared/ipc';
import { AppError } from '../services/errors';
import { readUserFile, MAX_PROJECT_BYTES } from '../services/files';
import { writeFileAtomic } from '../services/fs-utils';
import type { Logger } from '../services/logger';
import type { RecentFiles } from '../services/recent-files';
import { isAllowedExternalUrl } from '../security';
import type { EditorWindow, WindowManager } from '../windows';
import { handle } from './handle';

export interface IpcContext {
  logger: Logger;
  windows: WindowManager;
  recent: RecentFiles;
  info: () => AppInfo;
  defaultProjectsDir: string;
  logsDir: string;
}

const None = z.undefined();
const Bytes = z
  .instanceof(Uint8Array)
  .refine((value) => value.byteLength <= MAX_PROJECT_BYTES, 'File is too large');
const PathSchema = z.string().min(1).max(4096);
const NameSchema = z
  .string()
  .max(200)
  // Characters Windows does not allow in file names, including control characters.
  // eslint-disable-next-line no-control-regex
  .transform((name) => name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '').trim() || 'Untitled');

const EXPORT_FILTERS: Record<ExportFormat, { name: string; extensions: string[] }> = {
  png: { name: 'PNG', extensions: ['png'] },
  jpeg: { name: 'JPEG', extensions: ['jpg', 'jpeg'] },
  webp: { name: 'WebP', extensions: ['webp'] },
};

function withExtension(file: string, extensions: string[]): string {
  const ext = path.extname(file).slice(1).toLowerCase();
  return extensions.includes(ext) ? file : `${file}.${extensions[0]}`;
}

export function registerIpcHandlers(ctx: IpcContext): void {
  const { logger } = ctx;
  let lastExportDir: string | null = null;

  const windowFor = (event: IpcMainInvokeEvent): EditorWindow => {
    const entry = ctx.windows.forContents(event.sender.id);
    if (!entry) throw new AppError('forbidden', 'Unknown window');
    return entry;
  };

  const save = async (owner: BrowserWindow, options: Electron.SaveDialogOptions) =>
    dialog.showSaveDialog(owner, options);

  handle(logger, IPC.appInfo, None, () => ctx.info());

  handle(logger, IPC.initialFile, None, async (_input, event) => {
    const entry = windowFor(event);
    const file = entry.initialFile;
    entry.initialFile = null;
    if (!file) return null;
    const opened = await readUserFile(file);
    entry.grants.add(opened.path);
    await ctx.recent.add(opened.path, opened.kind);
    return opened;
  });

  handle(logger, IPC.openDialog, None, async (_input, event) => {
    const entry = windowFor(event);
    await mkdir(ctx.defaultProjectsDir, { recursive: true }).catch(() => {});
    const result = await dialog.showOpenDialog(entry.window, {
      defaultPath: ctx.defaultProjectsDir,
      properties: ['openFile'],
      filters: [
        { name: 'Auram Photo', extensions: ['cproj', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
        { name: 'Auram project', extensions: ['cproj'] },
        { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
      ],
    });
    const chosen = result.filePaths[0];
    if (result.canceled || !chosen) return null;
    const opened = await readUserFile(chosen);
    entry.grants.add(opened.path);
    await ctx.recent.add(opened.path, opened.kind);
    return opened;
  });

  handle(logger, IPC.openRecent, PathSchema, async (file, event) => {
    const entry = windowFor(event);
    if (!ctx.recent.has(file))
      throw new AppError('forbidden', 'This file is not in the recent files list.');
    const opened = await readUserFile(file);
    entry.grants.add(opened.path);
    await ctx.recent.add(opened.path, opened.kind);
    return opened;
  });

  handle(
    logger,
    IPC.chooseProjectPath,
    z.object({ currentPath: PathSchema.nullable(), suggestedName: NameSchema }),
    async (request, event): Promise<string | null> => {
      const entry = windowFor(event);
      await mkdir(ctx.defaultProjectsDir, { recursive: true }).catch(() => {});
      const current = request.currentPath?.toLowerCase().endsWith('.cproj')
        ? request.currentPath
        : null;
      const result = await save(entry.window, {
        defaultPath: current ?? path.join(ctx.defaultProjectsDir, `${request.suggestedName}.cproj`),
        filters: [{ name: 'Auram project', extensions: ['cproj'] }],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (result.canceled || !result.filePath) return null;
      const target = withExtension(result.filePath, ['cproj']);
      entry.grants.add(target);
      return target;
    },
  );

  handle(
    logger,
    IPC.saveProject,
    z.object({ path: PathSchema, bytes: Bytes }),
    async (request, event): Promise<SavedFile> => {
      const entry = windowFor(event);
      if (!entry.grants.has(request.path) || !request.path.toLowerCase().endsWith('.cproj')) {
        throw new AppError('forbidden', 'Choose where to save the project first.');
      }
      await writeFileAtomic(request.path, request.bytes);
      await ctx.recent.add(request.path, 'project');
      logger.info('files', 'Saved project', {
        name: path.basename(request.path),
        bytes: request.bytes.byteLength,
      });
      return { path: request.path, name: path.basename(request.path) };
    },
  );

  handle(
    logger,
    IPC.exportImage,
    z.object({ format: z.enum(['png', 'jpeg', 'webp']), suggestedName: NameSchema, bytes: Bytes }),
    async (request, event): Promise<SavedFile | null> => {
      const entry = windowFor(event);
      const filter = EXPORT_FILTERS[request.format];
      const directory = lastExportDir ?? app.getPath('pictures');
      const result = await save(entry.window, {
        defaultPath: path.join(directory, `${request.suggestedName}.${filter.extensions[0]}`),
        filters: [filter],
        properties: ['createDirectory', 'showOverwriteConfirmation'],
      });
      if (result.canceled || !result.filePath) return null;
      const target = withExtension(result.filePath, filter.extensions);
      await writeFileAtomic(target, request.bytes);
      lastExportDir = path.dirname(target);
      logger.info('files', 'Exported image', {
        format: request.format,
        bytes: request.bytes.byteLength,
      });
      return { path: target, name: path.basename(target) };
    },
  );

  handle(logger, IPC.recentList, None, (): Promise<RecentFile[]> => ctx.recent.list());
  handle(logger, IPC.recentRemove, PathSchema, async (file) => {
    await ctx.recent.remove(file);
    return ctx.recent.list();
  });

  handle(logger, IPC.revealFile, PathSchema, (file, event) => {
    const entry = windowFor(event);
    if (!entry.grants.has(file) && !ctx.recent.has(file))
      throw new AppError('forbidden', 'Unknown file.');
    shell.showItemInFolder(file);
    return null;
  });

  handle(
    logger,
    IPC.setDocumentState,
    z.object({ title: z.string().max(300), hasDocument: z.boolean(), edited: z.boolean() }),
    (state, event) => {
      const entry = windowFor(event);
      entry.hasDocument = state.hasDocument;
      entry.window.setTitle(state.title);
      entry.window.setDocumentEdited(state.edited);
      return null;
    },
  );

  handle(logger, IPC.confirmClose, None, (_input, event) => {
    const entry = windowFor(event);
    entry.allowClose = true;
    entry.window.close();
    return null;
  });

  handle(logger, IPC.openLogs, None, async () => {
    await mkdir(ctx.logsDir, { recursive: true });
    const error = await shell.openPath(ctx.logsDir);
    if (error) throw new AppError('io', error);
    return null;
  });

  handle(logger, IPC.openExternal, z.string().max(2048), async (url) => {
    if (!isAllowedExternalUrl(url)) throw new AppError('forbidden', 'This link cannot be opened.');
    await shell.openExternal(url);
    return null;
  });
}
