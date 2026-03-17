import {
  DEFAULT_GRID_END_MINUTES,
  DEFAULT_GRID_START_MINUTES,
  MAX_GRID_END_MINUTES,
  TIME_STEP_MINUTES,
} from '../../shared/constants';

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

export type GenericMeridiem = 'AM' | 'PM';
export type TimeWidgetSegment = 'meridiem' | 'hour' | 'minute';
export type TimeWidgetMenuSegment = 'hour' | 'minute';

export type MeridiemTimeParts = {
  meridiem: GenericMeridiem;
  hour: string;
  minute: string;
};

export const splitTimeParts = (time: string): { hour: string; minute: string } => {
  const [rawHour = '00', rawMinute = '00'] = time.split(':');

  return {
    hour: String(Number(rawHour) || 0).padStart(2, '0'),
    minute: String(Number(rawMinute) || 0).padStart(2, '0'),
  };
};

export const composeTimeParts = (hour: string, minute: string): string =>
  `${hour.padStart(2, '0')}:${minute.padStart(2, '0')}`;

export const splitMeridiemTimeParts = (time: string): MeridiemTimeParts => {
  const { hour, minute } = splitTimeParts(time);
  const hourNumber = Number(hour);

  return {
    meridiem: hourNumber >= 12 ? 'PM' : 'AM',
    hour: String(hourNumber % 12 || 12).padStart(2, '0'),
    minute,
  };
};

export const composeMeridiemTimeParts = (
  meridiem: GenericMeridiem,
  hour: string,
  minute: string,
): string => {
  const normalizedHour = ((Number(hour) || 0) % 12) + (meridiem === 'PM' ? 12 : 0);
  const canonicalHour = meridiem === 'AM' && normalizedHour === 12 ? 0 : normalizedHour;

  return composeTimeParts(String(canonicalHour), minute);
};

export const coerceMeridiemTimeParts = (
  meridiem: GenericMeridiem,
  hour: string,
  minute: string,
  times: string[],
): MeridiemTimeParts => splitMeridiemTimeParts(coerceTimeToOptions(composeMeridiemTimeParts(meridiem, hour, minute), times));

export const resolveSessionTimeMenuSegment = (
  segment: TimeWidgetSegment | TimeWidgetMenuSegment | null | undefined,
): TimeWidgetMenuSegment => (segment === 'minute' ? 'minute' : 'hour');

export const getNextSessionTimeMenuSegment = (
  segment: TimeWidgetSegment,
  currentSegment: TimeWidgetMenuSegment | null,
): TimeWidgetMenuSegment => {
  if (segment === 'hour') {
    return 'minute';
  }

  if (segment === 'minute') {
    return 'minute';
  }

  return resolveSessionTimeMenuSegment(currentSegment);
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

export const buildTimeOptions = (
  startMinutes = 0,
  endMinutes = MAX_GRID_END_MINUTES,
  step = TIME_STEP_MINUTES,
): string[] => {
  const options: string[] = [];

  for (let minutes = startMinutes; minutes <= endMinutes; minutes += step) {
    options.push(minutesToTime(minutes));
  }

  return options;
};

export const getSessionStartTimeOptions = (): string[] =>
  buildTimeOptions(DEFAULT_GRID_START_MINUTES, DEFAULT_GRID_END_MINUTES - TIME_STEP_MINUTES);

export const getSessionEndTimeOptions = (): string[] =>
  buildTimeOptions(DEFAULT_GRID_START_MINUTES + TIME_STEP_MINUTES, DEFAULT_GRID_END_MINUTES);

export const getSessionEndTimeOptionsAfterStart = (startTime: string): string[] => {
  const startMinutes = timeToMinutes(startTime);
  if (!Number.isFinite(startMinutes)) {
    return getSessionEndTimeOptions();
  }

  return getSessionEndTimeOptions().filter((time) => timeToMinutes(time) > startMinutes);
};

export const getHourOptions = (times: string[]): string[] =>
  [...new Set(times.map((time) => splitTimeParts(time).hour))];

export const getMinuteOptionsForHour = (times: string[], hour: string): string[] =>
  [...new Set(times.filter((time) => splitTimeParts(time).hour === hour).map((time) => splitTimeParts(time).minute))];

export const coerceTimeToOptions = (time: string, times: string[]): string => {
  if (times.length === 0) {
    return time;
  }

  const targetMinutes = timeToMinutes(time);
  if (!Number.isFinite(targetMinutes)) {
    return times[0];
  }

  return times.reduce((closest, candidate) => {
    const closestMinutes = timeToMinutes(closest);
    const candidateMinutes = timeToMinutes(candidate);
    const closestDistance = Math.abs(closestMinutes - targetMinutes);
    const candidateDistance = Math.abs(candidateMinutes - targetMinutes);

    if (candidateDistance === closestDistance) {
      return candidateMinutes < closestMinutes ? candidate : closest;
    }

    return candidateDistance < closestDistance ? candidate : closest;
  }, times[0]);
};
