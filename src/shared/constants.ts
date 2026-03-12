import type { DayKey } from './types';

export const APP_NAME = 'Soosta Timetable';
export const DATA_VERSION = 2;
export const DATA_FILE_NAME = 'soosta-timetable.json';
export const DAY_ORDER: DayKey[] = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
export const DAY_LABELS: Record<DayKey, { short: string; full: string; english: string }> = {
  MON: { short: '월', full: '월요일', english: 'Monday' },
  TUE: { short: '화', full: '화요일', english: 'Tuesday' },
  WED: { short: '수', full: '수요일', english: 'Wednesday' },
  THU: { short: '목', full: '목요일', english: 'Thursday' },
  FRI: { short: '금', full: '금요일', english: 'Friday' },
  SAT: { short: '토', full: '토요일', english: 'Saturday' },
};
export const COLOR_PALETTE = [
  '#7c72ff',
  '#4cc9f0',
  '#ff7aa2',
  '#ffb84c',
  '#7ddc8b',
  '#d69bff',
  '#5fc7b8',
  '#ff8b5e',
];
export const DEFAULT_GRID_START_MINUTES = 9 * 60;
export const DEFAULT_GRID_END_MINUTES = 22 * 60;
export const MIN_GRID_START_MINUTES = 6 * 60;
export const MAX_GRID_END_MINUTES = 23 * 60 + 30;
export const TIME_STEP_MINUTES = 30;
export const MIN_LECTURE_REMINDER_MINUTES = 1;
export const MAX_LECTURE_REMINDER_MINUTES = 12 * 60;
export const LECTURE_REMINDER_LEAD_MINUTES = [60, 30, 15, 10] as const;
export const IPC_CHANNELS = {
  loadData: 'soosta:load-data',
  saveData: 'soosta:save-data',
  exportData: 'soosta:export-data',
  importData: 'soosta:import-data',
  showLectureReminder: 'soosta:show-lecture-reminder',
  minimizeWindow: 'soosta:minimize-window',
  toggleMaximizeWindow: 'soosta:toggle-maximize-window',
  closeWindow: 'soosta:close-window',
  isWindowMaximized: 'soosta:is-window-maximized',
  windowMaximizedChanged: 'soosta:window-maximized-changed',
} as const;
