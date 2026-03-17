import {
  DAY_ORDER,
  DEFAULT_GRID_END_MINUTES,
  DEFAULT_GRID_START_MINUTES,
  TIME_STEP_MINUTES,
} from '../../shared/constants';
import type {
  AgendaItem,
  BoardStats,
  ConflictRecord,
  FlattenedSession,
  FreeWindow,
  PositionedSession,
  DayKey,
  TimetableBoard,
} from '../../shared/types';
import {
  clampMinutesToStep,
  formatDuration,
  minutesToTime,
  timeToMinutes,
} from './time';

const minutesInDay = 24 * 60;
const MAX_SESSION_END_MINUTES = 23 * 60 + 30;
const MIN_SESSION_DURATION_MINUTES = TIME_STEP_MINUTES;

const jsDayToDayKey = (day: number) => {
  if (day >= 1 && day <= 6) {
    return DAY_ORDER[day - 1];
  }

  return null;
};

export interface CurrentTimeIndicatorState {
  day: DayKey;
  currentMinutes: number;
  offsetMinutes: number;
  label: string;
}

export const flattenBoardSessions = (board: TimetableBoard): FlattenedSession[] =>
  board.courses.flatMap((course) =>
    course.sessions.map((session) => ({
      courseId: course.id,
      courseTitle: course.title,
      instructor: course.instructor,
      courseLocation: course.location,
      courseColor: course.color,
      sessionId: session.id,
      day: session.day,
      start: session.start,
      end: session.end,
      location: session.location || course.location,
      startMinutes: timeToMinutes(session.start),
      endMinutes: timeToMinutes(session.end),
    })),
  );

export const detectConflicts = (board: TimetableBoard): ConflictRecord[] => {
  const flattened = flattenBoardSessions(board);
  const conflicts: ConflictRecord[] = [];

  DAY_ORDER.forEach((day) => {
    const items = flattened
      .filter((session) => session.day === day)
      .sort((left, right) => left.startMinutes - right.startMinutes || left.endMinutes - right.endMinutes);

    const active: FlattenedSession[] = [];

    items.forEach((item) => {
      const stillActive = active.filter((entry) => entry.endMinutes > item.startMinutes);
      stillActive.forEach((entry) => {
        conflicts.push({
          day,
          sessionIds: [entry.sessionId, item.sessionId],
          courseIds: [entry.courseId, item.courseId],
          startMinutes: Math.max(entry.startMinutes, item.startMinutes),
          endMinutes: Math.min(entry.endMinutes, item.endMinutes),
        });
      });

      stillActive.push(item);
      active.splice(0, active.length, ...stillActive);
    });
  });

  return conflicts;
};

export const getConflictSessionIds = (board: TimetableBoard): Set<string> => {
  const ids = new Set<string>();
  detectConflicts(board).forEach((conflict) => {
    conflict.sessionIds.forEach((sessionId) => ids.add(sessionId));
  });
  return ids;
};

export const getConflictingSessionIdsFor = (board: TimetableBoard, sessionIds: string[]): Set<string> => {
  const watched = new Set(sessionIds);
  const conflicts = new Set<string>();

  detectConflicts(board).forEach((conflict) => {
    if (conflict.sessionIds.some((sessionId) => watched.has(sessionId))) {
      conflict.sessionIds.forEach((sessionId) => conflicts.add(sessionId));
    }
  });

  return conflicts;
};

const layoutCluster = (
  cluster: FlattenedSession[],
  conflictSessionIds: Set<string>,
): PositionedSession[] => {
  const sorted = [...cluster].sort(
    (left, right) => left.startMinutes - right.startMinutes || left.endMinutes - right.endMinutes,
  );
  const columnEndTimes: number[] = [];
  const assigned = sorted.map((item) => {
    let columnIndex = columnEndTimes.findIndex((value) => value <= item.startMinutes);
    if (columnIndex === -1) {
      columnIndex = columnEndTimes.length;
      columnEndTimes.push(item.endMinutes);
    } else {
      columnEndTimes[columnIndex] = item.endMinutes;
    }

    return { item, columnIndex };
  });

  const totalColumns = Math.max(1, columnEndTimes.length);

  return assigned.map(({ item, columnIndex }) => ({
    ...item,
    leftPercent: (columnIndex / totalColumns) * 100,
    widthPercent: 100 / totalColumns,
    isConflict: conflictSessionIds.has(item.sessionId),
  }));
};

export const getPositionedSessions = (board: TimetableBoard): PositionedSession[] => {
  const flattened = flattenBoardSessions(board);
  const conflicts = getConflictSessionIds(board);
  const positioned: PositionedSession[] = [];

  DAY_ORDER.forEach((day) => {
    const sessions = flattened
      .filter((session) => session.day === day)
      .sort((left, right) => left.startMinutes - right.startMinutes || left.endMinutes - right.endMinutes);

    let cluster: FlattenedSession[] = [];
    let clusterEnd = -1;

    sessions.forEach((session) => {
      if (cluster.length === 0) {
        cluster = [session];
        clusterEnd = session.endMinutes;
        return;
      }

      if (session.startMinutes < clusterEnd) {
        cluster.push(session);
        clusterEnd = Math.max(clusterEnd, session.endMinutes);
        return;
      }

      positioned.push(...layoutCluster(cluster, conflicts));
      cluster = [session];
      clusterEnd = session.endMinutes;
    });

    if (cluster.length > 0) {
      positioned.push(...layoutCluster(cluster, conflicts));
    }
  });

  return positioned;
};

export const getBoardStats = (board: TimetableBoard): BoardStats => ({
  totalCredits: board.courses.reduce((sum, course) => sum + (course.credits ?? 0), 0),
  courseCount: board.courses.length,
  sessionCount: board.courses.reduce((sum, course) => sum + course.sessions.length, 0),
  conflictCount: detectConflicts(board).length,
});

export const getGridRange = (board: TimetableBoard): { startMinutes: number; endMinutes: number } => {
  void board;

  return {
    startMinutes: DEFAULT_GRID_START_MINUTES,
    endMinutes: DEFAULT_GRID_END_MINUTES,
  };
};

export const getCurrentTimeIndicatorState = (
  range: { startMinutes: number; endMinutes: number },
  now = new Date(),
): CurrentTimeIndicatorState | null => {
  const day = jsDayToDayKey(now.getDay());
  if (!day) {
    return null;
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  if (currentMinutes < range.startMinutes || currentMinutes >= range.endMinutes) {
    return null;
  }

  return {
    day,
    currentMinutes,
    offsetMinutes: currentMinutes - range.startMinutes,
    label: minutesToTime(currentMinutes),
  };
};

export const getCoursesSortedForList = (board: TimetableBoard): TimetableBoard['courses'] =>
  [...board.courses].sort((left, right) => {
    const leftTime = Math.min(...left.sessions.map((session) => DAY_ORDER.indexOf(session.day) * minutesInDay + timeToMinutes(session.start)));
    const rightTime = Math.min(...right.sessions.map((session) => DAY_ORDER.indexOf(session.day) * minutesInDay + timeToMinutes(session.start)));
    return leftTime - rightTime || left.title.localeCompare(right.title, 'ko-KR');
  });

export const getTodayAgenda = (board: TimetableBoard, now = new Date()): AgendaItem[] => {
  const activeDay = jsDayToDayKey(now.getDay());
  if (!activeDay) {
    return [];
  }

  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  return flattenBoardSessions(board)
    .filter((session) => session.day === activeDay)
    .sort((left, right) => left.startMinutes - right.startMinutes)
    .map((session, index, items) => {
      const hasEarlierUpcoming = items.some(
        (entry, itemIndex) => itemIndex < index && entry.startMinutes >= currentMinutes,
      );
      return {
        courseId: session.courseId,
        sessionId: session.sessionId,
        title: session.courseTitle,
        day: session.day,
        start: session.start,
        end: session.end,
        location: session.location,
        instructor: session.instructor,
        color: session.courseColor,
        isOngoing: session.startMinutes <= currentMinutes && session.endMinutes > currentMinutes,
        isNext:
          !hasEarlierUpcoming &&
          session.startMinutes >= currentMinutes &&
          !items.some((entry, itemIndex) => itemIndex < index && entry.startMinutes >= currentMinutes),
      };
    });
};

export const getNextSession = (board: TimetableBoard, now = new Date()): AgendaItem | null => {
  const sessions = flattenBoardSessions(board);
  if (sessions.length === 0) {
    return null;
  }

  const currentDay = jsDayToDayKey(now.getDay());
  const currentMinutes = now.getHours() * 60 + now.getMinutes();
  const currentOffset = currentDay ? DAY_ORDER.indexOf(currentDay) * minutesInDay + currentMinutes : DAY_ORDER.length * minutesInDay;

  const weighted = sessions.map((session) => {
    const dayOffset = DAY_ORDER.indexOf(session.day) * minutesInDay + session.startMinutes;
    const ongoing = currentDay === session.day && session.startMinutes <= currentMinutes && session.endMinutes > currentMinutes;
    return {
      session,
      dayOffset,
      ongoing,
      effectiveOffset: ongoing
        ? currentOffset
        : dayOffset >= currentOffset
          ? dayOffset
          : dayOffset + DAY_ORDER.length * minutesInDay,
    };
  });

  weighted.sort((left, right) => left.effectiveOffset - right.effectiveOffset || left.session.startMinutes - right.session.startMinutes);
  const { session, ongoing } = weighted[0];

  return {
    courseId: session.courseId,
    sessionId: session.sessionId,
    title: session.courseTitle,
    day: session.day,
    start: session.start,
    end: session.end,
    location: session.location,
    instructor: session.instructor,
    color: session.courseColor,
    isOngoing: ongoing,
    isNext: !ongoing,
  };
};

export const getFreeWindows = (board: TimetableBoard, day: AgendaItem['day'] | null): FreeWindow[] => {
  if (!day) {
    return [];
  }

  const { startMinutes, endMinutes } = getGridRange(board);
  const sessions = flattenBoardSessions(board)
    .filter((session) => session.day === day)
    .sort((left, right) => left.startMinutes - right.startMinutes);

  if (sessions.length === 0) {
    return [
      {
        start: minutesToTime(startMinutes),
        end: minutesToTime(endMinutes),
        durationMinutes: endMinutes - startMinutes,
      },
    ];
  }

  const windows: FreeWindow[] = [];
  let cursor = startMinutes;

  sessions.forEach((session) => {
    if (session.startMinutes > cursor) {
      windows.push({
        start: minutesToTime(cursor),
        end: minutesToTime(session.startMinutes),
        durationMinutes: session.startMinutes - cursor,
      });
    }

    cursor = Math.max(cursor, session.endMinutes);
  });

  if (cursor < endMinutes) {
    windows.push({
      start: minutesToTime(cursor),
      end: minutesToTime(endMinutes),
      durationMinutes: endMinutes - cursor,
    });
  }

  return windows.filter((window) => window.durationMinutes >= 30);
};

export const formatFreeWindow = (window: FreeWindow): string =>
  `${window.start}–${window.end} · ${formatDuration(window.durationMinutes)}`;

export const resolveDraggedSessionPlacement = ({
  dayIndex,
  rawStartMinutes,
  durationMinutes,
  gridStartMinutes,
  gridEndMinutes,
}: {
  dayIndex: number;
  rawStartMinutes: number;
  durationMinutes: number;
  gridStartMinutes: number;
  gridEndMinutes: number;
}): {
  day: DayKey;
  startMinutes: number;
  endMinutes: number;
} => {
  const clampedDayIndex = Math.max(0, Math.min(DAY_ORDER.length - 1, dayIndex));
  const maxStartMinutes = Math.max(gridStartMinutes, gridEndMinutes - durationMinutes);
  const startMinutes = clampMinutesToStep(rawStartMinutes, gridStartMinutes, maxStartMinutes);

  return {
    day: DAY_ORDER[clampedDayIndex],
    startMinutes,
    endMinutes: startMinutes + durationMinutes,
  };
};

export const updateBoardSessionSchedule = (
  board: TimetableBoard,
  courseId: string,
  sessionId: string,
  target: {
    day: DayKey;
    startMinutes: number;
    endMinutes: number;
  },
): TimetableBoard => ({
  ...board,
  courses: board.courses.map((course) =>
    course.id === courseId
      ? {
          ...course,
          sessions: course.sessions.map((session) =>
            session.id === sessionId
              ? {
                  ...session,
                  day: target.day,
                  start: minutesToTime(target.startMinutes),
                  end: minutesToTime(target.endMinutes),
                }
              : session,
          ),
        }
      : course,
  ),
});

export const swapBoardSessions = (
  board: TimetableBoard,
  dragged: {
    courseId: string;
    sessionId: string;
  },
  target: {
    courseId: string;
    sessionId: string;
  },
): TimetableBoard => {
  const swapPlacements = getSwapPlacements(board, dragged, target);
  if (!swapPlacements) {
    return board;
  }

  return {
    ...board,
    courses: board.courses.map((course) => ({
      ...course,
      sessions: course.sessions.map((session) => {
        if (course.id === dragged.courseId && session.id === dragged.sessionId) {
          return {
            ...session,
            day: swapPlacements.draggedPlacement.day,
            start: minutesToTime(swapPlacements.draggedPlacement.startMinutes),
            end: minutesToTime(swapPlacements.draggedPlacement.endMinutes),
          };
        }

        if (course.id === target.courseId && session.id === target.sessionId) {
          return {
            ...session,
            day: swapPlacements.targetPlacement.day,
            start: minutesToTime(swapPlacements.targetPlacement.startMinutes),
            end: minutesToTime(swapPlacements.targetPlacement.endMinutes),
          };
        }

        return session;
      }),
    })),
  };
};

const getBoardSession = (
  board: TimetableBoard,
  key: {
    courseId: string;
    sessionId: string;
  },
) =>
  board.courses
    .find((course) => course.id === key.courseId)
    ?.sessions.find((session) => session.id === key.sessionId);

const getSessionPlacement = (session: { day: DayKey; start: string; end: string }) => ({
  day: session.day,
  startMinutes: timeToMinutes(session.start),
  endMinutes: timeToMinutes(session.end),
});

const getSessionDurationMinutes = (session: { start: string; end: string }): number =>
  timeToMinutes(session.end) - timeToMinutes(session.start);

const isValidSwapPlacement = (placement: { startMinutes: number; endMinutes: number }): boolean =>
  placement.endMinutes > placement.startMinutes &&
  placement.endMinutes - placement.startMinutes >= MIN_SESSION_DURATION_MINUTES &&
  placement.endMinutes <= MAX_SESSION_END_MINUTES;

const buildSwapPlacement = (
  anchor: { day: DayKey; startMinutes: number },
  durationMinutes: number,
): { day: DayKey; startMinutes: number; endMinutes: number } | null => {
  const placement = {
    day: anchor.day,
    startMinutes: anchor.startMinutes,
    endMinutes: anchor.startMinutes + durationMinutes,
  };

  return isValidSwapPlacement(placement) ? placement : null;
};

const getSwapPlacements = (
  board: TimetableBoard,
  dragged: {
    courseId: string;
    sessionId: string;
  },
  target: {
    courseId: string;
    sessionId: string;
  },
):
  | {
      draggedPlacement: { day: DayKey; startMinutes: number; endMinutes: number };
      targetPlacement: { day: DayKey; startMinutes: number; endMinutes: number };
    }
  | null => {
  const draggedSession = getBoardSession(board, dragged);
  const targetSession = getBoardSession(board, target);

  if (!draggedSession || !targetSession) {
    return null;
  }

  const draggedPlacement = buildSwapPlacement(
    {
      day: targetSession.day,
      startMinutes: timeToMinutes(targetSession.start),
    },
    getSessionDurationMinutes(draggedSession),
  );
  const targetPlacement = buildSwapPlacement(
    {
      day: draggedSession.day,
      startMinutes: timeToMinutes(draggedSession.start),
    },
    getSessionDurationMinutes(targetSession),
  );

  if (!draggedPlacement || !targetPlacement) {
    return null;
  }

  return {
    draggedPlacement,
    targetPlacement,
  };
};

const isSamePlacement = (
  left: { day: DayKey; startMinutes: number; endMinutes: number },
  right: { day: DayKey; startMinutes: number; endMinutes: number },
): boolean => left.day === right.day && left.startMinutes === right.startMinutes && left.endMinutes === right.endMinutes;

export const canSwapBoardSessions = (
  board: TimetableBoard,
  dragged: {
    courseId: string;
    sessionId: string;
  },
  target: {
    courseId: string;
    sessionId: string;
  },
): boolean => {
  if (!getSwapPlacements(board, dragged, target)) {
    return false;
  }

  const swapped = swapBoardSessions(board, dragged, target);
  return getConflictingSessionIdsFor(swapped, [dragged.sessionId, target.sessionId]).size === 0;
};

export type SessionDropRejectReason = 'not-found' | 'overlap' | 'ambiguous-overlap' | 'unsafe-swap';

export const getSessionDropRejectMessage = (reason: SessionDropRejectReason): string => {
  switch (reason) {
    case 'not-found':
      return '드래그한 강의 정보를 다시 찾지 못했어요. 화면을 새로 고친 뒤 다시 시도해 주세요.';
    case 'unsafe-swap':
      return '겹침 없이 서로 바꿀 수 없는 시간표 조합이에요.';
    case 'ambiguous-overlap':
      return '여러 강의와 동시에 겹치는 구간이라 자동으로 옮길 수 없어요. 원하는 강의 블록 위에 정확히 놓아 주세요.';
    case 'overlap':
    default:
      return '겹치는 시간으로는 옮길 수 없어요. 다른 강의 블록 위에 놓으면 서로 바뀌어요.';
  }
};

export type SessionDropAction =
  | { kind: 'noop' }
  | {
      kind: 'move';
      placement: {
        day: DayKey;
        startMinutes: number;
        endMinutes: number;
      };
    }
  | {
      kind: 'swap';
      target: {
        courseId: string;
        sessionId: string;
      };
    }
  | {
      kind: 'reject';
      reason: SessionDropRejectReason;
    };

export const resolveSessionDropAction = (
  board: TimetableBoard,
  dragged: {
    courseId: string;
    sessionId: string;
  },
  placement: {
    day: DayKey;
    startMinutes: number;
    endMinutes: number;
  },
  directTarget?: {
    courseId: string;
    sessionId: string;
  } | null,
): SessionDropAction => {
  const draggedSession = getBoardSession(board, dragged);
  if (!draggedSession) {
    return { kind: 'reject', reason: 'not-found' };
  }

  const originPlacement = getSessionPlacement(draggedSession);
  if (isSamePlacement(originPlacement, placement)) {
    return { kind: 'noop' };
  }

  if (directTarget) {
    if (!getBoardSession(board, directTarget)) {
      return { kind: 'reject', reason: 'not-found' };
    }

    return canSwapBoardSessions(board, dragged, directTarget)
      ? { kind: 'swap', target: directTarget }
      : { kind: 'reject', reason: 'unsafe-swap' };
  }

  const exactSlotTargets = flattenBoardSessions(board).filter(
    (session) =>
      !(session.courseId === dragged.courseId && session.sessionId === dragged.sessionId) &&
      session.day === placement.day &&
      session.startMinutes === placement.startMinutes,
  );

  if (exactSlotTargets.length === 1) {
    const exactTarget = { courseId: exactSlotTargets[0].courseId, sessionId: exactSlotTargets[0].sessionId };
    return canSwapBoardSessions(board, dragged, exactTarget)
      ? { kind: 'swap', target: exactTarget }
      : { kind: 'reject', reason: 'unsafe-swap' };
  }

  if (exactSlotTargets.length > 1) {
    return { kind: 'reject', reason: 'ambiguous-overlap' };
  }

  const moved = updateBoardSessionSchedule(board, dragged.courseId, dragged.sessionId, placement);
  const conflictIds = getConflictingSessionIdsFor(moved, [dragged.sessionId]);

  if (conflictIds.size === 0) {
    return { kind: 'move', placement };
  }

  return { kind: 'reject', reason: conflictIds.size > 2 ? 'ambiguous-overlap' : 'overlap' };
};
