import { generateId } from '../../shared/data';
import { createBlankBoard, createBlankSession, duplicateBoard, generateRandomCourseColor, validateCourse } from '../domain/model';
import { getDefaultLectureReminderLeadMinutes, sortUniqueLectureReminderLeadMinutes } from '../../shared/reminders';
import { formatReminderLeadLabel, formatReminderLeadList, isReminderLeadMinutes } from './shared';
import type { AppData, LectureReminderLeadMinutes } from '../../shared/types';

const INVALID_DRAFT_BLOCKED_ACTIONS = [
  'select-board',
  'new-board',
  'duplicate-board',
  'delete-board',
  'delete-course',
  'delete-course-from-menu',
  'export-data',
  'import-data',
  'toggle-lecture-reminders',
  'toggle-lecture-reminder-lead',
  'reset-lecture-reminder-times',
] as const;

type ActionHandlerContext = {
  data: AppData | null;
  selectedCourseId: string | null;
  pendingCourseId: string | null;
  hasUnsavedChanges: boolean;
  canAutosaveDraft: boolean;
  isCourseColorFieldExpanded: boolean;
  lastReminderSweepAt: number;
  localRevision: number;
  lastSavedRevision: number;
  saveInFlightRevision: number | null;
  isTimetableFitMode: boolean;
  banner: { tone: 'success' | 'error' | 'info'; text: string } | null;
  confirmDiscardInvalidInspectorDraft(): boolean;
  beginInspectorOpenAnimation(): void;
  showBanner(banner: { tone: 'success' | 'error' | 'info'; text: string }): void;
  dismissBanner(immediate?: boolean): void;
  render(): void;
  renderFrame(preserveFocus?: boolean): void;
  persist(nextData: AppData, successText: string, afterSuccess?: () => void): Promise<void>;
  getActiveBoard(): AppData['boards'][number];
  deleteCourse(courseId: string, openBlankForm?: boolean): Promise<void>;
  applyCourseColor(form: HTMLFormElement, color: string): void;
  syncCourseColorFieldDisclosure(form: HTMLFormElement): void;
  handleCourseInput(form: HTMLFormElement): Promise<void>;
  getEditableCourse(): ReturnType<ActionHandlerContext['getActiveBoard']>['courses'][number];
  applyLocalUpdate(
    nextData: AppData,
    messages: { successText: string; invalidText: string },
    canAutosave: boolean,
    preserveFocus?: boolean,
  ): void;
  upsertCourse(course: ReturnType<ActionHandlerContext['getActiveBoard']>['courses'][number]): AppData;
  getSelectedCourse(): ReturnType<ActionHandlerContext['getActiveBoard']>['courses'][number] | null;
  areLectureRemindersEnabled(): boolean;
  getLectureReminderLeadMinutes(): LectureReminderLeadMinutes[];
  dismissLectureReminder(): void;
  runReminderSweep(): void;
  triggerManualLectureReminder(): Promise<void>;
  exportTimetableJpeg(): Promise<void>;
  toggleTimetableFitMode(): void;
  clearAutosaveTimer(): void;
  getErrorMessage(error: unknown): string;
  handleCloseInspector(): Promise<void>;
};

export const handleRendererAction = async (app: ActionHandlerContext, action: string, element: HTMLElement): Promise<void> => {
  (app as ActionHandlerContext & { closeSessionContextMenu: () => void }).closeSessionContextMenu();

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

  if (!app.data) {
    return;
  }

  if (
    app.hasUnsavedChanges &&
    !app.canAutosaveDraft &&
    INVALID_DRAFT_BLOCKED_ACTIONS.includes(action as (typeof INVALID_DRAFT_BLOCKED_ACTIONS)[number])
  ) {
    app.showBanner({ tone: 'error', text: '입력을 먼저 정리해주세요. 저장이 보류된 항목이 있어요.' });
    return;
  }

  switch (action) {
    case 'new-course':
      if (!app.confirmDiscardInvalidInspectorDraft()) {
        return;
      }
      app.selectedCourseId = null;
      app.pendingCourseId = generateId('course');
      app.beginInspectorOpenAnimation();
      app.showBanner({ tone: 'info', text: '강의 입력 폼을 초기화했어요.' });
      app.render();
      return;
    case 'select-course':
      if (!app.confirmDiscardInvalidInspectorDraft()) {
        return;
      }
      app.selectedCourseId = element.dataset.courseId ?? null;
      app.pendingCourseId = null;
      app.beginInspectorOpenAnimation();
      app.dismissBanner();
      app.render();
      return;
    case 'select-board': {
      const boardId = element.dataset.boardId;
      if (!boardId || boardId === app.data.activeBoardId) {
        return;
      }

      await app.persist(
        { ...app.data, activeBoardId: boardId },
        '보드를 전환했어요.',
        () => {
          app.selectedCourseId = null;
          app.pendingCourseId = null;
        },
      );
      return;
    }
    case 'new-board': {
      const newBoard = createBlankBoard(app.data.boards.length);
      await app.persist(
        {
          ...app.data,
          activeBoardId: newBoard.id,
          boards: [newBoard, ...app.data.boards],
        },
        '새 시간표 보드를 만들었어요.',
        () => {
          app.selectedCourseId = null;
          app.pendingCourseId = null;
        },
      );
      return;
    }
    case 'duplicate-board': {
      const duplicated = duplicateBoard(app.getActiveBoard());
      await app.persist(
        {
          ...app.data,
          activeBoardId: duplicated.id,
          boards: [duplicated, ...app.data.boards],
        },
        '현재 보드를 사본으로 복제했어요.',
        () => {
          app.selectedCourseId = null;
          app.pendingCourseId = null;
        },
      );
      return;
    }
    case 'delete-board': {
      if (app.data.boards.length === 1) {
        app.showBanner({ tone: 'error', text: '마지막 보드는 삭제할 수 없어요.' });
        return;
      }

      const approved = window.confirm('현재 시간표 보드를 삭제할까요? 이 작업은 되돌릴 수 없습니다.');
      if (!approved) {
        return;
      }

      const activeBoardId = app.data.activeBoardId;
      const remainingBoards = app.data.boards.filter((board) => board.id !== activeBoardId);
      await app.persist(
        {
          ...app.data,
          activeBoardId: remainingBoards[0].id,
          boards: remainingBoards,
        },
        '보드를 삭제했어요.',
        () => {
          app.selectedCourseId = null;
          app.pendingCourseId = null;
        },
      );
      return;
    }
    case 'delete-course': {
      const courseId = element.dataset.courseId ?? app.selectedCourseId;
      if (!courseId) {
        return;
      }

      await app.deleteCourse(courseId);
      return;
    }
    case 'delete-course-from-menu': {
      const courseId = element.dataset.courseId;
      if (!courseId) {
        return;
      }

      await app.deleteCourse(courseId, false);
      return;
    }
    case 'toggle-color-field': {
      app.isCourseColorFieldExpanded = !app.isCourseColorFieldExpanded;
      const form = element.closest<HTMLFormElement>('form');
      if (form?.id === 'course-form') {
        app.syncCourseColorFieldDisclosure(form);
      } else {
        app.renderFrame(true);
      }
      return;
    }
    case 'recommend-color': {
      const color = element.dataset.color;
      const form = element.closest<HTMLFormElement>('form') ?? document.querySelector<HTMLFormElement>('#course-form');
      if (!color || !form) {
        return;
      }

      app.applyCourseColor(form, color);
      await app.handleCourseInput(form);
      return;
    }
    case 'randomize-color': {
      const form = element.closest<HTMLFormElement>('form') ?? document.querySelector<HTMLFormElement>('#course-form');
      if (!form) {
        return;
      }

      const currentColor = form.querySelector<HTMLInputElement>('input[name="color"]')?.value;
      const nextColor = generateRandomCourseColor({
        excludeColors: [
          ...(currentColor ? [currentColor] : []),
          ...app.getActiveBoard().courses.map((course) => course.color),
        ],
      });

      app.applyCourseColor(form, nextColor);
      await app.handleCourseInput(form);
      return;
    }
    case 'add-session': {
      const course = app.getEditableCourse();
      const nextCourse = {
        ...course,
        sessions: [...course.sessions, createBlankSession()],
      };
      app.selectedCourseId = nextCourse.id;
      app.pendingCourseId = null;
      app.applyLocalUpdate(
        app.upsertCourse(nextCourse),
        {
          successText: '세션 변경사항을 자동 저장했어요.',
          invalidText: '세션 구성을 확인하면 자동 저장돼요.',
        },
        validateCourse(nextCourse).length === 0,
      );
      return;
    }
    case 'remove-session': {
      const course = app.getSelectedCourse();
      if (!course || course.sessions.length === 1) {
        app.showBanner({ tone: 'error', text: '세션은 최소 하나 이상 필요해요.' });
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
      app.applyLocalUpdate(
        app.upsertCourse(nextCourse),
        {
          successText: '세션 변경사항을 자동 저장했어요.',
          invalidText: '세션 구성을 확인하면 자동 저장돼요.',
        },
        validateCourse(nextCourse).length === 0,
      );
      return;
    }
    case 'toggle-lecture-reminders': {
      const nextEnabled = !app.areLectureRemindersEnabled();
      app.lastReminderSweepAt = Date.now();

      await app.persist(
        {
          ...app.data,
          preferences: {
            ...app.data.preferences,
            lectureRemindersEnabled: nextEnabled,
          },
        },
        nextEnabled ? '강의 알림을 켰어요.' : '강의 알림을 껐어요.',
        () => {
          if (!nextEnabled) {
            app.dismissLectureReminder();
          }
        },
      );

      app.lastReminderSweepAt = Date.now();
      if (nextEnabled) {
        app.runReminderSweep();
      }
      return;
    }
    case 'toggle-lecture-reminder-lead': {
      const requestedLeadMinutes = Number(element.dataset.leadMinutes);
      if (!isReminderLeadMinutes(requestedLeadMinutes)) {
        return;
      }

      const currentLeadMinutes = app.getLectureReminderLeadMinutes();
      const nextLeadMinutes = currentLeadMinutes.includes(requestedLeadMinutes)
        ? currentLeadMinutes.filter((minutes) => minutes !== requestedLeadMinutes)
        : sortUniqueLectureReminderLeadMinutes([...currentLeadMinutes, requestedLeadMinutes]);

      app.lastReminderSweepAt = Date.now();
      await app.persist(
        {
          ...app.data,
          preferences: {
            ...app.data.preferences,
            lectureReminderLeadMinutes: nextLeadMinutes,
          },
        },
        nextLeadMinutes.includes(requestedLeadMinutes)
          ? `${formatReminderLeadLabel(requestedLeadMinutes)} 자동 알림을 추가했어요.`
          : `${formatReminderLeadLabel(requestedLeadMinutes)} 자동 알림을 해제했어요.`,
      );
      app.lastReminderSweepAt = Date.now();
      return;
    }
    case 'reset-lecture-reminder-times': {
      const nextLeadMinutes = getDefaultLectureReminderLeadMinutes();

      app.lastReminderSweepAt = Date.now();
      await app.persist(
        {
          ...app.data,
          preferences: {
            ...app.data.preferences,
            lectureReminderLeadMinutes: nextLeadMinutes,
          },
        },
        `알림 시각을 기본값(${formatReminderLeadList(nextLeadMinutes)})으로 되돌렸어요.`,
      );
      app.lastReminderSweepAt = Date.now();
      return;
    }
    case 'test-lecture-reminder':
      await app.triggerManualLectureReminder();
      return;
    case 'export-timetable-jpg':
      await app.exportTimetableJpeg();
      return;
    case 'toggle-timetable-fit':
      app.toggleTimetableFitMode();
      return;
    case 'export-data': {
      try {
        const result = await window.soosta.exportData(app.data);
        if (!result.cancelled) {
          app.showBanner({ tone: 'success', text: `시간표를 JSON으로 내보냈어요. ${result.filePath ?? ''}`.trim() });
        }
      } catch (error) {
        app.showBanner({ tone: 'error', text: app.getErrorMessage(error) });
      }
      return;
    }
    case 'import-data': {
      try {
        const result = await window.soosta.importData();
        if (!result.cancelled && result.data) {
          app.clearAutosaveTimer();
          app.data = result.data;
          (app as ActionHandlerContext & { lastPersistedData: AppData | null }).lastPersistedData = result.data;
          app.selectedCourseId = null;
          app.pendingCourseId = null;
          app.localRevision += 1;
          app.lastSavedRevision = app.localRevision;
          app.saveInFlightRevision = null;
          app.hasUnsavedChanges = false;
          app.canAutosaveDraft = false;
          app.showBanner({ tone: 'success', text: '백업 파일을 가져와 현재 시간표를 갱신했어요.' });
          app.render();
        }
      } catch (error) {
        app.showBanner({ tone: 'error', text: app.getErrorMessage(error) });
      }
      return;
    }
    case 'dismiss-lecture-reminder':
      app.dismissLectureReminder();
      return;
    case 'close-inspector':
      await app.handleCloseInspector();
      return;
    default:
      return;
  }
};
