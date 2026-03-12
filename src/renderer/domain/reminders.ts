import { DAY_LABELS } from '../../shared/constants';
import {
  formatLectureReminderLeadMinutes,
  getDefaultLectureReminderLeadMinutes,
} from '../../shared/reminders';
import type {
  AgendaItem,
  LectureReminderLeadMinutes,
  NativeLectureReminderPayload,
  TimetableBoard,
} from '../../shared/types';
import { flattenBoardSessions } from './timetable';

const DAY_TO_JS_DAY = {
  MON: 1,
  TUE: 2,
  WED: 3,
  THU: 4,
  FRI: 5,
  SAT: 6,
} as const;

const MINUTE_IN_MS = 60 * 1000;

export interface UpcomingSessionOccurrence extends AgendaItem {
  startAt: string;
  endAt: string;
  startAtMs: number;
  endAtMs: number;
  startsInMinutes: number;
}

export interface LectureReminderEvent {
  reminderId: string;
  leadMinutes: LectureReminderLeadMinutes;
  session: UpcomingSessionOccurrence;
  nativePayload: NativeLectureReminderPayload;
}

const createOccurrenceDate = (jsDay: number, minutes: number, now: Date): Date => {
  const occurrence = new Date(now);
  occurrence.setSeconds(0, 0);

  let dayOffset = jsDay - now.getDay();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  if (dayOffset < 0 || (dayOffset === 0 && minutes <= currentMinutes)) {
    dayOffset += 7;
  }

  occurrence.setDate(now.getDate() + dayOffset);
  occurrence.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return occurrence;
};

const formatReminderBody = (
  session: UpcomingSessionOccurrence,
  leadMinutes: LectureReminderLeadMinutes,
): string => {
  const locationText = session.location ? ` · ${session.location}` : '';
  return `${session.title} 수업이 ${formatLectureReminderLeadMinutes(leadMinutes)} 뒤 ${session.start}에 시작돼요. ${DAY_LABELS[session.day].full}${locationText}`;
};

export const getNextUpcomingSessionOccurrence = (
  board: TimetableBoard,
  now = new Date(),
): UpcomingSessionOccurrence | null => {
  const sessions = flattenBoardSessions(board);
  if (sessions.length === 0) {
    return null;
  }

  const weighted = sessions.map((session) => {
    const startDate = createOccurrenceDate(DAY_TO_JS_DAY[session.day], session.startMinutes, now);
    const endDate = new Date(startDate);
    endDate.setHours(Math.floor(session.endMinutes / 60), session.endMinutes % 60, 0, 0);

    return {
      session,
      startDate,
      endDate,
      startAtMs: startDate.getTime(),
    };
  });

  weighted.sort((left, right) => left.startAtMs - right.startAtMs || left.session.startMinutes - right.session.startMinutes);
  const { session, startDate, endDate, startAtMs } = weighted[0];

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
    isOngoing: false,
    isNext: true,
    startAt: startDate.toISOString(),
    endAt: endDate.toISOString(),
    startAtMs,
    endAtMs: endDate.getTime(),
    startsInMinutes: Math.max(0, Math.ceil((startAtMs - now.getTime()) / MINUTE_IN_MS)),
  };
};

export const getDueLectureReminderEvents = (
  board: TimetableBoard,
  from: Date,
  to: Date,
  leadMinutes = getDefaultLectureReminderLeadMinutes(),
): LectureReminderEvent[] => {
  const fromMs = Math.min(from.getTime(), to.getTime());
  const toMs = Math.max(from.getTime(), to.getTime());
  const nextSession = getNextUpcomingSessionOccurrence(board, new Date(toMs));

  if (!nextSession) {
    return [];
  }

  return [...leadMinutes]
    .filter((leadTime) => {
      const reminderAtMs = nextSession.startAtMs - leadTime * MINUTE_IN_MS;
      return reminderAtMs > fromMs && reminderAtMs <= toMs;
    })
    .sort((left, right) => left - right)
    .map((leadMinutesValue) => {
      const reminderId = `${nextSession.sessionId}:${nextSession.startAt}:${leadMinutesValue}`;

      return {
        reminderId,
        leadMinutes: leadMinutesValue,
        session: nextSession,
        nativePayload: {
          reminderId,
          leadMinutes: leadMinutesValue,
          courseTitle: nextSession.title,
          location: nextSession.location,
          startsAt: nextSession.startAt,
          title: `${nextSession.title} · ${formatLectureReminderLeadMinutes(leadMinutesValue)} 전`,
          body: formatReminderBody(nextSession, leadMinutesValue),
        },
      };
    });
};
