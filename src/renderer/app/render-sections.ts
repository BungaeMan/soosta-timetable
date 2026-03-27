import { DAY_LABELS, DAY_ORDER, LECTURE_REMINDER_LEAD_MINUTES } from '../../shared/constants';
import type { AgendaItem, AppData, Course, CourseSession, DayKey, LectureReminderLeadMinutes } from '../../shared/types';
import { getCourseColorRecommendations, hexColorToRgb } from '../domain/model';
import { coerceTimeToOptions, formatDuration, getSessionEndTimeOptionsAfterStart, minutesToTime, timeToMinutes } from '../domain/time';
import type { CourseColorChannel, InspectorVisibility, SessionTimeFieldName } from './shared';
import {
  escapeHtml,
  formatReminderLeadLabel,
  formatReminderLeadList,
  renderIcon,
  sanitizeColor,
  SESSION_START_TIME_OPTIONS,
} from './shared';

type SidebarSectionOptions = {
  data: AppData;
  board: AppData['boards'][number];
  agenda: AgendaItem[];
  agendaDay: DayKey | null;
  remindersEnabled: boolean;
  reminderLeadMinutes: readonly LectureReminderLeadMinutes[];
  reminderSummary: string;
  renderAgendaItem: (item: AgendaItem) => string;
};

type AgendaSectionOptions = {
  agenda: AgendaItem[];
  agendaDay: DayKey | null;
  renderAgendaItem: (item: AgendaItem) => string;
};

type ContentSectionOptions = {
  board: AppData['boards'][number];
  stats: {
    totalCredits: number;
  };
  range: {
    startMinutes: number;
    endMinutes: number;
  };
  bodyMarkup: string;
  isTimetableFitMode: boolean;
  isTimetableJpegExporting: boolean;
};

type InspectorPanelSectionOptions = {
  course: Course;
  isEditing: boolean;
  visualState: InspectorVisibility;
  colorFieldMarkup: string;
  sessionRowsMarkup: string;
};

type CourseColorFieldSectionOptions = {
  courses: Course[];
  course: Course;
  isExpanded: boolean;
};

type SessionRowMarkupOptions = {
  session: CourseSession;
  index: number;
  renderSessionTimeInput: (
    sessionId: string,
    fieldName: SessionTimeFieldName,
    value: string,
    pairedValue?: string,
  ) => string;
};

const renderColorChannelField = (label: 'R' | 'G' | 'B', channel: CourseColorChannel, value: number): string => `
  <div class="color-channel-field">
    <span>${label}</span>
    <input
      type="number"
      min="0"
      max="255"
      step="1"
      inputmode="numeric"
      value="${value}"
      data-color-control="rgb"
      data-color-channel="${channel}"
      aria-label="${label} 값"
    />
  </div>
`;

export const renderAgendaSection = ({ agenda, agendaDay, renderAgendaItem }: AgendaSectionOptions): string => `
  <section class="panel-card agenda-panel" data-agenda-panel>
    <div class="panel-heading compact">
      <div>
        <h2>오늘 일정</h2>
      </div>
      <span class="panel-hint">${agendaDay ? escapeHtml(DAY_LABELS[agendaDay].full) : '일요일'}</span>
    </div>
    ${
      agenda.length > 0
        ? `<div class="agenda-list">${agenda.map((item) => renderAgendaItem(item)).join('')}</div>`
        : `<div class="empty-copy">오늘 등록된 강의가 없어요. 여백이 넓은 날이네요.</div>`
    }
  </section>
`;

export const renderSidebarSection = ({
  data,
  board,
  agenda,
  agendaDay,
  remindersEnabled,
  reminderLeadMinutes,
  reminderSummary,
  renderAgendaItem,
}: SidebarSectionOptions): string => `
  <section class="panel-card board-panel">
    <div class="panel-heading">
      <div>
        <h2>학기 보드</h2>
      </div>
      <button type="button" class="soft-button" data-action="new-board">${renderIcon('plus')}새 시간표</button>
    </div>
    <div class="board-switcher">
      ${data.boards
        .map(
          (item) => `
            <button
              type="button"
              class="board-chip ${item.id === board.id ? 'is-active' : ''}"
              data-action="select-board"
              data-board-id="${escapeHtml(item.id)}"
            >
              <span class="board-chip-title">${escapeHtml(item.name)}</span>
              <span class="board-chip-meta">${escapeHtml(item.semester)}</span>
            </button>
          `,
        )
        .join('')}
    </div>
    <form id="board-form" class="stack-form">
      <label>
        <span>보드 이름</span>
        <input name="board-name" value="${escapeHtml(board.name)}" maxlength="40" placeholder="예: 메인 플랜" />
      </label>
      <label>
        <span>학기</span>
        <input name="board-semester" value="${escapeHtml(board.semester)}" maxlength="40" placeholder="예: 2026 봄학기" />
      </label>
      <label>
        <span>메모</span>
        <textarea name="board-note" rows="3" placeholder="이 시간표의 기준이나 참고 메모를 적어보세요.">${escapeHtml(board.note)}</textarea>
      </label>
      <div class="form-note-row split-row">
        <button type="button" class="ghost-button" data-action="duplicate-board">${renderIcon('copy')}복제</button>
        <button type="button" class="ghost-button danger-button" data-action="delete-board">${renderIcon('trash')}삭제</button>
      </div>
    </form>
  </section>

  ${renderAgendaSection({ agenda, agendaDay, renderAgendaItem })}

  <section class="panel-card insight-panel">
    <div class="panel-heading compact">
      <div>
        <h2>강의 알림</h2>
      </div>
    </div>
    <p class="empty-copy compact-copy">
      ${
        remindersEnabled
          ? reminderLeadMinutes.length > 0
            ? `자동 알림이 켜져 있어요. ${reminderSummary}`
            : '자동 알림은 켜져 있지만 선택된 시각이 없어요. 아래에서 분 단위로 직접 입력하거나 기본 버튼으로 추가해 주세요.'
          : `자동 알림이 꺼져 있어요. 켜면 선택한 시각(${reminderLeadMinutes.length > 0 ? formatReminderLeadList(reminderLeadMinutes) : '없음'})에 다시 알려줍니다.`
      }
    </p>
    <div class="reminder-settings-panel">
      <div class="reminder-settings-group reminder-settings-actions-grid">
        <button
          type="button"
          class="${remindersEnabled ? 'soft-button' : 'ghost-button'} reminder-settings-button"
          data-action="toggle-lecture-reminders"
        >
          ${renderIcon(remindersEnabled ? 'check' : 'alert')}
          ${remindersEnabled ? '알림 끄기' : '알림 켜기'}
        </button>
        <button
          type="button"
          class="ghost-button reminder-settings-button"
          data-action="test-lecture-reminder"
        >
          ${renderIcon('spark')}
          테스트 알림
        </button>
      </div>
      <div class="reminder-settings-group reminder-settings-presets-grid">
        ${LECTURE_REMINDER_LEAD_MINUTES.map(
          (minutes) => `
            <button
              type="button"
              class="${reminderLeadMinutes.includes(minutes) ? 'soft-button' : 'ghost-button'} reminder-settings-button"
              data-action="toggle-lecture-reminder-lead"
              data-lead-minutes="${minutes}"
            >
              ${renderIcon(reminderLeadMinutes.includes(minutes) ? 'check' : 'clock')}
              ${formatReminderLeadLabel(minutes)}
            </button>
          `,
        ).join('')}
      </div>
      <form id="reminder-settings-form" class="stack-form reminder-settings-form reminder-settings-group">
        <label>
          <span>직접 입력 (분)</span>
          <input
            name="lecture-reminder-lead-minutes"
            value="${escapeHtml(reminderLeadMinutes.join(', '))}"
            inputmode="numeric"
            placeholder="예: 90, 45, 10"
          />
        </label>
        <p class="empty-copy compact-copy">쉼표나 공백으로 여러 시각을 입력할 수 있어요. 예: 120 45 10</p>
        <div class="reminder-settings-actions-grid reminder-settings-form-actions">
          <button type="submit" class="soft-button reminder-settings-button">
            ${renderIcon('check')}
            시각 저장
          </button>
          <button
            type="button"
            class="ghost-button reminder-settings-button"
            data-action="reset-lecture-reminder-times"
          >
            ${renderIcon('clock')}
            기본값 복원
          </button>
        </div>
      </form>
    </div>
  </section>
`;

export const renderContentSection = ({
  board,
  stats,
  range,
  bodyMarkup,
  isTimetableFitMode,
  isTimetableJpegExporting,
}: ContentSectionOptions): string => {
  const hasCourses = board.courses.length > 0;

  return `
    <section class="panel-card hero-panel">
      <div class="panel-heading hero-heading">
        <div>
          <div class="hero-title-row">
            <h2>${escapeHtml(board.name)}</h2>
            <span class="hero-title-meta">${escapeHtml(board.semester)}</span>
          </div>
          ${board.note ? `<p class="hero-copy">${escapeHtml(board.note)}</p>` : ''}
        </div>
        <div class="hero-actions">
          <div class="hero-badges">
            <span class="hero-badge">${board.courses.length} courses</span>
            <span class="hero-badge secondary">${stats.totalCredits}학점</span>
            <span class="hero-badge secondary">${minutesToTime(range.startMinutes)}–${minutesToTime(range.endMinutes)}</span>
          </div>
          ${
            hasCourses
              ? `
                <div class="hero-action-buttons">
                  <button
                    type="button"
                    class="ghost-button timetable-export-button"
                    data-action="export-timetable-jpg"
                    ${isTimetableJpegExporting ? 'disabled' : ''}
                  >
                    ${renderIcon('image')}
                    ${isTimetableJpegExporting ? 'JPG 저장 중…' : 'JPG 다운로드'}
                  </button>
                  <button
                    type="button"
                    class="${isTimetableFitMode ? 'soft-button' : 'ghost-button'} timetable-fit-button"
                    data-action="toggle-timetable-fit"
                    aria-pressed="${isTimetableFitMode ? 'true' : 'false'}"
                  >
                    ${renderIcon(isTimetableFitMode ? 'restore' : 'maximize')}
                    ${isTimetableFitMode ? '원래 높이' : '한 화면 맞춤'}
                  </button>
                </div>
              `
              : ''
          }
        </div>
      </div>
      ${bodyMarkup}
    </section>
  `;
};

export const renderInspectorPanelSection = ({
  course,
  isEditing,
  visualState,
  colorFieldMarkup,
  sessionRowsMarkup,
}: InspectorPanelSectionOptions): string => {
  const weeklyMinutes = course.sessions.reduce(
    (sum, session) => sum + (timeToMinutes(session.end) - timeToMinutes(session.start)),
    0,
  );
  const isClosing = visualState === 'closing';
  const panelClassNames = ['panel-card', 'inspector-panel'];
  if (visualState === 'opening') {
    panelClassNames.push('is-opening');
  }
  if (isClosing) {
    panelClassNames.push('is-closing');
  }

  return `
    <section class="${panelClassNames.join(' ')}" data-visual-state="${visualState}" ${isClosing ? 'aria-hidden="true"' : ''}>
      <div class="panel-heading">
        <div>
          <h2>${isEditing ? escapeHtml(course.title || '강의 수정') : '새 강의 만들기'}</h2>
          <p class="hero-copy">${isEditing ? '선택된 강의를 다듬고 즉시 반영하세요.' : '한 과목씩 더 묵직하게 쌓아 올리는 방식으로 설계했어요.'}</p>
        </div>
        <div class="inspector-meta">
          <span>${course.sessions.length}회</span>
          <span>${escapeHtml(formatDuration(weeklyMinutes))}</span>
        </div>
      </div>
      <form id="course-form" class="stack-form" data-mode="${isEditing ? 'edit' : 'create'}">
        <input type="hidden" name="course-id" value="${escapeHtml(course.id)}" />
        <input type="hidden" name="location" value="${escapeHtml(course.location)}" />
        <label>
          <span>강의명</span>
          <input name="title" value="${escapeHtml(course.title)}" maxlength="60" placeholder="예: 인터랙션디자인" required />
        </label>
        <div class="split-fields">
          <label>
            <span>과목 코드</span>
            <input name="code" value="${escapeHtml(course.code)}" maxlength="24" placeholder="예: DES304" />
          </label>
          <label>
            <span>학점</span>
            <input name="credits" type="number" min="0" max="9" step="1" value="${course.credits ?? ''}" placeholder="3" />
          </label>
        </div>
        <div class="split-fields">
          <label>
            <span>교수명</span>
            <input name="instructor" value="${escapeHtml(course.instructor)}" maxlength="32" placeholder="예: 정민서" />
          </label>
        </div>
        ${colorFieldMarkup}
        <label>
          <span>메모</span>
          <textarea name="memo" rows="3" placeholder="과제, 발표, 수업 분위기 같은 메모를 남겨보세요.">${escapeHtml(course.memo)}</textarea>
        </label>
        <div class="session-editor-head">
          <div>
            <h3>주간 수업 시간</h3>
            <p>한 과목이 여러 요일에 열리면 수업 시간을 추가해 주세요.</p>
          </div>
          <button type="button" class="soft-button" data-action="add-session">${renderIcon('plus')}수업 시간 추가</button>
        </div>
        <div id="session-list" class="session-list">
          ${sessionRowsMarkup}
        </div>
        <div class="form-note-row stack-actions">
          <button type="button" class="ghost-button" data-action="new-course">${renderIcon('reset')}초기화</button>
          ${
            isEditing
              ? `<button type="button" class="ghost-button danger-button" data-action="delete-course" data-course-id="${escapeHtml(course.id)}">${renderIcon('trash')}이 강의 삭제</button>`
              : ''
          }
        </div>
      </form>
      <button
        type="button"
        class="inspector-close-button"
        data-action="close-inspector"
        aria-label="${isEditing ? '강의 에디터 닫기' : '새 강의 폼 닫기'}"
        title="${isEditing ? '에디터 닫기' : '폼 닫기'}"
      >
        ${renderIcon('collapse-right')}
      </button>
    </section>
  `;
};

export const renderCourseColorFieldSection = ({
  courses,
  course,
  isExpanded,
}: CourseColorFieldSectionOptions): string => {
  const currentColor = sanitizeColor(course.color);
  const rgb = hexColorToRgb(currentColor);
  const otherCourseCount = courses.filter((item) => item.id !== course.id).length;
  const recommendationHint =
    otherCourseCount > 0
      ? '기존 강의 컬러를 먼저 보여드리고, 이어서 다른 팔레트를 추천해요.'
      : '아직 강의가 없어서 기본 팔레트를 먼저 추천해요.';
  const recommendations = getCourseColorRecommendations(courses, {
    currentCourseId: course.id,
    selectedColor: currentColor,
    limit: 6,
  });

  return `
    <div class="form-field">
      <span>포인트 컬러</span>
      <div class="color-field-shell">
        <button
          type="button"
          class="color-field-toggle"
          data-action="toggle-color-field"
          aria-expanded="${isExpanded ? 'true' : 'false'}"
          aria-controls="course-color-panel"
          aria-label="${isExpanded ? '추천 색상과 RGB 미세 조정 접기' : '추천 색상과 RGB 미세 조정 펼치기'}"
        >
          <span class="color-field-toggle-summary">
            <span
              class="color-preview-swatch color-field-toggle-chip"
              data-color-preview-swatch
              style="--swatch:${escapeHtml(currentColor)}"
              aria-hidden="true"
            ></span>
            <span class="color-field-toggle-copy">
              <span class="color-field-toggle-kicker">추천 색상 · RGB 미세 조정</span>
              <strong data-color-preview-hex>${escapeHtml(currentColor.toUpperCase())}</strong>
              <span data-color-preview-rgb>R ${rgb.red} · G ${rgb.green} · B ${rgb.blue}</span>
            </span>
          </span>
          <span class="color-field-toggle-label">${isExpanded ? '접기' : '펼치기'}</span>
          <span class="color-field-toggle-icon" aria-hidden="true">${renderIcon('chevron-down')}</span>
        </button>
        <div class="color-field" id="course-color-panel" ${isExpanded ? '' : 'hidden'}>
          <div class="color-field-section">
            <div class="color-field-heading">
              <div class="color-field-heading-copy">
                <strong>추천 색상</strong>
                <span>${recommendationHint}</span>
              </div>
            </div>
            <div class="color-swatch-grid">
              ${recommendations
                .map((color) => {
                  const isActive = sanitizeColor(color) === currentColor;
                  return `
                    <button
                      type="button"
                      class="color-swatch-button ${isActive ? 'is-active' : ''}"
                      data-action="recommend-color"
                      data-color="${escapeHtml(color)}"
                      data-color-option
                      aria-pressed="${isActive ? 'true' : 'false'}"
                    >
                      <span class="color-swatch-button-chip" style="--swatch:${escapeHtml(color)}" aria-hidden="true"></span>
                      <span>${escapeHtml(color.toUpperCase())}</span>
                    </button>
                  `;
                })
                .join('')}
            </div>
          </div>
          <div class="color-field-section">
            <div class="color-field-heading">
              <strong>RGB 미세 조정</strong>
              <span>추천한 색을 시작점으로 잡고 수치를 직접 다듬을 수 있어요.</span>
            </div>
            <div class="color-picker-row">
              <input name="color" type="color" value="${currentColor}" aria-label="강의 포인트 컬러" />
              <button
                type="button"
                class="color-randomize-button"
                data-action="randomize-color"
                aria-label="랜덤 색상 선택"
                title="랜덤 색상"
              >
                ${renderIcon('spark')}
              </button>
            </div>
            <div class="color-rgb-grid">
              ${renderColorChannelField('R', 'red', rgb.red)}
              ${renderColorChannelField('G', 'green', rgb.green)}
              ${renderColorChannelField('B', 'blue', rgb.blue)}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
};

export const renderSessionRowMarkup = ({ session, index, renderSessionTimeInput }: SessionRowMarkupOptions): string => {
  const resolvedStartValue = coerceTimeToOptions(session.start, SESSION_START_TIME_OPTIONS);
  const resolvedEndValue = coerceTimeToOptions(session.end, getSessionEndTimeOptionsAfterStart(resolvedStartValue));

  return `
    <div class="session-row" data-session-id="${escapeHtml(session.id)}">
      <div class="session-row-header">
        <strong>수업 시간 ${index + 1}</strong>
        <button type="button" class="icon-button danger-inline" data-action="remove-session" aria-label="수업 시간 삭제">×</button>
      </div>
      <div class="session-grid">
        <label>
          <span>요일</span>
          <select name="session-day">
            ${DAY_ORDER.map(
              (day) => `<option value="${day}" ${day === session.day ? 'selected' : ''}>${escapeHtml(DAY_LABELS[day].full)}</option>`,
            ).join('')}
          </select>
        </label>
        <label>
          <span>장소</span>
          <input name="session-location" value="${escapeHtml(session.location)}" maxlength="32" placeholder="세션별 장소" />
        </label>
        <div class="form-field">
          <span>시작</span>
          ${renderSessionTimeInput(session.id, 'session-start', resolvedStartValue, resolvedEndValue)}
        </div>
        <div class="form-field">
          <span>종료</span>
          ${renderSessionTimeInput(session.id, 'session-end', resolvedEndValue, resolvedStartValue)}
        </div>
      </div>
    </div>
  `;
};
