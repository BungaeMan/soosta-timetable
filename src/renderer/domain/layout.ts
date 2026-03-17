export type RendererViewportBand = 'full' | 'tight' | 'compact';
export type RendererViewportHeightBand = 'tall' | 'short';
export type ShellLayoutMode = 'three-column' | 'inspector-below';
export type TimetableDensity = 'standard' | 'compact';
export type ControlRailSide = 'left' | 'right';
export type PlatformControlRail = 'traffic-lights-left' | 'window-controls-right';
export type DesktopPlatform = NodeJS.Platform | 'linux' | 'darwin' | 'win32';

const FULL_LAYOUT_MIN_WIDTH = 1440;
const TIGHT_LAYOUT_MIN_WIDTH = 1320;
const COMPACT_SIDE_INSPECTOR_MIN_WIDTH = 1180;
const SHORT_LAYOUT_MAX_HEIGHT = 1080;
const STANDARD_TIMETABLE_PIXELS_PER_MINUTE = 1.24;
const SHORT_TIMETABLE_PIXELS_PER_MINUTE = 0.84;

export const getRendererViewportBand = (viewportWidth: number): RendererViewportBand => {
  if (viewportWidth >= FULL_LAYOUT_MIN_WIDTH) {
    return 'full';
  }

  if (viewportWidth >= TIGHT_LAYOUT_MIN_WIDTH) {
    return 'tight';
  }

  return 'compact';
};

export const getRendererViewportHeightBand = (viewportHeight: number): RendererViewportHeightBand =>
  viewportHeight <= SHORT_LAYOUT_MAX_HEIGHT ? 'short' : 'tall';

export const getTimetablePixelsPerMinute = (viewportHeight = Number.POSITIVE_INFINITY): number => {
  return getRendererViewportHeightBand(viewportHeight) === 'short'
    ? SHORT_TIMETABLE_PIXELS_PER_MINUTE
    : STANDARD_TIMETABLE_PIXELS_PER_MINUTE;
};

export const getRendererLayout = (viewportWidth: number, viewportHeight = Number.POSITIVE_INFINITY) => {
  const viewportBand = getRendererViewportBand(viewportWidth);
  const viewportHeightBand = getRendererViewportHeightBand(viewportHeight);
  const prefersCompactDensity = viewportHeightBand === 'short';
  const fullTimetableDensity: TimetableDensity = prefersCompactDensity ? 'compact' : 'standard';
  const fullSidebarDensity = prefersCompactDensity ? 'tight' : 'standard';

  if (viewportBand === 'full') {
    return {
      viewportBand,
      viewportHeightBand,
      shellLayoutMode: 'three-column' as const,
      timetableDensity: fullTimetableDensity,
      sidebarDensity: fullSidebarDensity,
      inspectorPlacement: 'side' as const,
      preserveMainHorizontalScrollbarAvoidance: true,
    };
  }

  if (viewportBand === 'tight') {
    return {
      viewportBand,
      viewportHeightBand,
      shellLayoutMode: 'three-column' as const,
      timetableDensity: 'compact' as const,
      sidebarDensity: 'tight' as const,
      inspectorPlacement: 'side' as const,
      preserveMainHorizontalScrollbarAvoidance: true,
    };
  }

  if (viewportWidth >= COMPACT_SIDE_INSPECTOR_MIN_WIDTH) {
    return {
      viewportBand,
      viewportHeightBand,
      shellLayoutMode: 'three-column' as const,
      timetableDensity: 'compact' as const,
      sidebarDensity: 'tight' as const,
      inspectorPlacement: 'side' as const,
      preserveMainHorizontalScrollbarAvoidance: true,
    };
  }

  return {
    viewportBand,
    viewportHeightBand,
    shellLayoutMode: 'inspector-below' as const,
    timetableDensity: 'compact' as const,
    sidebarDensity: 'tight' as const,
    inspectorPlacement: 'below' as const,
    preserveMainHorizontalScrollbarAvoidance: true,
  };
};

export const getPlatformControlRail = (platform: DesktopPlatform): PlatformControlRail => {
  return platform === 'darwin' ? 'traffic-lights-left' : 'window-controls-right';
};

export const getPlatformControlRailSide = (platform: DesktopPlatform): ControlRailSide => {
  return platform === 'darwin' ? 'left' : 'right';
};
