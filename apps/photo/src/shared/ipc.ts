/* Contract between the Auram Photo main process and its renderer. */

export type LogLevel = 'error' | 'warn' | 'info' | 'debug';

export type ErrorCode =
  'invalid-input' | 'forbidden' | 'not-found' | 'too-large' | 'io' | 'cancelled' | 'unknown';

export interface IpcError {
  code: ErrorCode;
  message: string;
}

export type IpcResult<T> = { ok: true; value: T } | { ok: false; error: IpcError };

export type Language = 'en' | 'pl';

export interface AppInfo {
  name: string;
  version: string;
  platform: string;
  arch: string;
  isPackaged: boolean;
  language: Language;
  /** Set when Auram Launcher started this process. */
  launcherVersion: string | null;
  defaultProjectsDir: string;
  logsDir: string;
  repositoryUrl: string;
}

export type FileKind = 'project' | 'image';

/** A file the user chose (or the launcher passed), read by the main process. */
export interface OpenedFile {
  path: string;
  name: string;
  kind: FileKind;
  bytes: Uint8Array;
}

export interface SavedFile {
  path: string;
  name: string;
}

export interface RecentFile {
  path: string;
  name: string;
  kind: FileKind;
  openedAt: string;
  exists: boolean;
}

export interface DocumentState {
  title: string;
  hasDocument: boolean;
  edited: boolean;
}

export type ExportFormat = 'png' | 'jpeg' | 'webp';

export const IPC = {
  appInfo: 'photo:app:info',
  initialFile: 'photo:file:initial',
  openDialog: 'photo:file:open-dialog',
  openRecent: 'photo:file:open-recent',
  chooseProjectPath: 'photo:file:choose-project-path',
  saveProject: 'photo:file:save-project',
  exportImage: 'photo:file:export',
  recentList: 'photo:recent:list',
  recentRemove: 'photo:recent:remove',
  revealFile: 'photo:file:reveal',
  setDocumentState: 'photo:window:set-document-state',
  confirmClose: 'photo:window:confirm-close',
  openLogs: 'photo:app:open-logs',
  openExternal: 'photo:app:open-external',
} as const;

export const IPC_EVENTS = {
  closeRequested: 'photo:event:close-requested',
  openFile: 'photo:event:open-file',
} as const;

/** API exposed to the renderer as `window.auramPhoto`. */
export interface PhotoApi {
  app: {
    info(): Promise<IpcResult<AppInfo>>;
    openLogs(): Promise<IpcResult<null>>;
    openExternal(url: string): Promise<IpcResult<null>>;
  };
  files: {
    /** The file this window was opened with (from the launcher or the command line), once. */
    initial(): Promise<IpcResult<OpenedFile | null>>;
    openDialog(): Promise<IpcResult<OpenedFile | null>>;
    openRecent(path: string): Promise<IpcResult<OpenedFile>>;
    /** Asks where to save a project. The chosen path becomes writable for this window. */
    chooseProjectPath(request: {
      currentPath: string | null;
      suggestedName: string;
    }): Promise<IpcResult<string | null>>;
    /** Writes a project to a path this window opened, saved or chose. */
    saveProject(request: { path: string; bytes: Uint8Array }): Promise<IpcResult<SavedFile>>;
    exportImage(request: {
      format: ExportFormat;
      suggestedName: string;
      bytes: Uint8Array;
    }): Promise<IpcResult<SavedFile | null>>;
    recent(): Promise<IpcResult<RecentFile[]>>;
    removeRecent(path: string): Promise<IpcResult<RecentFile[]>>;
    reveal(path: string): Promise<IpcResult<null>>;
    /** Files opened while the app is running, e.g. a second launch from Auram Launcher. */
    onOpenFile(listener: (file: OpenedFile) => void): () => void;
  };
  window: {
    /** Reports the open document so the window title, close prompt and file routing stay correct. */
    setDocumentState(state: DocumentState): Promise<IpcResult<null>>;
    /** Closes the window after the renderer has dealt with unsaved changes. */
    confirmClose(): Promise<IpcResult<null>>;
    onCloseRequested(listener: () => void): () => void;
  };
}
