import {
  LECTURE_REMINDER_LEAD_MINUTES,
  MAX_LECTURE_REMINDER_MINUTES,
  MIN_LECTURE_REMINDER_MINUTES,
} from './constants';

const isValidLectureReminderLeadMinutes = (value: number): boolean =>
  Number.isInteger(value) &&
  value >= MIN_LECTURE_REMINDER_MINUTES &&
  value <= MAX_LECTURE_REMINDER_MINUTES;

const normalizeLectureReminderLeadMinutesEntry = (value: unknown): number | null => {
  if (typeof value === 'number' && Number.isInteger(value)) {
    return isValidLectureReminderLeadMinutes(value) ? value : null;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isInteger(parsed) && isValidLectureReminderLeadMinutes(parsed) ? parsed : null;
  }

  return null;
};

export const getDefaultLectureReminderLeadMinutes = (): number[] => [...LECTURE_REMINDER_LEAD_MINUTES];

export const sortUniqueLectureReminderLeadMinutes = (minutes: number[]): number[] =>
  [...new Set(minutes)].sort((left, right) => right - left);

export const normalizeLectureReminderLeadMinutes = (value: unknown): number[] => {
  if (!Array.isArray(value)) {
    return getDefaultLectureReminderLeadMinutes();
  }

  if (value.length === 0) {
    return [];
  }

  const normalized = value
    .map((entry) => normalizeLectureReminderLeadMinutesEntry(entry))
    .filter((entry): entry is number => entry !== null);

  return normalized.length > 0
    ? sortUniqueLectureReminderLeadMinutes(normalized)
    : getDefaultLectureReminderLeadMinutes();
};

export const parseLectureReminderLeadMinutesInput = (
  value: string,
): {
  invalidTokens: string[];
  minutes: number[];
} => {
  const tokens = value
    .split(/[,\s]+/)
    .map((token) => token.trim())
    .filter(Boolean);

  const invalidTokens: string[] = [];
  const minutes: number[] = [];

  tokens.forEach((token) => {
    if (!/^\d+$/.test(token)) {
      invalidTokens.push(token);
      return;
    }

    const parsed = Number(token);
    if (!isValidLectureReminderLeadMinutes(parsed)) {
      invalidTokens.push(token);
      return;
    }

    minutes.push(parsed);
  });

  return {
    invalidTokens,
    minutes: sortUniqueLectureReminderLeadMinutes(minutes),
  };
};

export const formatLectureReminderLeadMinutes = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;

  if (hours > 0 && remainingMinutes > 0) {
    return `${hours}시간 ${remainingMinutes}분`;
  }

  if (hours > 0) {
    return `${hours}시간`;
  }

  return `${minutes}분`;
};

export const formatLectureReminderLeadMinutesList = (minutes: number[]): string =>
  minutes.length > 0
    ? sortUniqueLectureReminderLeadMinutes(minutes)
        .map((entry) => formatLectureReminderLeadMinutes(entry))
        .join(' · ')
    : '설정 없음';
