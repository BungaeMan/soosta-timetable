import path from 'node:path';

import { app, BrowserWindow, ipcMain, Notification, screen, shell } from 'electron';

import { IPC_CHANNELS } from './shared/constants';
import { exportAppData, importAppData, loadAppData, saveAppData } from './main/persistence';
import { formatLectureReminderLeadMinutes } from './shared/reminders';
import type { AppData, NativeLectureReminderPayload } from './shared/types';

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
const REMINDER_POPUP_WIDTH = 388;
const REMINDER_POPUP_HEIGHT = 208;
const REMINDER_POPUP_MARGIN = 18;
const REMINDER_POPUP_AUTO_DISMISS_MS = 12_000;
const REMINDER_HISTORY_RETENTION_MS = 8 * 24 * 60 * 60 * 1000;
const APP_LOGO_FILE_NAME = 'soosta-logo.png';
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

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

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
    height: REMINDER_POPUP_HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
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
  reminderPopupWindow.setIgnoreMouseEvents(true);
  reminderPopupWindow.on('closed', () => {
    clearReminderPopupTimer();
    reminderPopupWindow = null;
  });

  return reminderPopupWindow;
};

const positionReminderPopupWindow = (window: BrowserWindow): void => {
  const workArea = screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).workArea;

  window.setBounds({
    x: Math.round(workArea.x + workArea.width - REMINDER_POPUP_WIDTH - REMINDER_POPUP_MARGIN),
    y: Math.round(workArea.y + REMINDER_POPUP_MARGIN),
    width: REMINDER_POPUP_WIDTH,
    height: REMINDER_POPUP_HEIGHT,
  });
};

const createReminderPopupMarkup = (payload: NativeLectureReminderPayload): string => {
  const leadLabel = payload.isTest ? '테스트 알림' : `${formatLectureReminderLeadMinutes(payload.leadMinutes)} 전 알림`;
  const startsAtLabel = new Intl.DateTimeFormat('ko-KR', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(payload.startsAt));

  return `
    <!doctype html>
    <html lang="ko">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Lecture reminder</title>
        <style>
          :root {
            color-scheme: dark;
            --accent: #7c72ff;
            --bg: rgba(8, 14, 30, 0.98);
            --bg-soft: rgba(22, 31, 56, 0.96);
            --text: #f8faff;
            --muted: rgba(232, 238, 255, 0.78);
          }

          * {
            box-sizing: border-box;
          }

          html,
          body {
            width: 100%;
            height: 100%;
            margin: 0;
            overflow: hidden;
            background: transparent;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          }

          body {
            padding: 12px;
          }

          .card {
            position: relative;
            height: 100%;
            padding: 18px 18px 16px 22px;
            border-radius: 24px;
            background:
              radial-gradient(circle at top right, rgba(255, 255, 255, 0.18), transparent 34%),
              linear-gradient(160deg, var(--bg), var(--bg-soft));
            color: var(--text);
            border: 1px solid rgba(255, 255, 255, 0.14);
            box-shadow:
              0 24px 44px rgba(6, 10, 21, 0.42),
              inset 0 1px 0 rgba(255, 255, 255, 0.08);
          }

          .card::before {
            content: '';
            position: absolute;
            inset: 0 auto 0 0;
            width: 8px;
            border-radius: 24px 0 0 24px;
            background: linear-gradient(180deg, #9a92ff, var(--accent));
          }

          .eyebrow {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            padding: 6px 10px;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.1);
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.12em;
            text-transform: uppercase;
          }

          .eyebrow::before {
            content: '';
            width: 9px;
            height: 9px;
            border-radius: 999px;
            background: var(--accent);
            box-shadow: 0 0 18px rgba(124, 114, 255, 0.66);
          }

          h1 {
            margin: 14px 0 0;
            font-size: 24px;
            line-height: 1.15;
            letter-spacing: -0.04em;
          }

          .meta,
          .body {
            margin: 10px 0 0;
            color: var(--muted);
            font-size: 13px;
            line-height: 1.6;
          }

          .body {
            margin-top: 14px;
            padding-top: 12px;
            border-top: 1px solid rgba(255, 255, 255, 0.1);
          }
        </style>
      </head>
      <body>
        <main class="card" role="alert" aria-live="assertive">
          <div class="eyebrow">${escapeHtml(leadLabel)}</div>
          <h1>${escapeHtml(payload.courseTitle)}</h1>
          <p class="meta">${escapeHtml(`${startsAtLabel} 시작 · ${payload.location || '장소 미정'}`)}</p>
          <p class="body">${escapeHtml(payload.body)}</p>
        </main>
      </body>
    </html>
  `;
};

const showReminderPopupWindow = async (payload: NativeLectureReminderPayload): Promise<void> => {
  const popup = ensureReminderPopupWindow();
  positionReminderPopupWindow(popup);
  await popup.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(createReminderPopupMarkup(payload))}`);
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
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#eef3ff',
    icon: process.platform === 'darwin' ? undefined : getAppLogoPath(),
    titleBarStyle: 'hidden',
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
