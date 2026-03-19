const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { LECTURE_REMINDER_LEAD_MINUTES, TIME_STEP_MINUTES } = require('../dist-test/shared/constants.js');
const { coerceAppData } = require('../dist-test/shared/data.js');
const {
  formatLectureReminderLeadMinutesList,
  parseLectureReminderLeadMinutesInput,
} = require('../dist-test/shared/reminders.js');
const { createReminderPopupMarkup } = require('../dist-test/shared/reminder-popup.js');
const {
  getCourseColorRecommendations,
  hexColorToRgb,
  normalizeCourseDraft,
  rgbToHexColor,
  restoreActiveBoardFromPersisted,
  sanitizeCourseColor,
  validateCourse,
} = require('../dist-test/renderer/domain/model.js');
const {
  coerceMeridiemTimeParts,
  coerceTimeToOptions,
  composeMeridiemTimeParts,
  composeTimeParts,
  getSessionEndTimeOptions,
  getSessionEndTimeOptionsAfterStart,
  getHourOptions,
  getMinuteOptionsForHour,
  getNextSessionTimeMenuSegment,
  getSessionStartTimeOptions,
  clampMinutesToStep,
  resolveSessionTimeMenuSegment,
  snapMinutesToStep,
  splitMeridiemTimeParts,
  splitTimeParts,
} = require('../dist-test/renderer/domain/time.js');
const timetableDomain = require('../dist-test/renderer/domain/timetable.js');
const {
  canSwapBoardSessions,
  detectConflicts,
  getBoardStats,
  getConflictingSessionIdsFor,
  getCurrentTimeIndicatorState,
  getGridRange,
  getFreeWindows,
  getNextSession,
  getPositionedSessions,
  getSessionDropRejectMessage,
  resolveSessionDropAction,
  resolveDraggedSessionPlacement,
  swapBoardSessions,
  updateBoardSessionSchedule,
} = timetableDomain;
const {
  getDueLectureReminderEvents,
  getReminderSweepStartMs,
  getNextUpcomingSessionOccurrence,
} = require('../dist-test/renderer/domain/reminders.js');
const {
  getPlatformControlRail,
  getPlatformControlRailSide,
  getRendererLayout,
  getTimetablePixelsPerMinute,
  getViewportFittedTimetablePixelsPerMinute,
} = require('../dist-test/renderer/domain/layout.js');
const {
  getTimetableJpegExportMetrics,
  getTimetableJpegFileName,
} = require('../dist-test/renderer/domain/export-image.js');

const rendererAppSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'app.ts'), 'utf8');
const exportImageSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'domain', 'export-image.ts'), 'utf8');
const indexCssSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.css'), 'utf8');
const mainProcessSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'index.ts'), 'utf8');
const forgeConfigSource = fs.readFileSync(path.join(__dirname, '..', 'forge.config.ts'), 'utf8');
const persistenceSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'main', 'persistence.ts'), 'utf8');
const preloadSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'preload.ts'), 'utf8');
const reminderPopupSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'reminder-popup.ts'), 'utf8');
const sharedConstantsSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'constants.ts'), 'utf8');
const sharedTypesSource = fs.readFileSync(path.join(__dirname, '..', 'src', 'shared', 'types.ts'), 'utf8');
const webpackRulesSource = fs.readFileSync(path.join(__dirname, '..', 'webpack.rules.ts'), 'utf8');

const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const getCssBlock = (selector) => {
  const match = indexCssSource.match(new RegExp(`${escapeRegExp(selector)}\\s*\\{([\\s\\S]*?)\\n\\}`, 'm'));
  assert.ok(match, `Could not find CSS block for ${selector}`);
  return match[1];
};

const makeBoard = () => ({
  id: 'board-1',
  name: '테스트 보드',
  semester: '2026-1',
  note: '',
  createdAt: '2026-03-09T00:00:00.000Z',
  updatedAt: '2026-03-09T00:00:00.000Z',
  courses: [
    {
      id: 'course-a',
      title: '자료구조',
      code: 'CSE220',
      instructor: '김교수',
      location: '공학관 301',
      credits: 3,
      memo: '',
      color: '#7c72ff',
      sessions: [{ id: 's1', day: 'MON', start: '09:00', end: '10:00', location: '공학관 301' }],
    },
    {
      id: 'course-b',
      title: '컴퓨터그래픽스',
      code: 'CSE330',
      instructor: '박교수',
      location: '공학관 305',
      credits: 3,
      memo: '',
      color: '#4cc9f0',
      sessions: [{ id: 's2', day: 'MON', start: '09:30', end: '10:30', location: '공학관 305' }],
    },
    {
      id: 'course-c',
      title: '미디어연구',
      code: 'ART210',
      instructor: '이교수',
      location: '인문관 201',
      credits: 2,
      memo: '',
      color: '#ff7aa2',
      sessions: [{ id: 's3', day: 'MON', start: '13:00', end: '14:15', location: '인문관 201' }],
    },
  ],
});

test('course color recommendations keep the current choice visible and surface analyzed lecture colors first', () => {
  const board = makeBoard();

  assert.deepEqual(
    getCourseColorRecommendations(board.courses, {
      currentCourseId: 'course-a',
      selectedColor: '#7c72ff',
      limit: 6,
    }),
    ['#7c72ff', '#4cc9f0', '#ff7aa2', '#ffb84c', '#7ddc8b', '#d69bff'],
  );
});

test('course color recommendations fall back to the default palette when there are no other courses', () => {
  assert.deepEqual(
    getCourseColorRecommendations([], {
      selectedColor: '#7c72ff',
      limit: 6,
    }),
    ['#7c72ff', '#4cc9f0', '#ff7aa2', '#ffb84c', '#7ddc8b', '#d69bff'],
  );
});

test('course color recommendations surface observed custom colors before falling back to the palette', () => {
  assert.deepEqual(
    getCourseColorRecommendations(
      [
        { ...makeBoard().courses[0], id: 'course-x', color: '#123456' },
        { ...makeBoard().courses[1], id: 'course-y', color: '#abcdef' },
      ],
      {
        selectedColor: '#ffb84c',
        limit: 4,
      },
    ),
    ['#ffb84c', '#123456', '#abcdef', '#7c72ff'],
  );
});

test('course color helpers normalize hex colors and clamp RGB values', () => {
  assert.equal(sanitizeCourseColor('#ABC'), '#aabbcc');
  assert.deepEqual(hexColorToRgb('#4cc9f0'), { red: 76, green: 201, blue: 240 });
  assert.equal(rgbToHexColor({ red: 300, green: -12, blue: 128.4 }), '#ff0080');
});

test('weekday constants remove Saturday across the app surface', () => {
  assert.match(sharedTypesSource, /export type DayKey = 'MON' \| 'TUE' \| 'WED' \| 'THU' \| 'FRI';/);
  assert.match(sharedConstantsSource, /export const DAY_ORDER: DayKey\[] = \['MON', 'TUE', 'WED', 'THU', 'FRI'\];/);
  assert.match(sharedConstantsSource, /export const TIMETABLE_DAY_ORDER: DayKey\[] = DAY_ORDER;/);
  assert.doesNotMatch(sharedConstantsSource, /SAT:/);
  assert.match(sharedConstantsSource, /FRI: \{ short: '금', full: '금요일', english: 'Friday' \},/);
});

test('detectConflicts finds overlapping class sessions and counts stats', () => {
  const board = makeBoard();
  const conflicts = detectConflicts(board);
  const stats = getBoardStats(board);

  assert.equal(conflicts.length, 1);
  assert.deepEqual(conflicts[0].sessionIds.sort(), ['s1', 's2']);
  assert.equal(stats.totalCredits, 8);
  assert.equal(stats.conflictCount, 1);
});

test('getPositionedSessions splits overlapping blocks into columns', () => {
  const positioned = getPositionedSessions(makeBoard()).filter(
    (item) => item.day === 'MON' && (item.start === '09:00' || item.start === '09:30'),
  );

  assert.equal(positioned.length, 2);
  assert.equal(positioned[0].widthPercent, 50);
  assert.equal(positioned[1].widthPercent, 50);
  assert.notEqual(positioned[0].leftPercent, positioned[1].leftPercent);
});

test('getFreeWindows returns 30+ minute gaps for the active day', () => {
  const windows = getFreeWindows(makeBoard(), 'MON');

  assert.ok(windows.some((window) => window.start === '10:30' && window.end === '13:00'));
});

test('getGridRange stays fixed at 09:00 to 22:00 for empty and populated boards', () => {
  const board = makeBoard();
  const extremeBoard = {
    ...board,
    courses: [
      ...board.courses,
      {
        id: 'course-early-late',
        title: '극단 시간 강의',
        code: 'EDGE101',
        instructor: '최교수',
        location: '실험동',
        credits: 1,
        memo: '',
        color: '#5fc7b8',
        sessions: [
          { id: 's-early', day: 'MON', start: '06:00', end: '07:00', location: '실험동' },
          { id: 's-late', day: 'FRI', start: '21:30', end: '23:30', location: '실험동' },
        ],
      },
    ],
  };
  const emptyBoard = {
    ...board,
    courses: [],
  };

  assert.deepEqual(getGridRange(board), { startMinutes: 9 * 60, endMinutes: 22 * 60 });
  assert.deepEqual(getGridRange(extremeBoard), { startMinutes: 9 * 60, endMinutes: 22 * 60 });
  assert.deepEqual(getGridRange(emptyBoard), { startMinutes: 9 * 60, endMinutes: 22 * 60 });
});

test('timetable domain no longer exports the current-time highlight helper', () => {
  assert.equal('getCurrentTimeSlotHighlight' in timetableDomain, false);
});

test('getCurrentTimeIndicatorState resolves the current weekday offset inside the visible grid', () => {
  const state = getCurrentTimeIndicatorState(
    { startMinutes: 9 * 60, endMinutes: 22 * 60 },
    new Date(2026, 2, 9, 10, 37, 0, 0),
  );

  assert.deepEqual(state, {
    day: 'MON',
    currentMinutes: 10 * 60 + 37,
    offsetMinutes: 97,
    label: '10:37',
  });
});

test('getCurrentTimeIndicatorState hides outside grid bounds and on sunday', () => {
  assert.equal(
    getCurrentTimeIndicatorState(
      { startMinutes: 9 * 60, endMinutes: 22 * 60 },
      new Date(2026, 2, 8, 10, 37, 0, 0),
    ),
    null,
  );
  assert.equal(
    getCurrentTimeIndicatorState(
      { startMinutes: 9 * 60, endMinutes: 22 * 60 },
      new Date(2026, 2, 9, 8, 59, 0, 0),
    ),
    null,
  );
  assert.equal(
    getCurrentTimeIndicatorState(
      { startMinutes: 9 * 60, endMinutes: 22 * 60 },
      new Date(2026, 2, 9, 22, 0, 0, 0),
    ),
    null,
  );
});

test('getNextSession returns the next weekly session even after the week boundary', () => {
  const board = makeBoard();
  const next = getNextSession(board, new Date('2026-03-15T12:00:00'));

  assert.ok(next);
  assert.equal(next.title, '자료구조');
  assert.equal(next.day, 'MON');
  assert.equal(next.start, '09:00');
});

test('getNextUpcomingSessionOccurrence skips ongoing classes and finds the next upcoming start', () => {
  const board = makeBoard();
  const nextUpcoming = getNextUpcomingSessionOccurrence(board, new Date('2026-03-09T09:45:00'));

  assert.ok(nextUpcoming);
  assert.equal(nextUpcoming.title, '미디어연구');
  assert.equal(nextUpcoming.day, 'MON');
  assert.equal(nextUpcoming.start, '13:00');
  assert.equal(nextUpcoming.isNext, true);
});

test('getDueLectureReminderEvents emits the crossed threshold for the next upcoming lecture', () => {
  const events = getDueLectureReminderEvents(
    makeBoard(),
    new Date('2026-03-09T12:29:00'),
    new Date('2026-03-09T12:30:00'),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].leadMinutes, 30);
  assert.equal(events[0].session.title, '미디어연구');
  assert.match(events[0].nativePayload.title, /30분 전/);
});

test('getDueLectureReminderEvents formats the one-hour threshold clearly', () => {
  const events = getDueLectureReminderEvents(
    makeBoard(),
    new Date('2026-03-09T11:59:00'),
    new Date('2026-03-09T12:00:00'),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].leadMinutes, 60);
  assert.match(events[0].nativePayload.title, /1시간 전/);
  assert.match(events[0].nativePayload.body, /1시간 뒤/);
});

test('getDueLectureReminderEvents supports custom minute-based reminder times', () => {
  const events = getDueLectureReminderEvents(
    makeBoard(),
    new Date('2026-03-09T11:29:00'),
    new Date('2026-03-09T11:30:00'),
    [90],
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].leadMinutes, 90);
  assert.match(events[0].nativePayload.title, /1시간 30분 전/);
  assert.match(events[0].nativePayload.body, /1시간 30분 뒤/);
});

test('createReminderPopupMarkup exposes a close button and escapes reminder content', () => {
  const markup = createReminderPopupMarkup({
    reminderId: 'reminder-1',
    leadMinutes: 15,
    courseTitle: '자료구조 <script>alert(1)</script>',
    location: '공학관 & 301',
    startsAt: '2026-03-09T13:00:00.000Z',
    title: '자료구조 · 15분 전',
    body: '곧 시작합니다 <b>지금 이동</b>',
  });

  assert.match(markup, /id="close-reminder"/);
  assert.match(markup, /aria-label="알림 닫기"/);
  assert.match(markup, /color-scheme: light/);
  assert.match(markup, /overflow-wrap: anywhere/);
  assert.match(markup, /class="header-copy"/);
  assert.doesNotMatch(markup, /\.card::before/);
  assert.match(markup, /window\.close\(\)/);
  assert.match(markup, /자료구조 &lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(markup, /공학관 &amp; 301/);
  assert.doesNotMatch(markup, /<script>alert\(1\)<\/script>/);
});

test('reminder popup markup removes the card-style border lines', () => {
  assert.match(reminderPopupSource, /\.card\s*\{[\s\S]*border: 0;/);
  assert.match(reminderPopupSource, /\.close-button\s*\{[\s\S]*border: 0;/);
  assert.match(reminderPopupSource, /\.meta\s*\{[\s\S]*border: 0;/);
  assert.match(reminderPopupSource, /\.body\s*\{[\s\S]*border-top: 0;/);
  assert.doesNotMatch(reminderPopupSource, /\.card\s*\{[\s\S]*border: 1px solid/);
  assert.doesNotMatch(reminderPopupSource, /\.body\s*\{[\s\S]*border-top: 1px solid/);
});

test('reminder popup markup softens shadows and allows long content to expand or scroll instead of clipping', () => {
  assert.match(reminderPopupSource, /--shadow: rgba\(79, 97, 150, 0\.08\);/);
  assert.match(reminderPopupSource, /body\s*\{[\s\S]*overflow-y: auto;/);
  assert.match(reminderPopupSource, /body\s*\{[\s\S]*scrollbar-gutter: stable;/);
  assert.match(reminderPopupSource, /\.card\s*\{[\s\S]*min-height: 0;/);
  assert.match(reminderPopupSource, /\.card\s*\{[\s\S]*box-shadow: 0 10px 20px var\(--shadow\);/);
  assert.match(reminderPopupSource, /\.close-button\s*\{[\s\S]*box-shadow: 0 3px 8px rgba\(79, 97, 150, 0\.06\);/);
  assert.match(reminderPopupSource, /\.body\s*\{[\s\S]*white-space: pre-wrap;/);
});

test('getDueLectureReminderEvents respects custom configured reminder times', () => {
  const fifteenMinuteOnly = getDueLectureReminderEvents(
    makeBoard(),
    new Date('2026-03-09T12:44:00'),
    new Date('2026-03-09T12:45:00'),
    [15],
  );
  const tenMinuteOnly = getDueLectureReminderEvents(
    makeBoard(),
    new Date('2026-03-09T12:44:00'),
    new Date('2026-03-09T12:45:00'),
    [10],
  );

  assert.equal(fifteenMinuteOnly.length, 1);
  assert.equal(fifteenMinuteOnly[0].leadMinutes, 15);
  assert.equal(tenMinuteOnly.length, 0);
});

test('getDueLectureReminderEvents only tracks the very next upcoming lecture', () => {
  const board = {
    ...makeBoard(),
    courses: [
      {
        id: 'course-next',
        title: '운영체제',
        code: 'CSE301',
        instructor: '한교수',
        location: '공학관 201',
        credits: 3,
        memo: '',
        color: '#5fc7b8',
        sessions: [{ id: 'session-next', day: 'MON', start: '10:30', end: '11:30', location: '공학관 201' }],
      },
      {
        id: 'course-later',
        title: '컴파일러',
        code: 'CSE410',
        instructor: '윤교수',
        location: '공학관 410',
        credits: 3,
        memo: '',
        color: '#ffb84c',
        sessions: [{ id: 'session-later', day: 'MON', start: '11:00', end: '12:00', location: '공학관 410' }],
      },
    ],
  };

  const events = getDueLectureReminderEvents(
    board,
    new Date('2026-03-09T09:59:00'),
    new Date('2026-03-09T10:00:00'),
  );

  assert.equal(events.length, 1);
  assert.equal(events[0].leadMinutes, 30);
  assert.equal(events[0].session.title, '운영체제');
});

test('getReminderSweepStartMs keeps long idle gaps instead of truncating them to the cold-start fallback', () => {
  const completedAtMs = Date.parse('2026-03-09T09:55:00.000Z');
  const longGapStartMs = Date.parse('2026-03-09T09:40:00.000Z');

  assert.equal(getReminderSweepStartMs(0, completedAtMs, 90 * 1000), completedAtMs - 90 * 1000);
  assert.equal(getReminderSweepStartMs(longGapStartMs, completedAtMs, 90 * 1000), longGapStartMs);
});

test('coerceAppData defaults lecture reminders to enabled for legacy app data', () => {
  const data = coerceAppData(
    {
      version: 1,
      activeBoardId: 'board-1',
      boards: [makeBoard()],
    },
    true,
  );

  assert.equal(data.preferences.lectureRemindersEnabled, true);
  assert.deepEqual(data.preferences.lectureReminderLeadMinutes, LECTURE_REMINDER_LEAD_MINUTES);
});

test('coerceAppData preserves an explicit disabled lecture reminder setting', () => {
  const data = coerceAppData(
    {
      version: 1,
      activeBoardId: 'board-1',
      boards: [makeBoard()],
      preferences: {
        lectureRemindersEnabled: false,
        lectureReminderLeadMinutes: [30, 10],
      },
    },
    true,
  );

  assert.equal(data.preferences.lectureRemindersEnabled, false);
  assert.deepEqual(data.preferences.lectureReminderLeadMinutes, [30, 10]);
});

test('coerceAppData normalizes custom lecture reminder times into the supported order', () => {
  const data = coerceAppData(
    {
      version: 1,
      activeBoardId: 'board-1',
      boards: [makeBoard()],
      preferences: {
        lectureRemindersEnabled: true,
        lectureReminderLeadMinutes: [10, 90, 10, 45],
      },
    },
    true,
  );

  assert.deepEqual(data.preferences.lectureReminderLeadMinutes, [90, 45, 10]);
});

test('parseLectureReminderLeadMinutesInput accepts comma and space separated custom times', () => {
  const parsed = parseLectureReminderLeadMinutesInput('90, 45 10');

  assert.deepEqual(parsed.invalidTokens, []);
  assert.deepEqual(parsed.minutes, [90, 45, 10]);
  assert.equal(formatLectureReminderLeadMinutesList(parsed.minutes), '1시간 30분 · 45분 · 10분');
});

test('parseLectureReminderLeadMinutesInput rejects invalid or out-of-range tokens', () => {
  const parsed = parseLectureReminderLeadMinutesInput('0, foo, 900, 30');

  assert.deepEqual(parsed.invalidTokens, ['0', 'foo', '900']);
  assert.deepEqual(parsed.minutes, [30]);
});

test('coerceAppData strict mode rejects invalid imports', () => {
  assert.throws(() => coerceAppData({ version: 1, activeBoardId: 'none', boards: [] }, true), /최소 한 개 이상의 시간표/);
});

test('coerceAppData sanitizes unsafe imported identifiers', () => {
  const data = coerceAppData(
    {
      version: 1,
      activeBoardId: 'board"><img src=x onerror=alert(1)>',
      boards: [
        {
          id: 'board"><img src=x onerror=alert(1)>',
          name: '보드',
          semester: '2026-1',
          note: '',
          courses: [
            {
              id: 'course" onclick="alert(1)',
              title: '보안 테스트',
              code: 'SEC101',
              instructor: '김교수',
              location: '공학관 100',
              credits: 3,
              memo: '',
              color: '#7c72ff',
              sessions: [
                {
                  id: 'session</div><script>alert(1)</script>',
                  day: 'MON',
                  start: '09:00',
                  end: '10:00',
                  location: '공학관 100',
                },
              ],
            },
          ],
        },
      ],
    },
    true,
  );

  assert.match(data.boards[0].id, /^board-/);
  assert.match(data.boards[0].courses[0].id, /^course-/);
  assert.match(data.boards[0].courses[0].sessions[0].id, /^session-/);
  assert.equal(data.activeBoardId, data.boards[0].id);
});

test('coerceAppData normalizes imported session times to 30-minute steps', () => {
  const data = coerceAppData(
    {
      version: 1,
      activeBoardId: 'board-1',
      boards: [
        {
          id: 'board-1',
          name: '보드',
          semester: '2026-1',
          note: '',
          courses: [
            {
              id: 'course-1',
              title: '정규화 테스트',
              code: 'GRID101',
              instructor: '김교수',
              location: '공학관 100',
              credits: 3,
              memo: '',
              color: '#7c72ff',
              sessions: [{ id: 'session-1', day: 'MON', start: '09:15', end: '10:20', location: '공학관 100' }],
            },
          ],
        },
      ],
    },
    true,
  );

  const normalized = data.boards[0].courses[0].sessions[0];
  assert.equal(normalized.start, '09:30');
  assert.equal(normalized.end, '10:30');
});

test('coerceAppData keeps imported late-night sessions valid after normalization', () => {
  const data = coerceAppData(
    {
      version: 1,
      activeBoardId: 'board-1',
      boards: [
        {
          id: 'board-1',
          name: '보드',
          semester: '2026-1',
          note: '',
          courses: [
            {
              id: 'course-1',
              title: '야간 수업',
              code: 'NIGHT101',
              instructor: '김교수',
              location: '공학관 100',
              credits: 1,
              memo: '',
              color: '#7c72ff',
              sessions: [{ id: 'session-1', day: 'MON', start: '23:45', end: '23:50', location: '공학관 100' }],
            },
          ],
        },
      ],
    },
    true,
  );

  const normalized = data.boards[0].courses[0].sessions[0];
  assert.equal(normalized.start, '23:00');
  assert.equal(normalized.end, '23:30');
});

test('validateCourse rejects off-grid session times', () => {
  const issues = validateCourse({
    id: 'course-1',
    title: '오프그리드 강의',
    code: 'GRID102',
    instructor: '김교수',
    location: '공학관 100',
    credits: 3,
    memo: '',
    color: '#7c72ff',
    sessions: [{ id: 'session-1', day: 'MON', start: '09:15', end: '10:15', location: '공학관 100' }],
  });

  assert.ok(issues.some((issue) => issue.includes('30분 단위')));
});

test('normalizeCourseDraft preserves in-progress spacing for editable course text fields', () => {
  const draft = normalizeCourseDraft({
    id: 'course-1',
    title: '자료 ',
    code: ' CSE220 ',
    instructor: '김 교수 ',
    location: '공학관 301 ',
    credits: 3,
    memo: '팀플 메모 ',
    color: '#7c72ff',
    sessions: [{ id: 'session-1', day: 'MON', start: '09:00', end: '10:00', location: '공학관 301 ' }],
  });

  assert.equal(draft.title, '자료 ');
  assert.equal(draft.code, ' CSE220 ');
  assert.equal(draft.instructor, '김 교수 ');
  assert.equal(draft.location, '공학관 301 ');
  assert.equal(draft.memo, '팀플 메모 ');
  assert.equal(draft.sessions[0].location, '공학관 301 ');
});

test('getSessionStartTimeOptions and getSessionEndTimeOptions stay inside the fixed 09:00 to 22:00 timetable range', () => {
  const startOptions = getSessionStartTimeOptions();
  const endOptions = getSessionEndTimeOptions();

  assert.equal(startOptions[0], '09:00');
  assert.equal(startOptions.at(-1), '21:30');
  assert.equal(endOptions[0], '09:30');
  assert.equal(endOptions.at(-1), '22:00');
  assert.equal(startOptions.length, 26);
  assert.equal(endOptions.length, 26);
  assert.ok(startOptions.every((time) => Number(time.slice(-2)) % TIME_STEP_MINUTES === 0));
  assert.ok(endOptions.every((time) => Number(time.slice(-2)) % TIME_STEP_MINUTES === 0));
});

test('getSessionEndTimeOptionsAfterStart only returns end times later than the chosen start', () => {
  const optionsAfterNine = getSessionEndTimeOptionsAfterStart('09:00');
  const optionsAfterLateStart = getSessionEndTimeOptionsAfterStart('21:30');

  assert.equal(optionsAfterNine[0], '09:30');
  assert.ok(optionsAfterNine.every((time) => time > '09:00'));
  assert.deepEqual(optionsAfterLateStart, ['22:00']);
});

test('time widget helpers expose only valid hour and minute combinations', () => {
  const startOptions = getSessionStartTimeOptions();
  const endOptions = getSessionEndTimeOptions();

  assert.equal(getHourOptions(startOptions)[0], '09');
  assert.equal(getHourOptions(startOptions).at(-1), '21');
  assert.deepEqual(getMinuteOptionsForHour(startOptions, '09'), ['00', '30']);
  assert.deepEqual(getMinuteOptionsForHour(startOptions, '21'), ['00', '30']);
  assert.deepEqual(getMinuteOptionsForHour(endOptions, '09'), ['30']);
  assert.deepEqual(getMinuteOptionsForHour(endOptions, '22'), ['00']);
});

test('time widget helpers compose parts and coerce boundary selections to valid times', () => {
  const startOptions = getSessionStartTimeOptions();
  const endOptions = getSessionEndTimeOptions();

  assert.deepEqual(splitTimeParts('09:30'), { hour: '09', minute: '30' });
  assert.equal(composeTimeParts('9', '0'), '09:00');
  assert.equal(coerceTimeToOptions('23:30', startOptions), '21:30');
  assert.equal(coerceTimeToOptions('00:00', endOptions), '09:30');
  assert.equal(coerceTimeToOptions('09:30', startOptions), '09:30');
});

test('meridiem time helpers preserve canonical HH:MM values for midnight and noon boundaries', () => {
  assert.deepEqual(splitMeridiemTimeParts('00:30'), { meridiem: 'AM', hour: '12', minute: '30' });
  assert.deepEqual(splitMeridiemTimeParts('12:00'), { meridiem: 'PM', hour: '12', minute: '00' });
  assert.deepEqual(splitMeridiemTimeParts('12:30'), { meridiem: 'PM', hour: '12', minute: '30' });
  assert.deepEqual(splitMeridiemTimeParts('23:00'), { meridiem: 'PM', hour: '11', minute: '00' });
  assert.deepEqual(splitMeridiemTimeParts('23:30'), { meridiem: 'PM', hour: '11', minute: '30' });

  assert.equal(composeMeridiemTimeParts('AM', '12', '30'), '00:30');
  assert.equal(composeMeridiemTimeParts('PM', '12', '00'), '12:00');
  assert.equal(composeMeridiemTimeParts('PM', '12', '30'), '12:30');
  assert.equal(composeMeridiemTimeParts('PM', '11', '00'), '23:00');
  assert.equal(composeMeridiemTimeParts('PM', '11', '30'), '23:30');
});

test('meridiem time helpers coerce invalid widget boundary selections to valid half-hour options', () => {
  const startOptions = getSessionStartTimeOptions();
  const endOptions = getSessionEndTimeOptions();

  assert.deepEqual(coerceMeridiemTimeParts('PM', '11', '30', startOptions), {
    meridiem: 'PM',
    hour: '09',
    minute: '30',
  });
  assert.deepEqual(coerceMeridiemTimeParts('AM', '12', '00', endOptions), {
    meridiem: 'AM',
    hour: '09',
    minute: '30',
  });
  assert.deepEqual(coerceMeridiemTimeParts('AM', '13', '15', startOptions), {
    meridiem: 'AM',
    hour: '09',
    minute: '00',
  });
});

test('session time widget keeps meridiem changes inside the hour-minute flow', () => {
  assert.equal(resolveSessionTimeMenuSegment(null), 'hour');
  assert.equal(resolveSessionTimeMenuSegment('meridiem'), 'hour');
  assert.equal(resolveSessionTimeMenuSegment('minute'), 'minute');

  assert.equal(getNextSessionTimeMenuSegment('meridiem', null), 'hour');
  assert.equal(getNextSessionTimeMenuSegment('meridiem', 'minute'), 'minute');
  assert.equal(getNextSessionTimeMenuSegment('hour', 'hour'), 'minute');
  assert.equal(getNextSessionTimeMenuSegment('minute', 'minute'), 'minute');
});

test('session time popover relies on the option-button flow without duplicate hour-minute trigger controls', () => {
  assert.match(rendererAppSource, /renderSessionTimeMeridiemButtons\(meridiem, meridiemOptions\)/);
  assert.match(rendererAppSource, /const selectionSummary = `\$\{SESSION_TIME_MERIDIEM_LABELS\[meridiem\]\} \$\{Number\(hour\)\}시 \$\{minute\}분`;/);
  assert.match(rendererAppSource, /session-time-select-menu-summary/);
  assert.doesNotMatch(rendererAppSource, /renderSessionTimeSelectTrigger/);
  assert.doesNotMatch(rendererAppSource, /data-session-time-select-trigger/);
  assert.doesNotMatch(rendererAppSource, /session-time-select-row/);
  assert.doesNotMatch(indexCssSource, /\.session-time-select-trigger\s*\{/);
  assert.match(indexCssSource, /\.session-time-select-menu-summary\s*\{/);
});

test('session time trigger stacks the selected time above the action label', () => {
  assert.match(indexCssSource, /\.session-time-trigger-label\s*\{[\s\S]*display:\s*flex;[\s\S]*flex-direction:\s*column;[\s\S]*align-items:\s*flex-start;/);
  assert.match(indexCssSource, /\.session-time-trigger-meta,\s*\.session-time-trigger-placeholder\s*\{[\s\S]*display:\s*block;/);
});

test('session rows keep button-based time widgets outside label wrappers', () => {
  assert.match(
    rendererAppSource,
    /const resolvedStartValue = coerceTimeToOptions\(session\.start, SESSION_START_TIME_OPTIONS\);/,
  );
  assert.match(
    rendererAppSource,
    /const resolvedEndValue = coerceTimeToOptions\(session\.end, getSessionEndTimeOptionsAfterStart\(resolvedStartValue\)\);/,
  );
  assert.match(
    rendererAppSource,
    /<div class="form-field">\s*<span>시작<\/span>\s*\$\{this\.renderSessionTimeInput\(session\.id, 'session-start', resolvedStartValue, resolvedEndValue\)\}/,
  );
  assert.match(
    rendererAppSource,
    /<div class="form-field">\s*<span>종료<\/span>\s*\$\{this\.renderSessionTimeInput\(session\.id, 'session-end', resolvedEndValue, resolvedStartValue\)\}/,
  );
  assert.doesNotMatch(
    rendererAppSource,
    /<label>\s*<span>시작<\/span>\s*\$\{this\.renderSessionTimeInput\(session\.id, 'session-start', resolvedStartValue, resolvedEndValue\)\}/,
  );
  assert.doesNotMatch(
    rendererAppSource,
    /<label>\s*<span>종료<\/span>\s*\$\{this\.renderSessionTimeInput\(session\.id, 'session-end', resolvedEndValue, resolvedStartValue\)\}/,
  );
});

test('current-time timetable indicator uses retained DOM anchors and a dedicated sync ticker', () => {
  assert.doesNotMatch(rendererAppSource, /getCurrentTimeSlotHighlight/);
  assert.doesNotMatch(rendererAppSource, /current-time-slot/);
  assert.match(rendererAppSource, /data-day-head="\$\{day\}"/);
  assert.match(rendererAppSource, /data-day-column="\$\{day\}"/);
  assert.match(rendererAppSource, /const dayColumns = \[\.\.\.this\.root\.querySelectorAll<HTMLElement>\('\[data-day-column\]'\)\];/);
  assert.match(rendererAppSource, /const indicator = this\.root\.querySelector<HTMLElement>\('\[data-current-time-indicator\]'\);/);
  assert.match(rendererAppSource, /indicator\.style\.left = `\$\{dayColumn\.offsetLeft\}px`;/);
  assert.match(rendererAppSource, /indicator\.style\.width = `\$\{dayColumn\.offsetWidth\}px`;/);
  assert.doesNotMatch(rendererAppSource, /axisLabel/);
  assert.match(rendererAppSource, /if \(!dayColumn\) \{/);
  assert.match(rendererAppSource, /<div class="timetable-current-time-indicator" data-current-time-indicator hidden aria-hidden="true">/);
  assert.match(rendererAppSource, /private startCurrentTimeTicker\(\): void/);
  assert.match(rendererAppSource, /private syncCurrentTimeIndicator\(now = new Date\(\)\): void/);
  assert.match(rendererAppSource, /const indicatorState = getCurrentTimeIndicatorState\(range, now\);/);
  assert.match(
    rendererAppSource,
    /this\.currentTimeTicker = window\.setTimeout\(\(\) => \{\s*this\.currentTimeTicker = null;\s*this\.syncCurrentTimeIndicator\(\);\s*this\.queueCurrentTimeIndicatorTick\(\);/m,
  );
  assert.match(indexCssSource, /\.timetable-body\s*\{\s*position: relative;/);
  assert.doesNotMatch(indexCssSource, /\.timetable-current-time-axis\s*\{/);
  assert.match(indexCssSource, /\.timetable-current-time-indicator\s*\{[\s\S]*left: 0;[\s\S]*width: 0;[\s\S]*pointer-events: none;[\s\S]*z-index: 3;/);
  assert.match(indexCssSource, /\.timetable-current-time-dot\s*\{[\s\S]*position: absolute;[\s\S]*transform: translate\(-50%, -50%\);/);
  assert.match(indexCssSource, /\.timetable-current-time-line\s*\{[\s\S]*position: absolute;[\s\S]*inset-inline: 0;[\s\S]*transform: translateY\(-50%\);/);
  assert.match(indexCssSource, /\.timetable-current-time-indicator\[hidden\]\s*\{\s*display: none;/);
  assert.match(indexCssSource, /\.day-head\.is-current-time-day span\s*\{/);
  assert.doesNotMatch(indexCssSource, /\.day-column\.is-current-time-day\s*\{/);
  assert.doesNotMatch(rendererAppSource, /dayColumn\.classList\.add\('is-current-time-day'\)/);
});

test('current-time indicator re-syncs during content-column resize so editor panel toggles do not leave the bar drifting', () => {
  assert.match(rendererAppSource, /private currentTimeIndicatorSyncFrame: number \| null = null;/);
  assert.match(rendererAppSource, /private layoutResizeObserver: ResizeObserver \| null = null;/);
  assert.match(rendererAppSource, /this\.bindLayoutResizeObserver\(\);/);
  assert.match(rendererAppSource, /private bindLayoutResizeObserver\(\): void \{/);
  assert.match(
    rendererAppSource,
    /this\.layoutResizeObserver = new ResizeObserver\(\(\) => \{\s*this\.queueCurrentTimeIndicatorSync\(\);\s*}\);/m,
  );
  assert.match(rendererAppSource, /this\.layoutResizeObserver\.observe\(contentSlot\);/);
  assert.match(rendererAppSource, /private queueCurrentTimeIndicatorSync\(\): void \{/);
  assert.match(
    rendererAppSource,
    /this\.currentTimeIndicatorSyncFrame = window\.requestAnimationFrame\(\(\) => \{\s*this\.currentTimeIndicatorSyncFrame = null;\s*this\.syncCurrentTimeIndicator\(\);/m,
  );
  assert.match(rendererAppSource, /this\.layoutResizeObserver\?\.disconnect\(\);/);
  assert.match(rendererAppSource, /this\.cancelQueuedCurrentTimeIndicatorSync\(\);/);
});

test('hero header renders board name and semester inline instead of a stacked semester subtitle', () => {
  assert.match(rendererAppSource, /<div class="hero-title-row">\s*<h2>\$\{escapeHtml\(board\.name\)\}<\/h2>\s*<span class="hero-title-meta">\$\{escapeHtml\(board\.semester\)\}<\/span>/m);
  assert.match(rendererAppSource, /\$\{board\.note \? `<p class=\"hero-copy\">\$\{escapeHtml\(board\.note\)\}<\/p>` : ''\}/);
  assert.doesNotMatch(rendererAppSource, /<p class="hero-copy">\$\{escapeHtml\(board\.semester\)\}\$\{board\.note \? ` · \$\{escapeHtml\(board\.note\)\}` : ' · 에디토리얼 톤의 데스크톱 시간표'\}<\/p>/);
  assert.match(indexCssSource, /\.hero-title-row\s*\{[\s\S]*display: inline-flex;[\s\S]*align-items: baseline;[\s\S]*flex-wrap: wrap;/);
  assert.match(indexCssSource, /\.hero-title-meta\s*\{[\s\S]*font-size: 14px;[\s\S]*font-weight: 600;[\s\S]*white-space: nowrap;/);
});

test('sidebar drops the separate next schedule card and keeps reminder controls alongside today agenda markers', () => {
  assert.doesNotMatch(rendererAppSource, /<p class="eyebrow">/);
  assert.doesNotMatch(rendererAppSource, /<h2>다음 일정<\/h2>/);
  assert.match(rendererAppSource, /<h2>강의 알림<\/h2>/);
  assert.match(rendererAppSource, /item\.isNext \? '<span class="agenda-state">다음 수업<\/span>' : ''/);
  assert.doesNotMatch(rendererAppSource, /private renderNextSession\(/);
  assert.doesNotMatch(rendererAppSource, /테스트 버튼은 설정과 관계없이 팝업·네이티브 알림·소리를 1회 바로 띄워줍니다\./);
  assert.doesNotMatch(indexCssSource, /\.reminder-settings-footnote\s*\{/);
  assert.doesNotMatch(rendererAppSource, />다음 움직임</);
  assert.doesNotMatch(indexCssSource, /\.eyebrow\s*\{/);
});

test('renderer bundles Pretendard locally so the primary UI font stays consistent across installs', () => {
  const bundledFontPath = path.join(__dirname, '..', 'src', 'assets', 'fonts', 'PretendardVariable.ttf');
  const bundledLicensePath = path.join(__dirname, '..', 'src', 'assets', 'fonts', 'Pretendard-LICENSE.txt');

  assert.ok(fs.existsSync(bundledFontPath));
  assert.ok(fs.existsSync(bundledLicensePath));
  assert.match(indexCssSource, /@font-face\s*\{[\s\S]*font-family:\s*'Soosta Pretendard';[\s\S]*url\('\.\/assets\/fonts\/PretendardVariable\.ttf'\)\s*format\('truetype'\);[\s\S]*font-weight:\s*45 920;[\s\S]*font-display:\s*swap;/);
  assert.match(indexCssSource, /--font-stack:\s*'Soosta Pretendard',\s*'Pretendard Variable',\s*Pretendard,\s*'SUIT Variable',\s*SUIT,\s*Inter,\s*'SF Pro Display',\s*'Apple SD Gothic Neo',\s*system-ui,\s*sans-serif;/);
  assert.ok(webpackRulesSource.includes("test: /\\.(woff2?|ttf|otf|eot)$/i,"));
  assert.ok(webpackRulesSource.includes("type: 'asset/resource',"));
});

test('lecture reminder card does not draw an extra border line', () => {
  const lectureReminderBlock = getCssBlock('.lecture-reminder');
  assert.match(lectureReminderBlock, /border: 0;/);
  assert.match(lectureReminderBlock, /box-shadow: 0 10px 24px rgba\(79, 97, 150, 0\.08\);/);
  assert.match(lectureReminderBlock, /align-items: flex-start;/);
  assert.doesNotMatch(lectureReminderBlock, /border:\s*1px solid/);
  assert.doesNotMatch(lectureReminderBlock, /inset 0 1px 0/);
});

test('top-right banner toast does not draw an extra border line', () => {
  const bannerBlock = getCssBlock('.banner');
  assert.match(bannerBlock, /border: 0;/);
  assert.match(bannerBlock, /box-shadow: 0 6px 14px rgba\(79, 97, 150, 0\.028\);/);
  assert.doesNotMatch(bannerBlock, /border:\s*1px solid/);
  assert.doesNotMatch(bannerBlock, /inset 0 1px 0/);
});

test('global shadow tokens and secondary controls stay flatter after the shadow cleanup', () => {
  assert.match(indexCssSource, /--shadow: 0 12px 28px rgba\(79, 97, 150, 0\.09\);/);
  assert.match(indexCssSource, /--shadow-card: 0 8px 20px rgba\(79, 97, 150, 0\.07\);/);
  assert.match(indexCssSource, /--shadow-control: 0 4px 12px rgba\(79, 97, 150, 0\.05\);/);
  assert.match(indexCssSource, /--shadow-button: 0 8px 18px rgba\(98, 86, 255, 0\.16\);/);
  assert.match(indexCssSource, /\.ghost-button\s*\{[\s\S]*box-shadow: none;/);
  assert.match(indexCssSource, /\.soft-button\s*\{[\s\S]*box-shadow: none;/);
  assert.match(getCssBlock('.sync-chip'), /box-shadow: none;/);
  assert.match(getCssBlock('.color-field'), /box-shadow: none;/);
  assert.match(getCssBlock('.topbar-brand-mark'), /box-shadow: inset 0 0 0 1px rgba\(59, 72, 108, 0\.08\);/);
  assert.doesNotMatch(getCssBlock('.topbar-brand-mark'), /0 8px 18px rgba\(79, 97, 150, 0\.14\)/);
});

test('course color field styles support a collapsible recommendation and RGB control section', () => {
  assert.match(getCssBlock('.color-field-shell'), /flex-direction: column;/);
  assert.match(getCssBlock('.color-field-toggle'), /justify-content: space-between;/);
  assert.match(getCssBlock('.color-field-toggle-summary'), /flex: 1;/);
  assert.match(getCssBlock('.color-field-toggle-kicker'), /font-size: 11px;/);
  assert.match(indexCssSource, /\.color-field-toggle\[aria-expanded='true'\] \.color-field-toggle-icon\s*\{[\s\S]*transform: rotate\(180deg\);/);
  assert.match(getCssBlock('.color-field'), /flex-direction: column;/);
  assert.match(indexCssSource, /\.color-field\[hidden\]\s*\{\s*display: none;/);
  assert.match(getCssBlock('.color-swatch-grid'), /grid-template-columns: repeat\(2, minmax\(0, 1fr\)\);/);
  assert.match(getCssBlock('.color-rgb-grid'), /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\);/);
  assert.match(getCssBlock('.color-swatch-button.is-active'), /background: rgba\(110, 103, 255, 0\.08\);/);
  assert.match(getCssBlock('.color-preview-card'), /background: rgba\(255, 255, 255, 0\.78\);/);
});

test('app shell and packaged resources share logo/logo.png as the logo asset', () => {
  assert.match(mainProcessSource, /const APP_LOGO_FILE_NAME = 'logo\.png';/);
  assert.match(indexCssSource, /url\('\.\.\/logo\/logo\.png'\) center \/ cover no-repeat;/);
  assert.match(forgeConfigSource, /const packagedAppLogo = path\.resolve\(__dirname, 'logo\/logo\.png'\);/);
  assert.match(forgeConfigSource, /extraResource: \[packagedAppLogo\],/);
  assert.doesNotMatch(mainProcessSource, /soosta-logo\.png/);
  assert.doesNotMatch(indexCssSource, /soosta-logo\.png/);
  assert.doesNotMatch(forgeConfigSource, /soosta-logo\.png/);
});

test('floating timetable surfaces use softer shadows instead of heavy lift', () => {
  assert.match(getCssBlock('.session-context-menu'), /box-shadow: 0 12px 28px rgba\(79, 97, 150, 0\.12\);/);
  assert.match(getCssBlock('.timetable-current-time-dot'), /0 6px 12px rgba\(219, 94, 122, 0\.16\)/);
  assert.match(getCssBlock('.timetable-current-time-line'), /0 6px 14px rgba\(219, 94, 122, 0\.16\)/);
  assert.match(getCssBlock('.session-block'), /box-shadow: 0 10px 22px color-mix\(in srgb, var\(--course-color\) 16%, transparent\);/);
  assert.match(getCssBlock('.session-block.is-selected'), /box-shadow: 0 14px 28px color-mix\(in srgb, var\(--course-color\) 24%, transparent\);/);
  assert.match(getCssBlock('.session-block.is-context-target'), /0 16px 30px color-mix\(in srgb, var\(--course-color\) 28%, transparent\)/);
});

test('reminder popup window grows to fit longer reminder content before it is shown', () => {
  assert.match(mainProcessSource, /const REMINDER_POPUP_MIN_HEIGHT = 236;/);
  assert.match(mainProcessSource, /const REMINDER_POPUP_MAX_HEIGHT = 420;/);
  assert.match(mainProcessSource, /const measureReminderPopupHeight = async \(window: BrowserWindow\): Promise<number> =>/);
  assert.match(mainProcessSource, /executeJavaScript\(`[\s\S]*document\.documentElement[\s\S]*scrollHeight[\s\S]*`\);/);
  assert.match(mainProcessSource, /const popupHeight = Math\.max\(REMINDER_POPUP_MIN_HEIGHT, Math\.min\(maxHeight, measuredHeight\)\);/);
  assert.match(mainProcessSource, /positionReminderPopupWindow\(popup, REMINDER_POPUP_WIDTH, popupHeight\);/);
});

test('main window chrome stays fully custom without native frame borders', () => {
  assert.match(mainProcessSource, /mainWindow = new BrowserWindow\(\{[\s\S]*frame: false,/);
  assert.match(mainProcessSource, /mainWindow = new BrowserWindow\(\{[\s\S]*hasShadow: false,/);
  assert.doesNotMatch(mainProcessSource, /mainWindow = new BrowserWindow\(\{[\s\S]*titleBarStyle:/);
});

test('reminder popup window disables native shadow chrome', () => {
  assert.match(mainProcessSource, /reminderPopupWindow = new BrowserWindow\(\{[\s\S]*frame: false,[\s\S]*hasShadow: false,/);
});

test('topbar removes the separator line so the app edge stays clean', () => {
  const topbarBlock = getCssBlock('.app-topbar');
  assert.match(topbarBlock, /border-bottom: 0;/);
  assert.doesNotMatch(topbarBlock, /border-bottom:\s*1px solid/);
});

test('timetable session blocks clamp overflowing copy inside constrained cells', () => {
  assert.match(rendererAppSource, /const blockLayout = getSessionBlockLayout\(blockHeight, session\.widthPercent, session\.courseTitle\.length\)/);
  assert.match(rendererAppSource, /data-density="\$\{blockLayout\.density\}"/);
  assert.match(rendererAppSource, /session-block-meta session-block-time/);
  assert.match(rendererAppSource, /session-block-meta session-block-location/);
  assert.match(indexCssSource, /\.session-block\s*\{[\s\S]*overflow: hidden;/);
  assert.match(indexCssSource, /\.session-block-title\s*\{[\s\S]*-webkit-line-clamp: var\(--session-block-title-lines, 1\)/);
  assert.match(indexCssSource, /\.session-block-time\s*\{[\s\S]*font-size: calc\(var\(--session-block-meta-size\) \+ 2px\);[\s\S]*font-weight: 600;/);
  assert.match(indexCssSource, /\.session-block-location\s*\{[\s\S]*font-size: calc\(var\(--session-block-meta-size\) \+ 1px\);/);
});

test('timetable footer legend is removed so the grid can use the freed vertical space', () => {
  assert.doesNotMatch(rendererAppSource, /요일: 월–토/);
  assert.doesNotMatch(rendererAppSource, /드래그는 30분 단위로 스냅 이동됩니다\./);
  assert.match(indexCssSource, /\.timetable-scroll\s*\{[\s\S]*padding-bottom: 0;/);
});

test('renderer keeps the weekday timetable readable while preventing horizontal scroll on narrow widths', () => {
  assert.doesNotMatch(rendererAppSource, /syncTimetablePixelsPerMinuteFit/);
  assert.match(
    rendererAppSource,
    /private getTimetablePixelsPerMinute\(\): number \{\s*return this\.timetableFitPixelsPerMinute \?\? getTimetablePixelsPerMinute\(this\.viewportHeight \|\| this\.getViewportHeight\(\)\);\s*\}/,
  );
  assert.match(getCssBlock(".app-shell[data-viewport-height-band='short']"), /--main-plan-max-height: min\(920px, calc\(100dvh - 184px\)\);/);
  assert.match(indexCssSource, /\.timetable-scroll\s*\{[\s\S]*overflow-y: auto;[\s\S]*overflow-x: hidden;/);
  assert.match(indexCssSource, /\.timetable-grid\s*\{[\s\S]*width:\s*100%;/);
  assert.match(rendererAppSource, /private renderTimetable\([\s\S]*TIMETABLE_DAY_ORDER\.map\(/);
  assert.match(
    indexCssSource,
    /\.timetable-head,\s*\.timetable-body\s*\{[\s\S]*grid-template-columns:\s*var\(--time-axis-width\) repeat\(5, minmax\(0, 1fr\)\);/,
  );
});

test('renderer exposes a timetable fit toggle that recalculates the visible timetable height and restores the default scale', () => {
  assert.match(rendererAppSource, /data-action="toggle-timetable-fit"/);
  assert.match(rendererAppSource, /aria-pressed="\$\{this\.isTimetableFitMode \? 'true' : 'false'\}"/);
  assert.match(rendererAppSource, /private measureFittedTimetablePixelsPerMinute\(\): number \| null/);
  assert.match(rendererAppSource, /private syncTimetableFitMode\(preserveFocus = false\): void/);
  assert.match(rendererAppSource, /private toggleTimetableFitMode\(\): void/);
  assert.match(rendererAppSource, /this\.queueTimetableFitSync\(preserveFocus\);/);
  assert.match(rendererAppSource, /this\.timetableFitPixelsPerMinute \?\? getTimetablePixelsPerMinute\(this\.viewportHeight \|\| this\.getViewportHeight\(\)\)/);
  assert.match(rendererAppSource, /case 'toggle-timetable-fit':[\s\S]*this\.toggleTimetableFitMode\(\);/);
  assert.match(indexCssSource, /\.hero-actions\s*\{[\s\S]*justify-content: flex-end;/);
  assert.match(indexCssSource, /\.timetable-fit-button\s*\{[\s\S]*white-space: nowrap;/);
});

test('renderer exposes a JPG export action for the timetable card', () => {
  assert.match(rendererAppSource, /data-action="export-timetable-jpg"/);
  assert.match(rendererAppSource, /\$\{renderIcon\('image'\)\}\s*\$\{this\.isTimetableJpegExporting \? 'JPG 저장 중…' : 'JPG 다운로드'\}/);
  assert.match(rendererAppSource, /image: '<rect x="3" y="5" width="18" height="14" rx="2" \/><circle cx="9" cy="10" r="1\.5" \/><path d="m21 16-5\.5-5\.5L8 18" \/>'/);
  assert.match(rendererAppSource, /JPG 다운로드/);
  assert.match(rendererAppSource, /JPG 저장 중…/);
  assert.match(rendererAppSource, /private async exportTimetableJpeg\(\): Promise<void>/);
  assert.match(rendererAppSource, /await renderTimetableToJpegBytes\(\{/);
  assert.match(rendererAppSource, /window\.soosta\.exportTimetableJpeg\(\{/);
  assert.match(rendererAppSource, /fileName: getTimetableJpegFileName\(board\.name\)/);
  assert.match(rendererAppSource, /case 'export-timetable-jpg':[\s\S]*await this\.exportTimetableJpeg\(\);/);
  assert.match(indexCssSource, /\.hero-action-buttons\s*\{[\s\S]*display: inline-flex;/);
  assert.match(indexCssSource, /\.timetable-export-button,\s*[\s\S]*\.timetable-fit-button\s*\{/);
});

test('main, preload, and shared types wire the JPG export IPC path', () => {
  assert.match(sharedConstantsSource, /exportTimetableJpeg:\s*'soosta:export-timetable-jpeg'/);
  assert.match(sharedTypesSource, /export interface TimetableJpegExportRequest \{\s*fileName: string;\s*bytes: Uint8Array;\s*\}/);
  assert.match(sharedTypesSource, /exportTimetableJpeg: \(payload: TimetableJpegExportRequest\) => Promise<ExportResult>;/);
  assert.match(preloadSource, /exportTimetableJpeg: \(payload: TimetableJpegExportRequest\) =>/);
  assert.match(preloadSource, /ipcRenderer\.invoke\(IPC_CHANNELS\.exportTimetableJpeg, payload\)/);
  assert.match(mainProcessSource, /ipcMain\.handle\(IPC_CHANNELS\.exportTimetableJpeg, async \(_event, payload: TimetableJpegExportRequest\) => \{/);
  assert.match(mainProcessSource, /return exportTimetableJpeg\(getMainWindow\(\), payload\);/);
  assert.match(persistenceSource, /export const exportTimetableJpeg = async \(/);
  assert.match(persistenceSource, /filters: \[\{ name: 'JPG Image', extensions: \['jpg', 'jpeg'\] \}\]/);
  assert.match(persistenceSource, /const resolvedFilePath = ensureFileExtension\(filePath, \['jpg', 'jpeg'\]\);/);
});

test('JPG export draws the semester inline with the board title and keeps session blocks fully opaque', () => {
  assert.match(exportImageSource, /const titleWidth = context\.measureText\(board\.name\)\.width;/);
  assert.match(exportImageSource, /context\.fillText\(board\.semester, contentX \+ titleWidth \+ 14, titleY \+ 10\);/);
  assert.match(exportImageSource, /const fillColor = session\.isConflict \? theme\.danger : accent;/);
  assert.doesNotMatch(exportImageSource, /withAlpha\(accent, 0\.16\)/);
});

test('JPG export clamps the left time labels so the last hour does not overflow the grid', () => {
  assert.match(exportImageSource, /const labelY = Math\.min\(/);
  assert.match(exportImageSource, /Math\.max\(bodyY \+ EXPORT_TIME_LABEL_OFFSET_Y, lineY - EXPORT_TIME_LABEL_OFFSET_Y\)/);
  assert.match(exportImageSource, /bodyY \+ metrics\.gridHeight - EXPORT_TIME_LABEL_BOTTOM_PADDING/);
  assert.doesNotMatch(exportImageSource, /context\.fillText\(minutesToTime\(minutes\), metrics\.outerPaddingX \+ metrics\.cardPadding \+ 18, lineY \+ 10\);/);
});

test('initial renderer load still renders through renderFrame so layout state stays consistent after the first edit', () => {
  assert.match(
    rendererAppSource,
    /finally \{\s*this\.isLoading = false;\s*this\.renderFrame\(\);\s*this\.startCurrentTimeTicker\(\);/,
  );
  assert.doesNotMatch(
    rendererAppSource,
    /finally \{\s*this\.isLoading = false;\s*this\.render\(\);\s*this\.startCurrentTimeTicker\(\);/,
  );
});

test('editor removes the representative location field and relabels the reset action', () => {
  assert.doesNotMatch(rendererAppSource, /<span>대표 장소<\/span>/);
  assert.match(rendererAppSource, /<input type="hidden" name="location" value="\$\{escapeHtml\(course\.location\)\}" \/>/);
  assert.match(rendererAppSource, /data-action="new-course">\$\{renderIcon\('reset'\)\}초기화<\/button>/);
  assert.match(rendererAppSource, /강의 입력 폼을 초기화했어요\./);
});

test('editor close button stays dynamically centered without hover shift', () => {
  assert.match(rendererAppSource, /class="inspector-close-button"/);
  assert.match(rendererAppSource, /\$\{renderIcon\('collapse-right'\)\}/);
  assert.match(rendererAppSource, /<\/form>\s*<button[\s\S]*class="inspector-close-button"/);
  assert.match(rendererAppSource, /private syncInspectorCloseButtonPosition\(\): void/);
  assert.match(rendererAppSource, /if \(shell\?\.dataset\.layoutMode === 'inspector-below'\) \{\s*panel\.style\.removeProperty\('--inspector-close-button-top'\);\s*return;\s*\}/);
  assert.match(rendererAppSource, /panel\.style\.setProperty\('--inspector-close-button-top', `\$\{Math\.round\(nextTop\)\}px`\)/);
  assert.match(indexCssSource, /\.icon-button:hover,[\s\S]*transform: translateY\(-1px\);/);
  assert.match(indexCssSource, /\.inspector-close-button\s*\{[\s\S]*top: var\(--inspector-close-button-top, calc\(50% - 20px\)\);[\s\S]*left: -28px;[\s\S]*transform: none;/);
  assert.match(indexCssSource, /\.app-shell\[data-layout-mode='inspector-below'\] \.inspector-close-button\s*\{[\s\S]*top: 18px;[\s\S]*right: 18px;[\s\S]*left: auto;/);
  assert.match(indexCssSource, /\.inspector-close-button:hover,[\s\S]*\.inspector-close-button:focus-visible\s*\{[\s\S]*transform: none;/);
  assert.match(indexCssSource, /\.inspector-close-button:active\s*\{[\s\S]*transform: none;/);
});

test('compact editor layout keeps the inspector on the side longer and recenters it naturally when it stacks below', () => {
  assert.deepEqual(getRendererLayout(1319, 900), {
    viewportBand: 'compact',
    viewportHeightBand: 'short',
    shellLayoutMode: 'three-column',
    timetableDensity: 'compact',
    sidebarDensity: 'tight',
    inspectorPlacement: 'side',
    preserveMainHorizontalScrollbarAvoidance: true,
  });

  assert.deepEqual(getRendererLayout(1179, 900), {
    viewportBand: 'compact',
    viewportHeightBand: 'short',
    shellLayoutMode: 'inspector-below',
    timetableDensity: 'compact',
    sidebarDensity: 'tight',
    inspectorPlacement: 'below',
    preserveMainHorizontalScrollbarAvoidance: true,
  });

  assert.match(indexCssSource, /\.app-shell\[data-viewport-band='compact'\]\[data-layout-mode='three-column'\] \.app-layout\s*\{[\s\S]*grid-template-columns: minmax\(236px, 252px\) minmax\(0, 1fr\) minmax\(288px, 312px\);/);
  assert.match(indexCssSource, /\.app-shell\[data-layout-mode='inspector-below'\] \.inspector-column\s*\{[\s\S]*grid-column: 1 \/ -1;[\s\S]*width: 100%;[\s\S]*max-width: none;[\s\S]*align-self: stretch;[\s\S]*transform-origin: center top;/);
  assert.match(indexCssSource, /\.app-shell\[data-layout-mode='inspector-below'\] \.inspector-panel\s*\{[\s\S]*width: min\(100%, 1040px\);[\s\S]*margin-inline: auto;[\s\S]*background: var\(--surface-strong\);/);
  assert.match(indexCssSource, /\.app-shell\[data-layout-mode='inspector-below'\]\[data-inspector-state='opening'\] \.inspector-panel,[\s\S]*transform: translateY\(20px\) scale\(0\.984\);/);
});

test('color input defers live input mutations so the native RGB picker stays open while typing', () => {
  assert.match(
    rendererAppSource,
    /target instanceof HTMLInputElement && event\.type === 'input'[\s\S]*target\.type === 'color'/,
  );
});

test('course editor renders a foldable color section with recommended color actions and RGB adjustment controls', () => {
  assert.match(rendererAppSource, /private isCourseColorFieldExpanded = false;/);
  assert.match(rendererAppSource, /case 'toggle-color-field':/);
  assert.match(rendererAppSource, /'chevron-down': '<path d="m6 9 6 6 6-6" \/>',/);
  assert.match(rendererAppSource, /data-action="toggle-color-field"/);
  assert.match(rendererAppSource, /\$\{renderIcon\('chevron-down'\)\}/);
  assert.match(rendererAppSource, /aria-controls="course-color-panel"/);
  assert.match(rendererAppSource, /추천 색상과 RGB 미세 조정 펼치기/);
  assert.match(rendererAppSource, /id="course-color-panel"/);
  assert.match(rendererAppSource, /data-action="recommend-color"/);
  assert.match(rendererAppSource, /input name="color" type="color"/);
  assert.match(rendererAppSource, /data-color-control="rgb"/);
  assert.match(rendererAppSource, /private syncCourseColorFieldDisclosure\(form: HTMLFormElement\): void/);
  assert.match(rendererAppSource, /form\?\.id === 'course-form'/);
  assert.match(rendererAppSource, /panel\.removeAttribute\('hidden'\);/);
  assert.match(rendererAppSource, /panel\.setAttribute\('hidden', ''\);/);
  assert.match(rendererAppSource, /추천한 색을 시작점으로 잡고 수치를 직접 다듬을 수 있어요\./);
  assert.match(rendererAppSource, /this\.isCourseColorFieldExpanded = !this\.isCourseColorFieldExpanded;/);
  assert.match(rendererAppSource, /querySelectorAll<HTMLElement>\('\[data-color-preview-swatch\]'\)/);
  assert.match(rendererAppSource, /this\.syncCourseColorControls\(form, target, event\.type === 'change'\);/);
});

test('renderer syncs the end time forward when a later start time is committed', () => {
  assert.match(rendererAppSource, /syncSessionEndTimeAfterStartChange\(widget\.sessionId, widget\.draftValue\)/);
  assert.match(rendererAppSource, /getSessionTimeOptions\('session-end', startValue\)/);
});

test('restoreActiveBoardFromPersisted removes a transient invalid new course draft', () => {
  const persistedBoard = makeBoard();
  const persistedData = {
    version: 1,
    activeBoardId: persistedBoard.id,
    boards: [persistedBoard],
    preferences: {
      lectureRemindersEnabled: true,
      lectureReminderLeadMinutes: LECTURE_REMINDER_LEAD_MINUTES,
    },
  };
  const currentData = {
    ...persistedData,
    boards: [
      {
        ...persistedBoard,
        courses: [
          ...persistedBoard.courses,
          {
            id: 'draft-course',
            title: '',
            code: '',
            instructor: '',
            location: '',
            credits: null,
            memo: '',
            color: '#7c72ff',
            sessions: [{ id: 'draft-session', day: 'MON', start: '09:00', end: '10:00', location: '' }],
          },
        ],
      },
    ],
  };

  const restored = restoreActiveBoardFromPersisted(currentData, persistedData);

  assert.equal(restored.boards[0].courses.length, persistedBoard.courses.length);
  assert.equal(restored.boards[0].courses.find((course) => course.id === 'draft-course'), undefined);
});

test('restoreActiveBoardFromPersisted reverts invalid edits on the active board only', () => {
  const persistedBoard = makeBoard();
  const untouchedBoard = {
    ...makeBoard(),
    id: 'board-2',
    name: '보조 보드',
  };
  const persistedData = {
    version: 1,
    activeBoardId: persistedBoard.id,
    boards: [persistedBoard, untouchedBoard],
    preferences: {
      lectureRemindersEnabled: true,
      lectureReminderLeadMinutes: LECTURE_REMINDER_LEAD_MINUTES,
    },
  };
  const currentData = {
    ...persistedData,
    boards: [
      {
        ...persistedBoard,
        courses: persistedBoard.courses.map((course, index) =>
          index === 0
            ? {
                ...course,
                title: '',
              }
            : course,
        ),
      },
      {
        ...untouchedBoard,
        note: 'keep me',
      },
    ],
  };

  const restored = restoreActiveBoardFromPersisted(currentData, persistedData);

  assert.equal(restored.boards[0].courses[0].title, persistedBoard.courses[0].title);
  assert.equal(restored.boards[1].note, 'keep me');
});

test('snapMinutesToStep and clampMinutesToStep keep drag math within the 30-minute grid', () => {
  assert.equal(TIME_STEP_MINUTES, 30);
  assert.equal(snapMinutesToStep(547), 540);
  assert.equal(snapMinutesToStep(559), 570);
  assert.equal(clampMinutesToStep(361, 420, 1320), 420);
  assert.equal(clampMinutesToStep(1339, 420, 1320), 1320);
});

test('resolveDraggedSessionPlacement snaps to half-hours, clamps, and preserves duration', () => {
  const placement = resolveDraggedSessionPlacement({
    dayIndex: 8,
    rawStartMinutes: 559,
    durationMinutes: 75,
    gridStartMinutes: 420,
    gridEndMinutes: 1320,
  });

  assert.equal(placement.day, 'FRI');
  assert.equal(placement.startMinutes, 570);
  assert.equal(placement.endMinutes - placement.startMinutes, 75);
});

test('updateBoardSessionSchedule changes only the targeted session', () => {
  const board = makeBoard();
  const updated = updateBoardSessionSchedule(board, 'course-a', 's1', {
    day: 'THU',
    startMinutes: 14 * 60,
    endMinutes: 15 * 60 + 15,
  });

  const moved = updated.courses[0].sessions[0];
  const untouched = updated.courses[1].sessions[0];

  assert.equal(moved.day, 'THU');
  assert.equal(moved.start, '14:00');
  assert.equal(moved.end, '15:15');
  assert.equal(untouched.day, 'MON');
  assert.equal(untouched.start, '09:30');
});

test('swapBoardSessions exchanges start anchors while preserving each session duration', () => {
  const board = makeBoard();
  const updated = swapBoardSessions(
    board,
    { courseId: 'course-a', sessionId: 's1' },
    { courseId: 'course-c', sessionId: 's3' },
  );

  const dragged = updated.courses[0].sessions[0];
  const target = updated.courses[2].sessions[0];

  assert.equal(dragged.day, 'MON');
  assert.equal(dragged.start, '13:00');
  assert.equal(dragged.end, '14:00');

  assert.equal(target.day, 'MON');
  assert.equal(target.start, '09:00');
  assert.equal(target.end, '10:15');
});

test('swapBoardSessions preserves duration even when sessions are on different days', () => {
  const board = {
    id: 'board-different-days',
    name: '다른 요일 스왑',
    semester: '2026-1',
    note: '',
    createdAt: '2026-03-09T00:00:00.000Z',
    updatedAt: '2026-03-09T00:00:00.000Z',
    courses: [
      {
        id: 'course-a',
        title: '긴 수업',
        code: 'A101',
        instructor: '김교수',
        location: 'A관',
        credits: 3,
        memo: '',
        color: '#7c72ff',
        sessions: [{ id: 's1', day: 'MON', start: '08:30', end: '10:00', location: 'A관' }],
      },
      {
        id: 'course-b',
        title: '짧은 수업',
        code: 'B101',
        instructor: '박교수',
        location: 'B관',
        credits: 2,
        memo: '',
        color: '#4cc9f0',
        sessions: [{ id: 's2', day: 'THU', start: '15:00', end: '16:00', location: 'B관' }],
      },
    ],
  };

  const updated = swapBoardSessions(
    board,
    { courseId: 'course-a', sessionId: 's1' },
    { courseId: 'course-b', sessionId: 's2' },
  );

  const dragged = updated.courses[0].sessions[0];
  const target = updated.courses[1].sessions[0];

  assert.equal(dragged.day, 'THU');
  assert.equal(dragged.start, '15:00');
  assert.equal(dragged.end, '16:30');

  assert.equal(target.day, 'MON');
  assert.equal(target.start, '08:30');
  assert.equal(target.end, '09:30');
});

test('getConflictingSessionIdsFor flags empty-space drops that would overlap existing sessions', () => {
  const board = makeBoard();
  const moved = updateBoardSessionSchedule(board, 'course-c', 's3', {
    day: 'MON',
    startMinutes: 9 * 60 + 30,
    endMinutes: 10 * 60 + 45,
  });

  assert.deepEqual([...getConflictingSessionIdsFor(moved, ['s3'])].sort(), ['s1', 's2', 's3']);
});

test('getConflictingSessionIdsFor exposes swaps that would still create third-party overlaps', () => {
  const board = {
    id: 'board-2',
    name: '충돌 검증',
    semester: '2026-1',
    note: '',
    createdAt: '2026-03-09T00:00:00.000Z',
    updatedAt: '2026-03-09T00:00:00.000Z',
    courses: [
      {
        id: 'course-a',
        title: '이동 대상',
        code: 'A101',
        instructor: '김교수',
        location: 'A관',
        credits: 3,
        memo: '',
        color: '#7c72ff',
        sessions: [{ id: 's1', day: 'MON', start: '10:00', end: '11:00', location: 'A관' }],
      },
      {
        id: 'course-b',
        title: '스왑 대상',
        code: 'B101',
        instructor: '박교수',
        location: 'B관',
        credits: 3,
        memo: '',
        color: '#4cc9f0',
        sessions: [{ id: 's2', day: 'TUE', start: '13:00', end: '14:00', location: 'B관' }],
      },
      {
        id: 'course-c',
        title: '제3 강의',
        code: 'C101',
        instructor: '이교수',
        location: 'C관',
        credits: 3,
        memo: '',
        color: '#ff7aa2',
        sessions: [{ id: 's3', day: 'TUE', start: '13:30', end: '14:30', location: 'C관' }],
      },
    ],
  };

  const swapped = swapBoardSessions(
    board,
    { courseId: 'course-a', sessionId: 's1' },
    { courseId: 'course-b', sessionId: 's2' },
  );

  assert.deepEqual([...getConflictingSessionIdsFor(swapped, ['s1', 's2'])].sort(), ['s1', 's3']);
});

test('canSwapBoardSessions rejects swaps that still create third-party overlaps', () => {
  const board = {
    id: 'board-2',
    name: '충돌 검증',
    semester: '2026-1',
    note: '',
    createdAt: '2026-03-09T00:00:00.000Z',
    updatedAt: '2026-03-09T00:00:00.000Z',
    courses: [
      {
        id: 'course-a',
        title: '이동 대상',
        code: 'A101',
        instructor: '김교수',
        location: 'A관',
        credits: 3,
        memo: '',
        color: '#7c72ff',
        sessions: [{ id: 's1', day: 'MON', start: '10:00', end: '11:00', location: 'A관' }],
      },
      {
        id: 'course-b',
        title: '스왑 대상',
        code: 'B101',
        instructor: '박교수',
        location: 'B관',
        credits: 3,
        memo: '',
        color: '#4cc9f0',
        sessions: [{ id: 's2', day: 'TUE', start: '13:00', end: '14:00', location: 'B관' }],
      },
      {
        id: 'course-c',
        title: '제3 강의',
        code: 'C101',
        instructor: '이교수',
        location: 'C관',
        credits: 3,
        memo: '',
        color: '#ff7aa2',
        sessions: [{ id: 's3', day: 'TUE', start: '13:30', end: '14:30', location: 'C관' }],
      },
    ],
  };

  assert.equal(
    canSwapBoardSessions(board, { courseId: 'course-a', sessionId: 's1' }, { courseId: 'course-b', sessionId: 's2' }),
    false,
  );
});

test('resolveSessionDropAction supports safe moves, exact-slot fallback swaps, and overlap rejection', () => {
  const board = makeBoard();
  const fallbackSwapBoard = {
    id: 'board-3',
    name: '폴백 스왑',
    semester: '2026-1',
    note: '',
    createdAt: '2026-03-09T00:00:00.000Z',
    updatedAt: '2026-03-09T00:00:00.000Z',
    courses: [
      {
        id: 'course-a',
        title: '이동 대상',
        code: 'F101',
        instructor: '김교수',
        location: 'A관',
        credits: 3,
        memo: '',
        color: '#7c72ff',
        sessions: [{ id: 's1', day: 'MON', start: '08:00', end: '09:00', location: 'A관' }],
      },
      {
        id: 'course-b',
        title: '폴백 대상',
        code: 'F201',
        instructor: '박교수',
        location: 'B관',
        credits: 3,
        memo: '',
        color: '#4cc9f0',
        sessions: [{ id: 's2', day: 'MON', start: '11:00', end: '12:30', location: 'B관' }],
      },
    ],
  };

  assert.deepEqual(
    resolveSessionDropAction(
      board,
      { courseId: 'course-a', sessionId: 's1' },
      { day: 'THU', startMinutes: 14 * 60, endMinutes: 15 * 60 },
    ),
    {
      kind: 'move',
      placement: { day: 'THU', startMinutes: 14 * 60, endMinutes: 15 * 60 },
    },
  );

  assert.deepEqual(
    resolveSessionDropAction(
      fallbackSwapBoard,
      { courseId: 'course-a', sessionId: 's1' },
      { day: 'MON', startMinutes: 11 * 60, endMinutes: 12 * 60 },
    ),
    {
      kind: 'swap',
      target: { courseId: 'course-b', sessionId: 's2' },
    },
  );

  assert.deepEqual(
    resolveSessionDropAction(
      board,
      { courseId: 'course-a', sessionId: 's1' },
      { day: 'MON', startMinutes: 10 * 60, endMinutes: 11 * 60 },
    ),
    {
      kind: 'reject',
      reason: 'overlap',
    },
  );
});

test('resolveSessionDropAction rejects swaps that would overflow the supported day end', () => {
  const board = {
    id: 'board-overflow',
    name: '하루 끝 초과',
    semester: '2026-1',
    note: '',
    createdAt: '2026-03-09T00:00:00.000Z',
    updatedAt: '2026-03-09T00:00:00.000Z',
    courses: [
      {
        id: 'course-a',
        title: '긴 수업',
        code: 'A101',
        instructor: '김교수',
        location: 'A관',
        credits: 3,
        memo: '',
        color: '#7c72ff',
        sessions: [{ id: 's1', day: 'MON', start: '20:30', end: '23:30', location: 'A관' }],
      },
      {
        id: 'course-b',
        title: '늦은 수업',
        code: 'B101',
        instructor: '박교수',
        location: 'B관',
        credits: 1,
        memo: '',
        color: '#4cc9f0',
        sessions: [{ id: 's2', day: 'TUE', start: '22:30', end: '23:00', location: 'B관' }],
      },
    ],
  };

  assert.equal(
    canSwapBoardSessions(board, { courseId: 'course-a', sessionId: 's1' }, { courseId: 'course-b', sessionId: 's2' }),
    false,
  );

  assert.deepEqual(
    resolveSessionDropAction(
      board,
      { courseId: 'course-a', sessionId: 's1' },
      { day: 'TUE', startMinutes: 22 * 60 + 30, endMinutes: 25 * 60 + 30 },
      { courseId: 'course-b', sessionId: 's2' },
    ),
    {
      kind: 'reject',
      reason: 'unsafe-swap',
    },
  );
});

test('resolveSessionDropAction rejects unsafe direct swaps and ambiguous multi-overlaps', () => {
  const unsafeSwapBoard = {
    id: 'board-2',
    name: '충돌 검증',
    semester: '2026-1',
    note: '',
    createdAt: '2026-03-09T00:00:00.000Z',
    updatedAt: '2026-03-09T00:00:00.000Z',
    courses: [
      {
        id: 'course-a',
        title: '이동 대상',
        code: 'A101',
        instructor: '김교수',
        location: 'A관',
        credits: 3,
        memo: '',
        color: '#7c72ff',
        sessions: [{ id: 's1', day: 'MON', start: '10:00', end: '11:00', location: 'A관' }],
      },
      {
        id: 'course-b',
        title: '스왑 대상',
        code: 'B101',
        instructor: '박교수',
        location: 'B관',
        credits: 3,
        memo: '',
        color: '#4cc9f0',
        sessions: [{ id: 's2', day: 'TUE', start: '13:00', end: '14:00', location: 'B관' }],
      },
      {
        id: 'course-c',
        title: '제3 강의',
        code: 'C101',
        instructor: '이교수',
        location: 'C관',
        credits: 3,
        memo: '',
        color: '#ff7aa2',
        sessions: [{ id: 's3', day: 'TUE', start: '13:30', end: '14:30', location: 'C관' }],
      },
    ],
  };

  assert.deepEqual(
    resolveSessionDropAction(
      unsafeSwapBoard,
      { courseId: 'course-a', sessionId: 's1' },
      { day: 'TUE', startMinutes: 13 * 60, endMinutes: 14 * 60 },
      { courseId: 'course-b', sessionId: 's2' },
    ),
    {
      kind: 'reject',
      reason: 'unsafe-swap',
    },
  );

  const ambiguousBoard = {
    ...unsafeSwapBoard,
    courses: [
      {
        id: 'course-a',
        title: '이동 대상',
        code: 'A101',
        instructor: '김교수',
        location: 'A관',
        credits: 3,
        memo: '',
        color: '#7c72ff',
        sessions: [{ id: 's1', day: 'MON', start: '08:00', end: '09:00', location: 'A관' }],
      },
      {
        id: 'course-b',
        title: '겹침 대상1',
        code: 'B101',
        instructor: '박교수',
        location: 'B관',
        credits: 3,
        memo: '',
        color: '#4cc9f0',
        sessions: [{ id: 's2', day: 'MON', start: '10:00', end: '11:00', location: 'B관' }],
      },
      {
        id: 'course-c',
        title: '겹침 대상2',
        code: 'C101',
        instructor: '이교수',
        location: 'C관',
        credits: 3,
        memo: '',
        color: '#ff7aa2',
        sessions: [{ id: 's3', day: 'MON', start: '10:00', end: '11:00', location: 'C관' }],
      },
    ],
  };

  assert.deepEqual(
    resolveSessionDropAction(
      ambiguousBoard,
      { courseId: 'course-a', sessionId: 's1' },
      { day: 'MON', startMinutes: 10 * 60, endMinutes: 11 * 60 },
    ),
    {
      kind: 'reject',
      reason: 'ambiguous-overlap',
    },
  );
});

test('resolveSessionDropAction reports stale direct targets as not-found', () => {
  const board = makeBoard();

  assert.deepEqual(
    resolveSessionDropAction(
      board,
      { courseId: 'course-a', sessionId: 's1' },
      { day: 'MON', startMinutes: 13 * 60, endMinutes: 14 * 60 + 15 },
      { courseId: 'course-z', sessionId: 'missing-session' },
    ),
    {
      kind: 'reject',
      reason: 'not-found',
    },
  );
});

test('getSessionDropRejectMessage explains each drag/drop reject reason', () => {
  assert.match(getSessionDropRejectMessage('not-found'), /다시 찾지 못했어요/);
  assert.match(getSessionDropRejectMessage('unsafe-swap'), /서로 바꿀 수 없는/);
  assert.match(getSessionDropRejectMessage('ambiguous-overlap'), /여러 강의와 동시에 겹치는/);
  assert.match(getSessionDropRejectMessage('overlap'), /겹치는 시간으로는 옮길 수 없어요/);
});

test('getRendererLayout maps viewport widths to the approved breakpoint bands', () => {
  assert.deepEqual(getRendererLayout(1920, 1200), {
    viewportBand: 'full',
    viewportHeightBand: 'tall',
    shellLayoutMode: 'three-column',
    timetableDensity: 'standard',
    sidebarDensity: 'standard',
    inspectorPlacement: 'side',
    preserveMainHorizontalScrollbarAvoidance: true,
  });

  assert.deepEqual(getRendererLayout(1920, 1080), {
    viewportBand: 'full',
    viewportHeightBand: 'short',
    shellLayoutMode: 'three-column',
    timetableDensity: 'standard',
    sidebarDensity: 'tight',
    inspectorPlacement: 'side',
    preserveMainHorizontalScrollbarAvoidance: true,
  });

  assert.deepEqual(getRendererLayout(1320, 1080), {
    viewportBand: 'tight',
    viewportHeightBand: 'short',
    shellLayoutMode: 'three-column',
    timetableDensity: 'compact',
    sidebarDensity: 'tight',
    inspectorPlacement: 'side',
    preserveMainHorizontalScrollbarAvoidance: true,
  });

  assert.deepEqual(getRendererLayout(1319, 900), {
    viewportBand: 'compact',
    viewportHeightBand: 'short',
    shellLayoutMode: 'three-column',
    timetableDensity: 'compact',
    sidebarDensity: 'tight',
    inspectorPlacement: 'side',
    preserveMainHorizontalScrollbarAvoidance: true,
  });

  assert.deepEqual(getRendererLayout(1220, 1200), {
    viewportBand: 'compact',
    viewportHeightBand: 'tall',
    shellLayoutMode: 'three-column',
    timetableDensity: 'compact',
    sidebarDensity: 'tight',
    inspectorPlacement: 'side',
    preserveMainHorizontalScrollbarAvoidance: true,
  });

  assert.deepEqual(getRendererLayout(1179, 1200), {
    viewportBand: 'compact',
    viewportHeightBand: 'tall',
    shellLayoutMode: 'inspector-below',
    timetableDensity: 'compact',
    sidebarDensity: 'tight',
    inspectorPlacement: 'below',
    preserveMainHorizontalScrollbarAvoidance: true,
  });
});

test('getTimetablePixelsPerMinute keeps the readable timetable scale even on short layouts', () => {
  assert.equal(getTimetablePixelsPerMinute(1200), 1.24);
  assert.equal(getTimetablePixelsPerMinute(1080), 1.24);
  assert.equal(getTimetablePixelsPerMinute(900), 1.24);
  assert.equal(getTimetablePixelsPerMinute(Number.POSITIVE_INFINITY), 1.24);
});

test('getViewportFittedTimetablePixelsPerMinute derives a viewport-fitted scale and falls back on invalid input', () => {
  assert.equal(getViewportFittedTimetablePixelsPerMinute(624, 780), 0.8);
  assert.equal(getViewportFittedTimetablePixelsPerMinute(0, 780), 1.24);
  assert.equal(getViewportFittedTimetablePixelsPerMinute(624, 0), 1.24);
});

test('timetable JPG export helpers return stable metrics and sanitized filenames', () => {
  assert.deepEqual(getTimetableJpegExportMetrics(780), {
    canvasWidth: 1404,
    canvasHeight: 1940,
    cardWidth: 1292,
    cardHeight: 1836,
    gridHeight: 1560,
    pixelsPerMinute: 2,
    dayColumnWidth: 214,
    dayColumnGap: 12,
    timeAxisWidth: 90,
    dayHeaderHeight: 76,
    outerPaddingX: 56,
    outerPaddingY: 52,
    cardPadding: 36,
    metaHeight: 102,
    timetableTopGap: 26,
    sessionInsetX: 6,
    sessionInsetY: 4,
    renderScale: 2,
  });
  assert.equal(getTimetableJpegFileName('2026-1 시간표 / 디자인', new Date('2026-03-17T00:00:00Z')), 'soosta-timetable-2026-1-시간표-디자인-2026-03-17.jpg');
  assert.equal(getTimetableJpegFileName('   ', new Date('2026-03-17T00:00:00Z')), 'soosta-timetable-timetable-2026-03-17.jpg');
});

test('platform control rails follow desktop conventions', () => {
  assert.equal(getPlatformControlRail('darwin'), 'traffic-lights-left');
  assert.equal(getPlatformControlRailSide('darwin'), 'left');

  assert.equal(getPlatformControlRail('win32'), 'window-controls-right');
  assert.equal(getPlatformControlRailSide('win32'), 'right');

  assert.equal(getPlatformControlRail('linux'), 'window-controls-right');
  assert.equal(getPlatformControlRailSide('linux'), 'right');
});
