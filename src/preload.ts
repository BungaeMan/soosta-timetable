import { contextBridge, ipcRenderer } from 'electron';

import { IPC_CHANNELS } from './shared/constants';
import type {
  AppData,
  ExportResult,
  ImportResult,
  NativeLectureReminderPayload,
  SoostaApi,
  WindowMaximizedListener,
} from './shared/types';

const api: SoostaApi = {
  loadData: () => ipcRenderer.invoke(IPC_CHANNELS.loadData) as Promise<AppData>,
  saveData: (data: AppData) => ipcRenderer.invoke(IPC_CHANNELS.saveData, data) as Promise<AppData>,
  exportData: (data: AppData) => ipcRenderer.invoke(IPC_CHANNELS.exportData, data) as Promise<ExportResult>,
  importData: () => ipcRenderer.invoke(IPC_CHANNELS.importData) as Promise<ImportResult>,
  showLectureReminder: (payload: NativeLectureReminderPayload) =>
    ipcRenderer.invoke(IPC_CHANNELS.showLectureReminder, payload) as Promise<void>,
  minimizeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.minimizeWindow) as Promise<void>,
  toggleMaximizeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.toggleMaximizeWindow) as Promise<void>,
  closeWindow: () => ipcRenderer.invoke(IPC_CHANNELS.closeWindow) as Promise<void>,
  isWindowMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.isWindowMaximized) as Promise<boolean>,
  subscribeWindowMaximized: (listener: WindowMaximizedListener) => {
    const handleWindowMaximizedChanged = (_event: Electron.IpcRendererEvent, isMaximized: boolean): void => {
      listener(isMaximized);
    };

    ipcRenderer.on(IPC_CHANNELS.windowMaximizedChanged, handleWindowMaximizedChanged);

    return () => {
      ipcRenderer.removeListener(IPC_CHANNELS.windowMaximizedChanged, handleWindowMaximizedChanged);
    };
  },
};

contextBridge.exposeInMainWorld('soosta', api);
