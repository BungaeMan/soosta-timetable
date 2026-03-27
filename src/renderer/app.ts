import { APP_NAME, DAY_LABELS, TIMETABLE_DAY_ORDER } from '../shared/constants';
import { generateId } from '../shared/data';
import { parseLectureReminderLeadMinutesInput } from '../shared/reminders';
import type {
  AgendaItem,
  AppData,
  Course,
  CourseSession,
  DayKey,
  LectureReminderLeadMinutes,
  TimetableBoard,
  Unsubscribe,
} from '../shared/types';
import type { DesktopPlatform } from './domain/layout';
import { getTimetableJpegFileName, renderTimetableToJpegBytes } from './domain/export-image';
import {
  getPlatformControlRail,
  getPlatformControlRailSide,
  getRendererLayout,
  getTimetablePixelsPerMinute,
  getViewportFittedTimetablePixelsPerMinute,
} from './domain/layout';
import {
  createBlankCourse,
  getCourseColorRecommendations,
  hexColorToRgb,
  normalizeCourseDraft,
  rgbToHexColor,
  restoreActiveBoardFromPersisted,
  validateCourse,
} from './domain/model';
import { getBoardStats, getGridRange, getPositionedSessions, getTodayAgenda } from './domain/timetable';
import { minutesToTime } from './domain/time';
import type {
  ActiveLectureReminder,
  Banner,
  BannerVisibility,
  CourseColorChannel,
  FocusSnapshot,
  InspectorVisibility,
  PendingSessionDrag,
  PendingSessionTimeTarget,
  ScrollSnapshot,
  SessionContextMenu,
  SessionDragState,
  SessionTimeFieldName,
  SessionTimeWidgetCloseReason,
  SessionTimeWidgetState,
} from './app/shared';
import {
  consumeSuppressedSessionBlockClick as consumeSuppressedSessionBlockClickFromModule,
  finishSessionDrag as finishSessionDragFromModule,
  handleSessionDragMove as handleSessionDragMoveFromModule,
  renderDragPreview as renderDragPreviewFromModule,
  resetSessionDrag as resetSessionDragFromModule,
  startSessionDrag as startSessionDragFromModule,
  syncSessionDragToViewport as syncSessionDragToViewportFromModule,
} from './app/drag-drop';
import {
  AUTOSAVE_DELAY_MS,
  DEFAULT_TIMETABLE_BLOCK_MIN_HEIGHT,
  escapeHtml,
  FITTED_TIMETABLE_BLOCK_MIN_HEIGHT,
  formatReminderLeadList,
  getCurrentWeekday,
  getSessionBlockLayout,
  INSPECTOR_SPRING_DURATION_MS,
  isCompositionTextField,
  prefersReducedMotion,
  renderIcon,
  resolveDesktopPlatform,
  sanitizeColor,
  SCROLLABLE_SELECTOR,
  SCROLLBAR_ACTIVE_CLASS,
  SCROLLBAR_IDLE_DELAY_MS,
  SCROLL_SNAPSHOT_SELECTORS,
  TIMETABLE_FIT_SYNC_EPSILON,
} from './app/shared';
import {
  renderLoadingCard,
  renderStatusActions as renderStatusActionsMarkup,
  renderWindowControls as renderWindowControlsMarkup,
} from './app/rendering';
import {
  renderContentSection,
  renderCourseColorFieldSection,
  renderInspectorPanelSection,
  renderSessionRowMarkup,
  renderSidebarSection,
} from './app/render-sections';
import { handleRendererAction } from './app/actions';
import {
  startCurrentTimeTicker as startCurrentTimeTickerFromModule,
  stopCurrentTimeTicker as stopCurrentTimeTickerFromModule,
  syncCurrentTimeUi as syncCurrentTimeUiFromModule,
  queueCurrentTimeIndicatorSync as queueCurrentTimeIndicatorSyncFromModule,
  cancelQueuedCurrentTimeIndicatorSync as cancelQueuedCurrentTimeIndicatorSyncFromModule,
  syncCurrentTimeIndicator as syncCurrentTimeIndicatorFromModule,
  renderBannerToast as renderBannerToastFromModule,
  startReminderSweepLoop as startReminderSweepLoopFromModule,
  stopReminderSweepLoop as stopReminderSweepLoopFromModule,
  runReminderSweep as runReminderSweepFromModule,
  areLectureRemindersEnabled as areLectureRemindersEnabledFromModule,
  getLectureReminderLeadMinutes as getLectureReminderLeadMinutesFromModule,
  getLectureReminderSummary as getLectureReminderSummaryFromModule,
  triggerManualLectureReminder as triggerManualLectureReminderFromModule,
  dismissLectureReminder as dismissLectureReminderFromModule,
  showBanner as showBannerFromModule,
  dismissBanner as dismissBannerFromModule,
} from './app/feedback';
import { bindRendererEvents } from './app/events';
import {
  closeSessionTimeWidget as closeSessionTimeWidgetFromModule,
  handleSessionTimeWidgetClick as handleSessionTimeWidgetClickFromModule,
  renderOpenSessionTimeWidget as renderOpenSessionTimeWidgetFromModule,
  renderSessionTimeInput as renderSessionTimeInputFromModule,
  restorePendingSessionTimeTriggerFocus as restorePendingSessionTimeTriggerFocusFromModule,
  resumePendingSessionTimeWidgetOpen as resumePendingSessionTimeWidgetOpenFromModule,
  syncSessionEndTimeAfterStartChange as syncSessionEndTimeAfterStartChangeFromModule,
} from './app/session-time';

export class SoostaApp {
  readonly root: HTMLDivElement;
  data: AppData | null = null;
  private lastPersistedData: AppData | null = null;
  private selectedCourseId: string | null = null;
  private pendingCourseId: string | null = null;
  banner: Banner | null = null;
  bannerVisibility: BannerVisibility = 'hidden';
  isLoading = true;
  private isSaving = false;
  hasUnsavedChanges = false;
  canAutosaveDraft = false;
  localRevision = 0;
  lastSavedRevision = 0;
  saveInFlightRevision: number | null = null;
  saveTimer: ReturnType<typeof setTimeout> | null = null;
  dragState: SessionDragState | null = null;
  pendingSessionDrag: PendingSessionDrag | null = null;
  dragMoveFrame: number | null = null;
  pendingDragPointer: { clientX: number; clientY: number } | null = null;
  currentDragPointer: { clientX: number; clientY: number } | null = null;
  viewportWidth = 0;
  viewportHeight = 0;
  readonly platform: DesktopPlatform = resolveDesktopPlatform();
  isWindowMaximized = false;
  private unsubscribeWindowMaximized: Unsubscribe | null = null;
  resizeFrame: number | null = null;
  private inspectorCloseButtonFrame: number | null = null;
  bannerAnimationFrame: number | null = null;
  bannerAutoDismissTimer: ReturnType<typeof setTimeout> | null = null;
  bannerAutoDismissStartedAt: number | null = null;
  bannerAutoDismissRemainingMs: number | null = null;
  bannerCleanupTimer: ReturnType<typeof setTimeout> | null = null;
  isBannerHovered = false;
  isBannerFocused = false;
  private composingField: HTMLInputElement | HTMLTextAreaElement | null = null;
  private pendingAutosaveAfterComposition = false;
  private pendingRenderAfterComposition = false;
  private closingInspectorCourse: Course | null = null;
  private closingInspectorIsEditing = false;
  private inspectorVisibility: InspectorVisibility = 'closed';
  private inspectorCloseTimer: ReturnType<typeof setTimeout> | null = null;
  private inspectorOpenFrame: number | null = null;
  suppressSessionBlockClick = false;
  suppressSessionBlockClickTimer: ReturnType<typeof setTimeout> | null = null;
  currentTimeTicker: number | null = null;
  currentTimeIndicatorSyncFrame: number | null = null;
  private timetableFitSyncFrame: number | null = null;
  private layoutResizeObserver: ResizeObserver | null = null;
  reminderSweepTimer: ReturnType<typeof setInterval> | null = null;
  reminderCardTimer: ReturnType<typeof setTimeout> | null = null;
  lastReminderSweepAt = Date.now();
  activeLectureReminder: ActiveLectureReminder | null = null;
  readonly firedLectureReminderIds = new Set<string>();
  reminderAudioContext: AudioContext | null = null;
  private readonly scrollableBindings = new WeakSet<HTMLElement>();
  private readonly scrollHideTimers = new WeakMap<HTMLElement, number>();
  private sessionContextMenu: SessionContextMenu | null = null;
  private sessionContextAnchor: HTMLElement | null = null;
  sessionTimeWidget: SessionTimeWidgetState | null = null;
  pendingSessionTimeFocus: PendingSessionTimeTarget | null = null;
  pendingSessionTimeOpen: PendingSessionTimeTarget | null = null;
  isCourseColorFieldExpanded = false;
  isTimetableFitMode = false;
  timetableFitPixelsPerMinute: number | null = null;
  isTimetableJpegExporting = false;


  bindEvents!: () => void;
  startCurrentTimeTicker!: () => void;
  stopCurrentTimeTicker!: () => void;
  syncCurrentTimeUi!: (now?: Date) => void;
  queueCurrentTimeIndicatorSync!: () => void;
  cancelQueuedCurrentTimeIndicatorSync!: () => void;
  syncCurrentTimeIndicator!: (now?: Date) => void;
  renderBannerToast!: () => void;
  startReminderSweepLoop!: () => void;
  stopReminderSweepLoop!: () => void;
  runReminderSweep!: () => void;
  areLectureRemindersEnabled!: () => boolean;
  getLectureReminderLeadMinutes!: () => LectureReminderLeadMinutes[];
  getLectureReminderSummary!: () => string;
  triggerManualLectureReminder!: () => Promise<void>;
  dismissLectureReminder!: () => void;
  showBanner!: (banner: Banner) => void;
  dismissBanner!: (immediate?: boolean) => void;
  renderSessionTimeInput!: (sessionId: string, name: SessionTimeFieldName, value: string, pairedValue?: string) => string;
  restorePendingSessionTimeTriggerFocus!: () => void;
  resumePendingSessionTimeWidgetOpen!: () => void;
  renderOpenSessionTimeWidget!: () => void;
  syncSessionEndTimeAfterStartChange!: (sessionId: string, startValue: string) => void;
  closeSessionTimeWidget!: (options: { reason: SessionTimeWidgetCloseReason; outsideTarget?: HTMLElement | null }) => void;
  handleSessionTimeWidgetClick!: (target: HTMLElement) => boolean;
  handleAction!: (action: string, element: HTMLElement) => Promise<void>;
  startSessionDrag!: (event: PointerEvent, block: HTMLElement) => void;
  handleSessionDragMove!: (event: PointerEvent) => void;
  finishSessionDrag!: (event: PointerEvent) => Promise<void>;
  resetSessionDrag!: () => void;
  consumeSuppressedSessionBlockClick!: (target: HTMLElement) => boolean;
  syncSessionDragToViewport!: () => void;

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

  render(): void {
    this.renderTopbar();
    this.renderStatus();
    this.renderBannerToast();

    if (this.isLoading || !this.data) {
      this.syncShellLayoutState('open');
      this.query('#sidebar-slot').innerHTML = renderLoadingCard('시간표를 준비하고 있어요.');
      this.query('#content-slot').innerHTML = renderLoadingCard('주간 레이아웃을 불러오는 중입니다.');
      this.query('#inspector-slot').innerHTML = renderLoadingCard('에디터를 정리하고 있어요.');
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

  private renderTopbar(): void {
    this.syncShellLayoutState();
    const topbarSlot = this.query<HTMLElement>('#topbar-slot');
    const windowControls = renderWindowControlsMarkup({
      platform: this.platform,
      isWindowMaximized: this.isWindowMaximized,
    });

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

  private renderStatus(): void {
    const syncSlot = this.query('#sync-slot');
    const statusActions = renderStatusActionsMarkup({
      isLoading: this.isLoading,
      hasData: Boolean(this.data),
    });
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

  private renderSidebar(): string {
    const data = this.data;
    if (!data) {
      return '';
    }

    const board = this.getActiveBoard();
    const agenda = getTodayAgenda(board);
    const reminderLeadMinutes = this.getLectureReminderLeadMinutes();
    return renderSidebarSection({
      data,
      board,
      agenda,
      agendaDay: agenda.length > 0 ? agenda[0].day : getCurrentWeekday() ?? null,
      remindersEnabled: this.areLectureRemindersEnabled(),
      reminderLeadMinutes,
      reminderSummary: this.getLectureReminderSummary(),
      renderAgendaItem: (item) => this.renderAgendaItem(item),
    });
  }

  private renderContent(): string {
    const board = this.getActiveBoard();
    const stats = getBoardStats(board);
    const range = getGridRange(board);
    const positioned = getPositionedSessions(board);
    const pixelsPerMinute = this.getTimetablePixelsPerMinute();
    const height = (range.endMinutes - range.startMinutes) * pixelsPerMinute;
    const hasCourses = board.courses.length > 0;
    const hours: number[] = [];
    for (let minutes = range.startMinutes; minutes <= range.endMinutes; minutes += 60) {
      hours.push(minutes);
    }

    return renderContentSection({
      board,
      stats,
      range,
      bodyMarkup: hasCourses
        ? this.renderTimetable(positioned, height, hours, range.startMinutes, pixelsPerMinute)
        : this.renderEmptyBoard(),
      isTimetableFitMode: this.isTimetableFitMode,
      isTimetableJpegExporting: this.isTimetableJpegExporting,
    });
  }

  getMinimumSessionBlockHeight(): number {
    return this.isTimetableFitMode ? FITTED_TIMETABLE_BLOCK_MIN_HEIGHT : DEFAULT_TIMETABLE_BLOCK_MIN_HEIGHT;
  }

  private measureFittedTimetablePixelsPerMinute(): number | null {
    if (!this.data) {
      return null;
    }

    const board = this.getActiveBoard();
    if (board.courses.length === 0) {
      return null;
    }

    const scroll = this.root.querySelector<HTMLElement>('.timetable-scroll');
    const grid = scroll?.querySelector<HTMLElement>('.timetable-grid');
    const head = grid?.querySelector<HTMLElement>('.timetable-head');
    if (!scroll || !grid || !head) {
      return null;
    }

    const range = getGridRange(board);
    const minuteSpan = range.endMinutes - range.startMinutes;
    const styles = window.getComputedStyle(grid);
    const gap = Number.parseFloat(styles.rowGap || styles.gap || '0') || 0;
    const availableHeight = scroll.clientHeight - head.getBoundingClientRect().height - gap;

    return getViewportFittedTimetablePixelsPerMinute(
      availableHeight,
      minuteSpan,
      getTimetablePixelsPerMinute(this.viewportHeight || this.getViewportHeight()),
    );
  }

  private cancelQueuedTimetableFitSync(): void {
    if (this.timetableFitSyncFrame !== null) {
      window.cancelAnimationFrame(this.timetableFitSyncFrame);
      this.timetableFitSyncFrame = null;
    }
  }

  private queueTimetableFitSync(preserveFocus = false): void {
    if (!this.isTimetableFitMode || this.timetableFitSyncFrame !== null) {
      return;
    }

    this.timetableFitSyncFrame = window.requestAnimationFrame(() => {
      this.timetableFitSyncFrame = null;
      this.syncTimetableFitMode(preserveFocus);
    });
  }

  private syncTimetableFitMode(preserveFocus = false): void {
    if (!this.isTimetableFitMode) {
      return;
    }

    const nextPixelsPerMinute = this.measureFittedTimetablePixelsPerMinute();
    if (nextPixelsPerMinute === null) {
      return;
    }

    if (
      this.timetableFitPixelsPerMinute !== null &&
      Math.abs(this.timetableFitPixelsPerMinute - nextPixelsPerMinute) <= TIMETABLE_FIT_SYNC_EPSILON
    ) {
      return;
    }

    this.timetableFitPixelsPerMinute = nextPixelsPerMinute;
    this.renderFrame(preserveFocus);
  }

  private toggleTimetableFitMode(): void {
    if (!this.data || this.getActiveBoard().courses.length === 0) {
      return;
    }

    this.cancelQueuedTimetableFitSync();
    this.isTimetableFitMode = !this.isTimetableFitMode;

    if (this.isTimetableFitMode) {
      this.timetableFitPixelsPerMinute = this.measureFittedTimetablePixelsPerMinute();
    } else {
      this.timetableFitPixelsPerMinute = null;
    }

    this.renderFrame(true);
  }

  private async exportTimetableJpeg(): Promise<void> {
    if (!this.data || this.isTimetableJpegExporting) {
      return;
    }

    const board = this.getActiveBoard();
    if (board.courses.length === 0) {
      return;
    }

    this.isTimetableJpegExporting = true;
    this.renderFrame(true);

    try {
      const range = getGridRange(board);
      const positioned = getPositionedSessions(board).filter((session) => TIMETABLE_DAY_ORDER.includes(session.day));
      const imageBytes = await renderTimetableToJpegBytes({
        board,
        positionedSessions: positioned,
        range,
        minimumSessionBlockHeight: this.getMinimumSessionBlockHeight(),
      });
      const result = await window.soosta.exportTimetableJpeg({
        fileName: getTimetableJpegFileName(board.name),
        bytes: imageBytes,
      });

      if (!result.cancelled) {
        this.showBanner({ tone: 'success', text: `시간표를 JPG로 저장했어요. ${result.filePath ?? ''}`.trim() });
      }
    } catch (error) {
      this.showBanner({ tone: 'error', text: this.getErrorMessage(error) });
    } finally {
      this.isTimetableJpegExporting = false;
      this.renderFrame(true);
    }
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
        (() => {
          const draftCourse = {
            ...createBlankCourse(board.courses.length),
            id: this.pendingCourseId ?? generateId('course'),
          };
          const [recommendedColor] = getCourseColorRecommendations(board.courses, {
            currentCourseId: draftCourse.id,
            limit: 1,
            preferFreshColors: true,
          });

          return {
            ...draftCourse,
            color: recommendedColor ?? draftCourse.color,
          };
        })()
      : this.closingInspectorCourse;
    const isEditing = isOpen ? Boolean(this.getSelectedCourse()) : this.closingInspectorIsEditing;

    if (!course) {
      return '';
    }

    return this.renderInspectorPanel(course, isEditing, visualState);
  }

  private renderInspectorPanel(course: Course, isEditing: boolean, visualState: InspectorVisibility): string {
    return renderInspectorPanelSection({
      course,
      isEditing,
      visualState,
      colorFieldMarkup: this.renderCourseColorField(course),
      sessionRowsMarkup: course.sessions.map((session, index) => this.renderSessionRow(session, index)).join(''),
    });
  }

  private renderCourseColorField(course: Course): string {
    return renderCourseColorFieldSection({
      courses: this.getActiveBoard().courses,
      course,
      isExpanded: this.isCourseColorFieldExpanded,
    });
  }

  private renderSessionRow(session: CourseSession, index: number): string {
    return renderSessionRowMarkup({
      session,
      index,
      renderSessionTimeInput: (sessionId, fieldName, value, pairedValue) =>
        this.renderSessionTimeInput(sessionId, fieldName, value, pairedValue),
    });
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
              ${TIMETABLE_DAY_ORDER.map(
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
                ${TIMETABLE_DAY_ORDER.map((day) => {
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
                          const blockHeight = Math.max(
                            this.getMinimumSessionBlockHeight(),
                            (session.endMinutes - session.startMinutes) * pixelsPerMinute - 8,
                          );
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

  renderAgendaItem(item: AgendaItem): string {
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

  async handleCourseInput(form: HTMLFormElement): Promise<void> {
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
    if (target instanceof HTMLInputElement && event.type === 'input') {
      if (target.type === 'color') {
        return true;
      }

      if (target.dataset.colorControl === 'rgb') {
        return true;
      }
    }

    if (!isCompositionTextField(target)) {
      return false;
    }

    return this.composingField === target || ('isComposing' in event && Boolean((event as InputEvent).isComposing));
  }

  applyLocalUpdate(
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

  clearAutosaveTimer(): void {
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

  private syncCourseColorControls(form: HTMLFormElement, target: HTMLElement, commitRgbInputs = false): void {
    if (!(target instanceof HTMLInputElement)) {
      return;
    }

    if (target.type === 'color') {
      this.applyCourseColor(form, target.value);
      return;
    }

    if (target.dataset.colorControl !== 'rgb') {
      return;
    }

    const colorInput = form.querySelector<HTMLInputElement>('input[name="color"]');
    const currentColor = sanitizeColor(colorInput?.value ?? '#7c72ff');
    const currentRgb = hexColorToRgb(currentColor);
    const nextColor = rgbToHexColor({
      red: this.readCourseColorChannel(form, 'red', currentRgb.red),
      green: this.readCourseColorChannel(form, 'green', currentRgb.green),
      blue: this.readCourseColorChannel(form, 'blue', currentRgb.blue),
    });

    this.applyCourseColor(form, nextColor, { syncRgbInputs: commitRgbInputs });
  }

  private applyCourseColor(form: HTMLFormElement, color: string, options: { syncRgbInputs?: boolean } = {}): void {
    const nextColor = sanitizeColor(color);
    const colorInput = form.querySelector<HTMLInputElement>('input[name="color"]');
    if (!colorInput) {
      return;
    }

    colorInput.value = nextColor;

    const rgb = hexColorToRgb(nextColor);
    if (options.syncRgbInputs !== false) {
      (['red', 'green', 'blue'] as const).forEach((channel) => {
        const input = form.querySelector<HTMLInputElement>(
          `[data-color-control="rgb"][data-color-channel="${channel}"]`,
        );
        if (input) {
          input.value = String(rgb[channel]);
        }
      });
    }

    this.updateCourseColorPreview(form, nextColor, rgb);
  }

  private readCourseColorChannel(form: HTMLFormElement, channel: CourseColorChannel, fallback: number): number {
    const input = form.querySelector<HTMLInputElement>(`[data-color-control="rgb"][data-color-channel="${channel}"]`);
    if (!input) {
      return fallback;
    }

    const parsed = Number(input.value);
    if (!Number.isFinite(parsed)) {
      return fallback;
    }

    return Math.max(0, Math.min(255, Math.round(parsed)));
  }

  private syncCourseColorFieldDisclosure(form: HTMLFormElement): void {
    const toggle = form.querySelector<HTMLButtonElement>('[data-action="toggle-color-field"]');
    const panel = form.querySelector<HTMLElement>('#course-color-panel');
    if (!toggle || !panel) {
      this.renderFrame(true);
      return;
    }

    const isExpanded = this.isCourseColorFieldExpanded;
    toggle.setAttribute('aria-expanded', isExpanded ? 'true' : 'false');
    toggle.setAttribute('aria-label', isExpanded ? '추천 색상과 RGB 미세 조정 접기' : '추천 색상과 RGB 미세 조정 펼치기');

    const label = toggle.querySelector<HTMLElement>('.color-field-toggle-label');
    if (label) {
      label.textContent = isExpanded ? '접기' : '펼치기';
    }

    if (isExpanded) {
      panel.removeAttribute('hidden');
      return;
    }

    panel.setAttribute('hidden', '');
  }

  private updateCourseColorPreview(form: HTMLFormElement, color: string, rgb = hexColorToRgb(color)): void {
    const normalizedColor = sanitizeColor(color);
    [...form.querySelectorAll<HTMLElement>('[data-color-preview-swatch]')].forEach((previewSwatch) => {
      previewSwatch.style.setProperty('--swatch', normalizedColor);
    });

    [...form.querySelectorAll<HTMLElement>('[data-color-preview-hex]')].forEach((previewHex) => {
      previewHex.textContent = normalizedColor.toUpperCase();
    });

    [...form.querySelectorAll<HTMLElement>('[data-color-preview-rgb]')].forEach((previewRgb) => {
      previewRgb.textContent = `R ${rgb.red} · G ${rgb.green} · B ${rgb.blue}`;
    });

    [...form.querySelectorAll<HTMLElement>('[data-color-option]')].forEach((option) => {
      const isActive = sanitizeColor(option.dataset.color ?? '') === normalizedColor;
      option.classList.toggle('is-active', isActive);
      option.setAttribute('aria-pressed', isActive ? 'true' : 'false');
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
      color: sanitizeColor(this.readTextField(form, 'color') || '#7c72ff'),
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
      renderDragPreviewFromModule(this as never);
    }
    this.queueTimetableFitSync(preserveFocus);
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

  getTimetablePixelsPerMinute(): number {
    return this.timetableFitPixelsPerMinute ?? getTimetablePixelsPerMinute(this.viewportHeight || this.getViewportHeight());
  }

  withUpdatedBoard(mutator: (board: TimetableBoard) => TimetableBoard): AppData {
    if (!this.data) {
      throw new Error('앱 데이터가 아직 준비되지 않았습니다.');
    }

    const activeBoard = this.getActiveBoard();
    return {
      ...this.data,
      boards: this.data.boards.map((board) => (board.id === activeBoard.id ? mutator(board) : board)),
    };
  }

  getActiveBoard(): TimetableBoard {
    if (!this.data) {
      throw new Error('앱 데이터가 아직 준비되지 않았습니다.');
    }

    const { activeBoardId, boards } = this.data;
    return boards.find((board) => board.id === activeBoardId) ?? boards[0];
  }

  getSelectedCourse(): Course | null {
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

  getErrorMessage(error: unknown): string {
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


const feedbackControllerMethods = {
  startCurrentTimeTicker(this: SoostaApp): void {
    startCurrentTimeTickerFromModule(this);
  },
  stopCurrentTimeTicker(this: SoostaApp): void {
    stopCurrentTimeTickerFromModule(this);
  },
  syncCurrentTimeUi(this: SoostaApp, now = new Date()): void {
    syncCurrentTimeUiFromModule(this, now);
  },
  queueCurrentTimeIndicatorSync(this: SoostaApp): void {
    queueCurrentTimeIndicatorSyncFromModule(this);
  },
  cancelQueuedCurrentTimeIndicatorSync(this: SoostaApp): void {
    cancelQueuedCurrentTimeIndicatorSyncFromModule(this);
  },
  syncCurrentTimeIndicator(this: SoostaApp, now = new Date()): void {
    syncCurrentTimeIndicatorFromModule(this, now);
  },
  renderBannerToast(this: SoostaApp): void {
    renderBannerToastFromModule(this);
  },
  startReminderSweepLoop(this: SoostaApp): void {
    startReminderSweepLoopFromModule(this);
  },
  stopReminderSweepLoop(this: SoostaApp): void {
    stopReminderSweepLoopFromModule(this);
  },
  areLectureRemindersEnabled(this: SoostaApp): boolean {
    return areLectureRemindersEnabledFromModule(this);
  },
  getLectureReminderLeadMinutes(this: SoostaApp): LectureReminderLeadMinutes[] {
    return getLectureReminderLeadMinutesFromModule(this);
  },
  getLectureReminderSummary(this: SoostaApp): string {
    return getLectureReminderSummaryFromModule(this);
  },
  runReminderSweep(this: SoostaApp): void {
    runReminderSweepFromModule(this);
  },
  async triggerManualLectureReminder(this: SoostaApp): Promise<void> {
    await triggerManualLectureReminderFromModule(this);
  },
  dismissLectureReminder(this: SoostaApp): void {
    dismissLectureReminderFromModule(this);
  },
  showBanner(this: SoostaApp, banner: Banner): void {
    showBannerFromModule(this, banner);
  },
  dismissBanner(this: SoostaApp, immediate = false): void {
    dismissBannerFromModule(this, immediate);
  },
};

const sessionTimeControllerMethods = {
  renderSessionTimeInput(this: SoostaApp, sessionId: string, name: SessionTimeFieldName, value: string, pairedValue?: string): string {
    return renderSessionTimeInputFromModule(sessionId, name, value, pairedValue);
  },
  restorePendingSessionTimeTriggerFocus(this: SoostaApp): void {
    restorePendingSessionTimeTriggerFocusFromModule(this as never);
  },
  resumePendingSessionTimeWidgetOpen(this: SoostaApp): void {
    resumePendingSessionTimeWidgetOpenFromModule(this as never);
  },
  renderOpenSessionTimeWidget(this: SoostaApp): void {
    renderOpenSessionTimeWidgetFromModule(this as never);
  },
  syncSessionEndTimeAfterStartChange(this: SoostaApp, sessionId: string, startValue: string): void {
    syncSessionEndTimeAfterStartChangeFromModule(this as never, sessionId, startValue);
  },
  closeSessionTimeWidget(this: SoostaApp, options: { reason: SessionTimeWidgetCloseReason; outsideTarget?: HTMLElement | null }): void {
    closeSessionTimeWidgetFromModule(this as never, options);
  },
  handleSessionTimeWidgetClick(this: SoostaApp, target: HTMLElement): boolean {
    return handleSessionTimeWidgetClickFromModule(this as never, target);
  },
};

const dragDropControllerMethods = {
  startSessionDrag(this: SoostaApp, event: PointerEvent, block: HTMLElement): void {
    startSessionDragFromModule(this as never, event, block);
  },
  handleSessionDragMove(this: SoostaApp, event: PointerEvent): void {
    handleSessionDragMoveFromModule(this as never, event);
  },
  async finishSessionDrag(this: SoostaApp, event: PointerEvent): Promise<void> {
    await finishSessionDragFromModule(this as never, event);
  },
  resetSessionDrag(this: SoostaApp): void {
    resetSessionDragFromModule(this as never);
  },
  consumeSuppressedSessionBlockClick(this: SoostaApp, target: HTMLElement): boolean {
    return consumeSuppressedSessionBlockClickFromModule(this as never, target);
  },
  syncSessionDragToViewport(this: SoostaApp): void {
    syncSessionDragToViewportFromModule(this as never);
  },
};

const routingControllerMethods = {
  bindEvents(this: SoostaApp): void {
    bindRendererEvents(this as never);
  },
  async handleAction(this: SoostaApp, action: string, element: HTMLElement): Promise<void> {
    await handleRendererAction(this as never, action, element);
  },
};

Object.assign(SoostaApp.prototype, feedbackControllerMethods, sessionTimeControllerMethods, dragDropControllerMethods, routingControllerMethods);

export const bootstrapApp = async (root: HTMLDivElement | null): Promise<void> => {
  if (!root) {
    throw new Error('#app 루트를 찾을 수 없습니다.');
  }

  const app = new SoostaApp(root);
  await app.init();
};
