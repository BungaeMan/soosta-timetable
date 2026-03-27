import { DAY_ORDER, LECTURE_REMINDER_LEAD_MINUTES } from '../../shared/constants';
import {
  formatLectureReminderLeadMinutes,
  formatLectureReminderLeadMinutesList,
} from '../../shared/reminders';
import type { DayKey, LectureReminderLeadMinutes } from '../../shared/types';
export type { DayKey, LectureReminderLeadMinutes } from '../../shared/types';
import { sanitizeCourseColor } from '../domain/model';
import {
  getSessionEndTimeOptions,
  getSessionEndTimeOptionsAfterStart,
  getSessionStartTimeOptions,
  splitMeridiemTimeParts,
  type GenericMeridiem,
  type TimeWidgetMenuSegment,
  type TimeWidgetSegment,
} from '../domain/time';
import type { DesktopPlatform } from '../domain/layout';

export type BannerTone = 'success' | 'error' | 'info';
export type BannerVisibility = 'hidden' | 'entering' | 'visible' | 'leaving';
export type InspectorVisibility = 'opening' | 'open' | 'closing' | 'closed';

export interface Banner {
  tone: BannerTone;
  text: string;
}

export interface ActiveLectureReminder {
  reminderId: string;
  leadMinutes: LectureReminderLeadMinutes;
  courseTitle: string;
  location: string;
  startsAt: string;
  body: string;
  isTest?: boolean;
}

export interface SessionContextMenu {
  courseId: string;
  courseTitle: string;
  clientX: number;
  clientY: number;
  accentColor: string;
  scheduleLabel: string;
  locationLabel: string;
}

export type SessionTimeFieldName = 'session-start' | 'session-end';
export type SessionTimeWidgetSegment = TimeWidgetSegment;
export type SessionTimeMenuSegment = TimeWidgetMenuSegment;
export type SessionTimeWidgetCloseReason =
  | 'escape'
  | 'enter'
  | 'minute'
  | 'outside'
  | 'toggle'
  | 'render'
  | 'resize'
  | 'unload';

export interface SessionTimeWidgetState {
  sessionId: string;
  fieldName: SessionTimeFieldName;
  committedValue: string;
  draftValue: string;
  openSegment: SessionTimeMenuSegment | null;
}

export interface PendingSessionTimeTarget {
  sessionId: string;
  fieldName: SessionTimeFieldName;
}

export type SessionBlockDensity = 'spacious' | 'compact' | 'minimal';

export interface SessionBlockLayout {
  density: SessionBlockDensity;
  titleLines: 1 | 2;
  showTime: boolean;
  showLocation: boolean;
  showConflictChip: boolean;
}

export type CourseColorChannel = 'red' | 'green' | 'blue';

export interface FocusSnapshot {
  formId: string;
  fieldName: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  sessionId: string | null;
  rawValue: string | null;
}

export interface ScrollSnapshot {
  selector: string;
  scrollTop: number;
  scrollLeft: number;
}

export interface SessionDragState {
  courseId: string;
  sessionId: string;
  durationMinutes: number;
  offsetY: number;
  pointerId: number;
  originDay: DayKey;
  originStartMinutes: number;
  previewDay: DayKey;
  previewStartMinutes: number;
  previewEndMinutes: number;
  previewLabel: string;
  dragColumns: Array<{
    day: DayKey;
    element: HTMLElement;
    rect: DOMRect;
  }>;
  gridStartMinutes: number;
  gridEndMinutes: number;
}

export interface PendingSessionDrag {
  block: HTMLElement;
  courseId: string;
  sessionId: string;
  day: DayKey;
  startMinutes: number;
  endMinutes: number;
  offsetY: number;
  pointerId: number;
  originClientX: number;
  originClientY: number;
}

export const AUTOSAVE_DELAY_MS = 360;
export const BANNER_EXIT_DURATION_MS = 560;
export const BANNER_AUTO_DISMISS_MS: Record<BannerTone, number> = {
  success: 2600,
  info: 3200,
  error: 4200,
};
export const SCROLLBAR_IDLE_DELAY_MS = 720;
export const SCROLLBAR_ACTIVE_CLASS = 'is-scrollbar-active';
export const SCROLLABLE_SELECTOR = '.app-layout, .timetable-scroll, .course-list-scroll, textarea';
export const SCROLL_SNAPSHOT_SELECTORS = ['.app-layout', '.timetable-scroll'];
export const INSPECTOR_SPRING_DURATION_MS = 760;
export const SESSION_DRAG_START_DISTANCE_PX = 6;
export const CURRENT_TIME_TICK_MS = 60 * 1000;
export const CURRENT_TIME_TICK_BUFFER_MS = 48;
export const FITTED_TIMETABLE_BLOCK_MIN_HEIGHT = 28;
export const DEFAULT_TIMETABLE_BLOCK_MIN_HEIGHT = 44;
export const TIMETABLE_FIT_SYNC_EPSILON = 0.005;
export const REMINDER_SWEEP_INTERVAL_MS = 15 * 1000;
export const REMINDER_SWEEP_LOOKBACK_MS = 90 * 1000;
export const REMINDER_CARD_AUTO_DISMISS_MS = 12 * 1000;

export const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const sanitizeColor = (value: string): string => sanitizeCourseColor(value);
export const prefersReducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
export const isReminderLeadMinutes = (value: number): value is LectureReminderLeadMinutes =>
  LECTURE_REMINDER_LEAD_MINUTES.some((candidate) => candidate === value);
export const formatReminderLeadLabel = (minutes: LectureReminderLeadMinutes): string =>
  `${formatLectureReminderLeadMinutes(minutes)} 전`;
export const formatReminderLeadList = (leadMinutes: readonly LectureReminderLeadMinutes[]): string =>
  formatLectureReminderLeadMinutesList([...leadMinutes]);

export const getBannerMeta = (tone: BannerTone): { label: string; icon: string } => {
  switch (tone) {
    case 'success':
      return { label: '완료', icon: 'check' };
    case 'error':
      return { label: '주의', icon: 'alert' };
    case 'info':
    default:
      return { label: '안내', icon: 'spark' };
  }
};

export const isCompositionTextField = (target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement => {
  if (target instanceof HTMLTextAreaElement) {
    return true;
  }

  if (!(target instanceof HTMLInputElement)) {
    return false;
  }

  return ['text', 'search', 'email', 'url', 'tel', 'password'].includes(target.type);
};

export const SESSION_START_TIME_OPTIONS = getSessionStartTimeOptions();
const SESSION_END_TIME_OPTIONS = getSessionEndTimeOptions();

export const SESSION_TIME_MERIDIEMS: GenericMeridiem[] = ['AM', 'PM'];
export const SESSION_TIME_MERIDIEM_LABELS: Record<GenericMeridiem, string> = {
  AM: '오전',
  PM: '오후',
};
export const SESSION_TIME_SEGMENT_LABELS: Record<SessionTimeWidgetSegment, string> = {
  meridiem: '오전/오후',
  hour: '시',
  minute: '분',
};

export const SESSION_TIME_FIELD_NAMES: SessionTimeFieldName[] = ['session-start', 'session-end'];

export const isSessionTimeFieldName = (value: string | undefined): value is SessionTimeFieldName =>
  value ? SESSION_TIME_FIELD_NAMES.includes(value as SessionTimeFieldName) : false;

export const getSessionTimeOptions = (fieldName: SessionTimeFieldName, pairedValue?: string): string[] => {
  if (fieldName === 'session-end' && pairedValue) {
    return getSessionEndTimeOptionsAfterStart(pairedValue);
  }

  return fieldName === 'session-start' ? SESSION_START_TIME_OPTIONS : SESSION_END_TIME_OPTIONS;
};

export const getPairedSessionTimeFieldName = (fieldName: SessionTimeFieldName): SessionTimeFieldName =>
  fieldName === 'session-start' ? 'session-end' : 'session-start';

export const formatSessionTimeTriggerLabel = (time: string): string => {
  const { meridiem, hour, minute } = splitMeridiemTimeParts(time);
  return `${SESSION_TIME_MERIDIEM_LABELS[meridiem]} ${Number(hour)}:${minute}`;
};

export const getSessionTimeHourOptions = (times: string[], meridiem: GenericMeridiem): string[] =>
  [...new Set(times.filter((time) => splitMeridiemTimeParts(time).meridiem === meridiem).map((time) => splitMeridiemTimeParts(time).hour))];

export const getSessionTimeMinuteOptions = (times: string[], meridiem: GenericMeridiem, hour: string): string[] =>
  [
    ...new Set(
      times
        .map((time) => splitMeridiemTimeParts(time))
        .filter((time) => time.meridiem === meridiem && time.hour === hour)
        .map((time) => time.minute),
    ),
  ];

export const getCurrentWeekday = (now = new Date()): DayKey | null => {
  const jsDay = now.getDay();
  if (jsDay >= 1 && jsDay <= DAY_ORDER.length) {
    return DAY_ORDER[jsDay - 1];
  }

  return null;
};

export const resolveDesktopPlatform = (): DesktopPlatform => {
  const userAgentDataPlatform = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData?.platform;
  const source = [userAgentDataPlatform, navigator.platform, navigator.userAgent].filter(Boolean).join(' ');
  const normalized = source.toLowerCase();

  if (normalized.includes('mac')) {
    return 'darwin';
  }

  if (normalized.includes('win')) {
    return 'win32';
  }

  if (normalized.includes('linux')) {
    return 'linux';
  }

  return 'linux';
};

export const getSessionBlockLayout = (blockHeight: number, widthPercent: number, titleLength: number): SessionBlockLayout => {
  const isVeryShort = blockHeight < 52;
  const isShort = blockHeight < 72;
  const isVeryNarrow = widthPercent < 40;
  const isSpacious = blockHeight >= 112 && widthPercent >= 58 && titleLength <= 28;

  if (isVeryShort || (isShort && isVeryNarrow)) {
    return {
      density: 'minimal',
      titleLines: 1,
      showTime: false,
      showLocation: false,
      showConflictChip: false,
    };
  }

  return {
    density: isSpacious ? 'spacious' : 'compact',
    titleLines: isSpacious ? 2 : 1,
    showTime: true,
    showLocation: blockHeight >= 82 && widthPercent >= 58,
    showConflictChip: isSpacious && blockHeight >= 124 && widthPercent >= 66,
  };
};

export const renderIcon = (name: string): string => {
  const paths: Record<string, string> = {
    spark: '<path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2Z" /><path d="M19.5 16.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z" />',
    plus: '<path d="M12 5v14" /><path d="M5 12h14" />',
    import: '<path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />',
    export: '<path d="M12 21V9" /><path d="m7 14 5-5 5 5" /><path d="M5 3h14" />',
    image: '<rect x="3" y="5" width="18" height="14" rx="2" /><circle cx="9" cy="10" r="1.5" /><path d="m21 16-5.5-5.5L8 18" />',
    board: '<rect x="4" y="5" width="16" height="14" rx="3" /><path d="M8 9h8" /><path d="M8 13h5" />',
    clock: '<circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" />',
    alert: '<path d="M12 4 4.5 18h15L12 4Z" /><path d="M12 10v3" /><path d="M12 16h.01" />',
    trash: '<path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M8 10v7" /><path d="M12 10v7" /><path d="M16 10v7" />',
    copy: '<rect x="9" y="9" width="10" height="10" rx="2" /><path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />',
    check: '<path d="m5 13 4 4L19 7" />',
    edit: '<path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" />',
    'collapse-right': '<path d="m10 7 5 5-5 5" /><path d="M18 5v14" />',
    'chevron-down': '<path d="m6 9 6 6 6-6" />',
    minimize: '<path d="M5 12h14" />',
    maximize: '<rect x="5" y="5" width="14" height="14" rx="2" />',
    restore:
      '<path d="M9 9h10v10H9z" /><path d="M5 5h10v2" /><path d="M5 7v8" /><path d="M7 5h8" />',
    close: '<path d="M6 6 18 18" /><path d="M18 6 6 18" />',
  };

  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? paths.spark}</svg>`;
};
