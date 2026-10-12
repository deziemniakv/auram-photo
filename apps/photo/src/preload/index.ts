import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { IPC, IPC_EVENTS, type PhotoApi } from '../shared/ipc';

/* The only bridge between the sandboxed editor UI and the main process. */

const invoke = <T>(channel: string, input?: unknown): Promise<T> =>
  ipcRenderer.invoke(channel, input);

function subscribe<T>(channel: string, listener: (value: T) => void): () => void {
  const wrapped = (_event: IpcRendererEvent, value: T) => listener(value);
  ipcRenderer.on(channel, wrapped);
  return () => {
    ipcRenderer.removeListener(channel, wrapped);
  };
}

const api: PhotoApi = {
  app: {
    info: () => invoke(IPC.appInfo),
    openLogs: () => invoke(IPC.openLogs),
    openExternal: (url) => invoke(IPC.openExternal, url),
  },
  files: {
    initial: () => invoke(IPC.initialFile),
    openDialog: () => invoke(IPC.openDialog),
    openRecent: (path) => invoke(IPC.openRecent, path),
    chooseProjectPath: (request) => invoke(IPC.chooseProjectPath, request),
    saveProject: (request) => invoke(IPC.saveProject, request),
    exportImage: (request) => invoke(IPC.exportImage, request),
    recent: () => invoke(IPC.recentList),
    removeRecent: (path) => invoke(IPC.recentRemove, path),
    reveal: (path) => invoke(IPC.revealFile, path),
    onOpenFile: (listener) => subscribe(IPC_EVENTS.openFile, listener),
  },
  window: {
    setDocumentState: (state) => invoke(IPC.setDocumentState, state),
    confirmClose: () => invoke(IPC.confirmClose),
    onCloseRequested: (listener) => subscribe(IPC_EVENTS.closeRequested, () => listener()),
  },
};

contextBridge.exposeInMainWorld('auramPhoto', api);
