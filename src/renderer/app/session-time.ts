import {
  coerceMeridiemTimeParts,
  coerceTimeToOptions,
  getNextSessionTimeMenuSegment,
  resolveSessionTimeMenuSegment,
  splitMeridiemTimeParts,
  timeToMinutes,
  type GenericMeridiem,
} from '../domain/time';
import type { SoostaApp } from '../app';
import {
  escapeHtml,
  formatSessionTimeTriggerLabel,
  getPairedSessionTimeFieldName,
  getSessionTimeHourOptions,
  getSessionTimeMinuteOptions,
  getSessionTimeOptions,
  isSessionTimeFieldName,
  renderIcon,
  SESSION_TIME_MERIDIEMS,
  SESSION_TIME_MERIDIEM_LABELS,
  SESSION_TIME_SEGMENT_LABELS,
  type PendingSessionTimeTarget,
  type SessionTimeFieldName,
  type SessionTimeMenuSegment,
  type SessionTimeWidgetCloseReason,
  type SessionTimeWidgetSegment,
} from './shared';

export const renderSessionTimeInput = (
  sessionId: string,
  name: SessionTimeFieldName,
  value: string,
  pairedValue?: string,
): string => {
  const timeOptions = getSessionTimeOptions(name, pairedValue);
  const resolvedValue = timeOptions.includes(value) ? value : coerceTimeToOptions(value, timeOptions);
  const label = name === 'session-start' ? '시작 시간' : '종료 시간';
  const triggerValue = formatSessionTimeTriggerLabel(resolvedValue);

  return `
    <div
      class="session-time-field"
      data-session-id="${escapeHtml(sessionId)}"
      data-session-time-field="${name}"
      data-session-time-label="${label}"
      data-open="false"
    >
      <input
        type="hidden"
        name="${name}"
        class="session-time-hidden-input"
        value="${escapeHtml(resolvedValue)}"
        required
      />
      <button
        type="button"
        class="session-time-trigger"
        data-session-time-trigger
        data-session-id="${escapeHtml(sessionId)}"
        data-session-time-field="${name}"
        data-open="false"
        aria-haspopup="dialog"
        aria-expanded="false"
        aria-label="${escapeHtml(`${label} ${triggerValue}`)}"
      >
        <span class="session-time-trigger-label">
          <span class="session-time-trigger-value">${escapeHtml(triggerValue)}</span>
          <span class="session-time-trigger-meta">${escapeHtml(label)} 선택</span>
        </span>
        <span class="session-time-trigger-icon" aria-hidden="true">${renderIcon('clock')}</span>
      </button>
      <div class="session-time-popover-slot"></div>
    </div>
  `;
};

const renderSessionTimeOptionButtons = (
  segment: SessionTimeWidgetSegment,
  values: string[],
  selectedValue: string,
  formatter: (value: string) => string,
): string =>
  values
    .map(
      (value) => `
        <button
          type="button"
          class="session-time-option"
          data-role="option"
          data-session-time-option="${segment}"
          data-session-time-value="${escapeHtml(value)}"
          data-selected="${value === selectedValue ? 'true' : 'false'}"
          aria-pressed="${value === selectedValue ? 'true' : 'false'}"
        >
          ${escapeHtml(formatter(value))}
        </button>
      `,
    )
    .join('');

const renderSessionTimeMeridiemButtons = (selectedValue: GenericMeridiem, values: GenericMeridiem[]): string => `
  <div class="session-time-meridiem">
    <span class="session-time-group-label">${SESSION_TIME_SEGMENT_LABELS.meridiem}</span>
    <div class="session-time-meridiem-options" role="group" aria-label="${escapeHtml(SESSION_TIME_SEGMENT_LABELS.meridiem)}">
      ${renderSessionTimeOptionButtons('meridiem', values, selectedValue, (value) => SESSION_TIME_MERIDIEM_LABELS[value as GenericMeridiem])}
    </div>
  </div>
`;

const renderSessionTimePopoverMarkup = (
  fieldName: SessionTimeFieldName,
  draftValue: string,
  openSegment: SessionTimeMenuSegment | null,
  pairedValue?: string,
): string => {
  const timeOptions = getSessionTimeOptions(fieldName, pairedValue);
  const { meridiem, hour, minute } = splitMeridiemTimeParts(draftValue);
  const meridiemOptions = SESSION_TIME_MERIDIEMS.filter((value) => getSessionTimeHourOptions(timeOptions, value).length > 0);
  const hourOptions = getSessionTimeHourOptions(timeOptions, meridiem);
  const minuteOptions = getSessionTimeMinuteOptions(timeOptions, meridiem, hour);
  const activeSegment = resolveSessionTimeMenuSegment(openSegment);
  const label = fieldName === 'session-start' ? '시작 시간' : '종료 시간';
  const selectionSummary = `${SESSION_TIME_MERIDIEM_LABELS[meridiem]} ${Number(hour)}시 ${minute}분`;
  const optionSet =
    activeSegment === 'hour'
      ? {
          values: hourOptions,
          selectedValue: hour,
          formatter: (value: string) => `${Number(value)}시`,
        }
      : {
          values: minuteOptions,
          selectedValue: minute,
          formatter: (value: string) => `${value}분`,
        };

  return `
    <div
      class="session-time-popover is-open"
      data-open="true"
      role="dialog"
      aria-label="${escapeHtml(label)} 선택"
    >
      ${renderSessionTimeMeridiemButtons(meridiem, meridiemOptions)}
      <div class="session-time-select-menu" data-session-time-menu="${activeSegment}">
        <div class="session-time-select-menu-head">
          <div class="session-time-select-menu-heading">
            <span class="session-time-select-menu-title">${SESSION_TIME_SEGMENT_LABELS[activeSegment]}</span>
            <span class="session-time-select-menu-summary">${escapeHtml(selectionSummary)}</span>
          </div>
          <span class="session-time-select-menu-hint">${
            activeSegment === 'minute' ? '바깥 클릭 또는 Enter로 적용' : '선택 후 다음 단계로 이동'
          }</span>
        </div>
        <div class="session-time-select-options" data-segment="${activeSegment}" role="listbox" aria-label="${escapeHtml(SESSION_TIME_SEGMENT_LABELS[activeSegment])}">
          ${renderSessionTimeOptionButtons(activeSegment, optionSet.values, optionSet.selectedValue, optionSet.formatter)}
        </div>
      </div>
    </div>
  `;
};

const getSessionTimeFieldElement = (
  app: SoostaApp,
  sessionId: string,
  fieldName: SessionTimeFieldName,
): HTMLElement | null =>
  app.root.querySelector<HTMLElement>(`.session-time-field[data-session-id="${sessionId}"][data-session-time-field="${fieldName}"]`);

const getSessionTimeFieldValue = (
  app: SoostaApp,
  sessionId: string,
  fieldName: SessionTimeFieldName,
): string | null =>
  getSessionTimeFieldElement(app, sessionId, fieldName)?.querySelector<HTMLInputElement>('.session-time-hidden-input')?.value ?? null;

const getSessionTimeOptionsForField = (
  app: SoostaApp,
  sessionId: string,
  fieldName: SessionTimeFieldName,
): string[] =>
  getSessionTimeOptions(fieldName, getSessionTimeFieldValue(app, sessionId, getPairedSessionTimeFieldName(fieldName)) ?? undefined);

const getSessionTimeTargetFromElement = (element: HTMLElement | null): PendingSessionTimeTarget | null => {
  const field = element?.closest<HTMLElement>('.session-time-field');
  const sessionId = field?.dataset.sessionId;
  const fieldName = field?.dataset.sessionTimeField;
  if (!sessionId || !isSessionTimeFieldName(fieldName)) {
    return null;
  }

  return { sessionId, fieldName };
};

const setSessionTimeFieldOpenState = (field: HTMLElement, isOpen: boolean): void => {
  field.dataset.open = isOpen ? 'true' : 'false';
  const row = field.closest<HTMLElement>('.session-row');
  if (row) {
    row.dataset.sessionTimeOpen = isOpen ? 'true' : 'false';
  }
  const trigger = field.querySelector<HTMLButtonElement>('[data-session-time-trigger]');
  if (trigger) {
    trigger.dataset.open = isOpen ? 'true' : 'false';
    trigger.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
  }
};

const updateSessionTimeTriggerLabel = (field: HTMLElement | null, value: string): void => {
  if (!field) {
    return;
  }

  const trigger = field.querySelector<HTMLButtonElement>('[data-session-time-trigger]');
  const triggerValue = field.querySelector<HTMLElement>('.session-time-trigger-value');
  const label = field.dataset.sessionTimeLabel ?? '시간';
  const formattedValue = formatSessionTimeTriggerLabel(value);

  if (triggerValue) {
    triggerValue.textContent = formattedValue;
  }

  if (trigger) {
    trigger.setAttribute('aria-label', `${label} ${formattedValue}`);
  }
};

export const restorePendingSessionTimeTriggerFocus = (app: SoostaApp): void => {
  if (!app.pendingSessionTimeFocus) {
    return;
  }

  const pending = app.pendingSessionTimeFocus;
  const trigger = getSessionTimeFieldElement(app, pending.sessionId, pending.fieldName)?.querySelector<HTMLButtonElement>(
    '[data-session-time-trigger]',
  );
  if (!trigger) {
    return;
  }

  app.pendingSessionTimeFocus = null;
  trigger.focus({ preventScroll: true });
};

const queueSessionTimeTriggerFocus = (app: SoostaApp, target: PendingSessionTimeTarget): void => {
  app.pendingSessionTimeFocus = target;
  window.requestAnimationFrame(() => {
    restorePendingSessionTimeTriggerFocus(app);
  });
};

export const resumePendingSessionTimeWidgetOpen = (app: SoostaApp): void => {
  if (!app.pendingSessionTimeOpen) {
    return;
  }

  const pending = app.pendingSessionTimeOpen;
  app.pendingSessionTimeOpen = null;
  openSessionTimeWidget(app, pending.sessionId, pending.fieldName);
};

const openSessionTimeWidget = (app: SoostaApp, sessionId: string, fieldName: SessionTimeFieldName): void => {
  const field = getSessionTimeFieldElement(app, sessionId, fieldName);
  const hiddenInput = field?.querySelector<HTMLInputElement>('.session-time-hidden-input');
  const popoverSlot = field?.querySelector<HTMLElement>('.session-time-popover-slot');
  if (!field || !hiddenInput || !popoverSlot) {
    return;
  }

  app.sessionTimeWidget = {
    sessionId,
    fieldName,
    committedValue: hiddenInput.value,
    draftValue: hiddenInput.value,
    openSegment: 'hour',
  };

  setSessionTimeFieldOpenState(field, true);
  popoverSlot.innerHTML = renderSessionTimePopoverMarkup(
    fieldName,
    hiddenInput.value,
    'hour',
    getSessionTimeFieldValue(app, sessionId, getPairedSessionTimeFieldName(fieldName)) ?? undefined,
  );
};

export const renderOpenSessionTimeWidget = (app: SoostaApp): void => {
  if (!app.sessionTimeWidget) {
    return;
  }

  const field = getSessionTimeFieldElement(app, app.sessionTimeWidget.sessionId, app.sessionTimeWidget.fieldName);
  const popoverSlot = field?.querySelector<HTMLElement>('.session-time-popover-slot');
  if (!field || !popoverSlot) {
    app.sessionTimeWidget = null;
    return;
  }

  setSessionTimeFieldOpenState(field, true);
  popoverSlot.innerHTML = renderSessionTimePopoverMarkup(
    app.sessionTimeWidget.fieldName,
    app.sessionTimeWidget.draftValue,
    app.sessionTimeWidget.openSegment,
    getSessionTimeFieldValue(app, app.sessionTimeWidget.sessionId, getPairedSessionTimeFieldName(app.sessionTimeWidget.fieldName)) ??
      undefined,
  );
};

const updateSessionTimeWidgetDraft = (app: SoostaApp, segment: SessionTimeWidgetSegment, value: string): void => {
  if (!app.sessionTimeWidget) {
    return;
  }

  const timeOptions = getSessionTimeOptionsForField(app, app.sessionTimeWidget.sessionId, app.sessionTimeWidget.fieldName);
  const nextParts = splitMeridiemTimeParts(app.sessionTimeWidget.draftValue);

  if (segment === 'meridiem') {
    nextParts.meridiem = value as GenericMeridiem;
  } else if (segment === 'hour') {
    nextParts.hour = String(Number(value) || 0).padStart(2, '0');
  } else {
    nextParts.minute = String(Number(value) || 0).padStart(2, '0');
  }

  const coerced = coerceMeridiemTimeParts(nextParts.meridiem, nextParts.hour, nextParts.minute, timeOptions);
  const normalizedHour = String(Number(coerced.hour) || 0).padStart(2, '0');
  const normalizedMinute = String(Number(coerced.minute) || 0).padStart(2, '0');
  const canonicalHour =
    coerced.meridiem === 'AM'
      ? normalizedHour === '12'
        ? '00'
        : normalizedHour
      : normalizedHour === '12'
        ? '12'
        : String(Number(normalizedHour) + 12).padStart(2, '0');

  app.sessionTimeWidget.draftValue = `${canonicalHour}:${normalizedMinute}`;
  app.sessionTimeWidget.openSegment = getNextSessionTimeMenuSegment(segment, app.sessionTimeWidget.openSegment);
  renderOpenSessionTimeWidget(app);
};

export const syncSessionEndTimeAfterStartChange = (app: SoostaApp, sessionId: string, startValue: string): void => {
  const endField = getSessionTimeFieldElement(app, sessionId, 'session-end');
  const endHiddenInput = endField?.querySelector<HTMLInputElement>('.session-time-hidden-input');
  if (!endField || !endHiddenInput) {
    return;
  }

  const endOptions = getSessionTimeOptions('session-end', startValue);
  if (endOptions.length === 0) {
    return;
  }

  if (timeToMinutes(endHiddenInput.value) > timeToMinutes(startValue) && endOptions.includes(endHiddenInput.value)) {
    return;
  }

  const nextEndValue = coerceTimeToOptions(endHiddenInput.value, endOptions);
  if (nextEndValue === endHiddenInput.value) {
    return;
  }

  endHiddenInput.value = nextEndValue;
  updateSessionTimeTriggerLabel(endField, nextEndValue);
};

const shouldRestoreSessionTimeTriggerFocus = (target: HTMLElement | null): boolean => {
  if (!target) {
    return true;
  }

  return !target.closest('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])');
};

export const closeSessionTimeWidget = (
  app: SoostaApp,
  options: {
    reason: SessionTimeWidgetCloseReason;
    outsideTarget?: HTMLElement | null;
  },
): void => {
  if (!app.sessionTimeWidget) {
    resumePendingSessionTimeWidgetOpen(app);
    return;
  }

  const widget = app.sessionTimeWidget;
  const field = getSessionTimeFieldElement(app, widget.sessionId, widget.fieldName);
  const hiddenInput = field?.querySelector<HTMLInputElement>('.session-time-hidden-input');
  const popoverSlot = field?.querySelector<HTMLElement>('.session-time-popover-slot');
  const hasChanged = widget.draftValue !== widget.committedValue;
  const shouldCommit =
    options.reason === 'enter' ||
    options.reason === 'minute' ||
    ((options.reason === 'outside' || options.reason === 'toggle') && hasChanged);
  const shouldWriteCommittedValue = shouldCommit && hasChanged;
  const shouldRestoreFocus =
    options.reason === 'escape' ||
    options.reason === 'enter' ||
    options.reason === 'minute' ||
    options.reason === 'toggle' ||
    (options.reason === 'outside' && shouldRestoreSessionTimeTriggerFocus(options.outsideTarget ?? null));

  app.sessionTimeWidget = null;
  if (popoverSlot) {
    popoverSlot.innerHTML = '';
  }
  if (field) {
    setSessionTimeFieldOpenState(field, false);
  }

  if (shouldWriteCommittedValue && hiddenInput) {
    hiddenInput.value = widget.draftValue;
    updateSessionTimeTriggerLabel(field, widget.draftValue);

    if (widget.fieldName === 'session-start') {
      syncSessionEndTimeAfterStartChange(app, widget.sessionId, widget.draftValue);
    }
  }

  if (shouldRestoreFocus) {
    queueSessionTimeTriggerFocus(app, {
      sessionId: widget.sessionId,
      fieldName: widget.fieldName,
    });
  }

  if (shouldWriteCommittedValue) {
    const form = field?.closest<HTMLFormElement>('form');
    if (form) {
      void app.handleCourseInput(form);
      return;
    }
  }

  if (!['render', 'resize', 'unload'].includes(options.reason)) {
    resumePendingSessionTimeWidgetOpen(app);
  }
};

const handleSessionTimeOptionClick = (app: SoostaApp, button: HTMLButtonElement): void => {
  if (!app.sessionTimeWidget) {
    return;
  }

  const segment = button.dataset.sessionTimeOption as SessionTimeWidgetSegment | undefined;
  const value = button.dataset.sessionTimeValue;
  if (!segment || !value) {
    return;
  }

  updateSessionTimeWidgetDraft(app, segment, value);
};

export const handleSessionTimeWidgetClick = (app: SoostaApp, target: HTMLElement): boolean => {
  const activeWidget = app.sessionTimeWidget;
  const activeField = activeWidget ? getSessionTimeFieldElement(app, activeWidget.sessionId, activeWidget.fieldName) : null;
  const trigger = target.closest<HTMLButtonElement>('[data-session-time-trigger]');
  const option = target.closest<HTMLButtonElement>('[data-session-time-option]');

  if (activeWidget && activeField && !activeField.contains(target)) {
    if (trigger) {
      const pending = getSessionTimeTargetFromElement(trigger);
      if (pending && (pending.sessionId !== activeWidget.sessionId || pending.fieldName !== activeWidget.fieldName)) {
        app.pendingSessionTimeOpen = pending;
      }
    }

    closeSessionTimeWidget(app, { reason: 'outside', outsideTarget: target });
    if (trigger) {
      return true;
    }
  }

  if (option) {
    handleSessionTimeOptionClick(app, option);
    return true;
  }

  if (!trigger) {
    return false;
  }

  const sessionTimeTarget = getSessionTimeTargetFromElement(trigger);
  if (!sessionTimeTarget) {
    return false;
  }

  if (activeWidget && activeWidget.sessionId === sessionTimeTarget.sessionId && activeWidget.fieldName === sessionTimeTarget.fieldName) {
    closeSessionTimeWidget(app, { reason: 'toggle', outsideTarget: trigger });
    return true;
  }

  app.pendingSessionTimeOpen = null;
  openSessionTimeWidget(app, sessionTimeTarget.sessionId, sessionTimeTarget.fieldName);
  return true;
};
