import { DAY_LABELS, DAY_ORDER } from '../../shared/constants';
import type { DayKey } from '../../shared/types';
import {
  getGridRange,
  getSessionDropRejectMessage,
  resolveDraggedSessionPlacement,
  resolveSessionDropAction,
  swapBoardSessions,
  updateBoardSessionSchedule,
} from '../domain/timetable';
import { minutesToTime } from '../domain/time';
import type { SoostaApp } from '../app';
import { dismissBanner, showBanner } from './feedback';
import {
  sanitizeColor,
  SESSION_DRAG_START_DISTANCE_PX,
  type SessionDragState,
} from './shared';

export const startSessionDrag = (app: SoostaApp, event: PointerEvent, block: HTMLElement): void => {
  if (!app.data || event.button !== 0) {
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
  app.pendingSessionDrag = {
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
};

export const handleSessionDragMove = (app: SoostaApp, event: PointerEvent): void => {
  if (!app.data) {
    return;
  }

  if (!app.dragState && app.pendingSessionDrag) {
    if (event.pointerId !== app.pendingSessionDrag.pointerId) {
      return;
    }

    const deltaX = event.clientX - app.pendingSessionDrag.originClientX;
    const deltaY = event.clientY - app.pendingSessionDrag.originClientY;
    if (Math.hypot(deltaX, deltaY) < SESSION_DRAG_START_DISTANCE_PX) {
      return;
    }

    if (!activatePendingSessionDrag(app)) {
      return;
    }
  }

  if (!app.dragState) {
    return;
  }

  app.currentDragPointer = { clientX: event.clientX, clientY: event.clientY };
  app.pendingDragPointer = { clientX: event.clientX, clientY: event.clientY };
  if (app.dragMoveFrame !== null) {
    return;
  }

  app.dragMoveFrame = window.requestAnimationFrame(() => {
    app.dragMoveFrame = null;
    const pointer = app.pendingDragPointer;
    app.pendingDragPointer = null;
    if (!pointer) {
      return;
    }

    updateSessionDragPlacement(app, pointer.clientX, pointer.clientY);
  });
};

export const finishSessionDrag = async (app: SoostaApp, event: PointerEvent): Promise<void> => {
  if (app.pendingSessionDrag) {
    if (event.pointerId === app.pendingSessionDrag.pointerId) {
      app.pendingSessionDrag = null;
    }
    return;
  }

  if (!app.dragState || !app.data) {
    return;
  }

  const dragState = app.dragState;
  const dropTarget = getDropTargetSession(event.clientX, event.clientY, dragState);
  const action = resolveSessionDropAction(
    app.getActiveBoard(),
    { courseId: dragState.courseId, sessionId: dragState.sessionId },
    {
      day: dragState.previewDay,
      startMinutes: dragState.previewStartMinutes,
      endMinutes: dragState.previewEndMinutes,
    },
    dropTarget,
  );
  suppressSessionBlockClickTemporarily(app);
  resetSessionDrag(app);

  if (action.kind === 'reject') {
    showBanner(app, {
      tone: 'error',
      text: getSessionDropRejectMessage(action.reason),
    });
    app.render();
    return;
  }

  if (action.kind === 'swap') {
    const nextData = app.withUpdatedBoard((board) => ({
      ...swapBoardSessions(
        board,
        { courseId: dragState.courseId, sessionId: dragState.sessionId },
        action.target,
      ),
      updatedAt: new Date().toISOString(),
    }));

    app.applyLocalUpdate(
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
    dismissBanner(app);
    app.render();
    return;
  }

  const nextData = app.withUpdatedBoard((board) => ({
    ...updateBoardSessionSchedule(board, dragState.courseId, dragState.sessionId, {
      day: action.placement.day,
      startMinutes: action.placement.startMinutes,
      endMinutes: action.placement.endMinutes,
    }),
    updatedAt: new Date().toISOString(),
  }));

  app.applyLocalUpdate(
    nextData,
    {
      successText: '드래그한 시간표 변경사항을 자동 저장했어요.',
      invalidText: '드래그 변경사항을 반영하지 못했어요.',
    },
    true,
  );
};

export const resetSessionDrag = (app: SoostaApp): void => {
  if (app.dragMoveFrame !== null) {
    window.cancelAnimationFrame(app.dragMoveFrame);
    app.dragMoveFrame = null;
  }
  app.pendingSessionDrag = null;
  app.pendingDragPointer = null;
  app.currentDragPointer = null;
  app.dragState = null;
  document.body.classList.remove('is-dragging-session');
  app.root.querySelector('.session-drag-preview')?.remove();
  app.root.querySelector('.session-block.is-drag-origin')?.classList.remove('is-drag-origin');
};

const activatePendingSessionDrag = (app: SoostaApp): boolean => {
  if (!app.data || !app.pendingSessionDrag) {
    return false;
  }

  const dragColumns = getDragColumns(app);
  if (dragColumns.length === 0) {
    app.pendingSessionDrag = null;
    return false;
  }

  const pendingDrag = app.pendingSessionDrag;
  const range = getGridRange(app.getActiveBoard());
  app.clearAutosaveTimer();
  try {
    pendingDrag.block.setPointerCapture(pendingDrag.pointerId);
  } catch (_error) {
    // Best-effort only; dragging still works without pointer capture.
  }

  pendingDrag.block.classList.add('is-drag-origin');
  document.body.classList.add('is-dragging-session');
  app.currentDragPointer = { clientX: pendingDrag.originClientX, clientY: pendingDrag.originClientY };
  app.dragState = {
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
  app.pendingSessionDrag = null;
  renderDragPreview(app);
  return true;
};

const suppressSessionBlockClickTemporarily = (app: SoostaApp): void => {
  clearSuppressedSessionBlockClick(app);
  app.suppressSessionBlockClick = true;
  app.suppressSessionBlockClickTimer = setTimeout(() => {
    clearSuppressedSessionBlockClick(app);
  }, 0);
};

export const consumeSuppressedSessionBlockClick = (app: SoostaApp, target: HTMLElement): boolean => {
  if (!app.suppressSessionBlockClick || !target.closest('.session-block')) {
    return false;
  }

  clearSuppressedSessionBlockClick(app);
  return true;
};

export const clearSuppressedSessionBlockClick = (app: SoostaApp): void => {
  if (app.suppressSessionBlockClickTimer !== null) {
    clearTimeout(app.suppressSessionBlockClickTimer);
    app.suppressSessionBlockClickTimer = null;
  }

  app.suppressSessionBlockClick = false;
};

export const renderDragPreview = (app: SoostaApp): void => {
  if (!app.dragState || !app.data) {
    return;
  }

  const dayColumn = app.dragState.dragColumns.find((column) => column.day === app.dragState?.previewDay)?.element;
  if (!dayColumn) {
    return;
  }

  const board = app.getActiveBoard();
  const pixelsPerMinute = app.getTimetablePixelsPerMinute();
  const top = (app.dragState.previewStartMinutes - app.dragState.gridStartMinutes) * pixelsPerMinute;
  const blockHeight = Math.max(app.getMinimumSessionBlockHeight(), app.dragState.durationMinutes * pixelsPerMinute - 8);
  const course = board.courses.find((item) => item.id === app.dragState?.courseId);
  const preview = app.root.querySelector<HTMLElement>('.session-drag-preview') ?? document.createElement('div');

  preview.className = 'session-block session-drag-preview';
  preview.style.setProperty('--course-color', sanitizeColor(course?.color ?? '#7c72ff'));
  preview.style.top = `${top + 4}px`;
  preview.style.height = `${blockHeight}px`;
  preview.style.left = '6px';
  preview.style.width = 'calc(100% - 12px)';
  preview.innerHTML = `
    <span class="session-block-title">${course?.title ?? '드래그 중'}</span>
    <span class="session-block-meta session-block-time">${app.dragState.previewLabel}</span>
    <span class="session-block-meta">${DAY_LABELS[app.dragState.previewDay].full}</span>
  `;
  dayColumn.append(preview);
};

const getDragColumns = (app: SoostaApp): SessionDragState['dragColumns'] =>
  [...app.root.querySelectorAll<HTMLElement>('.day-column')]
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

const getDropTargetSession = (
  clientX: number,
  clientY: number,
  dragState: SessionDragState,
): { courseId: string; sessionId: string } | null => {
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
};

const updateSessionDragPlacement = (app: SoostaApp, clientX: number, clientY: number): void => {
  if (!app.dragState) {
    return;
  }

  app.dragState.dragColumns = getDragColumns(app);
  if (app.dragState.dragColumns.length === 0) {
    return;
  }

  const hoveredIndex = app.dragState.dragColumns.reduce((closestIndex, column, index) => {
    if (clientX >= column.rect.left && clientX <= column.rect.right) {
      return index;
    }

    const closestRect = app.dragState?.dragColumns[closestIndex]?.rect;
    if (!closestRect) {
      return index;
    }

    const closestDistance = Math.min(Math.abs(clientX - closestRect.left), Math.abs(clientX - closestRect.right));
    const distance = Math.min(Math.abs(clientX - column.rect.left), Math.abs(clientX - column.rect.right));
    return distance < closestDistance ? index : closestIndex;
  }, 0);

  const columnRect = app.dragState.dragColumns[hoveredIndex]?.rect;
  if (!columnRect) {
    return;
  }

  const pixelsPerMinute = app.getTimetablePixelsPerMinute();
  const rawStartMinutes = app.dragState.gridStartMinutes + (clientY - columnRect.top - app.dragState.offsetY) / pixelsPerMinute;
  const placement = resolveDraggedSessionPlacement({
    dayIndex: hoveredIndex,
    rawStartMinutes,
    durationMinutes: app.dragState.durationMinutes,
    gridStartMinutes: app.dragState.gridStartMinutes,
    gridEndMinutes: app.dragState.gridEndMinutes,
  });

  app.dragState.previewDay = placement.day;
  app.dragState.previewStartMinutes = placement.startMinutes;
  app.dragState.previewEndMinutes = placement.endMinutes;
  app.dragState.previewLabel = `${minutesToTime(app.dragState.previewStartMinutes)}–${minutesToTime(app.dragState.previewEndMinutes)}`;
  renderDragPreview(app);
};

export const syncSessionDragToViewport = (app: SoostaApp): void => {
  if (!app.dragState || !app.currentDragPointer) {
    return;
  }

  updateSessionDragPlacement(app, app.currentDragPointer.clientX, app.currentDragPointer.clientY);
};
