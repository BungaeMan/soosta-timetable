const test = require('node:test');
const assert = require('node:assert/strict');

const { LECTURE_REMINDER_LEAD_MINUTES, TIME_STEP_MINUTES } = require('../dist-test/shared/constants.js');
const { coerceAppData } = require('../dist-test/shared/data.js');
const {
  formatLectureReminderLeadMinutesList,
  parseLectureReminderLeadMinutesInput,
} = require('../dist-test/shared/reminders.js');
const { validateCourse } = require('../dist-test/renderer/domain/model.js');
const {
  clampMinutesToStep,
  snapMinutesToStep,
} = require('../dist-test/renderer/domain/time.js');
const {
  canSwapBoardSessions,
  detectConflicts,
  getBoardStats,
  getConflictingSessionIdsFor,
  getCurrentTimeSlotHighlight,
  getGridRange,
  getFreeWindows,
  getNextSession,
  getPositionedSessions,
  getSessionDropRejectMessage,
  resolveSessionDropAction,
  resolveDraggedSessionPlacement,
  swapBoardSessions,
  updateBoardSessionSchedule,
} = require('../dist-test/renderer/domain/timetable.js');
const {
  getDueLectureReminderEvents,
  getNextUpcomingSessionOccurrence,
} = require('../dist-test/renderer/domain/reminders.js');
const {
  getPlatformControlRail,
  getPlatformControlRailSide,
  getRendererLayout,
  getTimetablePixelsPerMinute,
} = require('../dist-test/renderer/domain/layout.js');

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

test('getCurrentTimeSlotHighlight snaps to the active 30-minute slot inside the grid', () => {
  const highlight = getCurrentTimeSlotHighlight(9 * 60, 22 * 60, new Date('2026-03-09T13:17:00'));

  assert.deepEqual(highlight, {
    day: 'MON',
    startMinutes: 13 * 60,
    endMinutes: 13 * 60 + TIME_STEP_MINUTES,
  });
});

test('getCurrentTimeSlotHighlight returns null outside visible days or grid hours', () => {
  assert.equal(getCurrentTimeSlotHighlight(9 * 60, 22 * 60, new Date('2026-03-08T13:17:00')), null);
  assert.equal(getCurrentTimeSlotHighlight(9 * 60, 22 * 60, new Date('2026-03-09T08:59:00')), null);
  assert.equal(getCurrentTimeSlotHighlight(9 * 60, 22 * 60, new Date('2026-03-09T22:00:00')), null);
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

  assert.equal(placement.day, 'SAT');
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
    timetableDensity: 'compact',
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
    shellLayoutMode: 'inspector-below',
    timetableDensity: 'compact',
    sidebarDensity: 'tight',
    inspectorPlacement: 'below',
    preserveMainHorizontalScrollbarAvoidance: true,
  });

  assert.deepEqual(getRendererLayout(1220, 1200), {
    viewportBand: 'compact',
    viewportHeightBand: 'tall',
    shellLayoutMode: 'inspector-below',
    timetableDensity: 'compact',
    sidebarDensity: 'tight',
    inspectorPlacement: 'below',
    preserveMainHorizontalScrollbarAvoidance: true,
  });
});

test('getTimetablePixelsPerMinute compresses short 1080p layouts without shrinking taller viewports', () => {
  assert.equal(getTimetablePixelsPerMinute(1200), 1.24);
  assert.equal(getTimetablePixelsPerMinute(1080), 0.84);
  assert.equal(getTimetablePixelsPerMinute(900), 0.84);
  assert.equal(getTimetablePixelsPerMinute(Number.POSITIVE_INFINITY), 1.24);
});

test('platform control rails stay right-aligned across desktop targets', () => {
  assert.equal(getPlatformControlRail('darwin'), 'window-controls-right');
  assert.equal(getPlatformControlRailSide('darwin'), 'right');

  assert.equal(getPlatformControlRail('win32'), 'window-controls-right');
  assert.equal(getPlatformControlRailSide('win32'), 'right');

  assert.equal(getPlatformControlRail('linux'), 'window-controls-right');
  assert.equal(getPlatformControlRailSide('linux'), 'right');
});
