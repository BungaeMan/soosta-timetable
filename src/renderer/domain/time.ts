import { TIME_STEP_MINUTES } from '../../shared/constants';

export const timeToMinutes = (time: string): number => {
  const [hour, minute] = time.split(':').map((chunk) => Number(chunk));
  return hour * 60 + minute;
};

export const minutesToTime = (minutes: number): string => {
  const clamped = Math.max(0, Math.min(23 * 60 + 59, minutes));
  const hours = Math.floor(clamped / 60);
  const mins = clamped % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
};

export const formatDuration = (minutes: number): string => {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;

  if (hours > 0 && mins > 0) {
    return `${hours}시간 ${mins}분`;
  }

  if (hours > 0) {
    return `${hours}시간`;
  }

  return `${mins}분`;
};

export const roundDownToStep = (minutes: number, step = TIME_STEP_MINUTES): number =>
  Math.floor(minutes / step) * step;

export const roundUpToStep = (minutes: number, step = TIME_STEP_MINUTES): number =>
  Math.ceil(minutes / step) * step;

export const clampMinutes = (minutes: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, minutes));

export const snapMinutesToStep = (minutes: number, step = TIME_STEP_MINUTES): number =>
  Math.round(minutes / step) * step;

export const clampMinutesToStep = (
  minutes: number,
  min: number,
  max: number,
  step = TIME_STEP_MINUTES,
): number => clampMinutes(snapMinutesToStep(minutes, step), min, max);
