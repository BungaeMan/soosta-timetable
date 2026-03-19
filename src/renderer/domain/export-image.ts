import { DAY_LABELS, TIMETABLE_DAY_ORDER } from '../../shared/constants';
import type { PositionedSession, TimetableBoard } from '../../shared/types';
import { minutesToTime } from './time';

const EXPORT_CARD_PADDING = 36;
const EXPORT_OUTER_PADDING_X = 56;
const EXPORT_OUTER_PADDING_Y = 52;
const EXPORT_META_HEIGHT = 102;
const EXPORT_TIMETABLE_TOP_GAP = 26;
const EXPORT_DAY_HEADER_HEIGHT = 76;
const EXPORT_TIME_AXIS_WIDTH = 90;
const EXPORT_DAY_COLUMN_WIDTH = 214;
const EXPORT_DAY_COLUMN_GAP = 12;
const EXPORT_SESSION_INSET_X = 6;
const EXPORT_SESSION_INSET_Y = 4;
const EXPORT_TIME_LABEL_OFFSET_Y = 8;
const EXPORT_TIME_LABEL_BOTTOM_PADDING = 22;
const EXPORT_TARGET_GRID_HEIGHT = 1560;
const EXPORT_MIN_PIXELS_PER_MINUTE = 1.52;
const EXPORT_MAX_PIXELS_PER_MINUTE = 2.18;
const EXPORT_RENDER_SCALE = 2;
const EXPORT_JPEG_QUALITY = 0.94;
const EXPORT_FONT_STACK =
  "'Soosta Pretendard', 'Pretendard Variable', Pretendard, 'SUIT Variable', SUIT, Inter, 'Apple SD Gothic Neo', system-ui, sans-serif";
const FALLBACK_TEXT_COLOR = '#172033';
const FALLBACK_LIGHT_TEXT_COLOR = '#ffffff';
const FALLBACK_SUBTLE_TEXT_COLOR = 'rgba(23, 32, 51, 0.72)';
const FALLBACK_BACKGROUND_COLOR = '#eff4ff';
const FALLBACK_SURFACE_COLOR = 'rgba(255, 255, 255, 0.96)';
const FALLBACK_SURFACE_SOFT_COLOR = 'rgba(98, 111, 155, 0.08)';
const FALLBACK_STROKE_COLOR = 'rgba(59, 72, 108, 0.12)';
const FALLBACK_STROKE_STRONG_COLOR = 'rgba(59, 72, 108, 0.2)';
const FALLBACK_ACCENT_COLOR = '#6e67ff';
const FALLBACK_ACCENT_SOFT_COLOR = 'rgba(110, 103, 255, 0.14)';
const FALLBACK_DANGER_COLOR = '#db5e7a';
const FALLBACK_DANGER_SOFT_COLOR = 'rgba(219, 94, 122, 0.12)';

type CanvasTextBaselineLike = 'top' | 'middle' | 'alphabetic' | 'bottom' | 'ideographic' | 'hanging';

interface BlobLike {
  arrayBuffer: () => Promise<ArrayBuffer>;
}

interface CanvasTextMetricsLike {
  width: number;
}

interface CanvasContextLike {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  font: string;
  textBaseline: CanvasTextBaselineLike;
  beginPath: () => void;
  moveTo: (x: number, y: number) => void;
  lineTo: (x: number, y: number) => void;
  arcTo: (x1: number, y1: number, x2: number, y2: number, radius: number) => void;
  closePath: () => void;
  fill: () => void;
  stroke: () => void;
  fillRect: (x: number, y: number, width: number, height: number) => void;
  fillText: (text: string, x: number, y: number) => void;
  measureText: (text: string) => CanvasTextMetricsLike;
  save: () => void;
  restore: () => void;
  scale: (x: number, y: number) => void;
}

interface CanvasElementLike {
  width: number;
  height: number;
  getContext: (contextId: '2d') => CanvasContextLike | null;
  toBlob: (callback: (value: BlobLike | null) => void, type?: string, quality?: number) => void;
}

interface RendererDomLike {
  window?: {
    getComputedStyle: (element: unknown) => { getPropertyValue: (name: string) => string };
  };
  document?: {
    documentElement: unknown;
    createElement: (tagName: string) => CanvasElementLike;
  };
}

export interface TimetableExportRange {
  startMinutes: number;
  endMinutes: number;
}

export interface TimetableJpegExportMetrics {
  canvasWidth: number;
  canvasHeight: number;
  cardWidth: number;
  cardHeight: number;
  gridHeight: number;
  pixelsPerMinute: number;
  dayColumnWidth: number;
  dayColumnGap: number;
  timeAxisWidth: number;
  dayHeaderHeight: number;
  outerPaddingX: number;
  outerPaddingY: number;
  cardPadding: number;
  metaHeight: number;
  timetableTopGap: number;
  sessionInsetX: number;
  sessionInsetY: number;
  renderScale: number;
}

export interface TimetableJpegExportPayload {
  board: TimetableBoard;
  positionedSessions: readonly PositionedSession[];
  range: TimetableExportRange;
  minimumSessionBlockHeight?: number;
}

interface TimetableExportTheme {
  background: string;
  surface: string;
  surfaceSoft: string;
  stroke: string;
  strokeStrong: string;
  text: string;
  textSecondary: string;
  accent: string;
  accentSoft: string;
  danger: string;
  dangerSoft: string;
}

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value));
const colorPattern = /^#(?:[0-9a-fA-F]{3}){1,2}$/;

const sanitizeColor = (value: string): string => (colorPattern.test(value) ? value : FALLBACK_ACCENT_COLOR);

const sanitizeFileNameSegment = (value: string): string =>
  value
    .trim()
    .replace(/\s+/g, '-')
    .split('')
    .filter((character) => !/[<>:"/\\|?*]/.test(character) && character.charCodeAt(0) >= 32)
    .join('')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48);

const traceRoundedRect = (
  context: CanvasContextLike,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void => {
  const resolvedRadius = Math.max(0, Math.min(radius, width / 2, height / 2));
  context.beginPath();
  context.moveTo(x + resolvedRadius, y);
  context.lineTo(x + width - resolvedRadius, y);
  context.arcTo(x + width, y, x + width, y + resolvedRadius, resolvedRadius);
  context.lineTo(x + width, y + height - resolvedRadius);
  context.arcTo(x + width, y + height, x + width - resolvedRadius, y + height, resolvedRadius);
  context.lineTo(x + resolvedRadius, y + height);
  context.arcTo(x, y + height, x, y + height - resolvedRadius, resolvedRadius);
  context.lineTo(x, y + resolvedRadius);
  context.arcTo(x, y, x + resolvedRadius, y, resolvedRadius);
  context.closePath();
};

const fillRoundedRect = (
  context: CanvasContextLike,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  fillStyle: string,
): void => {
  traceRoundedRect(context, x, y, width, height, radius);
  context.fillStyle = fillStyle;
  context.fill();
};

const strokeRoundedRect = (
  context: CanvasContextLike,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
  strokeStyle: string,
  lineWidth = 1,
): void => {
  traceRoundedRect(context, x, y, width, height, radius);
  context.lineWidth = lineWidth;
  context.strokeStyle = strokeStyle;
  context.stroke();
};

const hexToRgb = (value: string): { red: number; green: number; blue: number } => {
  const sanitized = sanitizeColor(value).slice(1);
  const expanded = sanitized.length === 3 ? sanitized.split('').map((token) => `${token}${token}`).join('') : sanitized;

  return {
    red: Number.parseInt(expanded.slice(0, 2), 16),
    green: Number.parseInt(expanded.slice(2, 4), 16),
    blue: Number.parseInt(expanded.slice(4, 6), 16),
  };
};

const withAlpha = (value: string, alpha: number): string => {
  const { red, green, blue } = hexToRgb(value);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
};

const getContrastingTextColor = (backgroundColor: string): string => {
  const { red, green, blue } = hexToRgb(backgroundColor);
  const contrastBase = (red * 299 + green * 587 + blue * 114) / 1000;
  return contrastBase >= 160 ? FALLBACK_TEXT_COLOR : FALLBACK_LIGHT_TEXT_COLOR;
};

const truncateText = (context: CanvasContextLike, text: string, maxWidth: number): string => {
  if (context.measureText(text).width <= maxWidth) {
    return text;
  }

  const characters = Array.from(text);
  while (characters.length > 0) {
    const candidate = `${characters.join('')}…`;
    if (context.measureText(candidate).width <= maxWidth) {
      return candidate;
    }
    characters.pop();
  }

  return '…';
};

const wrapText = (context: CanvasContextLike, text: string, maxWidth: number, maxLines: number): string[] => {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const characters = Array.from(normalized);
  const lines: string[] = [];
  let currentLine = '';

  for (let index = 0; index < characters.length; index += 1) {
    const character = characters[index];
    const candidate = `${currentLine}${character}`;

    if (!currentLine || context.measureText(candidate).width <= maxWidth) {
      currentLine = candidate;
      continue;
    }

    lines.push(currentLine);
    currentLine = character;

    if (lines.length === maxLines - 1) {
      const remaining = `${currentLine}${characters.slice(index + 1).join('')}`;
      lines.push(truncateText(context, remaining, maxWidth));
      return lines;
    }
  }

  if (currentLine) {
    lines.push(currentLine);
  }

  return lines.slice(0, maxLines);
};

const drawTextBlock = (
  context: CanvasContextLike,
  lines: readonly string[],
  x: number,
  y: number,
  lineHeight: number,
  color: string,
): void => {
  context.fillStyle = color;
  lines.forEach((line, index) => {
    context.fillText(line, x, y + index * lineHeight);
  });
};

const readThemeValue = (name: string, fallback: string): string => {
  const dom = globalThis as RendererDomLike;
  if (!dom.window || !dom.document) {
    return fallback;
  }

  const value = dom.window.getComputedStyle(dom.document.documentElement).getPropertyValue(name).trim();
  return value || fallback;
};

const getTimetableExportTheme = (): TimetableExportTheme => ({
  background: readThemeValue('--bg', FALLBACK_BACKGROUND_COLOR),
  surface: readThemeValue('--surface-strong', FALLBACK_SURFACE_COLOR),
  surfaceSoft: readThemeValue('--surface-soft', FALLBACK_SURFACE_SOFT_COLOR),
  stroke: readThemeValue('--stroke', FALLBACK_STROKE_COLOR),
  strokeStrong: readThemeValue('--stroke-strong', FALLBACK_STROKE_STRONG_COLOR),
  text: readThemeValue('--text', FALLBACK_TEXT_COLOR),
  textSecondary: readThemeValue('--text-secondary', FALLBACK_SUBTLE_TEXT_COLOR),
  accent: readThemeValue('--accent', FALLBACK_ACCENT_COLOR),
  accentSoft: readThemeValue('--accent-soft', FALLBACK_ACCENT_SOFT_COLOR),
  danger: readThemeValue('--danger', FALLBACK_DANGER_COLOR),
  dangerSoft: readThemeValue('--danger-soft', FALLBACK_DANGER_SOFT_COLOR),
});

const createCanvas = (width: number, height: number, renderScale: number): CanvasElementLike => {
  const dom = globalThis as RendererDomLike;
  if (!dom.document) {
    throw new Error('시간표 이미지를 렌더링할 수 없습니다.');
  }

  const canvas = dom.document.createElement('canvas');
  canvas.width = Math.round(width * renderScale);
  canvas.height = Math.round(height * renderScale);
  return canvas;
};

const canvasToJpegBytes = async (canvas: CanvasElementLike): Promise<Uint8Array> => {
  const blob = await new Promise<BlobLike>((resolve, reject) => {
    canvas.toBlob((value: BlobLike | null) => {
      if (value) {
        resolve(value);
        return;
      }

      reject(new Error('JPG 이미지를 생성하지 못했습니다.'));
    }, 'image/jpeg', EXPORT_JPEG_QUALITY);
  });

  return new Uint8Array(await blob.arrayBuffer());
};

const getDayColumnX = (dayIndex: number, metrics: TimetableJpegExportMetrics): number =>
  metrics.outerPaddingX +
  metrics.cardPadding +
  metrics.timeAxisWidth +
  metrics.dayColumnGap +
  dayIndex * (metrics.dayColumnWidth + metrics.dayColumnGap);

const getMetaBadges = (board: TimetableBoard, range: TimetableExportRange): string[] => [
  `${board.courses.length} courses`,
  `${board.courses.reduce((sum, course) => sum + (course.credits ?? 0), 0)}학점`,
  `${minutesToTime(range.startMinutes)}–${minutesToTime(range.endMinutes)}`,
];

const drawBadgeRow = (
  context: CanvasContextLike,
  badges: readonly string[],
  x: number,
  y: number,
  theme: TimetableExportTheme,
): void => {
  context.save();
  context.font = `600 15px ${EXPORT_FONT_STACK}`;
  context.textBaseline = 'middle';

  let cursorX = x;
  badges.forEach((label, index) => {
    const paddingX = 14;
    const width = Math.ceil(context.measureText(label).width) + paddingX * 2;
    const fillStyle = index === 0 ? theme.accentSoft : theme.surfaceSoft;
    const textColor = index === 0 ? theme.accent : theme.textSecondary;
    fillRoundedRect(context, cursorX, y, width, 36, 18, fillStyle);
    strokeRoundedRect(context, cursorX, y, width, 36, 18, theme.stroke);
    context.fillStyle = textColor;
    context.fillText(label, cursorX + paddingX, y + 18);
    cursorX += width + 10;
  });

  context.restore();
};

const drawDayHeaders = (
  context: CanvasContextLike,
  metrics: TimetableJpegExportMetrics,
  headerY: number,
  theme: TimetableExportTheme,
): void => {
  context.save();
  context.textBaseline = 'middle';

  fillRoundedRect(
    context,
    metrics.outerPaddingX + metrics.cardPadding,
    headerY,
    metrics.timeAxisWidth,
    metrics.dayHeaderHeight,
    18,
    theme.surfaceSoft,
  );
  strokeRoundedRect(
    context,
    metrics.outerPaddingX + metrics.cardPadding,
    headerY,
    metrics.timeAxisWidth,
    metrics.dayHeaderHeight,
    18,
    theme.stroke,
  );
  context.font = `700 16px ${EXPORT_FONT_STACK}`;
  context.fillStyle = theme.textSecondary;
  context.fillText('Time', metrics.outerPaddingX + metrics.cardPadding + 22, headerY + metrics.dayHeaderHeight / 2);

  TIMETABLE_DAY_ORDER.forEach((day, index) => {
    const columnX = getDayColumnX(index, metrics);
    fillRoundedRect(context, columnX, headerY, metrics.dayColumnWidth, metrics.dayHeaderHeight, 18, theme.surfaceSoft);
    strokeRoundedRect(context, columnX, headerY, metrics.dayColumnWidth, metrics.dayHeaderHeight, 18, theme.stroke);

    context.font = `700 20px ${EXPORT_FONT_STACK}`;
    context.fillStyle = theme.text;
    context.fillText(DAY_LABELS[day].short, columnX + 18, headerY + 28);

    context.font = `500 13px ${EXPORT_FONT_STACK}`;
    context.fillStyle = theme.textSecondary;
    context.fillText(DAY_LABELS[day].english, columnX + 18, headerY + 52);
  });

  context.restore();
};

const drawGrid = (
  context: CanvasContextLike,
  range: TimetableExportRange,
  metrics: TimetableJpegExportMetrics,
  bodyY: number,
  theme: TimetableExportTheme,
): void => {
  context.save();
  context.textBaseline = 'top';

  TIMETABLE_DAY_ORDER.forEach((_day, index) => {
    const columnX = getDayColumnX(index, metrics);
    fillRoundedRect(context, columnX, bodyY, metrics.dayColumnWidth, metrics.gridHeight, 22, theme.surface);
    strokeRoundedRect(context, columnX, bodyY, metrics.dayColumnWidth, metrics.gridHeight, 22, theme.stroke);
  });

  fillRoundedRect(
    context,
    metrics.outerPaddingX + metrics.cardPadding,
    bodyY,
    metrics.timeAxisWidth,
    metrics.gridHeight,
    22,
    theme.surface,
  );
  strokeRoundedRect(
    context,
    metrics.outerPaddingX + metrics.cardPadding,
    bodyY,
    metrics.timeAxisWidth,
    metrics.gridHeight,
    22,
    theme.stroke,
  );

  context.font = `600 13px ${EXPORT_FONT_STACK}`;
  for (let minutes = range.startMinutes; minutes <= range.endMinutes; minutes += 60) {
    const offsetY = (minutes - range.startMinutes) * metrics.pixelsPerMinute;
    const lineY = bodyY + offsetY;
    const labelY = Math.min(
      Math.max(bodyY + EXPORT_TIME_LABEL_OFFSET_Y, lineY - EXPORT_TIME_LABEL_OFFSET_Y),
      bodyY + metrics.gridHeight - EXPORT_TIME_LABEL_BOTTOM_PADDING,
    );

    if (minutes < range.endMinutes) {
      TIMETABLE_DAY_ORDER.forEach((_day, index) => {
        const columnX = getDayColumnX(index, metrics);
        context.beginPath();
        context.moveTo(columnX + 14, lineY + 0.5);
        context.lineTo(columnX + metrics.dayColumnWidth - 14, lineY + 0.5);
        context.lineWidth = 1;
        context.strokeStyle = theme.stroke;
        context.stroke();
      });
    }

    context.fillStyle = theme.textSecondary;
    context.fillText(minutesToTime(minutes), metrics.outerPaddingX + metrics.cardPadding + 18, labelY);
  }

  context.restore();
};

const getSessionTextLayout = (blockHeight: number, blockWidth: number) => ({
  titleLines: blockHeight >= 112 && blockWidth >= 160 ? 2 : 1,
  showTime: blockHeight >= 68,
  showLocation: blockHeight >= 90 && blockWidth >= 150,
  showConflictChip: blockHeight >= 122 && blockWidth >= 162,
});

const drawSessionBlocks = (
  context: CanvasContextLike,
  positionedSessions: readonly PositionedSession[],
  range: TimetableExportRange,
  metrics: TimetableJpegExportMetrics,
  minimumSessionBlockHeight: number,
  theme: TimetableExportTheme,
): void => {
  context.save();
  context.textBaseline = 'top';

  TIMETABLE_DAY_ORDER.forEach((day, dayIndex) => {
    const columnX = getDayColumnX(dayIndex, metrics);
    const sessions = positionedSessions.filter((session) => session.day === day);

    sessions.forEach((session) => {
      const accent = sanitizeColor(session.courseColor);
      const x = columnX + (session.leftPercent / 100) * metrics.dayColumnWidth + metrics.sessionInsetX;
      const width = metrics.dayColumnWidth * (session.widthPercent / 100) - 10;
      const y =
        metrics.outerPaddingY +
        metrics.cardPadding +
        metrics.metaHeight +
        metrics.timetableTopGap +
        metrics.dayHeaderHeight +
        (session.startMinutes - range.startMinutes) * metrics.pixelsPerMinute +
        metrics.sessionInsetY;
      const height = Math.max(
        minimumSessionBlockHeight,
        (session.endMinutes - session.startMinutes) * metrics.pixelsPerMinute - 8,
      );
      const fillColor = session.isConflict ? theme.danger : accent;
      const borderColor = session.isConflict ? theme.danger : accent;
      const titleColor = getContrastingTextColor(fillColor);
      const metaColor = titleColor === FALLBACK_LIGHT_TEXT_COLOR ? 'rgba(255, 255, 255, 0.86)' : FALLBACK_SUBTLE_TEXT_COLOR;
      const contentX = x + 14;
      let contentY = y + 14;
      const contentWidth = Math.max(44, width - 28);
      const textLayout = getSessionTextLayout(height, width);

      fillRoundedRect(context, x, y, width, height, 18, fillColor);
      strokeRoundedRect(context, x, y, width, height, 18, borderColor, session.isConflict ? 1.5 : 1);

      context.font = `700 16px ${EXPORT_FONT_STACK}`;
      const titleLines = wrapText(context, session.courseTitle, contentWidth, textLayout.titleLines);
      drawTextBlock(context, titleLines, contentX, contentY, 20, titleColor);
      contentY += titleLines.length * 20 + 8;

      if (textLayout.showTime) {
        context.font = `600 13px ${EXPORT_FONT_STACK}`;
        drawTextBlock(
          context,
          [truncateText(context, `${session.start}–${session.end}`, contentWidth)],
          contentX,
          contentY,
          18,
          metaColor,
        );
        contentY += 22;
      }

      if (textLayout.showLocation) {
        context.font = `500 13px ${EXPORT_FONT_STACK}`;
        drawTextBlock(
          context,
          [truncateText(context, session.location || session.courseLocation || '장소 미정', contentWidth)],
          contentX,
          contentY,
          18,
          metaColor,
        );
      }

      if (session.isConflict && textLayout.showConflictChip) {
        context.font = `700 11px ${EXPORT_FONT_STACK}`;
        const label = '시간 겹침';
        const chipWidth = Math.ceil(context.measureText(label).width) + 16;
        const chipHeight = 24;
        const chipX = x + width - chipWidth - 12;
        const chipY = y + height - chipHeight - 12;
        fillRoundedRect(context, chipX, chipY, chipWidth, chipHeight, 12, withAlpha(theme.danger, 0.16));
        context.fillStyle = theme.danger;
        context.textBaseline = 'middle';
        context.fillText(label, chipX + 8, chipY + chipHeight / 2);
        context.textBaseline = 'top';
      }
    });
  });

  context.restore();
};

export const getTimetableJpegFileName = (boardName: string, now = new Date()): string => {
  const date = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const safeBoardName = sanitizeFileNameSegment(boardName) || 'timetable';
  return `soosta-timetable-${safeBoardName}-${date}.jpg`;
};

export const getTimetableJpegExportMetrics = (
  minuteSpan: number,
  dayCount = TIMETABLE_DAY_ORDER.length,
): TimetableJpegExportMetrics => {
  const resolvedDayCount = Math.max(1, dayCount);
  const safeMinuteSpan = Math.max(60, Math.round(minuteSpan));
  const pixelsPerMinute = Number(
    clamp(EXPORT_TARGET_GRID_HEIGHT / safeMinuteSpan, EXPORT_MIN_PIXELS_PER_MINUTE, EXPORT_MAX_PIXELS_PER_MINUTE).toFixed(4),
  );
  const gridHeight = Math.max(900, Math.round(safeMinuteSpan * pixelsPerMinute));
  const cardWidth =
    EXPORT_CARD_PADDING * 2 +
    EXPORT_TIME_AXIS_WIDTH +
    EXPORT_DAY_COLUMN_GAP +
    resolvedDayCount * EXPORT_DAY_COLUMN_WIDTH +
    Math.max(0, resolvedDayCount - 1) * EXPORT_DAY_COLUMN_GAP;
  const cardHeight =
    EXPORT_CARD_PADDING * 2 + EXPORT_META_HEIGHT + EXPORT_TIMETABLE_TOP_GAP + EXPORT_DAY_HEADER_HEIGHT + gridHeight;

  return {
    canvasWidth: cardWidth + EXPORT_OUTER_PADDING_X * 2,
    canvasHeight: cardHeight + EXPORT_OUTER_PADDING_Y * 2,
    cardWidth,
    cardHeight,
    gridHeight,
    pixelsPerMinute,
    dayColumnWidth: EXPORT_DAY_COLUMN_WIDTH,
    dayColumnGap: EXPORT_DAY_COLUMN_GAP,
    timeAxisWidth: EXPORT_TIME_AXIS_WIDTH,
    dayHeaderHeight: EXPORT_DAY_HEADER_HEIGHT,
    outerPaddingX: EXPORT_OUTER_PADDING_X,
    outerPaddingY: EXPORT_OUTER_PADDING_Y,
    cardPadding: EXPORT_CARD_PADDING,
    metaHeight: EXPORT_META_HEIGHT,
    timetableTopGap: EXPORT_TIMETABLE_TOP_GAP,
    sessionInsetX: EXPORT_SESSION_INSET_X,
    sessionInsetY: EXPORT_SESSION_INSET_Y,
    renderScale: EXPORT_RENDER_SCALE,
  };
};

export const renderTimetableToJpegBytes = async ({
  board,
  positionedSessions,
  range,
  minimumSessionBlockHeight = 44,
}: TimetableJpegExportPayload): Promise<Uint8Array> => {
  const minuteSpan = range.endMinutes - range.startMinutes;
  const metrics = getTimetableJpegExportMetrics(minuteSpan, TIMETABLE_DAY_ORDER.length);
  const theme = getTimetableExportTheme();
  const canvas = createCanvas(metrics.canvasWidth, metrics.canvasHeight, metrics.renderScale);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('시간표 이미지를 렌더링할 수 없습니다.');
  }

  context.scale(metrics.renderScale, metrics.renderScale);
  context.fillStyle = theme.background;
  context.fillRect(0, 0, metrics.canvasWidth, metrics.canvasHeight);

  fillRoundedRect(context, metrics.outerPaddingX, metrics.outerPaddingY, metrics.cardWidth, metrics.cardHeight, 32, theme.surface);
  strokeRoundedRect(
    context,
    metrics.outerPaddingX,
    metrics.outerPaddingY,
    metrics.cardWidth,
    metrics.cardHeight,
    32,
    theme.strokeStrong,
    1.2,
  );

  const contentX = metrics.outerPaddingX + metrics.cardPadding;
  const titleY = metrics.outerPaddingY + metrics.cardPadding;
  const badgesY = titleY + 50;
  const headerY = metrics.outerPaddingY + metrics.cardPadding + metrics.metaHeight + metrics.timetableTopGap;
  const bodyY = headerY + metrics.dayHeaderHeight;

  context.textBaseline = 'top';
  context.fillStyle = theme.text;
  context.font = `700 30px ${EXPORT_FONT_STACK}`;
  const titleWidth = context.measureText(board.name).width;
  context.fillText(board.name, contentX, titleY);

  context.font = `600 16px ${EXPORT_FONT_STACK}`;
  context.fillStyle = theme.textSecondary;
  context.fillText(board.semester, contentX + titleWidth + 14, titleY + 10);

  drawBadgeRow(context, getMetaBadges(board, range), contentX, badgesY, theme);
  drawDayHeaders(context, metrics, headerY, theme);
  drawGrid(context, range, metrics, bodyY, theme);
  drawSessionBlocks(context, positionedSessions, range, metrics, minimumSessionBlockHeight, theme);

  return canvasToJpegBytes(canvas);
};
