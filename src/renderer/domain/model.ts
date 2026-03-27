import { COLOR_PALETTE, TIME_STEP_MINUTES } from '../../shared/constants';
import { createBoard, createCourse, createSession, generateId } from '../../shared/data';
import type { AppData, Course, CourseSession, TimetableBoard } from '../../shared/types';
import { timeToMinutes } from './time';

export interface RgbColorChannels {
  red: number;
  green: number;
  blue: number;
}

interface HslColorChannels {
  hue: number;
  saturation: number;
  lightness: number;
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

const RANDOM_COLOR_ATTEMPTS = 32;
const RANDOM_COLOR_FALLBACK_STEPS = 48;
const MIN_RANDOM_COLOR_SATURATION = 58;
const MAX_RANDOM_COLOR_SATURATION = 78;
const MIN_RANDOM_COLOR_LIGHTNESS = 36;
const MAX_RANDOM_COLOR_LIGHTNESS = 52;
const MIN_RANDOM_COLOR_CONTRAST_WITH_WHITE = 3.6;
const MIN_RANDOM_COLOR_DISTANCE = 96;
const WHITE_COLOR = '#ffffff';

const normalizeHue = (value: number): number => ((value % 360) + 360) % 360;
const getRandomNumberInRange = (min: number, max: number): number => min + Math.random() * (max - min);

const hslToRgb = ({ hue, saturation, lightness }: HslColorChannels): RgbColorChannels => {
  const normalizedHue = normalizeHue(hue) / 360;
  const normalizedSaturation = Math.max(0, Math.min(100, saturation)) / 100;
  const normalizedLightness = Math.max(0, Math.min(100, lightness)) / 100;

  if (normalizedSaturation === 0) {
    const channel = normalizedLightness * 255;
    return { red: channel, green: channel, blue: channel };
  }

  const hueToChannel = (p: number, q: number, t: number): number => {
    let adjustedT = t;
    if (adjustedT < 0) adjustedT += 1;
    if (adjustedT > 1) adjustedT -= 1;
    if (adjustedT < 1 / 6) return p + (q - p) * 6 * adjustedT;
    if (adjustedT < 1 / 2) return q;
    if (adjustedT < 2 / 3) return p + (q - p) * (2 / 3 - adjustedT) * 6;
    return p;
  };

  const q =
    normalizedLightness < 0.5
      ? normalizedLightness * (1 + normalizedSaturation)
      : normalizedLightness + normalizedSaturation - normalizedLightness * normalizedSaturation;
  const p = 2 * normalizedLightness - q;

  return {
    red: hueToChannel(p, q, normalizedHue + 1 / 3) * 255,
    green: hueToChannel(p, q, normalizedHue) * 255,
    blue: hueToChannel(p, q, normalizedHue - 1 / 3) * 255,
  };
};

const rgbToHsl = ({ red, green, blue }: RgbColorChannels): HslColorChannels => {
  const normalizedRed = clampRgbChannel(red) / 255;
  const normalizedGreen = clampRgbChannel(green) / 255;
  const normalizedBlue = clampRgbChannel(blue) / 255;
  const maxChannel = Math.max(normalizedRed, normalizedGreen, normalizedBlue);
  const minChannel = Math.min(normalizedRed, normalizedGreen, normalizedBlue);
  const delta = maxChannel - minChannel;
  const lightness = (maxChannel + minChannel) / 2;

  if (delta === 0) {
    return {
      hue: 0,
      saturation: 0,
      lightness: lightness * 100,
    };
  }

  const saturation =
    lightness > 0.5 ? delta / (2 - maxChannel - minChannel) : delta / (maxChannel + minChannel);

  let hue = 0;
  switch (maxChannel) {
    case normalizedRed:
      hue = (normalizedGreen - normalizedBlue) / delta + (normalizedGreen < normalizedBlue ? 6 : 0);
      break;
    case normalizedGreen:
      hue = (normalizedBlue - normalizedRed) / delta + 2;
      break;
    default:
      hue = (normalizedRed - normalizedGreen) / delta + 4;
      break;
  }

  return {
    hue: normalizeHue(hue * 60),
    saturation: saturation * 100,
    lightness: lightness * 100,
  };
};

const buildRandomCourseColor = (): string =>
  rgbToHexColor(
    hslToRgb({
      hue: getRandomNumberInRange(0, 360),
      saturation: getRandomNumberInRange(MIN_RANDOM_COLOR_SATURATION, MAX_RANDOM_COLOR_SATURATION),
      lightness: getRandomNumberInRange(MIN_RANDOM_COLOR_LIGHTNESS, MAX_RANDOM_COLOR_LIGHTNESS),
    }),
  );

const getRelativeLuminance = (color: string): number => {
  const { red, green, blue } = hexColorToRgb(color);
  const normalizeChannel = (channel: number): number => {
    const normalized = clampRgbChannel(channel) / 255;
    return normalized <= 0.03928 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * normalizeChannel(red) + 0.7152 * normalizeChannel(green) + 0.0722 * normalizeChannel(blue);
};

const getContrastRatio = (left: string, right: string): number => {
  const leftLuminance = getRelativeLuminance(left);
  const rightLuminance = getRelativeLuminance(right);
  const brighter = Math.max(leftLuminance, rightLuminance);
  const darker = Math.min(leftLuminance, rightLuminance);

  return (brighter + 0.05) / (darker + 0.05);
};

const getRgbDistance = (left: string, right: string): number => {
  const leftRgb = hexColorToRgb(left);
  const rightRgb = hexColorToRgb(right);

  return Math.hypot(leftRgb.red - rightRgb.red, leftRgb.green - rightRgb.green, leftRgb.blue - rightRgb.blue);
};

const isReadableRandomCourseColor = (candidate: string, excludedColors: Set<string>): boolean =>
  getContrastRatio(candidate, WHITE_COLOR) >= MIN_RANDOM_COLOR_CONTRAST_WITH_WHITE &&
  [...excludedColors].every((color) => getRgbDistance(candidate, color) >= MIN_RANDOM_COLOR_DISTANCE);

const resolveRandomCourseColorFallback = (excludedColors: Set<string>): string => {
  const seedHue = excludedColors.size > 0 ? rgbToHsl(hexColorToRgb([...excludedColors][0])).hue : 248;

  for (let step = 0; step < RANDOM_COLOR_FALLBACK_STEPS; step += 1) {
    const saturationSpread = MAX_RANDOM_COLOR_SATURATION - MIN_RANDOM_COLOR_SATURATION;
    const lightnessSpread = MAX_RANDOM_COLOR_LIGHTNESS - MIN_RANDOM_COLOR_LIGHTNESS;
    const candidate = rgbToHexColor(
      hslToRgb({
        hue: seedHue + 37 + step * 47,
        saturation: MIN_RANDOM_COLOR_SATURATION + ((step * 7) % Math.max(1, saturationSpread)),
        lightness: MIN_RANDOM_COLOR_LIGHTNESS + ((step * 5) % Math.max(1, lightnessSpread)),
      }),
    );

    if (isReadableRandomCourseColor(candidate, excludedColors)) {
      return candidate;
    }
  }

  return '#5e4fd1';
};

export const generateRandomCourseColor = (options: { excludeColors?: string[] } = {}): string => {
  const excludedColors = new Set(
    (options.excludeColors ?? []).filter((color): color is string => Boolean(color)).map((color) => sanitizeCourseColor(color)),
  );

  for (let attempt = 0; attempt < RANDOM_COLOR_ATTEMPTS; attempt += 1) {
    const candidate = buildRandomCourseColor();
    if (isReadableRandomCourseColor(candidate, excludedColors)) {
      return candidate;
    }
  }

  return resolveRandomCourseColorFallback(excludedColors);
};

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

  if (options.preferFreshColors) {
    rankedPalette.forEach(pushRecommendation);
    rankedObservedColors.forEach(pushRecommendation);
  } else {
    rankedObservedColors.forEach(pushRecommendation);
    rankedPalette.forEach(pushRecommendation);
  }

  const visibleRecommendations = recommendations.slice(0, limit);
  if (selectedColor && !visibleRecommendations.includes(selectedColor)) {
    return [...visibleRecommendations.slice(0, Math.max(0, limit - 1)), selectedColor];
  }

  return visibleRecommendations;
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
