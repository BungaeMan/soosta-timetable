import { handleSessionTimeWidgetClick, closeSessionTimeWidget } from './session-time';
import { consumeSuppressedSessionBlockClick, startSessionDrag, handleSessionDragMove, finishSessionDrag, resetSessionDrag } from './drag-drop';
import { isCompositionTextField } from './shared';
import type { AppData, Unsubscribe } from '../../shared/types';

type EventBindingContext = {
  root: HTMLDivElement;
  data: AppData | null;
  banner: { tone: 'success' | 'error' | 'info'; text: string } | null;
  resizeFrame: number | null;
  viewportWidth: number;
  viewportHeight: number;
  unsubscribeWindowMaximized: Unsubscribe | null;
  confirmDiscardInvalidInspectorDraft(): boolean;
  shouldClearCourseSelectionFromMainPlanClick(target: HTMLElement): boolean;
  clearCourseSelection(preserveFocus?: boolean): void;
  dismissBanner(immediate?: boolean): void;
  shouldDeferFormMutation(event: Event, target: HTMLElement): boolean;
  syncCourseColorControls(form: HTMLFormElement, target: HTMLElement, commitRgbInputs?: boolean): void;
  handleFormMutation(form: HTMLFormElement): void;
  handleSubmit(form: HTMLFormElement): Promise<void>;
  openSessionContextMenu(block: HTMLElement, clientX: number, clientY: number): void;
  closeSessionContextMenu(): void;
  renderFrame(preserveFocus?: boolean): void;
  syncSessionDragToViewport(): void;
  queueCurrentTimeIndicatorSync(): void;
  cancelQueuedCurrentTimeIndicatorSync(): void;
  syncCurrentTimeUi(now?: Date): void;
  runReminderSweep(): void;
  flushAutosave(): Promise<void>;
  clearAutosaveTimer(): void;
  stopCurrentTimeTicker(): void;
  stopReminderSweepLoop(): void;
  dismissLectureReminder(): void;
  resumeDeferredCompositionWork(): void;
  bindLayoutResizeObserver(): void;
  query<T extends Element = HTMLElement>(selector: string): T;
  composingField: HTMLInputElement | HTMLTextAreaElement | null;
};

export const bindRendererEvents = (app: EventBindingContext): void => {
  app.root.addEventListener('click', (event) => {
    const target = event.target as HTMLElement;
    if (consumeSuppressedSessionBlockClick(app as never, target)) {
      return;
    }

    if (app.banner && !target.closest('.banner')) {
      app.dismissBanner();
    }

    if (app.data && app.shouldClearCourseSelectionFromMainPlanClick(target)) {
      if (!app.confirmDiscardInvalidInspectorDraft()) {
        return;
      }
      app.clearCourseSelection();
    }

    if (handleSessionTimeWidgetClick(app as never, target)) {
      event.preventDefault();
      return;
    }

    const contextMenuAction = target.closest<HTMLElement>('[data-context-action]');
    if (contextMenuAction) {
      event.preventDefault();
      event.stopPropagation();
      const action = contextMenuAction.dataset.contextAction;
      if (action === 'delete-course' && contextMenuAction.dataset.courseId) {
        void (app as EventBindingContext & { handleAction(action: string, element: HTMLElement): Promise<void> }).handleAction(
          'delete-course-from-menu',
          contextMenuAction,
        );
      }
      app.closeSessionContextMenu();
      return;
    }

    const actionElement = target.closest<HTMLElement>('[data-action]');
    if (actionElement) {
      event.preventDefault();
      void (app as EventBindingContext & { handleAction(action: string, element: HTMLElement): Promise<void> }).handleAction(
        actionElement.dataset.action ?? '',
        actionElement,
      );
      return;
    }

    if (!target.closest('.session-context-menu')) {
      app.closeSessionContextMenu();
    }
  });

  const handleFieldMutation = (event: Event) => {
    const target = event.target as HTMLElement;
    const form = target.closest<HTMLFormElement>('form');
    if (!form) {
      return;
    }

    if (form.id === 'course-form') {
      if (target instanceof HTMLInputElement && target.type === 'color') {
        app.syncCourseColorControls(form, target, false);
      }

      if (target instanceof HTMLInputElement && target.dataset.colorControl === 'rgb') {
        app.syncCourseColorControls(form, target, event.type === 'change');
      }
    }

    if (app.shouldDeferFormMutation(event, target)) {
      app.composingField = isCompositionTextField(target) ? target : app.composingField;
      return;
    }

    app.handleFormMutation(form);
  };

  app.root.addEventListener('input', handleFieldMutation);
  app.root.addEventListener('change', handleFieldMutation);

  app.root.addEventListener('compositionstart', (event) => {
    const target = event.target;
    if (isCompositionTextField(target)) {
      app.composingField = target;
    }
  });

  app.root.addEventListener('compositionend', (event) => {
    const target = event.target;
    if (!isCompositionTextField(target)) {
      return;
    }

    if (app.composingField === target) {
      app.composingField = null;
    }
    app.resumeDeferredCompositionWork();
  });

  app.root.addEventListener('submit', (event) => {
    event.preventDefault();
    const form = event.target as HTMLFormElement;
    void app.handleSubmit(form);
  });

  app.root.addEventListener('pointerdown', (event) => {
    const target = event.target as HTMLElement;
    const block = target.closest<HTMLElement>('.session-block');
    if (!block) {
      return;
    }

    startSessionDrag(app as never, event, block);
  });

  app.root.addEventListener('contextmenu', (event) => {
    const target = event.target as HTMLElement;
    const block = target.closest<HTMLElement>('.session-block');
    if (!block) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    app.openSessionContextMenu(block, event.clientX, event.clientY);
  });

  window.addEventListener('pointermove', (event) => {
    handleSessionDragMove(app as never, event);
  });
  window.addEventListener('pointerup', (event) => {
    void finishSessionDrag(app as never, event);
  });
  window.addEventListener('pointercancel', () => {
    resetSessionDrag(app as never);
  });
  window.addEventListener('resize', () => {
    if (app.resizeFrame !== null) {
      window.cancelAnimationFrame(app.resizeFrame);
    }

    closeSessionTimeWidget(app as never, { reason: 'resize' });
    app.resizeFrame = window.requestAnimationFrame(() => {
      app.resizeFrame = null;
      app.viewportWidth = Math.max(app.root.clientWidth, window.innerWidth || 0);
      app.viewportHeight = Math.max(app.root.clientHeight, window.innerHeight || 0);
      app.renderFrame(true);
      app.syncSessionDragToViewport();
    });
  });

  window.addEventListener('focus', () => {
    app.syncCurrentTimeUi();
    app.runReminderSweep();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      app.syncCurrentTimeUi();
      app.runReminderSweep();
    }
  });
  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      if ((app as EventBindingContext & { dragState: unknown }).dragState) {
        resetSessionDrag(app as never);
        return;
      }

      if ((app as EventBindingContext & { sessionTimeWidget: unknown }).sessionTimeWidget) {
        closeSessionTimeWidget(app as never, { reason: 'outside' });
        return;
      }

      if ((app as EventBindingContext & { sessionContextMenu: unknown }).sessionContextMenu) {
        app.closeSessionContextMenu();
        return;
      }
    }

    if (event.key === 'Enter' && (app as EventBindingContext & { sessionTimeWidget: unknown }).sessionTimeWidget) {
      const activeElement = document.activeElement;
      if (activeElement instanceof HTMLElement && activeElement.closest('.session-time-popover')) {
        closeSessionTimeWidget(app as never, { reason: 'outside', outsideTarget: activeElement });
        event.preventDefault();
      }
    }
  });

  window.addEventListener('beforeunload', () => {
    if (app.resizeFrame !== null) {
      window.cancelAnimationFrame(app.resizeFrame);
      app.resizeFrame = null;
    }
    closeSessionTimeWidget(app as never, { reason: 'unload' });
    app.clearAutosaveTimer();
    void app.flushAutosave();
    app.stopCurrentTimeTicker();
    app.cancelQueuedCurrentTimeIndicatorSync();
    app.stopReminderSweepLoop();
    app.dismissLectureReminder();
    app.unsubscribeWindowMaximized?.();
  });
};
