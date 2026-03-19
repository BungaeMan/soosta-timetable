import { COLOR_PALETTE, DATA_VERSION, TIME_STEP_MINUTES } from './constants';
import {
  getDefaultLectureReminderLeadMinutes,
  normalizeLectureReminderLeadMinutes,
} from './reminders';
import type { AppData, AppPreferences, Course, CourseSession, DayKey, TimetableBoard } from './types';

const DAY_SET = new Set<DayKey>(['MON', 'TUE', 'WED', 'THU', 'FRI']);
const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const IDENTIFIER_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const MAX_SESSION_END_MINUTES = 23 * 60 + 30;
const MAX_SESSION_START_MINUTES = MAX_SESSION_END_MINUTES - TIME_STEP_MINUTES;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const createDefaultPreferences = (): AppPreferences => ({
  lectureRemindersEnabled: true,
  lectureReminderLeadMinutes: getDefaultLectureReminderLeadMinutes(),
});

const asString = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value.trim() : fallback;

const asOptionalNumber = (value: unknown): number | null => {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
};

const isDayKey = (value: unknown): value is DayKey => typeof value === 'string' && DAY_SET.has(value as DayKey);

export const isValidTime = (value: unknown): value is string =>
  typeof value === 'string' && TIME_PATTERN.test(value);

export const timeToMinutes = (time: string): number => {
  const match = TIME_PATTERN.exec(time);
  if (!match) {
    return 0;
  }

  return Number(match[1]) * 60 + Number(match[2]);
};

const minutesToTime = (minutes: number): string => {
  const clamped = Math.max(0, Math.min(MAX_SESSION_END_MINUTES, minutes));
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

const snapMinutesToStep = (minutes: number, step = TIME_STEP_MINUTES): number =>
  Math.round(minutes / step) * step;

export const generateId = (prefix: string): string => {
  const uuid = globalThis.crypto?.randomUUID?.();
  if (uuid) {
    return `${prefix}-${uuid}`;
  }

  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
};

const sanitizeIdentifier = (value: unknown, prefix: string): string => {
  const candidate = asString(value);
  return IDENTIFIER_PATTERN.test(candidate) ? candidate : generateId(prefix);
};

const normalizeSessionTimes = (start: string, end: string): { start: string; end: string } => {
  const normalizedStartMinutes = Math.max(
    0,
    Math.min(MAX_SESSION_START_MINUTES, snapMinutesToStep(timeToMinutes(start))),
  );
  let normalizedEndMinutes = Math.max(
    normalizedStartMinutes + TIME_STEP_MINUTES,
    Math.min(MAX_SESSION_END_MINUTES, snapMinutesToStep(timeToMinutes(end))),
  );

  if (normalizedEndMinutes <= normalizedStartMinutes) {
    normalizedEndMinutes = Math.min(MAX_SESSION_END_MINUTES, normalizedStartMinutes + TIME_STEP_MINUTES);
  }

  return {
    start: minutesToTime(normalizedStartMinutes),
    end: minutesToTime(normalizedEndMinutes),
  };
};

export const createSession = (partial: Partial<CourseSession> = {}): CourseSession => {
  const fallbackStart = isValidTime(partial.start) ? partial.start : '09:00';
  const fallbackEnd =
    isValidTime(partial.end) && timeToMinutes(partial.end) > timeToMinutes(fallbackStart) ? partial.end : '10:30';
  const normalizedTimes = normalizeSessionTimes(fallbackStart, fallbackEnd);

  return {
    id: sanitizeIdentifier(partial.id, 'session'),
    day: isDayKey(partial.day) ? partial.day : 'MON',
    start: normalizedTimes.start,
    end: normalizedTimes.end,
    location: asString(partial.location),
  };
};

type CourseSeed = Omit<Partial<Course>, 'sessions'> & { sessions?: Array<Partial<CourseSession>> };

export const createCourse = (partial: CourseSeed = {}, colorIndex = 0): Course => ({
  id: sanitizeIdentifier(partial.id, 'course'),
  title: asString(partial.title),
  code: asString(partial.code),
  instructor: asString(partial.instructor),
  location: asString(partial.location),
  credits: asOptionalNumber(partial.credits),
  memo: asString(partial.memo),
  color: typeof partial.color === 'string' && partial.color ? partial.color : COLOR_PALETTE[colorIndex % COLOR_PALETTE.length],
  sessions: Array.isArray(partial.sessions) && partial.sessions.length > 0
    ? partial.sessions.map((session) => createSession(session))
    : [createSession()],
});

type BoardSeed = Omit<Partial<TimetableBoard>, 'courses'> & { courses?: CourseSeed[] };

export const createBoard = (partial: BoardSeed = {}, colorOffset = 0): TimetableBoard => {
  const now = new Date().toISOString();
  const sourceCourses = Array.isArray(partial.courses) ? partial.courses : [];

  return {
    id: sanitizeIdentifier(partial.id, 'board'),
    name: asString(partial.name, '새 시간표'),
    semester: asString(partial.semester, '2026-1'),
    note: asString(partial.note),
    createdAt: asString(partial.createdAt, now),
    updatedAt: asString(partial.updatedAt, now),
    courses: sourceCourses.map((course, index) => createCourse(course, colorOffset + index)),
  };
};

export const createSeedData = (): AppData => {
  const board = createBoard({
    name: '메인 플랜',
    semester: '2026 봄학기',
    note: '수강신청 전 미리 보는 메인 시간표입니다.',
    courses: [
      {
        title: '인간중심디자인',
        code: 'DES301',
        instructor: '박서윤',
        location: '조형관 502',
        credits: 3,
        memo: '팀 프로젝트 발표는 격주 금요일.',
        color: '#7c72ff',
        sessions: [
          { day: 'MON', start: '10:00', end: '11:15', location: '조형관 502' },
          { day: 'WED', start: '10:00', end: '11:15', location: '조형관 502' },
        ],
      },
      {
        title: '데이터구조',
        code: 'CSE220',
        instructor: '김하민',
        location: '공학관 301',
        credits: 3,
        memo: '매주 과제 제출',
        color: '#4cc9f0',
        sessions: [
          { day: 'TUE', start: '13:00', end: '14:15', location: '공학관 301' },
          { day: 'THU', start: '13:00', end: '14:15', location: '공학관 301' },
        ],
      },
      {
        title: '현대미디어이론',
        code: 'ART214',
        instructor: '이도윤',
        location: '인문관 411',
        credits: 2,
        memo: '리딩 노트 준비',
        color: '#ff7aa2',
        sessions: [{ day: 'MON', start: '15:00', end: '17:30', location: '인문관 411' }],
      },
      {
        title: '캡스톤스튜디오',
        code: 'DES402',
        instructor: '정유림',
        location: '디자인랩 2',
        credits: 4,
        memo: '최종 결과물 리뷰 중심 수업',
        color: '#7ddc8b',
        sessions: [{ day: 'FRI', start: '10:30', end: '13:20', location: '디자인랩 2' }],
      },
    ],
  });

  return {
    version: DATA_VERSION,
    activeBoardId: board.id,
    boards: [board],
    preferences: createDefaultPreferences(),
  };
};

const normalizePreferences = (value: unknown): AppPreferences => {
  if (!isRecord(value)) {
    return createDefaultPreferences();
  }

  return {
    lectureRemindersEnabled:
      typeof value.lectureRemindersEnabled === 'boolean'
        ? value.lectureRemindersEnabled
        : createDefaultPreferences().lectureRemindersEnabled,
    lectureReminderLeadMinutes: normalizeLectureReminderLeadMinutes(value.lectureReminderLeadMinutes),
  };
};

const normalizeSession = (value: unknown, strict: boolean): CourseSession | null => {
  if (!isRecord(value)) {
    if (strict) {
      throw new Error('세션 데이터 형식이 올바르지 않습니다.');
    }

    return null;
  }

  const day = value.day;
  const start = value.start;
  const end = value.end;

  if (!isDayKey(day) || !isValidTime(start) || !isValidTime(end) || timeToMinutes(start) >= timeToMinutes(end)) {
    if (strict) {
      throw new Error('세션의 요일 또는 시간 정보가 올바르지 않습니다.');
    }

    return null;
  }

  const normalizedTimes = normalizeSessionTimes(start, end);

  return {
    id: sanitizeIdentifier(value.id, 'session'),
    day,
    start: normalizedTimes.start,
    end: normalizedTimes.end,
    location: asString(value.location),
  };
};

const normalizeCourse = (value: unknown, strict: boolean, colorIndex: number): Course | null => {
  if (!isRecord(value)) {
    if (strict) {
      throw new Error('강의 데이터 형식이 올바르지 않습니다.');
    }

    return null;
  }

  const title = asString(value.title);
  const rawSessions = Array.isArray(value.sessions) ? value.sessions : [];
  const sessions = rawSessions
    .map((session) => normalizeSession(session, strict))
    .filter((session): session is CourseSession => session !== null);

  if (!title || sessions.length === 0) {
    if (strict) {
      throw new Error('강의명과 강의 시간은 반드시 포함되어야 합니다.');
    }

    return null;
  }

  return {
    id: sanitizeIdentifier(value.id, 'course'),
    title,
    code: asString(value.code),
    instructor: asString(value.instructor),
    location: asString(value.location),
    credits: asOptionalNumber(value.credits),
    memo: asString(value.memo),
    color:
      typeof value.color === 'string' && value.color.trim()
        ? value.color.trim()
        : COLOR_PALETTE[colorIndex % COLOR_PALETTE.length],
    sessions,
  };
};

const normalizeBoard = (value: unknown, strict: boolean, index: number): TimetableBoard | null => {
  if (!isRecord(value)) {
    if (strict) {
      throw new Error('시간표 데이터 형식이 올바르지 않습니다.');
    }

    return null;
  }

  const courses = (Array.isArray(value.courses) ? value.courses : [])
    .map((course, courseIndex) => normalizeCourse(course, strict, courseIndex + index))
    .filter((course): course is Course => course !== null);

  const now = new Date().toISOString();

  return {
    id: sanitizeIdentifier(value.id, 'board'),
    name: asString(value.name, `시간표 ${index + 1}`),
    semester: asString(value.semester, '미정 학기'),
    note: asString(value.note),
    createdAt: asString(value.createdAt, now),
    updatedAt: asString(value.updatedAt, now),
    courses,
  };
};

export const coerceAppData = (value: unknown, strict = false): AppData => {
  if (!isRecord(value)) {
    if (strict) {
      throw new Error('앱 데이터 형식이 올바르지 않습니다.');
    }

    return createSeedData();
  }

  const boards = (Array.isArray(value.boards) ? value.boards : [])
    .map((board, index) => normalizeBoard(board, strict, index))
    .filter((board): board is TimetableBoard => board !== null);

  if (boards.length === 0) {
    if (strict) {
      throw new Error('최소 한 개 이상의 시간표가 필요합니다.');
    }

    return createSeedData();
  }

  const requestedActiveId = asString(value.activeBoardId);
  const activeBoardId = boards.some((board) => board.id === requestedActiveId)
    ? requestedActiveId
    : boards[0].id;

  return {
    version: DATA_VERSION,
    activeBoardId,
    boards,
    preferences: normalizePreferences(value.preferences),
  };
};
