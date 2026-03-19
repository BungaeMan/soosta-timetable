import { app, dialog, type BrowserWindow } from 'electron';
import { mkdir, readFile, rename, writeFile, copyFile } from 'node:fs/promises';
import { join } from 'node:path';

import { DATA_FILE_NAME } from '../shared/constants';
import { coerceAppData, createSeedData } from '../shared/data';
import type { AppData, ExportResult, ImportResult, TimetableJpegExportRequest } from '../shared/types';

const ensureDataDirectory = async (): Promise<string> => {
  const directory = app.getPath('userData');
  await mkdir(directory, { recursive: true });
  return directory;
};

const getDataFilePath = async (): Promise<string> => {
  const directory = await ensureDataDirectory();
  return join(directory, DATA_FILE_NAME);
};

const writeJsonFile = async (filePath: string, payload: AppData): Promise<void> => {
  const tempPath = `${filePath}.tmp`;
  await writeFile(tempPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  await rename(tempPath, filePath);
};

const ensureFileExtension = (filePath: string, extensions: readonly string[]): string => {
  const normalizedPath = filePath.toLowerCase();
  if (extensions.some((extension) => normalizedPath.endsWith(`.${extension.toLowerCase()}`))) {
    return filePath;
  }

  return `${filePath}.${extensions[0]}`;
};

export const loadAppData = async (): Promise<AppData> => {
  const filePath = await getDataFilePath();

  try {
    const raw = await readFile(filePath, 'utf8');
    return coerceAppData(JSON.parse(raw));
  } catch (error) {
    const issue = error as NodeJS.ErrnoException;

    if (issue.code && issue.code !== 'ENOENT') {
      const backupPath = `${filePath}.corrupt-${Date.now()}.json`;
      try {
        await copyFile(filePath, backupPath);
      } catch {
        // Ignore backup failures and continue with seed data.
      }
    }

    const seedData = createSeedData();
    await writeJsonFile(filePath, seedData);
    return seedData;
  }
};

export const saveAppData = async (payload: AppData): Promise<AppData> => {
  const filePath = await getDataFilePath();
  const normalized = coerceAppData(payload, true);
  await writeJsonFile(filePath, normalized);
  return normalized;
};

export const exportAppData = async (
  mainWindow: BrowserWindow,
  payload: AppData,
): Promise<ExportResult> => {
  const normalized = coerceAppData(payload, true);
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '시간표 내보내기',
    defaultPath: join(app.getPath('downloads'), `soosta-timetable-${new Date().toISOString().slice(0, 10)}.json`),
    filters: [{ name: 'JSON', extensions: ['json'] }],
  });

  if (canceled || !filePath) {
    return { cancelled: true };
  }

  await writeJsonFile(filePath, normalized);
  return { cancelled: false, filePath };
};

export const exportTimetableJpeg = async (
  mainWindow: BrowserWindow,
  payload: TimetableJpegExportRequest,
): Promise<ExportResult> => {
  const defaultFileName = payload.fileName?.trim() || `soosta-timetable-${new Date().toISOString().slice(0, 10)}.jpg`;
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: '시간표 JPG 저장',
    defaultPath: join(app.getPath('downloads'), defaultFileName),
    filters: [{ name: 'JPG Image', extensions: ['jpg', 'jpeg'] }],
  });

  if (canceled || !filePath) {
    return { cancelled: true };
  }

  const resolvedFilePath = ensureFileExtension(filePath, ['jpg', 'jpeg']);
  const imageBytes = payload.bytes instanceof Uint8Array ? payload.bytes : new Uint8Array(payload.bytes);
  await writeFile(resolvedFilePath, imageBytes);
  return { cancelled: false, filePath: resolvedFilePath };
};

export const importAppData = async (mainWindow: BrowserWindow): Promise<ImportResult> => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: '시간표 가져오기',
    filters: [{ name: 'JSON', extensions: ['json'] }],
    properties: ['openFile'],
  });

  if (canceled || filePaths.length === 0) {
    return { cancelled: true };
  }

  const [filePath] = filePaths;
  const raw = await readFile(filePath, 'utf8');
  const data = coerceAppData(JSON.parse(raw), true);
  await saveAppData(data);

  return {
    cancelled: false,
    filePath,
    data,
  };
};
