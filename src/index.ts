import path from 'node:path';

import { app, BrowserWindow, ipcMain, Notification, screen, shell } from 'electron';

import { IPC_CHANNELS } from './shared/constants';
import { createReminderPopupMarkup } from './shared/reminder-popup';
import { exportAppData, exportTimetableJpeg, importAppData, loadAppData, saveAppData } from './main/persistence';
import type { AppData, NativeLectureReminderPayload, TimetableJpegExportRequest } from './shared/types';

declare const MAIN_WINDOW_WEBPACK_ENTRY: string;
declare const MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY: string;

if (require('electron-squirrel-startup')) {
  app.quit();
}

if (process.platform === 'win32') {
  app.setAppUserModelId('com.squirrel.SoostaTimetable.SoostaTimetable');
}

let mainWindow: BrowserWindow | null = null;
let clearAttentionTimer: ReturnType<typeof setTimeout> | null = null;
let reminderPopupWindow: BrowserWindow | null = null;
let reminderPopupTimer: ReturnType<typeof setTimeout> | null = null;
const shownLectureReminderIds = new Map<string, number>();
const REMINDER_POPUP_WIDTH = 420;
const REMINDER_POPUP_MIN_HEIGHT = 236;
const REMINDER_POPUP_MAX_HEIGHT = 420;
const REMINDER_POPUP_MARGIN = 18;
const REMINDER_POPUP_AUTO_DISMISS_MS = 12_000;
const REMINDER_HISTORY_RETENTION_MS = 8 * 24 * 60 * 60 * 1000;
const APP_LOGO_FILE_NAME = 'logo.png';
const DEV_APP_LOGO_PATH = path.resolve(process.cwd(), 'logo', APP_LOGO_FILE_NAME);

const getAppLogoPath = (): string =>
  app.isPackaged ? path.join(process.resourcesPath, APP_LOGO_FILE_NAME) : DEV_APP_LOGO_PATH;

const getMainWindow = (): BrowserWindow => {
  if (!mainWindow) {
    throw new Error('메인 윈도우를 찾을 수 없습니다.');
  }

  return mainWindow;
};

const sendWindowMaximizedState = (window: BrowserWindow): void => {
  window.webContents.send(IPC_CHANNELS.windowMaximizedChanged, window.isMaximized());
};

const pruneShownLectureReminderIds = (nowMs = Date.now()): void => {
  shownLectureReminderIds.forEach((shownAt, reminderId) => {
    if (nowMs - shownAt > REMINDER_HISTORY_RETENTION_MS) {
      shownLectureReminderIds.delete(reminderId);
    }
  });
};

const clearReminderPopupTimer = (): void => {
  if (reminderPopupTimer !== null) {
    clearTimeout(reminderPopupTimer);
    reminderPopupTimer = null;
  }
};

const hideReminderPopupWindow = (): void => {
  clearReminderPopupTimer();

  if (reminderPopupWindow && !reminderPopupWindow.isDestroyed()) {
    reminderPopupWindow.hide();
  }
};

const destroyReminderPopupWindow = (): void => {
  clearReminderPopupTimer();

  if (reminderPopupWindow && !reminderPopupWindow.isDestroyed()) {
    reminderPopupWindow.destroy();
  }

  reminderPopupWindow = null;
};

const ensureReminderPopupWindow = (): BrowserWindow => {
  if (reminderPopupWindow && !reminderPopupWindow.isDestroyed()) {
    return reminderPopupWindow;
  }

  reminderPopupWindow = new BrowserWindow({
    width: REMINDER_POPUP_WIDTH,
    height: REMINDER_POPUP_MIN_HEIGHT,
    show: false,
    frame: false,
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: true,
    transparent: true,
    backgroundColor: '#00000000',
    autoHideMenuBar: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
      backgroundThrottling: false,
      sandbox: true,
    },
  });

  reminderPopupWindow.setAlwaysOnTop(true, 'screen-saver');
  reminderPopupWindow.setVisibleOnAllWorkspaces(true);
  reminderPopupWindow.on('closed', () => {
    clearReminderPopupTimer();
    reminderPopupWindow = null;
  });

  return reminderPopupWindow;
};

const getReminderPopupWorkArea = () => {
  const targetBounds =
    mainWindow && !mainWindow.isDestroyed() ? mainWindow.getBounds() : screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds;
  return screen.getDisplayMatching(targetBounds).workArea;
};

const positionReminderPopupWindow = (window: BrowserWindow, width = REMINDER_POPUP_WIDTH, height = REMINDER_POPUP_MIN_HEIGHT): void => {
  const workArea = getReminderPopupWorkArea();

  window.setBounds({
    x: Math.round(workArea.x + workArea.width - width - REMINDER_POPUP_MARGIN),
    y: Math.round(workArea.y + REMINDER_POPUP_MARGIN),
    width,
    height,
  });
};

const measureReminderPopupHeight = async (window: BrowserWindow): Promise<number> => {
  try {
    const measuredHeight = await window.webContents.executeJavaScript(`
      (() => {
        const root = document.documentElement;
        const body = document.body;
        return Math.ceil(
          Math.max(
            root?.scrollHeight ?? 0,
            body?.scrollHeight ?? 0,
            root?.offsetHeight ?? 0,
            body?.offsetHeight ?? 0,
            body?.getBoundingClientRect().height ?? 0
          )
        );
      })();
    `);
    const nextHeight = Number(measuredHeight);

    return Number.isFinite(nextHeight) ? nextHeight : REMINDER_POPUP_MIN_HEIGHT;
  } catch {
    return REMINDER_POPUP_MIN_HEIGHT;
  }
};

const showReminderPopupWindow = async (payload: NativeLectureReminderPayload): Promise<void> => {
  const popup = ensureReminderPopupWindow();
  positionReminderPopupWindow(popup, REMINDER_POPUP_WIDTH, REMINDER_POPUP_MIN_HEIGHT);
  await popup.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(createReminderPopupMarkup(payload))}`);

  const workArea = getReminderPopupWorkArea();
  const maxHeight = Math.max(REMINDER_POPUP_MIN_HEIGHT, Math.min(REMINDER_POPUP_MAX_HEIGHT, workArea.height - REMINDER_POPUP_MARGIN * 2));
  const measuredHeight = await measureReminderPopupHeight(popup);
  const popupHeight = Math.max(REMINDER_POPUP_MIN_HEIGHT, Math.min(maxHeight, measuredHeight));

  positionReminderPopupWindow(popup, REMINDER_POPUP_WIDTH, popupHeight);
  popup.showInactive();
  popup.moveTop();

  clearReminderPopupTimer();
  reminderPopupTimer = setTimeout(() => {
    reminderPopupTimer = null;
    hideReminderPopupWindow();
  }, REMINDER_POPUP_AUTO_DISMISS_MS);
};

const clearWindowAttention = (): void => {
  if (clearAttentionTimer !== null) {
    clearTimeout(clearAttentionTimer);
    clearAttentionTimer = null;
  }

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.flashFrame(false);
  }
};

const focusMainWindow = (): void => {
  const window = getMainWindow();

  if (window.isMinimized()) {
    window.restore();
  }

  if (!window.isVisible()) {
    window.show();
  }

  window.focus();
  clearWindowAttention();
  hideReminderPopupWindow();
};

const showLectureReminder = async (payload: NativeLectureReminderPayload): Promise<void> => {
  const window = getMainWindow();

  pruneShownLectureReminderIds();
  if (shownLectureReminderIds.has(payload.reminderId)) {
    return;
  }

  shownLectureReminderIds.set(payload.reminderId, Date.now());

  if (!window.isFocused()) {
    window.flashFrame(true);

    if (clearAttentionTimer !== null) {
      clearTimeout(clearAttentionTimer);
    }

    clearAttentionTimer = setTimeout(() => {
      clearAttentionTimer = null;
      if (!window.isDestroyed()) {
        window.flashFrame(false);
      }
    }, 15000);
  }

  shell.beep();

  if (Notification.isSupported()) {
    const notification = new Notification({
      title: payload.title,
      body: payload.body,
      silent: true,
    });

    notification.on('click', () => {
      focusMainWindow();
    });
    notification.show();
  }

  try {
    await showReminderPopupWindow(payload);
  } catch {
    // Best-effort popup only; notification + beep already fired.
  }
};

const registerIpcHandlers = (): void => {
  ipcMain.handle(IPC_CHANNELS.loadData, async () => loadAppData());
  ipcMain.handle(IPC_CHANNELS.saveData, async (_event, payload: AppData) => saveAppData(payload));
  ipcMain.handle(IPC_CHANNELS.exportData, async (_event, payload: AppData) => {
    return exportAppData(getMainWindow(), payload);
  });
  ipcMain.handle(IPC_CHANNELS.exportTimetableJpeg, async (_event, payload: TimetableJpegExportRequest) => {
    return exportTimetableJpeg(getMainWindow(), payload);
  });
  ipcMain.handle(IPC_CHANNELS.importData, async () => {
    return importAppData(getMainWindow());
  });
  ipcMain.handle(IPC_CHANNELS.showLectureReminder, async (_event, payload: NativeLectureReminderPayload) => {
    await showLectureReminder(payload);
  });
  ipcMain.handle(IPC_CHANNELS.minimizeWindow, async () => {
    getMainWindow().minimize();
  });
  ipcMain.handle(IPC_CHANNELS.toggleMaximizeWindow, async () => {
    const window = getMainWindow();

    if (window.isMaximized()) {
      window.unmaximize();
      return;
    }

    window.maximize();
  });
  ipcMain.handle(IPC_CHANNELS.closeWindow, async () => {
    getMainWindow().close();
  });
  ipcMain.handle(IPC_CHANNELS.isWindowMaximized, async () => getMainWindow().isMaximized());
};

const createMainWindow = (): void => {
  mainWindow = new BrowserWindow({
    width: 1540,
    height: 940,
    minWidth: 1220,
    minHeight: 760,
    frame: false,
    hasShadow: false,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#eef3ff',
    icon: process.platform === 'darwin' ? undefined : getAppLogoPath(),
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !app.isPackaged,
      sandbox: false,
    },
  });

  if (process.platform === 'darwin') {
    mainWindow.setWindowButtonVisibility(false);
  }

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });
  mainWindow.webContents.on('did-finish-load', () => {
    if (mainWindow) {
      sendWindowMaximizedState(mainWindow);
    }
  });

  if (!app.isPackaged) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.on('maximize', () => {
    if (mainWindow) {
      sendWindowMaximizedState(mainWindow);
    }
  });
  mainWindow.on('focus', () => {
    clearWindowAttention();
  });
  mainWindow.on('unmaximize', () => {
    if (mainWindow) {
      sendWindowMaximizedState(mainWindow);
    }
  });
  mainWindow.on('closed', () => {
    clearWindowAttention();
    destroyReminderPopupWindow();
    mainWindow = null;
  });
};

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    app.dock.setIcon(getAppLogoPath());
  }

  registerIpcHandlers();
  createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
