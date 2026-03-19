import { COLOR_PALETTE, TIME_STEP_MINUTES } from '../../shared/constants';
import { createBoard, createCourse, createSession, generateId } from '../../shared/data';
import type { AppData, Course, CourseSession, TimetableBoard } from '../../shared/types';
import { timeToMinutes } from './time';

export interface RgbColorChannels {
  red: number;
  green: number;
  blue: number;
}

const colorPattern = /^#(?:[0-9a-fA-F]{3}){1,2}$/;

const expandHexColor = (value: string): string =>
  value.length === 4
    ? `#${value[1]}${value[1]}${value[2]}${value[2]}${value[3]}${value[3]}`
    : value;

const clampRgbChannel = (value: number): number => Math.max(0, Math.min(255, Math.round(value)));

export const sanitizeCourseColor = (value: string): string =>
  colorPattern.test(value) ? expandHexColor(value).toLowerCase() : COLOR_PALETTE[0];

export const hexColorToRgb = (value: string): RgbColorChannels => {
  const normalized = sanitizeCourseColor(value).slice(1);
  return {
    red: Number.parseInt(normalized.slice(0, 2), 16),
    green: Number.parseInt(normalized.slice(2, 4), 16),
    blue: Number.parseInt(normalized.slice(4, 6), 16),
  };
};

export const rgbToHexColor = ({ red, green, blue }: RgbColorChannels): string =>
  `#${[red, green, blue]
    .map((channel) => clampRgbChannel(channel).toString(16).padStart(2, '0'))
    .join('')}`;

export const getCourseColorRecommendations = (
  courses: Course[],
  options: {
    currentCourseId?: string;
    selectedColor?: string;
    limit?: number;
    preferFreshColors?: boolean;
  } = {},
): string[] => {
  const limit = Math.max(1, options.limit ?? 6);
  const selectedColor = options.selectedColor ? sanitizeCourseColor(options.selectedColor) : null;
  const colorUsageCounts = new Map<string, number>();
  const colorObservationOrder = new Map<string, number>();

  courses.forEach((course, index) => {
    if (course.id === options.currentCourseId) {
      return;
    }

    const color = sanitizeCourseColor(course.color);
    colorUsageCounts.set(color, (colorUsageCounts.get(color) ?? 0) + 1);
    if (!colorObservationOrder.has(color)) {
      colorObservationOrder.set(color, index);
    }
  });

  const paletteOrder = COLOR_PALETTE.map((color) => sanitizeCourseColor(color));
  const rankedPalette = [...paletteOrder].sort((left, right) => {
    const usageDifference = (colorUsageCounts.get(left) ?? 0) - (colorUsageCounts.get(right) ?? 0);
    if (usageDifference !== 0) {
      return usageDifference;
    }

    return paletteOrder.indexOf(left) - paletteOrder.indexOf(right);
  });

  const rankedObservedColors = [...colorUsageCounts.entries()]
    .sort((left, right) => {
      const usageDifference = right[1] - left[1];
      if (usageDifference !== 0) {
        return usageDifference;
      }

      return (colorObservationOrder.get(left[0]) ?? 0) - (colorObservationOrder.get(right[0]) ?? 0);
    })
    .map(([color]) => color);

  const recommendations: string[] = [];
  const pushRecommendation = (color: string | null | undefined): void => {
    if (!color) {
      return;
    }

    const normalized = sanitizeCourseColor(color);
    if (!recommendations.includes(normalized)) {
      recommendations.push(normalized);
    }
  };

  pushRecommendation(selectedColor);

  if (options.preferFreshColors) {
    rankedPalette.forEach(pushRecommendation);
    rankedObservedColors.forEach(pushRecommendation);
  } else {
    rankedObservedColors.forEach(pushRecommendation);
    rankedPalette.forEach(pushRecommendation);
  }

  return recommendations.slice(0, limit);
};

export const createBlankSession = (): CourseSession =>
  createSession({ day: 'MON', start: '09:00', end: '10:30', location: '' });

export const createBlankCourse = (colorIndex: number): Course =>
  createCourse(
    {
      id: generateId('course'),
      title: '',
      code: '',
      instructor: '',
      location: '',
      credits: null,
      memo: '',
      color: COLOR_PALETTE[colorIndex % COLOR_PALETTE.length],
      sessions: [createBlankSession()],
    },
    colorIndex,
  );

export const createBlankBoard = (index: number): TimetableBoard =>
  createBoard({
    name: `새 시간표 ${index + 1}`,
    semester: '새 학기',
    note: '',
    courses: [],
  });

export const duplicateBoard = (board: TimetableBoard): TimetableBoard => {
  const now = new Date().toISOString();
  return {
    ...board,
    id: generateId('board'),
    name: `${board.name} 사본`,
    createdAt: now,
    updatedAt: now,
    courses: board.courses.map((course, index) => ({
      ...course,
      id: generateId('course'),
      color: course.color || COLOR_PALETTE[index % COLOR_PALETTE.length],
      sessions: course.sessions.map((session) => ({
        ...session,
        id: generateId('session'),
      })),
    })),
  };
};

export const normalizeCourseDraft = (course: Course): Course => ({
  ...course,
  credits: typeof course.credits === 'number' && Number.isFinite(course.credits) ? course.credits : null,
  sessions: course.sessions.map((session) => ({
    ...session,
  })),
});

export const validateCourse = (course: Course): string[] => {
  const issues: string[] = [];

  if (!course.title.trim()) {
    issues.push('강의명은 비워둘 수 없습니다.');
  }

  if (course.credits !== null && (course.credits < 0 || course.credits > 9)) {
    issues.push('학점은 0 이상 9 이하로 입력해주세요.');
  }

  if (course.sessions.length === 0) {
    issues.push('최소 한 개 이상의 강의 시간이 필요합니다.');
  }

  const signatures = new Set<string>();

  course.sessions.forEach((session, index) => {
    if (timeToMinutes(session.start) % TIME_STEP_MINUTES !== 0 || timeToMinutes(session.end) % TIME_STEP_MINUTES !== 0) {
      issues.push(`${index + 1}번째 강의 시간은 30분 단위로 입력해주세요.`);
    }

    if (timeToMinutes(session.end) <= timeToMinutes(session.start)) {
      issues.push(`${index + 1}번째 강의 시간의 종료 시각은 시작 시각보다 늦어야 합니다.`);
    }

    const signature = `${session.day}-${session.start}-${session.end}`;
    if (signatures.has(signature)) {
      issues.push('같은 요일과 시간대의 강의 세션이 중복되었습니다.');
    }
    signatures.add(signature);
  });

  return issues;
};

export const restoreActiveBoardFromPersisted = (
  currentData: AppData,
  persistedData: AppData,
): AppData => {
  const persistedActiveBoard =
    persistedData.boards.find((board) => board.id === currentData.activeBoardId) ??
    persistedData.boards.find((board) => board.id === persistedData.activeBoardId);

  if (!persistedActiveBoard) {
    return currentData;
  }

  return {
    ...currentData,
    activeBoardId: persistedActiveBoard.id,
    boards: currentData.boards.map((board) =>
      board.id === currentData.activeBoardId
        ? {
            ...persistedActiveBoard,
            courses: persistedActiveBoard.courses.map((course) => ({
              ...course,
              sessions: course.sessions.map((session) => ({ ...session })),
            })),
          }
        : board,
    ),
  };
};
