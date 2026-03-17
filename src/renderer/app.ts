import { APP_NAME, DAY_LABELS, DAY_ORDER, LECTURE_REMINDER_LEAD_MINUTES } from '../shared/constants';
import { generateId } from '../shared/data';
import {
  formatLectureReminderLeadMinutes,
  formatLectureReminderLeadMinutesList,
  getDefaultLectureReminderLeadMinutes,
  parseLectureReminderLeadMinutesInput,
  sortUniqueLectureReminderLeadMinutes,
} from '../shared/reminders';
import type {
  AgendaItem,
  AppData,
  Course,
  CourseSession,
  DayKey,
  LectureReminderLeadMinutes,
  NativeLectureReminderPayload,
  TimetableBoard,
  Unsubscribe,
} from '../shared/types';
import type { DesktopPlatform } from './domain/layout';
import {
  getPlatformControlRail,
  getPlatformControlRailSide,
  getRendererLayout,
  getTimetablePixelsPerMinute,
} from './domain/layout';
import {
  getDueLectureReminderEvents,
  getNextUpcomingSessionOccurrence,
  getReminderSweepStartMs,
} from './domain/reminders';
import {
  createBlankBoard,
  createBlankCourse,
  createBlankSession,
  duplicateBoard,
  normalizeCourseDraft,
  restoreActiveBoardFromPersisted,
  validateCourse,
} from './domain/model';
import {
  getCurrentTimeIndicatorState,
  formatFreeWindow,
  getBoardStats,
  getFreeWindows,
  getGridRange,
  getNextSession,
  getPositionedSessions,
  getSessionDropRejectMessage,
  getTodayAgenda,
  resolveSessionDropAction,
  resolveDraggedSessionPlacement,
  swapBoardSessions,
  updateBoardSessionSchedule,
} from './domain/timetable';
import {
  coerceMeridiemTimeParts,
  coerceTimeToOptions,
  formatDuration,
  getNextSessionTimeMenuSegment,
  type GenericMeridiem,
  getSessionEndTimeOptions,
  getSessionEndTimeOptionsAfterStart,
  getSessionStartTimeOptions,
  minutesToTime,
  resolveSessionTimeMenuSegment,
  splitMeridiemTimeParts,
  type TimeWidgetMenuSegment,
  type TimeWidgetSegment,
  timeToMinutes,
} from './domain/time';

type BannerTone = 'success' | 'error' | 'info';
type BannerVisibility = 'hidden' | 'entering' | 'visible' | 'leaving';
type InspectorVisibility = 'opening' | 'open' | 'closing' | 'closed';

interface Banner {
  tone: BannerTone;
  text: string;
}

interface ActiveLectureReminder {
  reminderId: string;
  leadMinutes: LectureReminderLeadMinutes;
  courseTitle: string;
  location: string;
  startsAt: string;
  body: string;
  isTest?: boolean;
}

interface SessionContextMenu {
  courseId: string;
  courseTitle: string;
  clientX: number;
  clientY: number;
  accentColor: string;
  scheduleLabel: string;
  locationLabel: string;
}

type SessionTimeFieldName = 'session-start' | 'session-end';
type SessionTimeWidgetSegment = TimeWidgetSegment;
type SessionTimeMenuSegment = TimeWidgetMenuSegment;
type SessionTimeWidgetCloseReason = 'escape' | 'enter' | 'minute' | 'outside' | 'toggle' | 'render' | 'resize' | 'unload';

interface SessionTimeWidgetState {
  sessionId: string;
  fieldName: SessionTimeFieldName;
  committedValue: string;
  draftValue: string;
  openSegment: SessionTimeMenuSegment | null;
}

interface PendingSessionTimeTarget {
  sessionId: string;
  fieldName: SessionTimeFieldName;
}

type SessionBlockDensity = 'spacious' | 'compact' | 'minimal';

interface SessionBlockLayout {
  density: SessionBlockDensity;
  titleLines: 1 | 2;
  showTime: boolean;
  showLocation: boolean;
  showConflictChip: boolean;
}

const colorPattern = /^#(?:[0-9a-fA-F]{3}){1,2}$/;
const AUTOSAVE_DELAY_MS = 360;
const BANNER_EXIT_DURATION_MS = 560;
const BANNER_AUTO_DISMISS_MS: Record<BannerTone, number> = {
  success: 2600,
  info: 3200,
  error: 4200,
};
const SCROLLBAR_IDLE_DELAY_MS = 720;
const SCROLLBAR_ACTIVE_CLASS = 'is-scrollbar-active';
const SCROLLABLE_SELECTOR = '.app-layout, .timetable-scroll, .course-list-scroll, textarea';
const SCROLL_SNAPSHOT_SELECTORS = ['.app-layout', '.timetable-scroll'];
const INSPECTOR_SPRING_DURATION_MS = 760;
const SESSION_DRAG_START_DISTANCE_PX = 6;
const CURRENT_TIME_TICK_MS = 60 * 1000;
const CURRENT_TIME_TICK_BUFFER_MS = 48;
const REMINDER_SWEEP_INTERVAL_MS = 15 * 1000;
const REMINDER_SWEEP_LOOKBACK_MS = 90 * 1000;
const REMINDER_CARD_AUTO_DISMISS_MS = 12 * 1000;

interface FocusSnapshot {
  formId: string;
  fieldName: string;
  selectionStart: number | null;
  selectionEnd: number | null;
  sessionId: string | null;
  rawValue: string | null;
}

interface ScrollSnapshot {
  selector: string;
  scrollTop: number;
  scrollLeft: number;
}

interface SessionDragState {
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

interface PendingSessionDrag {
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

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

const sanitizeColor = (value: string): string => (colorPattern.test(value) ? value : '#7c72ff');
const prefersReducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
const isReminderLeadMinutes = (value: number): value is LectureReminderLeadMinutes =>
  LECTURE_REMINDER_LEAD_MINUTES.some((candidate) => candidate === value);
const formatReminderLeadLabel = (minutes: LectureReminderLeadMinutes): string =>
  `${formatLectureReminderLeadMinutes(minutes)} 전`;
const formatReminderLeadList = (leadMinutes: readonly LectureReminderLeadMinutes[]): string =>
  formatLectureReminderLeadMinutesList([...leadMinutes]);
const getBannerMeta = (tone: BannerTone): { label: string; icon: string } => {
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

const isCompositionTextField = (target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement => {
  if (target instanceof HTMLTextAreaElement) {
    return true;
  }

  if (!(target instanceof HTMLInputElement)) {
    return false;
  }

  return ['text', 'search', 'email', 'url', 'tel', 'password'].includes(target.type);
};

const SESSION_START_TIME_OPTIONS = getSessionStartTimeOptions();
const SESSION_END_TIME_OPTIONS = getSessionEndTimeOptions();
const SESSION_TIME_MERIDIEMS: GenericMeridiem[] = ['AM', 'PM'];
const SESSION_TIME_MERIDIEM_LABELS: Record<GenericMeridiem, string> = {
  AM: '오전',
  PM: '오후',
};
const SESSION_TIME_SEGMENT_LABELS: Record<SessionTimeWidgetSegment, string> = {
  meridiem: '오전/오후',
  hour: '시',
  minute: '분',
};
const SESSION_TIME_FIELD_NAMES: SessionTimeFieldName[] = ['session-start', 'session-end'];

const isSessionTimeFieldName = (value: string | undefined): value is SessionTimeFieldName =>
  value ? SESSION_TIME_FIELD_NAMES.includes(value as SessionTimeFieldName) : false;

const getSessionTimeOptions = (fieldName: SessionTimeFieldName, pairedValue?: string): string[] => {
  if (fieldName === 'session-end' && pairedValue) {
    return getSessionEndTimeOptionsAfterStart(pairedValue);
  }

  return fieldName === 'session-start' ? SESSION_START_TIME_OPTIONS : SESSION_END_TIME_OPTIONS;
};

const getPairedSessionTimeFieldName = (fieldName: SessionTimeFieldName): SessionTimeFieldName =>
  fieldName === 'session-start' ? 'session-end' : 'session-start';

const formatSessionTimeTriggerLabel = (time: string): string => {
  const { meridiem, hour, minute } = splitMeridiemTimeParts(time);
  return `${SESSION_TIME_MERIDIEM_LABELS[meridiem]} ${Number(hour)}:${minute}`;
};

const getSessionTimeHourOptions = (times: string[], meridiem: GenericMeridiem): string[] =>
  [...new Set(times.filter((time) => splitMeridiemTimeParts(time).meridiem === meridiem).map((time) => splitMeridiemTimeParts(time).hour))];

const getSessionTimeMinuteOptions = (times: string[], meridiem: GenericMeridiem, hour: string): string[] =>
  [
    ...new Set(
      times
        .map((time) => splitMeridiemTimeParts(time))
        .filter((time) => time.meridiem === meridiem && time.hour === hour)
        .map((time) => time.minute),
    ),
  ];

const getCurrentWeekday = (now = new Date()): DayKey | null => {
  const jsDay = now.getDay();
  if (jsDay >= 1 && jsDay <= 6) {
    return DAY_ORDER[jsDay - 1];
  }

  return null;
};

const resolveDesktopPlatform = (): DesktopPlatform => {
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

const getSessionBlockLayout = (blockHeight: number, widthPercent: number, titleLength: number): SessionBlockLayout => {
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

const renderIcon = (name: string): string => {
  const paths: Record<string, string> = {
    spark: '<path d="M12 2l1.8 5.2L19 9l-5.2 1.8L12 16l-1.8-5.2L5 9l5.2-1.8L12 2Z" /><path d="M19.5 16.5l.9 2.6 2.6.9-2.6.9-.9 2.6-.9-2.6-2.6-.9 2.6-.9.9-2.6Z" />',
    plus: '<path d="M12 5v14" /><path d="M5 12h14" />',
    import: '<path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" />',
    export: '<path d="M12 21V9" /><path d="m7 14 5-5 5 5" /><path d="M5 3h14" />',
    board: '<rect x="4" y="5" width="16" height="14" rx="3" /><path d="M8 9h8" /><path d="M8 13h5" />',
    clock: '<circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" />',
    alert: '<path d="M12 4 4.5 18h15L12 4Z" /><path d="M12 10v3" /><path d="M12 16h.01" />',
    trash: '<path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M8 10v7" /><path d="M12 10v7" /><path d="M16 10v7" />',
    copy: '<rect x="9" y="9" width="10" height="10" rx="2" /><path d="M7 15H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v1" />',
    check: '<path d="m5 13 4 4L19 7" />',
    edit: '<path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />',
    reset: '<path d="M3 12a9 9 0 1 0 3-6.7" /><path d="M3 4v5h5" />',
    'collapse-right': '<path d="m10 7 5 5-5 5" /><path d="M18 5v14" />',
    minimize: '<path d="M5 12h14" />',
    maximize: '<rect x="5" y="5" width="14" height="14" rx="2" />',
    restore:
      '<path d="M9 9h10v10H9z" /><path d="M5 5h10v2" /><path d="M5 7v8" /><path d="M7 5h8" />',
    close: '<path d="M6 6 18 18" /><path d="M18 6 6 18" />',
  };

  return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] ?? paths.spark}</svg>`;
};

class SoostaApp {
  private readonly root: HTMLDivElement;
  private data: AppData | null = null;
  private lastPersistedData: AppData | null = null;
  private selectedCourseId: string | null = null;
  private pendingCourseId: string | null = null;
  private banner: Banner | null = null;
  private bannerVisibility: BannerVisibility = 'hidden';
  private isLoading = true;
  private isSaving = false;
  private hasUnsavedChanges = false;
  private canAutosaveDraft = false;
  private localRevision = 0;
  private lastSavedRevision = 0;
  private saveInFlightRevision: number | null = null;
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private dragState: SessionDragState | null = null;
  private pendingSessionDrag: PendingSessionDrag | null = null;
  private dragMoveFrame: number | null = null;
  private pendingDragPointer: { clientX: number; clientY: number } | null = null;
  private currentDragPointer: { clientX: number; clientY: number } | null = null;
  private viewportWidth = 0;
  private viewportHeight = 0;
  private readonly platform: DesktopPlatform = resolveDesktopPlatform();
  private isWindowMaximized = false;
  private unsubscribeWindowMaximized: Unsubscribe | null = null;
  private resizeFrame: number | null = null;
  private inspectorCloseButtonFrame: number | null = null;
  private bannerAnimationFrame: number | null = null;
  private bannerAutoDismissTimer: ReturnType<typeof setTimeout> | null = null;
  private bannerAutoDismissStartedAt: number | null = null;
  private bannerAutoDismissRemainingMs: number | null = null;
  private bannerCleanupTimer: ReturnType<typeof setTimeout> | null = null;
  private isBannerHovered = false;
  private isBannerFocused = false;
  private composingField: HTMLInputElement | HTMLTextAreaElement | null = null;
  private pendingAutosaveAfterComposition = false;
  private pendingRenderAfterComposition = false;
  private closingInspectorCourse: Course | null = null;
  private closingInspectorIsEditing = false;
  private inspectorVisibility: InspectorVisibility = 'closed';
  private inspectorCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private inspectorOpenFrame: number | null = null;
  private suppressSessionBlockClick = false;
  private suppressSessionBlockClickTimer: ReturnType<typeof setTimeout> | null = null;
  private currentTimeTicker: number | null = null;
  private currentTimeIndicatorSyncFrame: number | null = null;
  private layoutResizeObserver: ResizeObserver | null = null;
  private reminderSweepTimer: ReturnType<typeof setInterval> | null = null;
  private reminderCardTimer: ReturnType<typeof setTimeout> | null = null;
  private lastReminderSweepAt = Date.now();
  private activeLectureReminder: ActiveLectureReminder | null = null;
  private readonly firedLectureReminderIds = new Set<string>();
  private reminderAudioContext: AudioContext | null = null;
  private readonly scrollableBindings = new WeakSet<HTMLElement>();
  private readonly scrollHideTimers = new WeakMap<HTMLElement, number>();
  private sessionContextMenu: SessionContextMenu | null = null;
  private sessionContextAnchor: HTMLElement | null = null;
  private sessionTimeWidget: SessionTimeWidgetState | null = null;
  private pendingSessionTimeFocus: PendingSessionTimeTarget | null = null;
  private pendingSessionTimeOpen: PendingSessionTimeTarget | null = null;

  public constructor(root: HTMLDivElement) {
    this.root = root;
  }

  public async init(): Promise<void> {
    this.viewportWidth = this.getViewportWidth();
    this.viewportHeight = this.getViewportHeight();
    this.renderShell();
    this.bindLayoutResizeObserver();
    this.bindEvents();
    await this.initWindowChromeState();

    try {
      this.data = await window.soosta.loadData();
      this.lastPersistedData = this.data;
      this.ensureSelection();
    } catch (error) {
      this.showBanner({ tone: 'error', text: this.getErrorMessage(error) });
    } finally {
      this.isLoading = false;
      this.renderFrame();
      this.startCurrentTimeTicker();
      this.startReminderSweepLoop();
      this.runReminderSweep();
    }
  }

  private async initWindowChromeState(): Promise<void> {
    try {
      this.isWindowMaximized = await window.soosta.isWindowMaximized();
      this.unsubscribeWindowMaximized = window.soosta.subscribeWindowMaximized((isMaximized) => {
        this.isWindowMaximized = isMaximized;
        this.renderTopbar();
      });
    } catch (_error) {
      this.isWindowMaximized = false;
      this.unsubscribeWindowMaximized = null;
    }
  }

  private bindLayoutResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') {
      return;
    }

    const contentSlot = this.root.querySelector<HTMLElement>('#content-slot');
    if (!contentSlot) {
      return;
    }

    this.layoutResizeObserver?.disconnect();
    this.layoutResizeObserver = new ResizeObserver(() => {
      this.queueCurrentTimeIndicatorSync();
    });
    this.layoutResizeObserver.observe(contentSlot);
  }

  private bindEvents(): void {
    this.root.addEventListener('click', (event) => {
      const target = event.target as HTMLElement;
      if (this.consumeSuppressedSessionBlockClick(target)) {
        return;
      }

      if (this.banner && !target.closest('.banner')) {
        this.dismissBanner();
      }

      if (this.data && this.shouldClearCourseSelectionFromMainPlanClick(target)) {
        if (!this.confirmDiscardInvalidInspectorDraft()) {
          return;
        }
        this.clearCourseSelection();
      }

      if (this.handleSessionTimeWidgetClick(target)) {
        event.preventDefault();
        return;
      }

      const actionElement = target.closest<HTMLElement>('[data-action]');
      if (!actionElement) {
        return;
      }

      const action = actionElement.dataset.action;
      if (!action) {
        return;
      }

      void this.handleAction(action, actionElement);
    });

    const handleFieldMutation = (event: Event) => {
      const target = event.target as HTMLElement | null;
      if (!target) {
        return;
      }

      const form = target.closest<HTMLFormElement>('form');
      if (!form) {
        return;
      }

      if (this.shouldDeferFormMutation(event, target)) {
        return;
      }

      void this.handleFormMutation(form);
    };

    this.root.addEventListener('input', handleFieldMutation);
    this.root.addEventListener('change', handleFieldMutation);
    this.root.addEventListener('compositionstart', (event) => {
      if (!isCompositionTextField(event.target)) {
        return;
      }

      this.composingField = event.target;
      if (this.saveTimer !== null) {
        this.pendingAutosaveAfterComposition = true;
        this.clearAutosaveTimer();
      }
    });
    this.root.addEventListener('compositionend', (event) => {
      if (!isCompositionTextField(event.target)) {
        return;
      }

      if (this.composingField === event.target) {
        this.composingField = null;
      }

      this.resumeDeferredCompositionWork();
    });

    this.root.addEventListener('submit', (event) => {
      event.preventDefault();
      const form = event.target as HTMLFormElement;
      void this.handleSubmit(form);
    });

    this.root.addEventListener('pointerdown', (event) => {
      const target = event.target as HTMLElement;
      if (this.sessionContextMenu && !target.closest('.session-context-menu')) {
        this.closeSessionContextMenu();
      }

      const block = target.closest<HTMLElement>('.session-block');
      if (!block || block.classList.contains('session-drag-preview')) {
        return;
      }

      this.startSessionDrag(event, block);
    });
    this.root.addEventListener('contextmenu', (event) => {
      const target = event.target as HTMLElement;
      if (target.closest('.session-context-menu')) {
        event.preventDefault();
        return;
      }

      const block = target.closest<HTMLElement>('.session-block');
      if (!block || block.classList.contains('session-drag-preview')) {
        if (this.sessionContextMenu && !target.closest('.session-context-menu')) {
          this.closeSessionContextMenu();
        }

        return;
      }

      event.preventDefault();
      this.openSessionContextMenu(block, event.clientX, event.clientY);
    });
    this.root.addEventListener(
      'scroll',
      () => {
        this.closeSessionContextMenu();
        this.queueInspectorCloseButtonPositionSync();
      },
      true,
    );

    window.addEventListener('pointermove', (event) => {
      this.handleSessionDragMove(event);
    });
    window.addEventListener('pointerup', (event) => {
      void this.finishSessionDrag(event);
    });
    window.addEventListener('pointercancel', () => {
      this.resetSessionDrag();
    });
    window.addEventListener('resize', () => {
      if (this.resizeFrame !== null) {
        return;
      }

      this.resizeFrame = window.requestAnimationFrame(() => {
        this.resizeFrame = null;
        this.closeSessionContextMenu();
        this.closeSessionTimeWidget({ reason: 'resize' });
        const nextViewportWidth = this.getViewportWidth();
        const nextViewportHeight = this.getViewportHeight();
        if (nextViewportWidth === this.viewportWidth && nextViewportHeight === this.viewportHeight) {
          return;
        }

        this.viewportWidth = nextViewportWidth;
        this.viewportHeight = nextViewportHeight;
        this.renderFrame(true);
      });
    });
    window.addEventListener('focus', () => {
      this.startCurrentTimeTicker();
      this.runReminderSweep();
    });
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) {
        this.startCurrentTimeTicker();
        this.runReminderSweep();
      }
    });
    window.addEventListener('keydown', (event) => {
      if (this.sessionTimeWidget && event.key === 'Escape') {
        event.preventDefault();
        this.closeSessionTimeWidget({ reason: 'escape' });
        return;
      }

      if (this.sessionTimeWidget && event.key === 'Enter') {
        const activeField = this.getSessionTimeFieldElement(this.sessionTimeWidget.sessionId, this.sessionTimeWidget.fieldName);
        const target = event.target;
        if (
          activeField &&
          target instanceof Node &&
          activeField.contains(target) &&
          (!(target instanceof HTMLElement) ||
            (!target.closest('[data-session-time-select-trigger]') && !target.closest('[data-session-time-option]')))
        ) {
          event.preventDefault();
          this.closeSessionTimeWidget({ reason: 'enter' });
          return;
        }
      }

      if (event.key === 'Escape' && this.sessionContextMenu) {
        this.closeSessionContextMenu();
        return;
      }

      if (this.sessionContextMenu && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
        const items = [...this.root.querySelectorAll<HTMLElement>('.session-context-item')];
        if (items.length > 0) {
          event.preventDefault();
          const activeIndex = items.findIndex((item) => item === document.activeElement);
          const nextIndex =
            event.key === 'ArrowDown'
              ? (activeIndex + 1 + items.length) % items.length
              : (activeIndex - 1 + items.length) % items.length;
          items[nextIndex]?.focus({ preventScroll: true });
        }
        return;
      }

      if (event.key !== 'Escape' || !this.banner) {
        return;
      }

      this.dismissBanner();
    });
    window.addEventListener('beforeunload', () => {
      this.unsubscribeWindowMaximized?.();
      this.unsubscribeWindowMaximized = null;
      if (this.resizeFrame !== null) {
        window.cancelAnimationFrame(this.resizeFrame);
        this.resizeFrame = null;
      }
      this.layoutResizeObserver?.disconnect();
      this.layoutResizeObserver = null;
      this.cancelQueuedCurrentTimeIndicatorSync();
      this.clearBannerTimers();
      this.stopCurrentTimeTicker();
      this.stopReminderSweepLoop();
      this.clearReminderCardTimer();
      this.composingField = null;
      this.pendingAutosaveAfterComposition = false;
      this.pendingRenderAfterComposition = false;
      this.clearSuppressedSessionBlockClick();
      this.cancelInspectorOpenAnimation();
      this.cancelInspectorCloseAnimation();
      this.resetSessionDrag();
      this.closeSessionContextMenu();
      this.closeSessionTimeWidget({ reason: 'unload' });
    });
  }

  private renderShell(): void {
    this.root.className = 'soosta-root';
    this.root.innerHTML = `
      <div class="app-shell">
        <header id="topbar-slot" class="app-topbar"></header>
        <div id="toast-slot" class="toast-layer"></div>
        <div id="session-menu-slot" class="session-context-layer"></div>
        <section class="status-row">
          <div id="sync-slot"></div>
        </section>
        <section class="app-layout">
          <aside id="sidebar-slot" class="layout-column sidebar-column"></aside>
          <main id="content-slot" class="layout-column content-column"></main>
          <aside id="inspector-slot" class="layout-column inspector-column"></aside>
        </section>
      </div>
    `;
    this.syncShellLayoutState(this.inspectorVisibility);
  }

  private render(): void {
    this.renderTopbar();
    this.renderStatus();
    this.renderBannerToast();

    if (this.isLoading || !this.data) {
      this.syncShellLayoutState('open');
      this.query('#sidebar-slot').innerHTML = this.renderLoadingCard('시간표를 준비하고 있어요.');
      this.query('#content-slot').innerHTML = this.renderLoadingCard('주간 레이아웃을 불러오는 중입니다.');
      this.query('#inspector-slot').innerHTML = this.renderLoadingCard('에디터를 정리하고 있어요.');
      this.syncScrollbars();
      this.syncCurrentTimeIndicator();
      this.queueInspectorCloseButtonPositionSync();
      return;
    }

    const inspectorState = this.getInspectorVisualState();
    this.syncShellLayoutState(inspectorState);
    this.query('#sidebar-slot').innerHTML = this.renderSidebar();
    this.query('#content-slot').innerHTML = this.renderContent();
    this.query('#inspector-slot').innerHTML = this.renderInspector(inspectorState);
    this.syncScrollbars();
    this.syncCurrentTimeIndicator();
    this.queueInspectorCloseButtonPositionSync();
  }

  private startCurrentTimeTicker(): void {
    this.stopCurrentTimeTicker();
    this.syncCurrentTimeIndicator();
    this.queueCurrentTimeIndicatorTick();
  }

  private stopCurrentTimeTicker(): void {
    if (this.currentTimeTicker !== null) {
      window.clearTimeout(this.currentTimeTicker);
      this.currentTimeTicker = null;
    }
  }

  private queueCurrentTimeIndicatorSync(): void {
    if (this.currentTimeIndicatorSyncFrame !== null) {
      return;
    }

    this.currentTimeIndicatorSyncFrame = window.requestAnimationFrame(() => {
      this.currentTimeIndicatorSyncFrame = null;
      this.syncCurrentTimeIndicator();
    });
  }

  private cancelQueuedCurrentTimeIndicatorSync(): void {
    if (this.currentTimeIndicatorSyncFrame !== null) {
      window.cancelAnimationFrame(this.currentTimeIndicatorSyncFrame);
      this.currentTimeIndicatorSyncFrame = null;
    }
  }

  private queueCurrentTimeIndicatorTick(now = new Date()): void {
    const elapsedThisMinuteMs = now.getSeconds() * 1000 + now.getMilliseconds();
    const delayUntilNextMinute = Math.max(1000, CURRENT_TIME_TICK_MS - elapsedThisMinuteMs + CURRENT_TIME_TICK_BUFFER_MS);

    this.currentTimeTicker = window.setTimeout(() => {
      this.currentTimeTicker = null;
      this.syncCurrentTimeIndicator();
      this.queueCurrentTimeIndicatorTick();
    }, delayUntilNextMinute);
  }

  private syncCurrentTimeIndicator(now = new Date()): void {
    const dayHeads = [...this.root.querySelectorAll<HTMLElement>('[data-day-head]')];
    const dayColumns = [...this.root.querySelectorAll<HTMLElement>('[data-day-column]')];
    const indicator = this.root.querySelector<HTMLElement>('[data-current-time-indicator]');

    dayHeads.forEach((head) => head.classList.remove('is-current-time-day'));

    if (indicator) {
      indicator.hidden = true;
      indicator.style.removeProperty('top');
      indicator.style.removeProperty('left');
      indicator.style.removeProperty('width');
    }

    if (!this.data) {
      return;
    }

    const board = this.getActiveBoard();
    if (board.courses.length === 0) {
      return;
    }

    const range = getGridRange(board);
    const indicatorState = getCurrentTimeIndicatorState(range, now);
    if (!indicatorState || !indicator) {
      return;
    }

    const dayHead = dayHeads.find((head) => head.dataset.dayHead === indicatorState.day);
    const dayColumn = dayColumns.find((column) => column.dataset.dayColumn === indicatorState.day);
    if (!dayColumn) {
      return;
    }

    const top = Number((indicatorState.offsetMinutes * this.getTimetablePixelsPerMinute()).toFixed(3));
    dayHead?.classList.add('is-current-time-day');
    indicator.hidden = false;
    indicator.style.top = `${top}px`;
    indicator.style.left = `${dayColumn.offsetLeft}px`;
    indicator.style.width = `${dayColumn.offsetWidth}px`;
  }

  private renderTopbar(): void {
    this.syncShellLayoutState();
    const topbarSlot = this.query<HTMLElement>('#topbar-slot');
    const windowControls = this.renderWindowControls();

    topbarSlot.innerHTML = `
      <div class="topbar-title-lane">
        <span class="topbar-brand">
          <span class="topbar-brand-mark" aria-hidden="true"></span>
          <span class="topbar-title">${escapeHtml(APP_NAME)}</span>
        </span>
      </div>
      ${windowControls}
    `;
  }

  private renderStatusActions(): string {
    const disabled = this.isLoading || !this.data ? 'disabled' : '';

    return `
      <div class="status-action-group">
        <button type="button" class="ghost-button status-action-button" data-action="import-data" ${disabled}>
          ${renderIcon('import')}
          <span class="button-label">가져오기</span>
        </button>
        <button type="button" class="ghost-button status-action-button" data-action="export-data" ${disabled}>
          ${renderIcon('export')}
          <span class="button-label">내보내기</span>
        </button>
        <button
          type="button"
          class="primary-button status-action-button status-action-button-primary"
          data-action="new-course"
          ${disabled}
        >
          ${renderIcon('plus')}
          <span class="button-label">새 강의</span>
        </button>
      </div>
    `;
  }

  private renderWindowControls(): string {
    const controlRail = getPlatformControlRail(this.platform);
    const controlOrder =
      controlRail === 'traffic-lights-left'
        ? [
            { action: 'close-window', label: '창 닫기', tone: 'close' },
            { action: 'minimize-window', label: '최소화', tone: 'minimize' },
            { action: 'toggle-maximize-window', label: this.isWindowMaximized ? '복원' : '최대화', tone: 'maximize' },
          ]
        : [
            { action: 'minimize-window', label: '최소화', tone: 'minimize' },
            { action: 'toggle-maximize-window', label: this.isWindowMaximized ? '복원' : '최대화', tone: 'maximize' },
            { action: 'close-window', label: '창 닫기', tone: 'close' },
          ];

    return `
      <div class="topbar-rail topbar-rail-controls">
        <div class="window-controls window-controls-${controlRail}">
          ${controlOrder
            .map(({ action, label, tone }) => {
              const iconName =
                tone === 'minimize' ? 'minimize' : tone === 'maximize' ? (this.isWindowMaximized ? 'restore' : 'maximize') : 'close';

              return `
                <button
                  type="button"
                  class="window-control window-control-${tone}"
                  data-action="${action}"
                  aria-label="${label}"
                  title="${label}"
                >
                  ${renderIcon(iconName)}
                  <span class="sr-only">${label}</span>
                </button>
              `;
            })
            .join('')}
        </div>
      </div>
    `;
  }

  private renderStatus(): void {
    const syncSlot = this.query('#sync-slot');
    const statusActions = this.renderStatusActions();
    this.renderBannerToast();

    const isInvalid = this.hasUnsavedChanges && !this.canAutosaveDraft && !this.isSaving;
    const label = this.isSaving
      ? '자동 저장 중…'
      : isInvalid
        ? '저장 보류 · 입력 확인'
        : this.hasUnsavedChanges
          ? '자동 저장 대기'
          : '로컬 저장 완료';
    const stateClass = this.isSaving ? 'is-saving' : isInvalid ? 'is-invalid' : this.hasUnsavedChanges ? 'is-pending' : 'is-idle';
    syncSlot.innerHTML = `
      <div class="status-action-cluster">
        <div class="sync-chip ${stateClass}">
          ${this.isSaving || this.hasUnsavedChanges ? renderIcon(isInvalid ? 'alert' : 'clock') : renderIcon('check')}
          <span>${label}</span>
        </div>
        ${statusActions}
      </div>
    `;
  }

  private renderBannerToast(): void {
    const toastSlot = this.root.querySelector<HTMLElement>('#toast-slot');
    if (!toastSlot) {
      return;
    }

    const bannerMeta = this.banner ? getBannerMeta(this.banner.tone) : null;

    toastSlot.innerHTML =
      this.banner || this.activeLectureReminder
        ? `
          <div class="toast-stack">
            <div class="toast-column">
              ${this.activeLectureReminder ? this.renderLectureReminderCard(this.activeLectureReminder) : ''}
              ${
                this.banner
                  ? `
                    <div
                      class="banner banner-${this.banner.tone} is-${this.bannerVisibility}"
                      role="${this.banner.tone === 'error' ? 'alert' : 'status'}"
                      aria-live="${this.banner.tone === 'error' ? 'assertive' : 'polite'}"
                    >
                      <div class="banner-icon" aria-hidden="true">${renderIcon(bannerMeta?.icon ?? 'spark')}</div>
                      <div class="banner-copy">
                        <strong class="banner-label">${escapeHtml(bannerMeta?.label ?? '안내')}</strong>
                        <p class="banner-message">${escapeHtml(this.banner.text)}</p>
                      </div>
                    </div>
                  `
                  : ''
              }
            </div>
          </div>
        `
        : '';

    const reminderElement = toastSlot.querySelector<HTMLElement>('.lecture-reminder');
    if (reminderElement) {
      reminderElement.addEventListener('mouseenter', () => {
        this.clearReminderCardTimer();
      });
      reminderElement.addEventListener('mouseleave', () => {
        this.scheduleReminderCardDismiss();
      });
      reminderElement.addEventListener('focusin', () => {
        this.clearReminderCardTimer();
      });
      reminderElement.addEventListener('focusout', (event) => {
        const nextTarget = event.relatedTarget;
        if (nextTarget instanceof Node && reminderElement.contains(nextTarget)) {
          return;
        }

        this.scheduleReminderCardDismiss();
      });
    }

    const bannerElement = toastSlot.querySelector<HTMLElement>('.banner');
    if (!bannerElement) {
      return;
    }

    bannerElement.addEventListener('mouseenter', () => {
      this.isBannerHovered = true;
      this.pauseBannerAutoDismiss();
    });
    bannerElement.addEventListener('mouseleave', () => {
      this.isBannerHovered = false;
      this.resumeBannerAutoDismissIfIdle();
    });
    bannerElement.addEventListener('focusin', () => {
      this.isBannerFocused = true;
      this.pauseBannerAutoDismiss();
    });
    bannerElement.addEventListener('focusout', (event) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && bannerElement.contains(nextTarget)) {
        return;
      }

      this.isBannerFocused = false;
      this.resumeBannerAutoDismissIfIdle();
    });
  }

  private renderLectureReminderCard(reminder: ActiveLectureReminder): string {
    const leadLabel = reminder.isTest ? '테스트 알림' : reminder.leadMinutes === 60 ? '1시간 전 알림' : `${reminder.leadMinutes}분 전 알림`;

    return `
      <section class="lecture-reminder" role="alert" aria-live="assertive">
        <div class="lecture-reminder-icon" aria-hidden="true">${renderIcon('alert')}</div>
        <div class="lecture-reminder-copy">
          <strong class="lecture-reminder-label">${escapeHtml(leadLabel)}</strong>
          <p class="lecture-reminder-title">${escapeHtml(reminder.courseTitle)}</p>
          <p class="lecture-reminder-message">${escapeHtml(reminder.body)}</p>
        </div>
        <button
          type="button"
          class="lecture-reminder-dismiss"
          data-action="dismiss-lecture-reminder"
          aria-label="강의 알림 닫기"
        >
          ${renderIcon('close')}
        </button>
      </section>
    `;
  }

  private startReminderSweepLoop(): void {
    this.stopReminderSweepLoop();
    this.lastReminderSweepAt = Date.now() - REMINDER_SWEEP_LOOKBACK_MS;
    this.reminderSweepTimer = setInterval(() => {
      this.runReminderSweep();
    }, REMINDER_SWEEP_INTERVAL_MS);
  }

  private stopReminderSweepLoop(): void {
    if (this.reminderSweepTimer !== null) {
      clearInterval(this.reminderSweepTimer);
      this.reminderSweepTimer = null;
    }
  }

  private runReminderSweep(): void {
    const completedAt = Date.now();
    const startedAt = getReminderSweepStartMs(this.lastReminderSweepAt, completedAt, REMINDER_SWEEP_LOOKBACK_MS);
    this.lastReminderSweepAt = completedAt;
    const reminderLeadMinutes = this.getLectureReminderLeadMinutes();

    if (!this.data || !this.areLectureRemindersEnabled() || reminderLeadMinutes.length === 0) {
      return;
    }

    const dueEvents = getDueLectureReminderEvents(
      this.getActiveBoard(),
      new Date(startedAt),
      new Date(completedAt),
      reminderLeadMinutes,
    ).filter((event) => !this.firedLectureReminderIds.has(event.reminderId));

    dueEvents.forEach((event) => {
      this.firedLectureReminderIds.add(event.reminderId);
      this.presentLectureReminder(event.nativePayload);
      void window.soosta.showLectureReminder(event.nativePayload).catch((): void => undefined);
    });
  }

  private areLectureRemindersEnabled(): boolean {
    return this.data?.preferences.lectureRemindersEnabled ?? true;
  }

  private getLectureReminderLeadMinutes(): LectureReminderLeadMinutes[] {
    return this.data?.preferences.lectureReminderLeadMinutes ?? getDefaultLectureReminderLeadMinutes();
  }

  private getLectureReminderSummary(): string {
    const leadMinutes = this.getLectureReminderLeadMinutes();
    if (leadMinutes.length === 0) {
      return '선택된 자동 알림 시각이 없어요.';
    }

    return `${formatReminderLeadList(leadMinutes)}에 알려줍니다.`;
  }

  private buildManualLectureReminderPayload(): NativeLectureReminderPayload {
    const nextUpcoming = this.data ? getNextUpcomingSessionOccurrence(this.getActiveBoard(), new Date()) : null;
    const reminderId = `manual-reminder:${Date.now()}`;
    const configuredLeadMinutes = this.getLectureReminderLeadMinutes();
    const configuredLeadText =
      this.areLectureRemindersEnabled() && configuredLeadMinutes.length > 0
        ? formatReminderLeadList(configuredLeadMinutes)
        : this.areLectureRemindersEnabled()
          ? '선택된 시각 없음'
          : '현재 꺼짐';

    if (nextUpcoming) {
      const locationText = nextUpcoming.location ? ` · ${nextUpcoming.location}` : '';

      return {
        reminderId,
        leadMinutes: 10,
        courseTitle: nextUpcoming.title,
        location: nextUpcoming.location,
        startsAt: nextUpcoming.startAt,
        title: `${nextUpcoming.title} · 테스트 알림`,
        body: `테스트 알림입니다. 실제 자동 알림은 ${DAY_LABELS[nextUpcoming.day].full} ${nextUpcoming.start} 시작 기준 ${configuredLeadText}${locationText}.`,
        isTest: true,
      };
    }

    return {
      reminderId,
      leadMinutes: 10,
      courseTitle: '강의 알림 테스트',
      location: '현재 보드 기준',
      startsAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
      title: '강의 알림 테스트',
      body: `팝업, 네이티브 알림, 소리가 정상적으로 보이는지 확인해보세요. 현재 자동 알림 설정: ${configuredLeadText}.`,
      isTest: true,
    };
  }

  private async triggerManualLectureReminder(): Promise<void> {
    const payload = this.buildManualLectureReminderPayload();

    this.presentLectureReminder(payload);

    try {
      await window.soosta.showLectureReminder(payload);
      this.showBanner({ tone: 'success', text: '테스트 알림을 보냈어요. 팝업과 소리를 확인해보세요.' });
    } catch (error) {
      this.showBanner({ tone: 'error', text: `테스트 알림을 보내지 못했어요. ${this.getErrorMessage(error)}` });
    }
  }

  private presentLectureReminder(payload: NativeLectureReminderPayload): void {
    this.activeLectureReminder = {
      reminderId: payload.reminderId,
      leadMinutes: payload.leadMinutes,
      courseTitle: payload.courseTitle,
      location: payload.location,
      startsAt: payload.startsAt,
      body: payload.body,
      isTest: payload.isTest,
    };
    this.playLectureReminderSound();
    this.renderBannerToast();
    this.scheduleReminderCardDismiss();
  }

  private dismissLectureReminder(): void {
    if (!this.activeLectureReminder) {
      return;
    }

    this.activeLectureReminder = null;
    this.clearReminderCardTimer();
    this.renderBannerToast();
  }

  private scheduleReminderCardDismiss(): void {
    if (!this.activeLectureReminder) {
      return;
    }

    this.clearReminderCardTimer();
    this.reminderCardTimer = setTimeout(() => {
      this.reminderCardTimer = null;
      this.dismissLectureReminder();
    }, REMINDER_CARD_AUTO_DISMISS_MS);
  }

  private clearReminderCardTimer(): void {
    if (this.reminderCardTimer !== null) {
      clearTimeout(this.reminderCardTimer);
      this.reminderCardTimer = null;
    }
  }

  private playLectureReminderSound(): void {
    const AudioContextCtor = window.AudioContext;
    if (!AudioContextCtor) {
      return;
    }

    if (!this.reminderAudioContext) {
      this.reminderAudioContext = new AudioContextCtor();
    }

    const context = this.reminderAudioContext;
    const playSequence = (): void => {
      const baseTime = context.currentTime;

      [0, 0.24, 0.48].forEach((offset, index) => {
        const oscillator = context.createOscillator();
        const gain = context.createGain();

        oscillator.type = 'triangle';
        oscillator.frequency.value = index === 2 ? 1046.5 : 880;
        gain.gain.setValueAtTime(0.0001, baseTime + offset);
        gain.gain.exponentialRampToValueAtTime(0.16, baseTime + offset + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, baseTime + offset + 0.18);

        oscillator.connect(gain);
        gain.connect(context.destination);
        oscillator.start(baseTime + offset);
        oscillator.stop(baseTime + offset + 0.18);
      });
    };

    if (context.state === 'suspended') {
      void context.resume().then(playSequence).catch((): void => undefined);
      return;
    }

    playSequence();
  }

  private showBanner(banner: Banner): void {
    const isSameBanner =
      this.banner?.tone === banner.tone &&
      this.banner?.text === banner.text &&
      this.bannerVisibility !== 'leaving';

    if (isSameBanner) {
      this.clearBannerAnimationAndCleanupTimers();
      this.banner = banner;
      this.bannerVisibility = 'visible';
      this.renderBannerToast();
      this.scheduleBannerAutoDismiss();
      return;
    }

    this.clearBannerTimers();
    this.banner = banner;
    this.isBannerHovered = false;
    this.isBannerFocused = false;

    if (prefersReducedMotion()) {
      this.bannerVisibility = 'visible';
      this.renderBannerToast();
      this.scheduleBannerAutoDismiss();
      return;
    }

    this.bannerVisibility = 'entering';
    this.renderBannerToast();
    this.bannerAnimationFrame = window.requestAnimationFrame(() => {
      this.bannerAnimationFrame = null;
      if (!this.banner) {
        return;
      }

      this.bannerVisibility = 'visible';
      this.renderBannerToast();
      this.scheduleBannerAutoDismiss();
    });
  }

  private dismissBanner(immediate = false): void {
    if (!this.banner) {
      return;
    }

    this.clearBannerTimers();

    if (immediate) {
      this.banner = null;
      this.bannerVisibility = 'hidden';
      this.renderBannerToast();
      return;
    }

    if (prefersReducedMotion()) {
      this.banner = null;
      this.bannerVisibility = 'hidden';
      this.renderBannerToast();
      return;
    }

    this.bannerVisibility = 'leaving';
    this.renderBannerToast();
    this.bannerCleanupTimer = setTimeout(() => {
      this.bannerCleanupTimer = null;
      this.banner = null;
      this.bannerVisibility = 'hidden';
      this.renderBannerToast();
    }, BANNER_EXIT_DURATION_MS);
  }

  private clearBannerTimers(): void {
    this.clearBannerAnimationAndCleanupTimers();
    this.clearBannerAutoDismissTimer();

    this.isBannerHovered = false;
    this.isBannerFocused = false;
  }

  private scheduleBannerAutoDismiss(): void {
    if (!this.banner) {
      return;
    }

    const timeoutMs = BANNER_AUTO_DISMISS_MS[this.banner.tone];
    if (timeoutMs <= 0) {
      return;
    }

    this.clearBannerAutoDismissTimer(false);
    this.bannerAutoDismissRemainingMs = timeoutMs;
    this.bannerAutoDismissStartedAt = null;

    if (this.isBannerHovered || this.isBannerFocused) {
      return;
    }

    this.startBannerAutoDismissTimer(timeoutMs);
  }

  private startBannerAutoDismissTimer(timeoutMs: number): void {
    this.clearBannerAutoDismissTimer(false);
    this.bannerAutoDismissRemainingMs = timeoutMs;
    this.bannerAutoDismissStartedAt = Date.now();
    this.bannerAutoDismissTimer = setTimeout(() => {
      this.clearBannerAutoDismissTimer();
      this.dismissBanner();
    }, timeoutMs);
  }

  private clearBannerAutoDismissTimer(resetState = true): void {
    if (this.bannerAutoDismissTimer !== null) {
      clearTimeout(this.bannerAutoDismissTimer);
      this.bannerAutoDismissTimer = null;
    }

    if (resetState) {
      this.bannerAutoDismissStartedAt = null;
      this.bannerAutoDismissRemainingMs = null;
    }
  }

  private clearBannerAnimationAndCleanupTimers(): void {
    if (this.bannerAnimationFrame !== null) {
      window.cancelAnimationFrame(this.bannerAnimationFrame);
      this.bannerAnimationFrame = null;
    }

    if (this.bannerCleanupTimer !== null) {
      clearTimeout(this.bannerCleanupTimer);
      this.bannerCleanupTimer = null;
    }
  }

  private pauseBannerAutoDismiss(): void {
    if (
      this.bannerAutoDismissTimer === null ||
      this.bannerAutoDismissStartedAt === null ||
      this.bannerAutoDismissRemainingMs === null
    ) {
      return;
    }

    const elapsed = Date.now() - this.bannerAutoDismissStartedAt;
    this.bannerAutoDismissRemainingMs = Math.max(0, this.bannerAutoDismissRemainingMs - elapsed);
    this.clearBannerAutoDismissTimer(false);
    this.bannerAutoDismissStartedAt = null;
  }

  private resumeBannerAutoDismissIfIdle(): void {
    if (this.isBannerHovered || this.isBannerFocused || !this.banner) {
      return;
    }

    if (this.bannerAutoDismissRemainingMs === null) {
      return;
    }

    if (this.bannerAutoDismissRemainingMs <= 0) {
      this.dismissBanner();
      return;
    }

    this.startBannerAutoDismissTimer(this.bannerAutoDismissRemainingMs);
  }

  private renderSidebar(): string {
    const data = this.data;
    if (!data) {
      return '';
    }

    const board = this.getActiveBoard();
    const agenda = getTodayAgenda(board);
    const nextSession = getNextSession(board);
    const remindersEnabled = this.areLectureRemindersEnabled();
    const reminderLeadMinutes = this.getLectureReminderLeadMinutes();
    const reminderSummary = this.getLectureReminderSummary();
    const agendaDay = agenda.length > 0 ? agenda[0].day : getCurrentWeekday() ?? nextSession?.day ?? null;
    const freeWindows = getFreeWindows(board, agendaDay);

    return `
      <section class="panel-card board-panel">
        <div class="panel-heading">
          <div>
            <h2>학기 보드</h2>
          </div>
          <button type="button" class="soft-button" data-action="new-board">${renderIcon('plus')}새 시간표</button>
        </div>
        <div class="board-switcher">
          ${data.boards
            .map(
              (item) => `
                <button
                  type="button"
                  class="board-chip ${item.id === board.id ? 'is-active' : ''}"
                  data-action="select-board"
                  data-board-id="${escapeHtml(item.id)}"
                >
                  <span class="board-chip-title">${escapeHtml(item.name)}</span>
                  <span class="board-chip-meta">${escapeHtml(item.semester)}</span>
                </button>
              `,
            )
            .join('')}
        </div>
        <form id="board-form" class="stack-form">
          <label>
            <span>보드 이름</span>
            <input name="board-name" value="${escapeHtml(board.name)}" maxlength="40" placeholder="예: 메인 플랜" />
          </label>
          <label>
            <span>학기</span>
            <input name="board-semester" value="${escapeHtml(board.semester)}" maxlength="40" placeholder="예: 2026 봄학기" />
          </label>
          <label>
            <span>메모</span>
            <textarea name="board-note" rows="3" placeholder="이 시간표의 기준이나 참고 메모를 적어보세요.">${escapeHtml(board.note)}</textarea>
          </label>
          <div class="form-note-row split-row">
            <button type="button" class="ghost-button" data-action="duplicate-board">${renderIcon('copy')}복제</button>
            <button type="button" class="ghost-button danger-button" data-action="delete-board">${renderIcon('trash')}삭제</button>
          </div>
        </form>
      </section>

      <section class="panel-card agenda-panel">
        <div class="panel-heading compact">
          <div>
            <h2>오늘 일정</h2>
          </div>
          <span class="panel-hint">${agendaDay ? escapeHtml(DAY_LABELS[agendaDay].full) : '일요일'}</span>
        </div>
        ${agenda.length > 0 ? `<div class="agenda-list">${agenda.map((item) => this.renderAgendaItem(item)).join('')}</div>` : `<div class="empty-copy">오늘 등록된 강의가 없어요. 여백이 넓은 날이네요.</div>`}
      </section>

      <section class="panel-card insight-panel">
        <div class="panel-heading compact">
          <div>
            <h2>다음 일정</h2>
          </div>
        </div>
        ${nextSession ? this.renderNextSession(nextSession, remindersEnabled, reminderLeadMinutes) : '<div class="empty-copy">등록된 강의가 없어 다음 일정도 아직 비어 있어요.</div>'}
        <div class="subsection-block">
          <h3>강의 알림 설정</h3>
          <p class="empty-copy compact-copy">
            ${
              remindersEnabled
                ? reminderLeadMinutes.length > 0
                  ? `자동 알림이 켜져 있어요. ${reminderSummary}`
                  : '자동 알림은 켜져 있지만 선택된 시각이 없어요. 아래에서 분 단위로 직접 입력하거나 기본 버튼으로 추가해 주세요.'
                : `자동 알림이 꺼져 있어요. 켜면 선택한 시각(${reminderLeadMinutes.length > 0 ? formatReminderLeadList(reminderLeadMinutes) : '없음'})에 다시 알려줍니다.`
            }
          </p>
          <div class="reminder-settings-panel">
            <div class="reminder-settings-group reminder-settings-actions-grid">
              <button
                type="button"
                class="${remindersEnabled ? 'soft-button' : 'ghost-button'} reminder-settings-button"
                data-action="toggle-lecture-reminders"
              >
                ${renderIcon(remindersEnabled ? 'check' : 'alert')}
                ${remindersEnabled ? '알림 끄기' : '알림 켜기'}
              </button>
              <button
                type="button"
                class="ghost-button reminder-settings-button"
                data-action="test-lecture-reminder"
              >
                ${renderIcon('spark')}
                테스트 알림
              </button>
            </div>
            <div class="reminder-settings-group reminder-settings-presets-grid">
              ${LECTURE_REMINDER_LEAD_MINUTES.map(
                (minutes) => `
                  <button
                    type="button"
                    class="${reminderLeadMinutes.includes(minutes) ? 'soft-button' : 'ghost-button'} reminder-settings-button"
                    data-action="toggle-lecture-reminder-lead"
                    data-lead-minutes="${minutes}"
                  >
                    ${renderIcon(reminderLeadMinutes.includes(minutes) ? 'check' : 'clock')}
                    ${formatReminderLeadLabel(minutes)}
                  </button>
                `,
              ).join('')}
            </div>
            <form id="reminder-settings-form" class="stack-form reminder-settings-form reminder-settings-group">
              <label>
                <span>직접 입력 (분)</span>
                <input
                  name="lecture-reminder-lead-minutes"
                  value="${escapeHtml(reminderLeadMinutes.join(', '))}"
                  inputmode="numeric"
                  placeholder="예: 90, 45, 10"
                />
              </label>
              <p class="empty-copy compact-copy">쉼표나 공백으로 여러 시각을 입력할 수 있어요. 예: 120 45 10</p>
              <div class="reminder-settings-actions-grid reminder-settings-form-actions">
                <button type="submit" class="soft-button reminder-settings-button">
                  ${renderIcon('check')}
                  시각 저장
                </button>
                <button
                  type="button"
                  class="ghost-button reminder-settings-button"
                  data-action="reset-lecture-reminder-times"
                >
                  ${renderIcon('clock')}
                  기본값 복원
                </button>
              </div>
            </form>
          </div>
          <p class="empty-copy compact-copy reminder-settings-footnote">테스트 버튼은 설정과 관계없이 팝업·네이티브 알림·소리를 1회 바로 띄워줍니다.</p>
        </div>
        <div class="subsection-block">
          <h3>${agendaDay ? `${escapeHtml(DAY_LABELS[agendaDay].full)} 빈 시간` : '이번 주 빈 시간'}</h3>
          ${freeWindows.length > 0 ? `<ul class="free-window-list">${freeWindows.map((window) => `<li>${escapeHtml(formatFreeWindow(window))}</li>`).join('')}</ul>` : '<div class="empty-copy compact-copy">30분 이상 비는 시간이 없어요.</div>'}
        </div>
      </section>
    `;
  }

  private renderContent(): string {
    const board = this.getActiveBoard();
    const stats = getBoardStats(board);
    const range = getGridRange(board);
    const positioned = getPositionedSessions(board);
    const pixelsPerMinute = this.getTimetablePixelsPerMinute();
    const height = (range.endMinutes - range.startMinutes) * pixelsPerMinute;
    const hours: number[] = [];
    for (let minutes = range.startMinutes; minutes <= range.endMinutes; minutes += 60) {
      hours.push(minutes);
    }

    return `
      <section class="panel-card hero-panel">
        <div class="panel-heading hero-heading">
          <div>
            <div class="hero-title-row">
              <h2>${escapeHtml(board.name)}</h2>
              <span class="hero-title-meta">${escapeHtml(board.semester)}</span>
            </div>
            ${board.note ? `<p class="hero-copy">${escapeHtml(board.note)}</p>` : ''}
          </div>
        <div class="hero-badges">
            <span class="hero-badge">${board.courses.length} courses</span>
            <span class="hero-badge secondary">${stats.totalCredits}학점</span>
            <span class="hero-badge secondary">${minutesToTime(range.startMinutes)}–${minutesToTime(range.endMinutes)}</span>
          </div>
        </div>
        ${board.courses.length > 0 ? this.renderTimetable(positioned, height, hours, range.startMinutes, pixelsPerMinute) : this.renderEmptyBoard()}
      </section>
    `;
  }

  private renderInspector(visualState: InspectorVisibility): string {
    const isOpen = this.shouldShowInspector();
    if (!isOpen && !this.closingInspectorCourse) {
      return '';
    }

    const board = this.getActiveBoard();
    const existingCourse = isOpen ? this.getSelectedCourse() : null;
    const course = isOpen
      ? existingCourse ??
        {
          ...createBlankCourse(board.courses.length),
          id: this.pendingCourseId ?? generateId('course'),
        }
      : this.closingInspectorCourse;
    const isEditing = isOpen ? Boolean(this.getSelectedCourse()) : this.closingInspectorIsEditing;

    if (!course) {
      return '';
    }

    return this.renderInspectorPanel(course, isEditing, visualState);
  }

  private renderInspectorPanel(course: Course, isEditing: boolean, visualState: InspectorVisibility): string {
    const weeklyMinutes = course.sessions.reduce(
      (sum, session) => sum + (timeToMinutes(session.end) - timeToMinutes(session.start)),
      0,
    );
    const isClosing = visualState === 'closing';
    const panelClassNames = ['panel-card', 'inspector-panel'];
    if (visualState === 'opening') {
      panelClassNames.push('is-opening');
    }
    if (isClosing) {
      panelClassNames.push('is-closing');
    }

    return `
      <section class="${panelClassNames.join(' ')}" data-visual-state="${visualState}" ${isClosing ? 'aria-hidden="true"' : ''}>
        <div class="panel-heading">
          <div>
            <h2>${isEditing ? escapeHtml(course.title || '강의 수정') : '새 강의 만들기'}</h2>
            <p class="hero-copy">${isEditing ? '선택된 강의를 다듬고 즉시 반영하세요.' : '한 과목씩 더 묵직하게 쌓아 올리는 방식으로 설계했어요.'}</p>
          </div>
          <div class="inspector-meta">
            <span>${course.sessions.length}회</span>
            <span>${escapeHtml(formatDuration(weeklyMinutes))}</span>
          </div>
        </div>
        <form id="course-form" class="stack-form" data-mode="${isEditing ? 'edit' : 'create'}">
          <input type="hidden" name="course-id" value="${escapeHtml(course.id)}" />
          <input type="hidden" name="location" value="${escapeHtml(course.location)}" />
          <label>
            <span>강의명</span>
            <input name="title" value="${escapeHtml(course.title)}" maxlength="60" placeholder="예: 인터랙션디자인" required />
          </label>
          <div class="split-fields">
            <label>
              <span>과목 코드</span>
              <input name="code" value="${escapeHtml(course.code)}" maxlength="24" placeholder="예: DES304" />
            </label>
            <label>
              <span>학점</span>
              <input name="credits" type="number" min="0" max="9" step="1" value="${course.credits ?? ''}" placeholder="3" />
            </label>
          </div>
          <div class="split-fields">
            <label>
              <span>교수명</span>
              <input name="instructor" value="${escapeHtml(course.instructor)}" maxlength="32" placeholder="예: 정민서" />
            </label>
          </div>
          <label>
            <span>포인트 컬러</span>
            <div class="color-field">
              <input name="color" type="color" value="${sanitizeColor(course.color)}" />
              <span>타임블록과 카드 포인트 컬러로 사용됩니다.</span>
            </div>
          </label>
          <label>
            <span>메모</span>
            <textarea name="memo" rows="3" placeholder="과제, 발표, 수업 분위기 같은 메모를 남겨보세요.">${escapeHtml(course.memo)}</textarea>
          </label>
          <div class="session-editor-head">
            <div>
              <h3>주간 수업 시간</h3>
              <p>한 과목이 여러 요일에 열리면 수업 시간을 추가해 주세요.</p>
            </div>
            <button type="button" class="soft-button" data-action="add-session">${renderIcon('plus')}수업 시간 추가</button>
          </div>
          <div id="session-list" class="session-list">
            ${course.sessions.map((session, index) => this.renderSessionRow(session, index)).join('')}
          </div>
          <div class="form-note-row stack-actions">
            <button type="button" class="ghost-button" data-action="new-course">${renderIcon('reset')}초기화</button>
            ${isEditing ? `<button type="button" class="ghost-button danger-button" data-action="delete-course" data-course-id="${escapeHtml(course.id)}">${renderIcon('trash')}이 강의 삭제</button>` : ''}
          </div>
        </form>
        <button
          type="button"
          class="inspector-close-button"
          data-action="close-inspector"
          aria-label="${isEditing ? '강의 에디터 닫기' : '새 강의 폼 닫기'}"
          title="${isEditing ? '에디터 닫기' : '폼 닫기'}"
        >
          ${renderIcon('collapse-right')}
        </button>
      </section>
    `;
  }

  private renderSessionRow(session: CourseSession, index: number): string {
    const resolvedStartValue = coerceTimeToOptions(session.start, SESSION_START_TIME_OPTIONS);
    const resolvedEndValue = coerceTimeToOptions(session.end, getSessionEndTimeOptionsAfterStart(resolvedStartValue));

    return `
      <div class="session-row" data-session-id="${escapeHtml(session.id)}">
        <div class="session-row-header">
          <strong>수업 시간 ${index + 1}</strong>
          <button type="button" class="icon-button danger-inline" data-action="remove-session" aria-label="수업 시간 삭제">×</button>
        </div>
        <div class="session-grid">
          <label>
            <span>요일</span>
            <select name="session-day">
              ${DAY_ORDER.map(
                (day) => `<option value="${day}" ${day === session.day ? 'selected' : ''}>${escapeHtml(DAY_LABELS[day].full)}</option>`,
              ).join('')}
            </select>
          </label>
          <label>
            <span>장소</span>
            <input name="session-location" value="${escapeHtml(session.location)}" maxlength="32" placeholder="세션별 장소" />
          </label>
          <div class="form-field">
            <span>시작</span>
            ${this.renderSessionTimeInput(session.id, 'session-start', resolvedStartValue, resolvedEndValue)}
          </div>
          <div class="form-field">
            <span>종료</span>
            ${this.renderSessionTimeInput(session.id, 'session-end', resolvedEndValue, resolvedStartValue)}
          </div>
        </div>
      </div>
    `;
  }

  private renderSessionTimeInput(sessionId: string, name: SessionTimeFieldName, value: string, pairedValue?: string): string {
    const timeOptions = getSessionTimeOptions(name, pairedValue);
    const resolvedValue = timeOptions.includes(value) ? value : coerceTimeToOptions(value, timeOptions);
    const label = name === 'session-start' ? '시작 시간' : '종료 시간';
    const triggerValue = formatSessionTimeTriggerLabel(resolvedValue);

    return `
      <div
        class="session-time-field"
        data-session-id="${escapeHtml(sessionId)}"
        data-session-time-field="${name}"
        data-session-time-label="${label}"
        data-open="false"
      >
        <input
          type="hidden"
          name="${name}"
          class="session-time-hidden-input"
          value="${escapeHtml(resolvedValue)}"
          required
        />
        <button
          type="button"
          class="session-time-trigger"
          data-session-time-trigger
          data-session-id="${escapeHtml(sessionId)}"
          data-session-time-field="${name}"
          data-open="false"
          aria-haspopup="dialog"
          aria-expanded="false"
          aria-label="${escapeHtml(`${label} ${triggerValue}`)}"
        >
          <span class="session-time-trigger-label">
            <span class="session-time-trigger-value">${escapeHtml(triggerValue)}</span>
            <span class="session-time-trigger-meta">${escapeHtml(label)} 선택</span>
          </span>
          <span class="session-time-trigger-icon" aria-hidden="true">${renderIcon('clock')}</span>
        </button>
        <div class="session-time-popover-slot"></div>
      </div>
    `;
  }

  private renderSessionTimeOptionButtons(
    segment: SessionTimeWidgetSegment,
    values: string[],
    selectedValue: string,
    formatter: (value: string) => string,
  ): string {
    return values
      .map(
        (value) => `
          <button
            type="button"
            class="session-time-option"
            data-role="option"
            data-session-time-option="${segment}"
            data-session-time-value="${escapeHtml(value)}"
            data-selected="${value === selectedValue ? 'true' : 'false'}"
            aria-pressed="${value === selectedValue ? 'true' : 'false'}"
          >
            ${escapeHtml(formatter(value))}
          </button>
        `,
      )
      .join('');
  }

  private renderSessionTimeSelectTrigger(
    segment: SessionTimeMenuSegment,
    selectedLabel: string,
    isOpen: boolean,
  ): string {
    return `
      <div class="session-time-select" data-session-time-select="${segment}" data-open="${isOpen ? 'true' : 'false'}">
        <span class="session-time-group-label">${SESSION_TIME_SEGMENT_LABELS[segment]}</span>
        <button
          type="button"
          class="session-time-select-trigger"
          data-session-time-select-trigger="${segment}"
          data-open="${isOpen ? 'true' : 'false'}"
          aria-haspopup="listbox"
          aria-expanded="${isOpen ? 'true' : 'false'}"
          aria-label="${escapeHtml(`${SESSION_TIME_SEGMENT_LABELS[segment]} ${selectedLabel}`)}"
        >
          <span class="session-time-select-value">${escapeHtml(selectedLabel)}</span>
          <span class="session-time-select-caret" aria-hidden="true">▾</span>
        </button>
      </div>
    `;
  }

  private renderSessionTimeMeridiemButtons(selectedValue: GenericMeridiem, values: GenericMeridiem[]): string {
    return `
      <div class="session-time-meridiem">
        <span class="session-time-group-label">${SESSION_TIME_SEGMENT_LABELS.meridiem}</span>
        <div class="session-time-meridiem-options" role="group" aria-label="${escapeHtml(SESSION_TIME_SEGMENT_LABELS.meridiem)}">
          ${this.renderSessionTimeOptionButtons('meridiem', values, selectedValue, (value) => SESSION_TIME_MERIDIEM_LABELS[value as GenericMeridiem])}
        </div>
      </div>
    `;
  }

  private renderSessionTimePopoverMarkup(
    fieldName: SessionTimeFieldName,
    draftValue: string,
    openSegment: SessionTimeMenuSegment | null,
    pairedValue?: string,
  ): string {
    const timeOptions = getSessionTimeOptions(fieldName, pairedValue);
    const { meridiem, hour, minute } = splitMeridiemTimeParts(draftValue);
    const meridiemOptions = SESSION_TIME_MERIDIEMS.filter((value) => getSessionTimeHourOptions(timeOptions, value).length > 0);
    const hourOptions = getSessionTimeHourOptions(timeOptions, meridiem);
    const minuteOptions = getSessionTimeMinuteOptions(timeOptions, meridiem, hour);
    const activeSegment = resolveSessionTimeMenuSegment(openSegment);
    const label = fieldName === 'session-start' ? '시작 시간' : '종료 시간';
    const optionSet =
      activeSegment === 'hour'
        ? {
            values: hourOptions,
            selectedValue: hour,
            formatter: (value: string) => `${Number(value)}시`,
          }
        : {
            values: minuteOptions,
            selectedValue: minute,
            formatter: (value: string) => `${value}분`,
          };

    return `
      <div
        class="session-time-popover is-open"
        data-open="true"
        role="dialog"
        aria-label="${escapeHtml(label)} 선택"
      >
        ${this.renderSessionTimeMeridiemButtons(meridiem, meridiemOptions)}
        <div class="session-time-select-row">
          ${this.renderSessionTimeSelectTrigger('hour', `${Number(hour)}시`, activeSegment === 'hour')}
          ${this.renderSessionTimeSelectTrigger('minute', `${minute}분`, activeSegment === 'minute')}
        </div>
        <div class="session-time-select-menu" data-session-time-menu="${activeSegment}">
          <div class="session-time-select-menu-head">
            <span class="session-time-select-menu-title">${SESSION_TIME_SEGMENT_LABELS[activeSegment]}</span>
            <span class="session-time-select-menu-hint">${
              activeSegment === 'minute' ? '바깥 클릭 또는 Enter로 적용' : '선택 후 다음 단계로 이동'
            }</span>
          </div>
          <div class="session-time-select-options" data-segment="${activeSegment}" role="listbox" aria-label="${escapeHtml(SESSION_TIME_SEGMENT_LABELS[activeSegment])}">
            ${this.renderSessionTimeOptionButtons(activeSegment, optionSet.values, optionSet.selectedValue, optionSet.formatter)}
          </div>
        </div>
      </div>
    `;
  }

  private getSessionTimeFieldElement(sessionId: string, fieldName: SessionTimeFieldName): HTMLElement | null {
    return this.root.querySelector<HTMLElement>(
      `.session-time-field[data-session-id="${sessionId}"][data-session-time-field="${fieldName}"]`,
    );
  }

  private getSessionTimeFieldValue(sessionId: string, fieldName: SessionTimeFieldName): string | null {
    return (
      this.getSessionTimeFieldElement(sessionId, fieldName)?.querySelector<HTMLInputElement>('.session-time-hidden-input')?.value ??
      null
    );
  }

  private getSessionTimeOptionsForField(sessionId: string, fieldName: SessionTimeFieldName): string[] {
    return getSessionTimeOptions(
      fieldName,
      this.getSessionTimeFieldValue(sessionId, getPairedSessionTimeFieldName(fieldName)) ?? undefined,
    );
  }

  private getSessionTimeTargetFromElement(element: HTMLElement | null): PendingSessionTimeTarget | null {
    const field = element?.closest<HTMLElement>('.session-time-field');
    const sessionId = field?.dataset.sessionId;
    const fieldName = field?.dataset.sessionTimeField;
    if (!sessionId || !isSessionTimeFieldName(fieldName)) {
      return null;
    }

    return {
      sessionId,
      fieldName,
    };
  }

  private setSessionTimeFieldOpenState(field: HTMLElement, isOpen: boolean): void {
    field.dataset.open = isOpen ? 'true' : 'false';
    const row = field.closest<HTMLElement>('.session-row');
    if (row) {
      row.dataset.sessionTimeOpen = isOpen ? 'true' : 'false';
    }
    const trigger = field.querySelector<HTMLButtonElement>('[data-session-time-trigger]');
    if (trigger) {
      trigger.dataset.open = isOpen ? 'true' : 'false';
      trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
    }
  }

  private updateSessionTimeTriggerLabel(field: HTMLElement | null, value: string): void {
    if (!field) {
      return;
    }

    const trigger = field.querySelector<HTMLButtonElement>('[data-session-time-trigger]');
    const triggerValue = field.querySelector<HTMLElement>('.session-time-trigger-value');
    const label = field.dataset.sessionTimeLabel ?? '시간';
    const formattedValue = formatSessionTimeTriggerLabel(value);

    if (triggerValue) {
      triggerValue.textContent = formattedValue;
    }

    if (trigger) {
      trigger.setAttribute('aria-label', `${label} ${formattedValue}`);
    }
  }

  private restorePendingSessionTimeTriggerFocus(): void {
    if (!this.pendingSessionTimeFocus) {
      return;
    }

    const pending = this.pendingSessionTimeFocus;
    const trigger = this.getSessionTimeFieldElement(pending.sessionId, pending.fieldName)?.querySelector<HTMLButtonElement>(
      '[data-session-time-trigger]',
    );
    if (!trigger) {
      return;
    }

    this.pendingSessionTimeFocus = null;
    trigger.focus({ preventScroll: true });
  }

  private queueSessionTimeTriggerFocus(target: PendingSessionTimeTarget): void {
    this.pendingSessionTimeFocus = target;
    window.requestAnimationFrame(() => {
      this.restorePendingSessionTimeTriggerFocus();
    });
  }

  private resumePendingSessionTimeWidgetOpen(): void {
    if (!this.pendingSessionTimeOpen) {
      return;
    }

    const pending = this.pendingSessionTimeOpen;
    this.pendingSessionTimeOpen = null;
    this.openSessionTimeWidget(pending.sessionId, pending.fieldName);
  }

  private openSessionTimeWidget(sessionId: string, fieldName: SessionTimeFieldName): void {
    const field = this.getSessionTimeFieldElement(sessionId, fieldName);
    const hiddenInput = field?.querySelector<HTMLInputElement>('.session-time-hidden-input');
    const popoverSlot = field?.querySelector<HTMLElement>('.session-time-popover-slot');
    if (!field || !hiddenInput || !popoverSlot) {
      return;
    }

    this.sessionTimeWidget = {
      sessionId,
      fieldName,
      committedValue: hiddenInput.value,
      draftValue: hiddenInput.value,
      openSegment: 'hour',
    };

    this.setSessionTimeFieldOpenState(field, true);
    popoverSlot.innerHTML = this.renderSessionTimePopoverMarkup(
      fieldName,
      hiddenInput.value,
      'hour',
      this.getSessionTimeFieldValue(sessionId, getPairedSessionTimeFieldName(fieldName)) ?? undefined,
    );
  }

  private renderOpenSessionTimeWidget(): void {
    if (!this.sessionTimeWidget) {
      return;
    }

    const field = this.getSessionTimeFieldElement(this.sessionTimeWidget.sessionId, this.sessionTimeWidget.fieldName);
    const popoverSlot = field?.querySelector<HTMLElement>('.session-time-popover-slot');
    if (!field || !popoverSlot) {
      this.sessionTimeWidget = null;
      return;
    }

    this.setSessionTimeFieldOpenState(field, true);
    popoverSlot.innerHTML = this.renderSessionTimePopoverMarkup(
      this.sessionTimeWidget.fieldName,
      this.sessionTimeWidget.draftValue,
      this.sessionTimeWidget.openSegment,
      this.getSessionTimeFieldValue(
        this.sessionTimeWidget.sessionId,
        getPairedSessionTimeFieldName(this.sessionTimeWidget.fieldName),
      ) ?? undefined,
    );
  }

  private updateSessionTimeWidgetDraft(segment: SessionTimeWidgetSegment, value: string): void {
    if (!this.sessionTimeWidget) {
      return;
    }

    const timeOptions = this.getSessionTimeOptionsForField(this.sessionTimeWidget.sessionId, this.sessionTimeWidget.fieldName);
    const nextParts = splitMeridiemTimeParts(this.sessionTimeWidget.draftValue);

    if (segment === 'meridiem') {
      nextParts.meridiem = value as GenericMeridiem;
    } else if (segment === 'hour') {
      nextParts.hour = String(Number(value) || 0).padStart(2, '0');
    } else {
      nextParts.minute = String(Number(value) || 0).padStart(2, '0');
    }

    const coerced = coerceMeridiemTimeParts(nextParts.meridiem, nextParts.hour, nextParts.minute, timeOptions);
    const normalizedHour = String(Number(coerced.hour) || 0).padStart(2, '0');
    const normalizedMinute = String(Number(coerced.minute) || 0).padStart(2, '0');
    const canonicalHour =
      coerced.meridiem === 'AM'
        ? normalizedHour === '12'
          ? '00'
          : normalizedHour
        : normalizedHour === '12'
          ? '12'
          : String(Number(normalizedHour) + 12).padStart(2, '0');

    this.sessionTimeWidget.draftValue = `${canonicalHour}:${normalizedMinute}`;
    this.sessionTimeWidget.openSegment = getNextSessionTimeMenuSegment(segment, this.sessionTimeWidget.openSegment);
    this.renderOpenSessionTimeWidget();
  }

  private syncSessionEndTimeAfterStartChange(sessionId: string, startValue: string): void {
    const endField = this.getSessionTimeFieldElement(sessionId, 'session-end');
    const endHiddenInput = endField?.querySelector<HTMLInputElement>('.session-time-hidden-input');
    if (!endField || !endHiddenInput) {
      return;
    }

    const endOptions = getSessionTimeOptions('session-end', startValue);
    if (endOptions.length === 0) {
      return;
    }

    if (timeToMinutes(endHiddenInput.value) > timeToMinutes(startValue) && endOptions.includes(endHiddenInput.value)) {
      return;
    }

    const nextEndValue = coerceTimeToOptions(endHiddenInput.value, endOptions);
    if (nextEndValue === endHiddenInput.value) {
      return;
    }

    endHiddenInput.value = nextEndValue;
    this.updateSessionTimeTriggerLabel(endField, nextEndValue);
  }

  private toggleSessionTimeWidgetSegment(segment: SessionTimeMenuSegment): void {
    if (!this.sessionTimeWidget) {
      return;
    }

    this.sessionTimeWidget.openSegment = segment;
    this.renderOpenSessionTimeWidget();
  }

  private shouldRestoreSessionTimeTriggerFocus(target: HTMLElement | null): boolean {
    if (!target) {
      return true;
    }

    return !target.closest('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
  }

  private closeSessionTimeWidget(options: {
    reason: SessionTimeWidgetCloseReason;
    outsideTarget?: HTMLElement | null;
  }): void {
    if (!this.sessionTimeWidget) {
      this.resumePendingSessionTimeWidgetOpen();
      return;
    }

    const widget = this.sessionTimeWidget;
    const field = this.getSessionTimeFieldElement(widget.sessionId, widget.fieldName);
    const hiddenInput = field?.querySelector<HTMLInputElement>('.session-time-hidden-input');
    const popoverSlot = field?.querySelector<HTMLElement>('.session-time-popover-slot');
    const hasChanged = widget.draftValue !== widget.committedValue;
    const shouldCommit =
      options.reason === 'enter' ||
      options.reason === 'minute' ||
      ((options.reason === 'outside' || options.reason === 'toggle') && hasChanged);
    const shouldWriteCommittedValue = shouldCommit && hasChanged;
    const shouldRestoreFocus =
      options.reason === 'escape' ||
      options.reason === 'enter' ||
      options.reason === 'minute' ||
      options.reason === 'toggle' ||
      (options.reason === 'outside' && this.shouldRestoreSessionTimeTriggerFocus(options.outsideTarget ?? null));

    this.sessionTimeWidget = null;
    if (popoverSlot) {
      popoverSlot.innerHTML = '';
    }
    if (field) {
      this.setSessionTimeFieldOpenState(field, false);
    }

    if (shouldWriteCommittedValue && hiddenInput) {
      hiddenInput.value = widget.draftValue;
      this.updateSessionTimeTriggerLabel(field, widget.draftValue);

      if (widget.fieldName === 'session-start') {
        this.syncSessionEndTimeAfterStartChange(widget.sessionId, widget.draftValue);
      }
    }

    if (shouldRestoreFocus) {
      this.queueSessionTimeTriggerFocus({
        sessionId: widget.sessionId,
        fieldName: widget.fieldName,
      });
    }

    if (shouldWriteCommittedValue) {
      const form = field?.closest<HTMLFormElement>('form');
      if (form) {
        void this.handleCourseInput(form);
        return;
      }
    }

    if (!['render', 'resize', 'unload'].includes(options.reason)) {
      this.resumePendingSessionTimeWidgetOpen();
    }
  }

  private handleSessionTimeOptionClick(button: HTMLButtonElement): void {
    if (!this.sessionTimeWidget) {
      return;
    }

    const segment = button.dataset.sessionTimeOption as SessionTimeWidgetSegment | undefined;
    const value = button.dataset.sessionTimeValue;
    if (!segment || !value) {
      return;
    }

    this.updateSessionTimeWidgetDraft(segment, value);
  }

  private handleSessionTimeWidgetClick(target: HTMLElement): boolean {
    const activeWidget = this.sessionTimeWidget;
    const activeField = activeWidget ? this.getSessionTimeFieldElement(activeWidget.sessionId, activeWidget.fieldName) : null;
    const trigger = target.closest<HTMLButtonElement>('[data-session-time-trigger]');
    const selectTrigger = target.closest<HTMLButtonElement>('[data-session-time-select-trigger]');
    const option = target.closest<HTMLButtonElement>('[data-session-time-option]');

    if (activeWidget && activeField && !activeField.contains(target)) {
      if (trigger) {
        const pending = this.getSessionTimeTargetFromElement(trigger);
        if (
          pending &&
          (pending.sessionId !== activeWidget.sessionId || pending.fieldName !== activeWidget.fieldName)
        ) {
          this.pendingSessionTimeOpen = pending;
        }
      }

      this.closeSessionTimeWidget({ reason: 'outside', outsideTarget: target });
      if (trigger) {
        return true;
      }
    }

    if (selectTrigger) {
      const segment = selectTrigger.dataset.sessionTimeSelectTrigger as SessionTimeMenuSegment | undefined;
      if (segment) {
        this.toggleSessionTimeWidgetSegment(segment);
        return true;
      }
    }

    if (option) {
      this.handleSessionTimeOptionClick(option);
      return true;
    }

    if (!trigger) {
      return false;
    }

    const sessionTimeTarget = this.getSessionTimeTargetFromElement(trigger);
    if (!sessionTimeTarget) {
      return false;
    }

    if (
      activeWidget &&
      activeWidget.sessionId === sessionTimeTarget.sessionId &&
      activeWidget.fieldName === sessionTimeTarget.fieldName
    ) {
      this.closeSessionTimeWidget({ reason: 'toggle', outsideTarget: trigger });
      return true;
    }

    this.pendingSessionTimeOpen = null;
    this.openSessionTimeWidget(sessionTimeTarget.sessionId, sessionTimeTarget.fieldName);
    return true;
  }

  private renderTimetable(
    positioned: ReturnType<typeof getPositionedSessions>,
    height: number,
    hours: number[],
    startMinutes: number,
    pixelsPerMinute: number,
  ): string {
    const { timetableDensity } = getRendererLayout(
      this.viewportWidth || this.getViewportWidth(),
      this.viewportHeight || this.getViewportHeight(),
    );

    return `
      <div class="timetable-wrap">
        <div class="timetable-scroll">
          <div class="timetable-grid timetable-grid-${timetableDensity}">
            <div class="timetable-head">
              <div class="timetable-corner">Time</div>
              ${DAY_ORDER.map(
                (day) => `
                  <div class="day-head" data-day-head="${day}">
                    <span>${escapeHtml(DAY_LABELS[day].short)}</span>
                    <small>${escapeHtml(DAY_LABELS[day].english)}</small>
                  </div>
                `,
              ).join('')}
            </div>
            <div class="timetable-body">
              <div class="time-axis" style="height:${height}px">
                ${hours
                  .map((hour) => {
                    const top = (hour - startMinutes) * pixelsPerMinute;
                    return `<span style="top:${top}px">${minutesToTime(hour)}</span>`;
                  })
                  .join('')}
              </div>
              <div class="day-columns">
                ${DAY_ORDER.map((day) => {
                  const daySessions = positioned.filter((item) => item.day === day);
                  return `
                    <div class="day-column" data-day-column="${day}" style="height:${height}px">
                      ${hours
                        .map((hour) => {
                          const top = (hour - startMinutes) * pixelsPerMinute;
                          return `<span class="hour-line" style="top:${top}px"></span>`;
                        })
                        .join('')}
                      ${daySessions
                        .map((session) => {
                          const top = (session.startMinutes - startMinutes) * pixelsPerMinute;
                          const blockHeight = Math.max(44, (session.endMinutes - session.startMinutes) * pixelsPerMinute - 8);
                          const blockLayout = getSessionBlockLayout(blockHeight, session.widthPercent, session.courseTitle.length);
                          const width = `calc(${session.widthPercent}% - 10px)`;
                          const left = `calc(${session.leftPercent}% + 6px)`;
                          return `
                            <button
                              type="button"
                              class="session-block ${session.isConflict ? 'is-conflict' : ''} ${session.courseId === this.selectedCourseId ? 'is-selected' : ''}"
                              data-density="${blockLayout.density}"
                              data-title-lines="${blockLayout.titleLines}"
                              data-action="select-course"
                              data-course-id="${escapeHtml(session.courseId)}"
                              data-course-color="${escapeHtml(sanitizeColor(session.courseColor))}"
                              data-course-title="${escapeHtml(session.courseTitle)}"
                              data-session-id="${escapeHtml(session.sessionId)}"
                              data-session-time="${escapeHtml(`${session.start}–${session.end}`)}"
                              data-session-location="${escapeHtml(session.location || session.courseLocation || '장소 미정')}"
                              data-day="${session.day}"
                              data-start-minutes="${session.startMinutes}"
                              data-end-minutes="${session.endMinutes}"
                              style="top:${top + 4}px;height:${blockHeight}px;left:${left};width:${width};--course-color:${sanitizeColor(session.courseColor)}"
                            >
                              <span class="session-block-title">${escapeHtml(session.courseTitle)}</span>
                              ${blockLayout.showTime ? `<span class="session-block-meta session-block-time">${escapeHtml(session.start)}–${escapeHtml(session.end)}</span>` : ''}
                              ${blockLayout.showLocation ? `<span class="session-block-meta session-block-location">${escapeHtml(session.location || session.courseLocation || '장소 미정')}</span>` : ''}
                              ${session.isConflict && blockLayout.showConflictChip ? '<span class="session-conflict-chip">시간 겹침</span>' : ''}
                            </button>
                          `;
                        })
                        .join('')}
                    </div>
                  `;
                }).join('')}
              </div>
              <div class="timetable-current-time-indicator" data-current-time-indicator hidden aria-hidden="true">
                <span class="timetable-current-time-dot"></span>
                <span class="timetable-current-time-line"></span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  private renderEmptyBoard(): string {
    return `
      <div class="empty-stage">
        <div class="empty-orb"></div>
        <div>
          <h3>아직 이 보드에는 수업이 없어요.</h3>
          <p>첫 강의를 추가하면 주간 그리드가 바로 채워집니다.</p>
          <button type="button" class="primary-button" data-action="new-course">${renderIcon('plus')}첫 강의 추가</button>
        </div>
      </div>
    `;
  }

  private renderAgendaItem(item: AgendaItem): string {
    return `
      <button type="button" class="agenda-item ${item.isOngoing ? 'is-live' : ''} ${item.isNext ? 'is-next' : ''}" data-action="select-course" data-course-id="${escapeHtml(item.courseId)}">
        <span class="agenda-swatch" style="--swatch:${sanitizeColor(item.color)}"></span>
        <div>
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.start)}–${escapeHtml(item.end)} · ${escapeHtml(item.location || '장소 미정')}</p>
        </div>
        ${item.isOngoing ? '<span class="agenda-state live">진행 중</span>' : item.isNext ? '<span class="agenda-state">다음 수업</span>' : ''}
      </button>
    `;
  }

  private renderNextSession(
    item: AgendaItem,
    remindersEnabled: boolean,
    reminderLeadMinutes: readonly LectureReminderLeadMinutes[],
  ): string {
    return `
      <div class="next-card">
        <div class="next-card-head">
          <span class="agenda-swatch" style="--swatch:${sanitizeColor(item.color)}"></span>
          <div>
            <strong>${escapeHtml(item.title)}</strong>
            <p>${escapeHtml(DAY_LABELS[item.day].full)} · ${escapeHtml(item.start)}–${escapeHtml(item.end)}</p>
          </div>
        </div>
        <div class="next-card-meta">
          <span>${escapeHtml(item.location || '장소 미정')}</span>
          <span>${escapeHtml(item.instructor || '교수 정보 없음')}</span>
        </div>
        <p class="next-card-reminder">${
          remindersEnabled
            ? reminderLeadMinutes.length > 0
              ? `알림 · ${formatReminderLeadList(reminderLeadMinutes)}`
              : '알림 · 시각 미선택'
            : '알림 · 현재 꺼짐'
        }</p>
      </div>
    `;
  }

  private renderLoadingCard(message: string): string {
    return `
      <section class="panel-card loading-card">
        <div class="loading-dot"></div>
        <p>${escapeHtml(message)}</p>
      </section>
    `;
  }

  private openSessionContextMenu(block: HTMLElement, clientX: number, clientY: number): void {
    const courseId = block.dataset.courseId;
    if (!courseId || !this.data) {
      return;
    }

    const course = this.getActiveBoard().courses.find((item) => item.id === courseId);
    if (!course) {
      return;
    }

    this.sessionContextAnchor?.classList.remove('is-context-target');
    this.sessionContextAnchor = block;
    this.sessionContextAnchor.classList.add('is-context-target');

    this.sessionContextMenu = {
      courseId,
      courseTitle: block.dataset.courseTitle || course.title || '강의 메뉴',
      clientX: clientX + 8,
      clientY: clientY + 8,
      accentColor: sanitizeColor(block.dataset.courseColor || course.color || '#7c72ff'),
      scheduleLabel: block.dataset.sessionTime || '시간 정보 없음',
      locationLabel: block.dataset.sessionLocation || '장소 미정',
    };
    this.renderSessionContextMenu();
  }

  private closeSessionContextMenu(): void {
    const slot = this.root.querySelector<HTMLElement>('#session-menu-slot');
    if (!this.sessionContextMenu && (!slot || !slot.innerHTML)) {
      return;
    }

    this.sessionContextAnchor?.classList.remove('is-context-target');
    this.sessionContextAnchor = null;
    this.sessionContextMenu = null;
    this.renderSessionContextMenu();
  }

  private renderSessionContextMenu(): void {
    const slot = this.root.querySelector<HTMLElement>('#session-menu-slot');
    if (!slot) {
      return;
    }

    if (!this.sessionContextMenu) {
      slot.innerHTML = '';
      return;
    }

    slot.innerHTML = `
      <div
        class="session-context-menu"
        role="menu"
        aria-label="${escapeHtml(this.sessionContextMenu.courseTitle)} 메뉴"
        style="--session-context-accent:${escapeHtml(this.sessionContextMenu.accentColor)};left:${this.sessionContextMenu.clientX}px;top:${this.sessionContextMenu.clientY}px"
      >
        <div class="session-context-header">
          <span class="session-context-swatch" aria-hidden="true"></span>
          <div class="session-context-copy">
            <div class="session-context-title">${escapeHtml(this.sessionContextMenu.courseTitle)}</div>
            <div class="session-context-meta">${escapeHtml(this.sessionContextMenu.scheduleLabel)}</div>
            <div class="session-context-meta secondary">${escapeHtml(this.sessionContextMenu.locationLabel)}</div>
          </div>
        </div>
        <div class="session-context-divider" aria-hidden="true"></div>
        <div
          class="session-context-actions"
          role="none"
        >
          <button
            type="button"
            class="session-context-item"
            data-action="select-course"
            data-course-id="${escapeHtml(this.sessionContextMenu.courseId)}"
            role="menuitem"
          >
            ${renderIcon('edit')}
            <span>편집</span>
          </button>
          <button
            type="button"
            class="session-context-item danger"
            data-action="delete-course-from-menu"
            data-course-id="${escapeHtml(this.sessionContextMenu.courseId)}"
            role="menuitem"
          >
            ${renderIcon('trash')}
            <span>삭제</span>
          </button>
        </div>
      </div>
    `;

    const menu = slot.querySelector<HTMLElement>('.session-context-menu');
    if (!menu) {
      return;
    }

    const rect = menu.getBoundingClientRect();
    const clampedLeft = Math.max(12, Math.min(this.sessionContextMenu.clientX, window.innerWidth - rect.width - 12));
    const clampedTop = Math.max(12, Math.min(this.sessionContextMenu.clientY, window.innerHeight - rect.height - 12));
    menu.style.left = `${clampedLeft}px`;
    menu.style.top = `${clampedTop}px`;
    menu.querySelector<HTMLElement>('.session-context-item')?.focus({ preventScroll: true });
  }

  private async deleteCourse(courseId: string, openBlankForm = true): Promise<void> {
    const course = this.getActiveBoard().courses.find((item) => item.id === courseId);
    if (!course) {
      return;
    }

    const isDeletingSelectedCourse = this.selectedCourseId === courseId;
    const approved = window.confirm(`'${course.title}' 강의를 삭제할까요?`);
    if (!approved) {
      return;
    }

    await this.persist(
      this.withUpdatedBoard((board) => ({
        ...board,
        updatedAt: new Date().toISOString(),
        courses: board.courses.filter((item) => item.id !== courseId),
      })),
      '강의를 삭제했어요.',
      () => {
        if (openBlankForm) {
          this.selectedCourseId = null;
          this.pendingCourseId = generateId('course');
          return;
        }

        if (isDeletingSelectedCourse) {
          this.selectedCourseId = null;
          this.pendingCourseId = null;
        }
      },
    );
  }

  private async handleAction(action: string, element: HTMLElement): Promise<void> {
    this.closeSessionContextMenu();

    switch (action) {
      case 'minimize-window':
        await window.soosta.minimizeWindow();
        return;
      case 'toggle-maximize-window':
        await window.soosta.toggleMaximizeWindow();
        return;
      case 'close-window':
        await window.soosta.closeWindow();
        return;
      default:
        break;
    }

    if (!this.data) {
      return;
    }

    if (
      this.hasUnsavedChanges &&
      !this.canAutosaveDraft &&
      ['select-board', 'new-board', 'duplicate-board', 'delete-board', 'delete-course', 'delete-course-from-menu', 'export-data', 'import-data', 'toggle-lecture-reminders', 'toggle-lecture-reminder-lead', 'reset-lecture-reminder-times'].includes(action)
    ) {
      this.showBanner({ tone: 'error', text: '입력을 먼저 정리해주세요. 저장이 보류된 항목이 있어요.' });
      return;
    }

    switch (action) {
      case 'new-course':
        if (!this.confirmDiscardInvalidInspectorDraft()) {
          return;
        }
        this.selectedCourseId = null;
        this.pendingCourseId = generateId('course');
        this.beginInspectorOpenAnimation();
        this.showBanner({ tone: 'info', text: '강의 입력 폼을 초기화했어요.' });
        this.render();
        return;
      case 'select-course':
        if (!this.confirmDiscardInvalidInspectorDraft()) {
          return;
        }
        this.selectedCourseId = element.dataset.courseId ?? null;
        this.pendingCourseId = null;
        this.beginInspectorOpenAnimation();
        this.dismissBanner();
        this.render();
        return;
      case 'select-board': {
        const boardId = element.dataset.boardId;
        if (!boardId || boardId === this.data.activeBoardId) {
          return;
        }

        await this.persist(
          { ...this.data, activeBoardId: boardId },
          '보드를 전환했어요.',
          () => {
            this.selectedCourseId = null;
            this.pendingCourseId = null;
          },
        );
        return;
      }
      case 'new-board': {
        const newBoard = createBlankBoard(this.data.boards.length);
        await this.persist(
          {
            ...this.data,
            activeBoardId: newBoard.id,
            boards: [newBoard, ...this.data.boards],
          },
          '새 시간표 보드를 만들었어요.',
          () => {
            this.selectedCourseId = null;
            this.pendingCourseId = null;
          },
        );
        return;
      }
      case 'duplicate-board': {
        const duplicated = duplicateBoard(this.getActiveBoard());
        await this.persist(
          {
            ...this.data,
            activeBoardId: duplicated.id,
            boards: [duplicated, ...this.data.boards],
          },
          '현재 보드를 사본으로 복제했어요.',
          () => {
            this.selectedCourseId = null;
            this.pendingCourseId = null;
          },
        );
        return;
      }
      case 'delete-board': {
        if (this.data.boards.length === 1) {
          this.showBanner({ tone: 'error', text: '마지막 보드는 삭제할 수 없어요.' });
          return;
        }

        const approved = window.confirm('현재 시간표 보드를 삭제할까요? 이 작업은 되돌릴 수 없습니다.');
        if (!approved) {
          return;
        }

        const activeBoardId = this.data.activeBoardId;
        const remainingBoards = this.data.boards.filter((board) => board.id !== activeBoardId);
        await this.persist(
          {
            ...this.data,
            activeBoardId: remainingBoards[0].id,
            boards: remainingBoards,
          },
          '보드를 삭제했어요.',
          () => {
            this.selectedCourseId = null;
            this.pendingCourseId = null;
          },
        );
        return;
      }
      case 'delete-course': {
        const courseId = element.dataset.courseId ?? this.selectedCourseId;
        if (!courseId) {
          return;
        }

        await this.deleteCourse(courseId);
        return;
      }
      case 'delete-course-from-menu': {
        const courseId = element.dataset.courseId;
        if (!courseId) {
          return;
        }

        await this.deleteCourse(courseId, false);
        return;
      }
      case 'add-session': {
        const course = this.getEditableCourse();
        const nextCourse = {
          ...course,
          sessions: [...course.sessions, createBlankSession()],
        };
        this.selectedCourseId = nextCourse.id;
        this.pendingCourseId = null;
        this.applyLocalUpdate(
          this.upsertCourse(nextCourse),
          {
            successText: '세션 변경사항을 자동 저장했어요.',
            invalidText: '세션 구성을 확인하면 자동 저장돼요.',
          },
          validateCourse(nextCourse).length === 0,
        );
        return;
      }
      case 'remove-session': {
        const course = this.getSelectedCourse();
        if (!course || course.sessions.length === 1) {
          this.showBanner({ tone: 'error', text: '세션은 최소 하나 이상 필요해요.' });
          return;
        }

        const row = element.closest<HTMLElement>('.session-row');
        const sessionId = row?.dataset.sessionId;
        if (!sessionId) {
          return;
        }

        const nextCourse = {
          ...course,
          sessions: course.sessions.filter((session) => session.id !== sessionId),
        };
        this.applyLocalUpdate(
          this.upsertCourse(nextCourse),
          {
            successText: '세션 변경사항을 자동 저장했어요.',
            invalidText: '세션 구성을 확인하면 자동 저장돼요.',
          },
          validateCourse(nextCourse).length === 0,
        );
        return;
      }
      case 'toggle-lecture-reminders': {
        const nextEnabled = !this.areLectureRemindersEnabled();
        this.lastReminderSweepAt = Date.now();

        await this.persist(
          {
            ...this.data,
            preferences: {
              ...this.data.preferences,
              lectureRemindersEnabled: nextEnabled,
            },
          },
          nextEnabled ? '강의 알림을 켰어요.' : '강의 알림을 껐어요.',
          () => {
            if (!nextEnabled) {
              this.dismissLectureReminder();
            }
          },
        );

        this.lastReminderSweepAt = Date.now();
        if (nextEnabled) {
          this.runReminderSweep();
        }
        return;
      }
      case 'toggle-lecture-reminder-lead': {
        const requestedLeadMinutes = Number(element.dataset.leadMinutes);
        if (!isReminderLeadMinutes(requestedLeadMinutes)) {
          return;
        }

        const currentLeadMinutes = this.getLectureReminderLeadMinutes();
        const nextLeadMinutes = currentLeadMinutes.includes(requestedLeadMinutes)
          ? currentLeadMinutes.filter((minutes) => minutes !== requestedLeadMinutes)
          : sortUniqueLectureReminderLeadMinutes([...currentLeadMinutes, requestedLeadMinutes]);

        this.lastReminderSweepAt = Date.now();
        await this.persist(
          {
            ...this.data,
            preferences: {
              ...this.data.preferences,
              lectureReminderLeadMinutes: nextLeadMinutes,
            },
          },
          nextLeadMinutes.includes(requestedLeadMinutes)
            ? `${formatReminderLeadLabel(requestedLeadMinutes)} 자동 알림을 추가했어요.`
            : `${formatReminderLeadLabel(requestedLeadMinutes)} 자동 알림을 해제했어요.`,
        );
        this.lastReminderSweepAt = Date.now();
        return;
      }
      case 'reset-lecture-reminder-times': {
        const nextLeadMinutes = getDefaultLectureReminderLeadMinutes();

        this.lastReminderSweepAt = Date.now();
        await this.persist(
          {
            ...this.data,
            preferences: {
              ...this.data.preferences,
              lectureReminderLeadMinutes: nextLeadMinutes,
            },
          },
          `알림 시각을 기본값(${formatReminderLeadList(nextLeadMinutes)})으로 되돌렸어요.`,
        );
        this.lastReminderSweepAt = Date.now();
        return;
      }
      case 'test-lecture-reminder':
        await this.triggerManualLectureReminder();
        return;
      case 'export-data': {
        try {
          const result = await window.soosta.exportData(this.data);
          if (!result.cancelled) {
            this.showBanner({ tone: 'success', text: `시간표를 JSON으로 내보냈어요. ${result.filePath ?? ''}`.trim() });
          }
        } catch (error) {
          this.showBanner({ tone: 'error', text: this.getErrorMessage(error) });
        }
        return;
      }
      case 'import-data': {
        try {
          const result = await window.soosta.importData();
          if (!result.cancelled && result.data) {
            this.clearAutosaveTimer();
            this.data = result.data;
            this.lastPersistedData = result.data;
            this.selectedCourseId = null;
            this.pendingCourseId = null;
            this.localRevision += 1;
            this.lastSavedRevision = this.localRevision;
            this.saveInFlightRevision = null;
            this.hasUnsavedChanges = false;
            this.canAutosaveDraft = false;
            this.showBanner({ tone: 'success', text: '백업 파일을 가져와 현재 시간표를 갱신했어요.' });
            this.render();
          }
        } catch (error) {
          this.showBanner({ tone: 'error', text: this.getErrorMessage(error) });
        }
        return;
      }
      case 'dismiss-lecture-reminder': {
        this.dismissLectureReminder();
        return;
      }
      case 'close-inspector':
        await this.handleCloseInspector();
        return;
      default:
        return;
    }
  }

  private async handleSubmit(form: HTMLFormElement): Promise<void> {
    if (form.id === 'board-form') {
      await this.handleBoardInput(form);
      await this.flushAutosave();
      return;
    }

    if (form.id === 'course-form') {
      await this.handleCourseInput(form);
      await this.flushAutosave();
      return;
    }

    if (form.id === 'reminder-settings-form') {
      await this.handleReminderSettingsSubmit(form);
    }
  }

  private async handleBoardInput(form: HTMLFormElement): Promise<void> {
    if (!this.data) {
      return;
    }

    const name = this.readTextField(form, 'board-name');
    const semester = this.readTextField(form, 'board-semester');
    const note = this.readTextField(form, 'board-note');

    this.applyLocalUpdate(
      this.withUpdatedBoard((board) => ({
        ...board,
        name,
        semester,
        note,
        updatedAt: new Date().toISOString(),
      })),
      {
        successText: '보드 변경사항을 자동 저장했어요.',
        invalidText: '보드 이름과 학기를 입력하면 자동 저장돼요.',
      },
      Boolean(name.trim() && semester.trim()),
      true,
    );
  }

  private async handleReminderSettingsSubmit(form: HTMLFormElement): Promise<void> {
    if (!this.data) {
      return;
    }

    if (this.hasUnsavedChanges && !this.canAutosaveDraft) {
      this.showBanner({ tone: 'error', text: '입력을 먼저 정리해주세요. 저장이 보류된 항목이 있어요.' });
      return;
    }

    const { invalidTokens, minutes } = parseLectureReminderLeadMinutesInput(
      this.readTextField(form, 'lecture-reminder-lead-minutes'),
    );

    if (invalidTokens.length > 0) {
      this.showBanner({
        tone: 'error',
        text: `알림 시각은 1~720 사이 분 단위 숫자로 입력해 주세요. 문제 값: ${invalidTokens.join(', ')}`,
      });
      return;
    }

    this.lastReminderSweepAt = Date.now();
    await this.persist(
      {
        ...this.data,
        preferences: {
          ...this.data.preferences,
          lectureReminderLeadMinutes: minutes,
        },
      },
      minutes.length > 0
        ? `알림 시각을 ${formatReminderLeadList(minutes)}로 저장했어요.`
        : '알림 시각을 모두 비웠어요. 자동 알림은 울리지 않아요.',
    );
    this.lastReminderSweepAt = Date.now();
  }

  private async handleCourseInput(form: HTMLFormElement): Promise<void> {
    if (!this.data) {
      return;
    }

    try {
      const draft = this.readCourseForm(form);
      const issues = validateCourse(draft);
      this.selectedCourseId = draft.id;
      this.pendingCourseId = null;

      this.applyLocalUpdate(
        this.upsertCourse(draft),
        {
          successText: '강의 변경사항을 자동 저장했어요.',
          invalidText: issues[0] ? `${issues[0]} 입력을 마치면 자동 저장돼요.` : '입력을 마치면 자동 저장돼요.',
        },
        issues.length === 0,
        true,
      );
    } catch (error) {
      this.showBanner({ tone: 'error', text: this.getErrorMessage(error) });
    }
  }

  private handleFormMutation(form: HTMLFormElement): void {
    if (form.id === 'board-form') {
      void this.handleBoardInput(form);
      return;
    }

    if (form.id === 'course-form') {
      void this.handleCourseInput(form);
    }
  }

  private shouldDeferFormMutation(event: Event, target: HTMLElement): boolean {
    if (target instanceof HTMLInputElement && target.type === 'color' && event.type === 'input') {
      return true;
    }

    if (!isCompositionTextField(target)) {
      return false;
    }

    return this.composingField === target || ('isComposing' in event && Boolean((event as InputEvent).isComposing));
  }

  private applyLocalUpdate(
    nextData: AppData,
    messages: { successText: string; invalidText: string },
    canAutosave: boolean,
    preserveFocus = false,
  ): void {
    this.data = nextData;
    this.ensureSelection();
    this.hasUnsavedChanges = true;
    this.canAutosaveDraft = canAutosave;
    this.localRevision += 1;

    if (canAutosave) {
      if (this.banner?.tone !== 'error') {
        this.dismissBanner();
      }
      this.scheduleAutosave();
    } else {
      if (this.banner?.tone !== 'error') {
        this.showBanner({ tone: 'info', text: messages.invalidText });
      }
      this.clearAutosaveTimer();
    }

    this.renderFrame(preserveFocus);
  }

  private scheduleAutosave(delay = AUTOSAVE_DELAY_MS): void {
    this.clearAutosaveTimer();
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.flushAutosave();
    }, delay);
  }

  private clearAutosaveTimer(): void {
    if (this.saveTimer !== null) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
  }

  private async flushAutosave(): Promise<void> {
    if (!this.data || this.saveInFlightRevision !== null || !this.hasUnsavedChanges || !this.canAutosaveDraft) {
      return;
    }

    if (this.composingField) {
      this.pendingAutosaveAfterComposition = true;
      return;
    }

    const revision = this.localRevision;
    const snapshot = this.data;
    this.saveInFlightRevision = revision;
    this.isSaving = true;
    this.renderStatus();

    try {
      const saved = await window.soosta.saveData(snapshot);
      this.lastSavedRevision = Math.max(this.lastSavedRevision, revision);
      this.lastPersistedData = saved;

      if (revision === this.localRevision) {
        this.data = saved;
        this.ensureSelection();
        this.hasUnsavedChanges = false;
        this.canAutosaveDraft = false;
        if (this.banner?.tone !== 'error') {
          this.dismissBanner();
        }
        if (this.composingField) {
          this.pendingRenderAfterComposition = true;
        } else {
          this.renderFrame(true);
        }
      }
    } catch (error) {
      this.showBanner({ tone: 'error', text: this.getErrorMessage(error) });
    } finally {
      if (this.saveInFlightRevision === revision) {
        this.saveInFlightRevision = null;
      }

      this.isSaving = false;

      if (this.lastSavedRevision < this.localRevision && this.canAutosaveDraft) {
        if (this.composingField) {
          this.pendingAutosaveAfterComposition = true;
        } else {
          this.scheduleAutosave(140);
        }
      } else {
        this.renderStatus();
      }
    }
  }

  private resumeDeferredCompositionWork(): void {
    window.requestAnimationFrame(() => {
      if (this.composingField) {
        return;
      }

      if (this.pendingRenderAfterComposition) {
        this.pendingRenderAfterComposition = false;
        this.renderFrame(true);
      }

      if (this.pendingAutosaveAfterComposition || (this.hasUnsavedChanges && this.canAutosaveDraft && this.saveInFlightRevision === null)) {
        this.pendingAutosaveAfterComposition = false;
        this.scheduleAutosave(40);
      }
    });
  }

  private readCourseForm(form: HTMLFormElement): Course {
    const id = this.readTextField(form, 'course-id') || generateId('course');
    const sessions = [...form.querySelectorAll<HTMLElement>('.session-row')].map((row) => ({
      id: row.dataset.sessionId ?? generateId('session'),
      day: this.readRowField(row, 'session-day') as DayKey,
      start: this.readRowField(row, 'session-start'),
      end: this.readRowField(row, 'session-end'),
      location: this.readRowField(row, 'session-location'),
    }));

    const creditsRaw = this.readTextField(form, 'credits');
    const credits = creditsRaw ? Number(creditsRaw) : null;

    return normalizeCourseDraft({
      id,
      title: this.readTextField(form, 'title'),
      code: this.readTextField(form, 'code'),
      instructor: this.readTextField(form, 'instructor'),
      location: this.readTextField(form, 'location'),
      credits: credits !== null && Number.isFinite(credits) ? credits : null,
      memo: this.readTextField(form, 'memo'),
      color: this.readTextField(form, 'color') || '#7c72ff',
      sessions,
    });
  }

  private readTextField(form: ParentNode, name: string): string {
    const element = form.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(`[name="${name}"]`);
    return element?.value ?? '';
  }

  private readRowField(row: ParentNode, name: string): string {
    const element = row.querySelector<HTMLInputElement | HTMLSelectElement>(`[name="${name}"]`);
    return element?.value ?? '';
  }

  private syncShellLayoutState(inspectorState?: InspectorVisibility) {
    const shell = this.query<HTMLDivElement>('.app-shell');
    const layout = getRendererLayout(
      this.viewportWidth || this.getViewportWidth(),
      this.viewportHeight || this.getViewportHeight(),
    );
    const controlRail = getPlatformControlRail(this.platform);
    const controlSide = getPlatformControlRailSide(this.platform);

    shell.dataset.viewportBand = layout.viewportBand;
    shell.dataset.viewportHeightBand = layout.viewportHeightBand;
    shell.dataset.layoutMode = layout.shellLayoutMode;
    shell.dataset.timetableDensity = layout.timetableDensity;
    shell.dataset.controlRail = controlRail;
    shell.dataset.controlSide = controlSide;

    if (inspectorState) {
      shell.dataset.inspectorState = inspectorState;
    }
  }

  private renderFrame(preserveFocus = false): void {
    if (this.sessionTimeWidget) {
      this.closeSessionTimeWidget({ reason: 'render' });
    }
    const snapshot = preserveFocus ? this.captureFocusSnapshot() : null;
    const scrollSnapshots = this.captureScrollSnapshots();
    this.render();

    this.restoreScrollSnapshots(scrollSnapshots);
    if (snapshot) {
      this.restoreFocusSnapshot(snapshot);
    }
    this.restorePendingSessionTimeTriggerFocus();
    this.resumePendingSessionTimeWidgetOpen();
    if (this.dragState) {
      this.renderDragPreview();
    }
  }

  private queueInspectorCloseButtonPositionSync(): void {
    if (this.inspectorCloseButtonFrame !== null) {
      return;
    }

    this.inspectorCloseButtonFrame = window.requestAnimationFrame(() => {
      this.inspectorCloseButtonFrame = null;
      this.syncInspectorCloseButtonPosition();
    });
  }

  private syncInspectorCloseButtonPosition(): void {
    const panel = this.root.querySelector<HTMLElement>('.inspector-panel');
    const closeButton = panel?.querySelector<HTMLButtonElement>('.inspector-close-button');
    if (!panel || !closeButton) {
      return;
    }

    const shell = panel.closest<HTMLElement>('.app-shell');
    if (shell?.dataset.layoutMode === 'inspector-below') {
      panel.style.removeProperty('--inspector-close-button-top');
      return;
    }

    const rect = panel.getBoundingClientRect();
    if (rect.height <= 0) {
      return;
    }

    const buttonHeight = closeButton.getBoundingClientRect().height || 40;
    const viewportHeight = this.viewportHeight || this.getViewportHeight();
    const visibleTop = Math.max(rect.top, 0);
    const visibleBottom = Math.min(rect.bottom, viewportHeight);
    const visibleMidpoint = visibleBottom > visibleTop ? (visibleTop + visibleBottom) / 2 : viewportHeight / 2;
    const minTop = 16;
    const maxTop = Math.max(minTop, rect.height - buttonHeight - 16);
    const nextTop = Math.min(Math.max(visibleMidpoint - rect.top - buttonHeight / 2, minTop), maxTop);

    panel.style.setProperty('--inspector-close-button-top', `${Math.round(nextTop)}px`);
  }

  private captureFocusSnapshot(): FocusSnapshot | null {
    const activeElement = document.activeElement;
    if (
      !activeElement ||
      !(activeElement instanceof HTMLInputElement || activeElement instanceof HTMLTextAreaElement || activeElement instanceof HTMLSelectElement) ||
      !this.root.contains(activeElement)
    ) {
      return null;
    }

    const form = activeElement.closest<HTMLFormElement>('form');
    if (!form?.id || !activeElement.name) {
      return null;
    }

    const row = activeElement.closest<HTMLElement>('.session-row');
    return {
      formId: form.id,
      fieldName: activeElement.name,
      selectionStart: 'selectionStart' in activeElement ? activeElement.selectionStart : null,
      selectionEnd: 'selectionEnd' in activeElement ? activeElement.selectionEnd : null,
      sessionId: row?.dataset.sessionId ?? null,
      rawValue: isCompositionTextField(activeElement) ? activeElement.value : null,
    };
  }

  private restoreFocusSnapshot(snapshot: FocusSnapshot): void {
    const form = this.root.querySelector<HTMLFormElement>(`#${snapshot.formId}`);
    if (!form) {
      return;
    }

    const scope = snapshot.sessionId
      ? form.querySelector<HTMLElement>(`.session-row[data-session-id="${snapshot.sessionId}"]`)
      : form;
    const field = scope?.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(
      `[name="${snapshot.fieldName}"]`,
    );

    if (!field) {
      return;
    }

    if (snapshot.rawValue !== null && isCompositionTextField(field)) {
      field.value = snapshot.rawValue;
    }

    field.focus({ preventScroll: true });
    if (
      field instanceof HTMLInputElement &&
      field.type !== 'color' &&
      snapshot.selectionStart !== null &&
      snapshot.selectionEnd !== null
    ) {
      field.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    }

    if (
      field instanceof HTMLTextAreaElement &&
      snapshot.selectionStart !== null &&
      snapshot.selectionEnd !== null
    ) {
      field.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
    }
  }

  private captureScrollSnapshots(): ScrollSnapshot[] {
    return SCROLL_SNAPSHOT_SELECTORS.map((selector) => {
      const element = this.root.querySelector<HTMLElement>(selector);
      if (!element) {
        return null;
      }

      return {
        selector,
        scrollTop: element.scrollTop,
        scrollLeft: element.scrollLeft,
      };
    }).filter((snapshot): snapshot is ScrollSnapshot => snapshot !== null);
  }

  private restoreScrollSnapshots(snapshots: ScrollSnapshot[]): void {
    snapshots.forEach(({ selector, scrollTop, scrollLeft }) => {
      const element = this.root.querySelector<HTMLElement>(selector);
      if (!element) {
        return;
      }

      element.scrollTop = scrollTop;
      element.scrollLeft = scrollLeft;
    });
  }

  private syncScrollbars(): void {
    this.root.querySelectorAll<HTMLElement>(SCROLLABLE_SELECTOR).forEach((element) => {
      if (this.scrollableBindings.has(element)) {
        return;
      }

      element.addEventListener(
        'scroll',
        () => {
          this.setScrollbarActive(element);
          if (element.classList.contains('timetable-scroll')) {
            this.syncSessionDragToViewport();
          }
        },
        { passive: true },
      );
      this.scrollableBindings.add(element);
    });
  }

  private setScrollbarActive(element: HTMLElement): void {
    element.classList.add(SCROLLBAR_ACTIVE_CLASS);

    const existingTimer = this.scrollHideTimers.get(element);
    if (existingTimer !== undefined) {
      window.clearTimeout(existingTimer);
    }

    const hideTimer = window.setTimeout(() => {
      element.classList.remove(SCROLLBAR_ACTIVE_CLASS);
      this.scrollHideTimers.delete(element);
    }, SCROLLBAR_IDLE_DELAY_MS);

    this.scrollHideTimers.set(element, hideTimer);
  }

  private upsertCourse(course: Course): AppData {
    return this.withUpdatedBoard((board) => {
      const timestamp = new Date().toISOString();
      const existingIndex = board.courses.findIndex((item) => item.id === course.id);
      const courses = [...board.courses];

      if (existingIndex >= 0) {
        courses.splice(existingIndex, 1, course);
      } else {
        courses.push(course);
      }

      return {
        ...board,
        updatedAt: timestamp,
        courses,
      };
    });
  }

  private getEditableCourse(): Course {
    const selected = this.getSelectedCourse();
    if (selected) {
      return selected;
    }

    const board = this.getActiveBoard();
    return {
      ...createBlankCourse(board.courses.length),
      id: this.pendingCourseId ?? generateId('course'),
    };
  }

  private async persist(nextData: AppData, successText: string, afterSuccess?: () => void): Promise<void> {
    const previous = this.data;
    this.clearAutosaveTimer();
    this.localRevision += 1;
    this.lastSavedRevision = this.localRevision;
    this.saveInFlightRevision = null;
    this.hasUnsavedChanges = false;
    this.canAutosaveDraft = false;
    this.data = nextData;
    this.isSaving = true;
    this.showBanner({ tone: 'info', text: '변경 사항을 저장하고 있어요…' });
    this.renderFrame();

    try {
      this.data = await window.soosta.saveData(nextData);
      this.lastPersistedData = this.data;
      afterSuccess?.();
      this.ensureSelection();
      this.hasUnsavedChanges = false;
      this.canAutosaveDraft = false;
      this.showBanner({ tone: 'success', text: successText });
    } catch (error) {
      this.data = previous;
      this.showBanner({ tone: 'error', text: this.getErrorMessage(error) });
    } finally {
      this.isSaving = false;
      this.renderFrame();
    }
  }

  private startSessionDrag(event: PointerEvent, block: HTMLElement): void {
    if (!this.data || event.button !== 0) {
      return;
    }

    const courseId = block.dataset.courseId;
    const sessionId = block.dataset.sessionId;
    const day = block.dataset.day as DayKey | undefined;
    const startMinutes = Number(block.dataset.startMinutes);
    const endMinutes = Number(block.dataset.endMinutes);
    if (!courseId || !sessionId || !day || Number.isNaN(startMinutes) || Number.isNaN(endMinutes)) {
      return;
    }

    const rect = block.getBoundingClientRect();
    this.pendingSessionDrag = {
      block,
      courseId,
      sessionId,
      day,
      startMinutes,
      endMinutes,
      offsetY: event.clientY - rect.top,
      pointerId: event.pointerId,
      originClientX: event.clientX,
      originClientY: event.clientY,
    };
  }

  private handleSessionDragMove(event: PointerEvent): void {
    if (!this.data) {
      return;
    }

    if (!this.dragState && this.pendingSessionDrag) {
      if (event.pointerId !== this.pendingSessionDrag.pointerId) {
        return;
      }

      const deltaX = event.clientX - this.pendingSessionDrag.originClientX;
      const deltaY = event.clientY - this.pendingSessionDrag.originClientY;
      if (Math.hypot(deltaX, deltaY) < SESSION_DRAG_START_DISTANCE_PX) {
        return;
      }

      if (!this.activatePendingSessionDrag()) {
        return;
      }
    }

    if (!this.dragState) {
      return;
    }

    this.currentDragPointer = { clientX: event.clientX, clientY: event.clientY };
    this.pendingDragPointer = { clientX: event.clientX, clientY: event.clientY };
    if (this.dragMoveFrame !== null) {
      return;
    }

    this.dragMoveFrame = window.requestAnimationFrame(() => {
      this.dragMoveFrame = null;
      const pointer = this.pendingDragPointer;
      this.pendingDragPointer = null;
      if (!pointer) {
        return;
      }

      this.updateSessionDragPlacement(pointer.clientX, pointer.clientY);
    });
  }

  private async finishSessionDrag(event: PointerEvent): Promise<void> {
    if (this.pendingSessionDrag) {
      if (event.pointerId === this.pendingSessionDrag.pointerId) {
        this.pendingSessionDrag = null;
      }
      return;
    }

    if (!this.dragState || !this.data) {
      return;
    }

    const dragState = this.dragState;
    const dropTarget = this.getDropTargetSession(event.clientX, event.clientY, dragState);
    const action = resolveSessionDropAction(
      this.getActiveBoard(),
      { courseId: dragState.courseId, sessionId: dragState.sessionId },
      {
        day: dragState.previewDay,
        startMinutes: dragState.previewStartMinutes,
        endMinutes: dragState.previewEndMinutes,
      },
      dropTarget,
    );
    this.suppressSessionBlockClickTemporarily();
    this.resetSessionDrag();

    if (action.kind === 'reject') {
      this.showBanner({
        tone: 'error',
        text: getSessionDropRejectMessage(action.reason),
      });
      this.render();
      return;
    }

    if (action.kind === 'swap') {
      const nextData = this.withUpdatedBoard((board) => ({
        ...swapBoardSessions(
          board,
          { courseId: dragState.courseId, sessionId: dragState.sessionId },
          action.target,
        ),
        updatedAt: new Date().toISOString(),
      }));

      this.applyLocalUpdate(
        nextData,
        {
          successText: '드래그한 강의 위치를 서로 바꿨어요.',
          invalidText: '드래그 변경사항을 반영하지 못했어요.',
        },
        true,
      );
      return;
    }

    if (action.kind === 'noop') {
      this.dismissBanner();
      this.render();
      return;
    }

    const nextData = this.withUpdatedBoard((board) => ({
      ...updateBoardSessionSchedule(board, dragState.courseId, dragState.sessionId, {
        day: action.placement.day,
        startMinutes: action.placement.startMinutes,
        endMinutes: action.placement.endMinutes,
      }),
      updatedAt: new Date().toISOString(),
    }));

    this.applyLocalUpdate(
      nextData,
      {
        successText: '드래그한 시간표 변경사항을 자동 저장했어요.',
        invalidText: '드래그 변경사항을 반영하지 못했어요.',
      },
      true,
    );
  }

  private resetSessionDrag(): void {
    if (this.dragMoveFrame !== null) {
      window.cancelAnimationFrame(this.dragMoveFrame);
      this.dragMoveFrame = null;
    }
    this.pendingSessionDrag = null;
    this.pendingDragPointer = null;
    this.currentDragPointer = null;
    this.dragState = null;
    document.body.classList.remove('is-dragging-session');
    this.root.querySelector('.session-drag-preview')?.remove();
    this.root.querySelector('.session-block.is-drag-origin')?.classList.remove('is-drag-origin');
  }

  private activatePendingSessionDrag(): boolean {
    if (!this.data || !this.pendingSessionDrag) {
      return false;
    }

    const dragColumns = this.getDragColumns();
    if (dragColumns.length === 0) {
      this.pendingSessionDrag = null;
      return false;
    }

    const pendingDrag = this.pendingSessionDrag;
    const range = getGridRange(this.getActiveBoard());
    this.clearAutosaveTimer();
    try {
      pendingDrag.block.setPointerCapture(pendingDrag.pointerId);
    } catch (_error) {
      // Best-effort only; dragging still works without pointer capture.
    }

    pendingDrag.block.classList.add('is-drag-origin');
    document.body.classList.add('is-dragging-session');
    this.currentDragPointer = { clientX: pendingDrag.originClientX, clientY: pendingDrag.originClientY };
    this.dragState = {
      courseId: pendingDrag.courseId,
      sessionId: pendingDrag.sessionId,
      durationMinutes: pendingDrag.endMinutes - pendingDrag.startMinutes,
      offsetY: pendingDrag.offsetY,
      pointerId: pendingDrag.pointerId,
      originDay: pendingDrag.day,
      originStartMinutes: pendingDrag.startMinutes,
      previewDay: pendingDrag.day,
      previewStartMinutes: pendingDrag.startMinutes,
      previewEndMinutes: pendingDrag.endMinutes,
      previewLabel: `${minutesToTime(pendingDrag.startMinutes)}–${minutesToTime(pendingDrag.endMinutes)}`,
      dragColumns,
      gridStartMinutes: range.startMinutes,
      gridEndMinutes: range.endMinutes,
    };
    this.pendingSessionDrag = null;
    this.renderDragPreview();
    return true;
  }

  private suppressSessionBlockClickTemporarily(): void {
    this.clearSuppressedSessionBlockClick();
    this.suppressSessionBlockClick = true;
    this.suppressSessionBlockClickTimer = setTimeout(() => {
      this.clearSuppressedSessionBlockClick();
    }, 0);
  }

  private consumeSuppressedSessionBlockClick(target: HTMLElement): boolean {
    if (!this.suppressSessionBlockClick || !target.closest('.session-block')) {
      return false;
    }

    this.clearSuppressedSessionBlockClick();
    return true;
  }

  private clearSuppressedSessionBlockClick(): void {
    if (this.suppressSessionBlockClickTimer !== null) {
      clearTimeout(this.suppressSessionBlockClickTimer);
      this.suppressSessionBlockClickTimer = null;
    }

    this.suppressSessionBlockClick = false;
  }

  private renderDragPreview(): void {
    if (!this.dragState || !this.data) {
      return;
    }

    const dayColumn = this.dragState.dragColumns.find((column) => column.day === this.dragState?.previewDay)?.element;
    if (!dayColumn) {
      return;
    }

    const board = this.getActiveBoard();
    const pixelsPerMinute = this.getTimetablePixelsPerMinute();
    const top = (this.dragState.previewStartMinutes - this.dragState.gridStartMinutes) * pixelsPerMinute;
    const blockHeight = Math.max(44, this.dragState.durationMinutes * pixelsPerMinute - 8);
    const course = board.courses.find((item) => item.id === this.dragState?.courseId);
    const preview = this.root.querySelector<HTMLElement>('.session-drag-preview') ?? document.createElement('div');

    preview.className = 'session-block session-drag-preview';
    preview.style.setProperty('--course-color', sanitizeColor(course?.color ?? '#7c72ff'));
    preview.style.top = `${top + 4}px`;
    preview.style.height = `${blockHeight}px`;
    preview.style.left = '6px';
    preview.style.width = 'calc(100% - 12px)';
    preview.innerHTML = `
      <span class="session-block-title">${escapeHtml(course?.title || '드래그 중')}</span>
      <span class="session-block-meta session-block-time">${escapeHtml(this.dragState.previewLabel)}</span>
      <span class="session-block-meta">${escapeHtml(DAY_LABELS[this.dragState.previewDay].full)}</span>
    `;
    dayColumn.append(preview);
  }

  private getDragColumns(): SessionDragState['dragColumns'] {
    return [...this.root.querySelectorAll<HTMLElement>('.day-column')]
      .map((element, index) => {
        const day = DAY_ORDER[index];
        if (!day) {
          return null;
        }

        return {
          day,
          element,
          rect: element.getBoundingClientRect(),
        };
      })
      .filter((column): column is SessionDragState['dragColumns'][number] => column !== null);
  }

  private getDropTargetSession(
    clientX: number,
    clientY: number,
    dragState: SessionDragState,
  ): { courseId: string; sessionId: string } | null {
    const target = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
    const block = target?.closest<HTMLElement>('.session-block');
    if (!block || block.classList.contains('session-drag-preview')) {
      return null;
    }

    const courseId = block.dataset.courseId;
    const sessionId = block.dataset.sessionId;
    if (!courseId || !sessionId) {
      return null;
    }

    if (courseId === dragState.courseId && sessionId === dragState.sessionId) {
      return null;
    }

    return { courseId, sessionId };
  }

  private updateSessionDragPlacement(clientX: number, clientY: number): void {
    if (!this.dragState) {
      return;
    }

    this.dragState.dragColumns = this.getDragColumns();
    if (this.dragState.dragColumns.length === 0) {
      return;
    }

    const hoveredIndex = this.dragState.dragColumns.reduce((closestIndex, column, index) => {
      if (clientX >= column.rect.left && clientX <= column.rect.right) {
        return index;
      }

      const closestRect = this.dragState?.dragColumns[closestIndex]?.rect;
      if (!closestRect) {
        return index;
      }

      const closestDistance = Math.min(Math.abs(clientX - closestRect.left), Math.abs(clientX - closestRect.right));
      const distance = Math.min(Math.abs(clientX - column.rect.left), Math.abs(clientX - column.rect.right));
      return distance < closestDistance ? index : closestIndex;
    }, 0);

    const columnRect = this.dragState.dragColumns[hoveredIndex]?.rect;
    if (!columnRect) {
      return;
    }

    const pixelsPerMinute = this.getTimetablePixelsPerMinute();
    const rawStartMinutes =
      this.dragState.gridStartMinutes + ((clientY - columnRect.top - this.dragState.offsetY) / pixelsPerMinute);
    const placement = resolveDraggedSessionPlacement({
      dayIndex: hoveredIndex,
      rawStartMinutes,
      durationMinutes: this.dragState.durationMinutes,
      gridStartMinutes: this.dragState.gridStartMinutes,
      gridEndMinutes: this.dragState.gridEndMinutes,
    });

    this.dragState.previewDay = placement.day;
    this.dragState.previewStartMinutes = placement.startMinutes;
    this.dragState.previewEndMinutes = placement.endMinutes;
    this.dragState.previewLabel = `${minutesToTime(this.dragState.previewStartMinutes)}–${minutesToTime(this.dragState.previewEndMinutes)}`;
    this.renderDragPreview();
  }

  private getTimetablePixelsPerMinute(): number {
    return getTimetablePixelsPerMinute(this.viewportHeight || this.getViewportHeight());
  }

  private syncSessionDragToViewport(): void {
    if (!this.dragState || !this.currentDragPointer) {
      return;
    }

    this.updateSessionDragPlacement(this.currentDragPointer.clientX, this.currentDragPointer.clientY);
  }

  private withUpdatedBoard(mutator: (board: TimetableBoard) => TimetableBoard): AppData {
    if (!this.data) {
      throw new Error('앱 데이터가 아직 준비되지 않았습니다.');
    }

    const activeBoard = this.getActiveBoard();
    return {
      ...this.data,
      boards: this.data.boards.map((board) => (board.id === activeBoard.id ? mutator(board) : board)),
    };
  }

  private getActiveBoard(): TimetableBoard {
    if (!this.data) {
      throw new Error('앱 데이터가 아직 준비되지 않았습니다.');
    }

    const { activeBoardId, boards } = this.data;
    return boards.find((board) => board.id === activeBoardId) ?? boards[0];
  }

  private getSelectedCourse(): Course | null {
    const board = this.getActiveBoard();
    return board.courses.find((course) => course.id === this.selectedCourseId) ?? null;
  }

  private ensureSelection(): void {
    if (!this.data) {
      return;
    }

    const board = this.getActiveBoard();
    if (this.selectedCourseId && !board.courses.some((course) => course.id === this.selectedCourseId)) {
      this.selectedCourseId = null;
    }

    if (this.pendingCourseId && board.courses.some((course) => course.id === this.pendingCourseId)) {
      this.pendingCourseId = null;
    }
  }

  private shouldShowInspector(): boolean {
    if (!this.data) {
      return true;
    }

    return Boolean(this.getSelectedCourse() || this.pendingCourseId);
  }

  private getInspectorVisualState(): InspectorVisibility {
    if (this.shouldShowInspector()) {
      if (this.inspectorVisibility === 'closing') {
        this.cancelInspectorCloseAnimation();
      }

      if (this.inspectorVisibility === 'closed') {
        this.beginInspectorOpenAnimation();
      } else if (this.inspectorVisibility !== 'opening') {
        this.inspectorVisibility = 'open';
      }

      return this.inspectorVisibility === 'closed' ? 'open' : this.inspectorVisibility;
    }

    this.cancelInspectorOpenAnimation();
    this.inspectorVisibility = this.closingInspectorCourse ? 'closing' : 'closed';
    return this.closingInspectorCourse ? 'closing' : 'closed';
  }

  private shouldClearCourseSelectionFromMainPlanClick(target: HTMLElement): boolean {
    if (!this.selectedCourseId && !this.pendingCourseId) {
      return false;
    }

    return Boolean(target.closest('.day-column')) && !target.closest('.session-block');
  }

  private beginInspectorCloseAnimation(): void {
    if (!this.data || !this.shouldShowInspector()) {
      return;
    }

    this.cancelInspectorOpenAnimation();
    this.cancelInspectorCloseAnimation();
    const editableCourse = this.getEditableCourse();
    this.closingInspectorCourse = {
      ...editableCourse,
      sessions: editableCourse.sessions.map((session) => ({ ...session })),
    };
    this.closingInspectorIsEditing = Boolean(this.getSelectedCourse());

    if (prefersReducedMotion()) {
      this.inspectorVisibility = 'closed';
      this.cancelInspectorCloseAnimation();
      return;
    }

    this.inspectorVisibility = 'closing';
    this.inspectorCloseTimer = setTimeout(() => {
      this.cancelInspectorCloseAnimation();
      this.inspectorVisibility = 'closed';
      this.render();
    }, INSPECTOR_SPRING_DURATION_MS);
  }

  private beginInspectorOpenAnimation(): void {
    this.cancelInspectorCloseAnimation();

    if (prefersReducedMotion()) {
      this.cancelInspectorOpenAnimation();
      this.inspectorVisibility = 'open';
      return;
    }

    if (this.inspectorVisibility === 'opening' || this.inspectorVisibility === 'open') {
      return;
    }

    this.cancelInspectorOpenAnimation();
    this.inspectorVisibility = 'opening';
    this.inspectorOpenFrame = window.requestAnimationFrame(() => {
      this.inspectorOpenFrame = null;
      if (!this.shouldShowInspector()) {
        this.inspectorVisibility = 'closed';
        return;
      }

      this.inspectorVisibility = 'open';
      this.render();
    });
  }

  private cancelInspectorOpenAnimation(): void {
    if (this.inspectorOpenFrame !== null) {
      window.cancelAnimationFrame(this.inspectorOpenFrame);
      this.inspectorOpenFrame = null;
    }
  }

  private cancelInspectorCloseAnimation(): void {
    if (this.inspectorCloseTimer !== null) {
      window.clearTimeout(this.inspectorCloseTimer);
      this.inspectorCloseTimer = null;
    }

    this.closingInspectorCourse = null;
    this.closingInspectorIsEditing = false;

    if (this.inspectorVisibility === 'closing') {
      this.inspectorVisibility = this.shouldShowInspector() ? 'open' : 'closed';
    }
  }

  private clearCourseSelection(preserveFocus = false): void {
    if (!this.selectedCourseId && !this.pendingCourseId) {
      return;
    }

    this.beginInspectorCloseAnimation();
    this.selectedCourseId = null;
    this.pendingCourseId = null;
    this.renderFrame(preserveFocus);
  }

  private discardLocalBoardDraft(): void {
    if (!this.data || !this.lastPersistedData) {
      return;
    }

    this.clearAutosaveTimer();
    this.localRevision += 1;
    this.lastSavedRevision = this.localRevision;
    this.saveInFlightRevision = null;
    this.data = restoreActiveBoardFromPersisted(this.data, this.lastPersistedData);
    this.ensureSelection();
    this.hasUnsavedChanges = false;
    this.canAutosaveDraft = false;
  }

  private confirmDiscardInvalidInspectorDraft(): boolean {
    if (!this.shouldShowInspector() || !this.hasUnsavedChanges || this.canAutosaveDraft) {
      return true;
    }

    const approved = window.confirm('저장되지 않은 입력을 버리고 계속할까요?');
    if (!approved) {
      return false;
    }

    this.discardLocalBoardDraft();
    this.dismissBanner();
    return true;
  }

  private async handleCloseInspector(): Promise<void> {
    if (!this.shouldShowInspector()) {
      return;
    }

    if (!this.confirmDiscardInvalidInspectorDraft()) {
      return;
    }

    this.clearCourseSelection(true);
  }

  private getViewportWidth(): number {
    return Math.max(this.root.clientWidth, window.innerWidth || 0);
  }

  private getViewportHeight(): number {
    return Math.max(this.root.clientHeight, window.innerHeight || 0);
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return '예기치 않은 문제가 발생했습니다.';
  }

  private query<T extends Element = HTMLElement>(selector: string): T {
    const element = this.root.querySelector<T>(selector);
    if (!element) {
      throw new Error(`${selector} 요소를 찾을 수 없습니다.`);
    }

    return element;
  }
}

export const bootstrapApp = async (root: HTMLDivElement | null): Promise<void> => {
  if (!root) {
    throw new Error('#app 루트를 찾을 수 없습니다.');
  }

  const app = new SoostaApp(root);
  await app.init();
};
