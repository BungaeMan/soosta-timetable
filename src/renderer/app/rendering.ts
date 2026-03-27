import { escapeHtml, renderIcon, type ActiveLectureReminder, type SessionContextMenu } from './shared';
import { getPlatformControlRail, type DesktopPlatform } from '../domain/layout';

export const renderLoadingCard = (message: string): string => `
  <section class="panel-card loading-card">
    <div class="loading-dot"></div>
    <p>${escapeHtml(message)}</p>
  </section>
`;

export const renderStatusActions = (options: { isLoading: boolean; hasData: boolean }): string => {
  const disabled = options.isLoading || !options.hasData ? 'disabled' : '';

  return `
    <div class="status-action-group">
      <button type="button" class="ghost-button status-action-button" data-action="import-data" ${disabled}>
        ${renderIcon('import')}
        <span class="button-label">가져오기</span>
      </button>
      <button type="button" class="ghost-button status-action-button" data-action="export-data" ${disabled}>
        ${renderIcon('export')}
        <span class="button-label">내보내기</span>
      </button>
      <button
        type="button"
        class="primary-button status-action-button status-action-button-primary"
        data-action="new-course"
        ${disabled}
      >
        ${renderIcon('plus')}
        <span class="button-label">새 강의</span>
      </button>
    </div>
  `;
};

export const renderWindowControls = (options: {
  platform: DesktopPlatform;
  isWindowMaximized: boolean;
}): string => {
  const controlRail = getPlatformControlRail(options.platform);
  const controlOrder =
    controlRail === 'traffic-lights-left'
      ? [
          { action: 'close-window', label: '창 닫기', tone: 'close' },
          { action: 'minimize-window', label: '최소화', tone: 'minimize' },
          { action: 'toggle-maximize-window', label: options.isWindowMaximized ? '복원' : '최대화', tone: 'maximize' },
        ]
      : [
          { action: 'minimize-window', label: '최소화', tone: 'minimize' },
          { action: 'toggle-maximize-window', label: options.isWindowMaximized ? '복원' : '최대화', tone: 'maximize' },
          { action: 'close-window', label: '창 닫기', tone: 'close' },
        ];

  return `
    <div class="topbar-rail topbar-rail-controls">
      <div class="window-controls window-controls-${controlRail}">
        ${controlOrder
          .map(({ action, label, tone }) => {
            const iconName =
              tone === 'minimize'
                ? 'minimize'
                : tone === 'maximize'
                  ? (options.isWindowMaximized ? 'restore' : 'maximize')
                  : 'close';

            return `
              <button
                type="button"
                class="window-control window-control-${tone}"
                data-action="${action}"
                aria-label="${label}"
                title="${label}"
              >
                ${renderIcon(iconName)}
                <span class="sr-only">${label}</span>
              </button>
            `;
          })
          .join('')}
      </div>
    </div>
  `;
};

export const renderLectureReminderCard = (reminder: ActiveLectureReminder): string => {
  const leadLabel = reminder.isTest ? '테스트 알림' : reminder.leadMinutes === 60 ? '1시간 전 알림' : `${reminder.leadMinutes}분 전 알림`;

  return `
    <section class="lecture-reminder" role="alert" aria-live="assertive">
      <div class="lecture-reminder-icon" aria-hidden="true">${renderIcon('alert')}</div>
      <div class="lecture-reminder-copy">
        <strong class="lecture-reminder-label">${escapeHtml(leadLabel)}</strong>
        <p class="lecture-reminder-title">${escapeHtml(reminder.courseTitle)}</p>
        <p class="lecture-reminder-message">${escapeHtml(reminder.body)}</p>
      </div>
      <button
        type="button"
        class="lecture-reminder-dismiss"
        data-action="dismiss-lecture-reminder"
        aria-label="강의 알림 닫기"
      >
        ${renderIcon('close')}
      </button>
    </section>
  `;
};

export const renderSessionContextMenuMarkup = (menu: SessionContextMenu): string => `
  <div
    class="session-context-menu"
    role="menu"
    aria-label="${escapeHtml(menu.courseTitle)} 메뉴"
    style="--session-context-accent:${escapeHtml(menu.accentColor)};left:${menu.clientX}px;top:${menu.clientY}px"
  >
    <div class="session-context-header">
      <span class="session-context-swatch" aria-hidden="true"></span>
      <div class="session-context-copy">
        <div class="session-context-title">${escapeHtml(menu.courseTitle)}</div>
        <div class="session-context-meta">${escapeHtml(menu.scheduleLabel)}</div>
        <div class="session-context-meta secondary">${escapeHtml(menu.locationLabel)}</div>
      </div>
    </div>
    <div class="session-context-divider" aria-hidden="true"></div>
    <div class="session-context-actions" role="none">
      <button
        type="button"
        class="session-context-item"
        data-action="select-course"
        data-course-id="${escapeHtml(menu.courseId)}"
        role="menuitem"
      >
        ${renderIcon('edit')}
        <span>편집</span>
      </button>
      <button
        type="button"
        class="session-context-item danger"
        data-action="delete-course-from-menu"
        data-course-id="${escapeHtml(menu.courseId)}"
        role="menuitem"
      >
        ${renderIcon('trash')}
        <span>삭제</span>
      </button>
    </div>
  </div>
`;
