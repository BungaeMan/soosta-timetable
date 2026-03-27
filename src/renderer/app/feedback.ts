import { DAY_LABELS } from '../../shared/constants';
import { getDefaultLectureReminderLeadMinutes } from '../../shared/reminders';
import type { LectureReminderLeadMinutes, NativeLectureReminderPayload } from '../../shared/types';
import { getCurrentTimeIndicatorState, getGridRange, getTodayAgenda } from '../domain/timetable';
import {
  getDueLectureReminderEvents,
  getNextUpcomingSessionOccurrence,
  getReminderSweepStartMs,
} from '../domain/reminders';
import type { SoostaApp } from '../app';
import { renderLectureReminderCard } from './rendering';
import {
  BANNER_AUTO_DISMISS_MS,
  BANNER_EXIT_DURATION_MS,
  CURRENT_TIME_TICK_BUFFER_MS,
  CURRENT_TIME_TICK_MS,
  REMINDER_CARD_AUTO_DISMISS_MS,
  REMINDER_SWEEP_INTERVAL_MS,
  REMINDER_SWEEP_LOOKBACK_MS,
  escapeHtml,
  formatReminderLeadList,
  getBannerMeta,
  getCurrentWeekday,
  prefersReducedMotion,
  renderIcon,
  type Banner,
} from './shared';
import { renderAgendaSection } from './render-sections';

const syncAgendaPanel = (app: SoostaApp, now = new Date()): void => {
  const agendaPanel = app.root.querySelector<HTMLElement>('[data-agenda-panel]');
  if (!agendaPanel || !app.data) {
    return;
  }

  const board = app.getActiveBoard();
  const agenda = getTodayAgenda(board, now);
  agendaPanel.outerHTML = renderAgendaSection({
    agenda,
    agendaDay: agenda.length > 0 ? agenda[0].day : getCurrentWeekday(now) ?? null,
    renderAgendaItem: (item) => app.renderAgendaItem(item),
  });
};

export const syncCurrentTimeUi = (app: SoostaApp, now = new Date()): void => {
  syncCurrentTimeIndicator(app, now);
  syncAgendaPanel(app, now);
};

export const startCurrentTimeTicker = (app: SoostaApp): void => {
  stopCurrentTimeTicker(app);
  syncCurrentTimeUi(app);
  queueCurrentTimeIndicatorTick(app);
};

export const stopCurrentTimeTicker = (app: SoostaApp): void => {
  if (app.currentTimeTicker !== null) {
    window.clearTimeout(app.currentTimeTicker);
    app.currentTimeTicker = null;
  }
};

export const queueCurrentTimeIndicatorSync = (app: SoostaApp): void => {
  if (app.currentTimeIndicatorSyncFrame !== null) {
    return;
  }

  app.currentTimeIndicatorSyncFrame = window.requestAnimationFrame(() => {
    app.currentTimeIndicatorSyncFrame = null;
    syncCurrentTimeIndicator(app);
  });
};

export const cancelQueuedCurrentTimeIndicatorSync = (app: SoostaApp): void => {
  if (app.currentTimeIndicatorSyncFrame !== null) {
    window.cancelAnimationFrame(app.currentTimeIndicatorSyncFrame);
    app.currentTimeIndicatorSyncFrame = null;
  }
};

const queueCurrentTimeIndicatorTick = (app: SoostaApp, now = new Date()): void => {
  const elapsedThisMinuteMs = now.getSeconds() * 1000 + now.getMilliseconds();
  const delayUntilNextMinute = Math.max(1000, CURRENT_TIME_TICK_MS - elapsedThisMinuteMs + CURRENT_TIME_TICK_BUFFER_MS);

  app.currentTimeTicker = window.setTimeout(() => {
    app.currentTimeTicker = null;
    syncCurrentTimeUi(app);
    queueCurrentTimeIndicatorTick(app);
  }, delayUntilNextMinute);
};

export const syncCurrentTimeIndicator = (app: SoostaApp, now = new Date()): void => {
  const dayHeads = [...app.root.querySelectorAll<HTMLElement>('[data-day-head]')];
  const dayColumns = [...app.root.querySelectorAll<HTMLElement>('[data-day-column]')];
  const indicator = app.root.querySelector<HTMLElement>('[data-current-time-indicator]');

  dayHeads.forEach((head) => head.classList.remove('is-current-time-day'));

  if (indicator) {
    indicator.hidden = true;
    indicator.style.removeProperty('top');
    indicator.style.removeProperty('left');
    indicator.style.removeProperty('width');
  }

  if (!app.data) {
    return;
  }

  const board = app.getActiveBoard();
  if (board.courses.length === 0) {
    return;
  }

  const range = getGridRange(board);
  const indicatorState = getCurrentTimeIndicatorState(range, now);
  if (!indicatorState || !indicator) {
    return;
  }

  const dayHead = dayHeads.find((head) => head.dataset.dayHead === indicatorState.day);
  const dayColumn = dayColumns.find((column) => column.dataset.dayColumn === indicatorState.day);
  if (!dayColumn) {
    return;
  }

  const top = Number((indicatorState.offsetMinutes * app.getTimetablePixelsPerMinute()).toFixed(3));
  dayHead?.classList.add('is-current-time-day');
  indicator.hidden = false;
  indicator.style.top = `${top}px`;
  indicator.style.left = `${dayColumn.offsetLeft}px`;
  indicator.style.width = `${dayColumn.offsetWidth}px`;
};

export const renderBannerToast = (app: SoostaApp): void => {
  const toastSlot = app.root.querySelector<HTMLElement>('#toast-slot');
  if (!toastSlot) {
    return;
  }

  const bannerMeta = app.banner ? getBannerMeta(app.banner.tone) : null;

  toastSlot.innerHTML =
    app.banner || app.activeLectureReminder
      ? `
        <div class="toast-stack">
          <div class="toast-column">
            ${app.activeLectureReminder ? renderLectureReminderCard(app.activeLectureReminder) : ''}
            ${
              app.banner
                ? `
                  <div
                    class="banner banner-${app.banner.tone} is-${app.bannerVisibility}"
                    role="${app.banner.tone === 'error' ? 'alert' : 'status'}"
                    aria-live="${app.banner.tone === 'error' ? 'assertive' : 'polite'}"
                  >
                    <div class="banner-icon" aria-hidden="true">${renderIcon(bannerMeta?.icon ?? 'spark')}</div>
                    <div class="banner-copy">
                      <strong class="banner-label">${escapeHtml(bannerMeta?.label ?? '안내')}</strong>
                      <p class="banner-message">${escapeHtml(app.banner.text)}</p>
                    </div>
                  </div>
                `
                : ''
            }
          </div>
        </div>
      `
      : '';

  const reminderElement = toastSlot.querySelector<HTMLElement>('.lecture-reminder');
  if (reminderElement) {
    reminderElement.addEventListener('mouseenter', () => {
      clearReminderCardTimer(app);
    });
    reminderElement.addEventListener('mouseleave', () => {
      scheduleReminderCardDismiss(app);
    });
    reminderElement.addEventListener('focusin', () => {
      clearReminderCardTimer(app);
    });
    reminderElement.addEventListener('focusout', (event) => {
      const nextTarget = event.relatedTarget;
      if (nextTarget instanceof Node && reminderElement.contains(nextTarget)) {
        return;
      }

      scheduleReminderCardDismiss(app);
    });
  }

  const bannerElement = toastSlot.querySelector<HTMLElement>('.banner');
  if (!bannerElement) {
    return;
  }

  bannerElement.addEventListener('mouseenter', () => {
    app.isBannerHovered = true;
    pauseBannerAutoDismiss(app);
  });
  bannerElement.addEventListener('mouseleave', () => {
    app.isBannerHovered = false;
    resumeBannerAutoDismissIfIdle(app);
  });
  bannerElement.addEventListener('focusin', () => {
    app.isBannerFocused = true;
    pauseBannerAutoDismiss(app);
  });
  bannerElement.addEventListener('focusout', (event) => {
    const nextTarget = event.relatedTarget;
    if (nextTarget instanceof Node && bannerElement.contains(nextTarget)) {
      return;
    }

    app.isBannerFocused = false;
    resumeBannerAutoDismissIfIdle(app);
  });
};

export const startReminderSweepLoop = (app: SoostaApp): void => {
  stopReminderSweepLoop(app);
  app.lastReminderSweepAt = Date.now() - REMINDER_SWEEP_LOOKBACK_MS;
  app.reminderSweepTimer = setInterval(() => {
    runReminderSweep(app);
  }, REMINDER_SWEEP_INTERVAL_MS);
};

export const stopReminderSweepLoop = (app: SoostaApp): void => {
  if (app.reminderSweepTimer !== null) {
    clearInterval(app.reminderSweepTimer);
    app.reminderSweepTimer = null;
  }
};

export const areLectureRemindersEnabled = (app: SoostaApp): boolean => app.data?.preferences.lectureRemindersEnabled ?? true;

export const getLectureReminderLeadMinutes = (app: SoostaApp): LectureReminderLeadMinutes[] =>
  app.data?.preferences.lectureReminderLeadMinutes ?? getDefaultLectureReminderLeadMinutes();

export const getLectureReminderSummary = (app: SoostaApp): string => {
  const leadMinutes = getLectureReminderLeadMinutes(app);
  if (leadMinutes.length === 0) {
    return '선택된 자동 알림 시각이 없어요.';
  }

  return `${formatReminderLeadList(leadMinutes)}에 알려줍니다.`;
};

export const runReminderSweep = (app: SoostaApp): void => {
  const completedAt = Date.now();
  const startedAt = getReminderSweepStartMs(app.lastReminderSweepAt, completedAt, REMINDER_SWEEP_LOOKBACK_MS);
  app.lastReminderSweepAt = completedAt;
  const reminderLeadMinutes = getLectureReminderLeadMinutes(app);

  if (!app.data || !areLectureRemindersEnabled(app) || reminderLeadMinutes.length === 0) {
    return;
  }

  const dueEvents = getDueLectureReminderEvents(
    app.getActiveBoard(),
    new Date(startedAt),
    new Date(completedAt),
    reminderLeadMinutes,
  ).filter((event) => !app.firedLectureReminderIds.has(event.reminderId));

  dueEvents.forEach((event) => {
    app.firedLectureReminderIds.add(event.reminderId);
    presentLectureReminder(app, event.nativePayload);
    void window.soosta.showLectureReminder(event.nativePayload).catch((): void => undefined);
  });
};

const buildManualLectureReminderPayload = (app: SoostaApp): NativeLectureReminderPayload => {
  const nextUpcoming = app.data ? getNextUpcomingSessionOccurrence(app.getActiveBoard(), new Date()) : null;
  const reminderId = `manual-reminder:${Date.now()}`;
  const configuredLeadMinutes = getLectureReminderLeadMinutes(app);
  const configuredLeadText =
    areLectureRemindersEnabled(app) && configuredLeadMinutes.length > 0
      ? formatReminderLeadList(configuredLeadMinutes)
      : areLectureRemindersEnabled(app)
        ? '선택된 시각 없음'
        : '현재 꺼짐';

  if (nextUpcoming) {
    const locationText = nextUpcoming.location ? ` · ${nextUpcoming.location}` : '';

    return {
      reminderId,
      leadMinutes: 10,
      courseTitle: nextUpcoming.title,
      location: nextUpcoming.location,
      startsAt: nextUpcoming.startAt,
      title: `${nextUpcoming.title} · 테스트 알림`,
      body: `테스트 알림입니다. 실제 자동 알림은 ${DAY_LABELS[nextUpcoming.day].full} ${nextUpcoming.start} 시작 기준 ${configuredLeadText}${locationText}.`,
      isTest: true,
    };
  }

  return {
    reminderId,
    leadMinutes: 10,
    courseTitle: '강의 알림 테스트',
    location: '현재 보드 기준',
    startsAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    title: '강의 알림 테스트',
    body: `팝업, 네이티브 알림, 소리가 정상적으로 보이는지 확인해보세요. 현재 자동 알림 설정: ${configuredLeadText}.`,
    isTest: true,
  };
};

export const triggerManualLectureReminder = async (app: SoostaApp): Promise<void> => {
  const payload = buildManualLectureReminderPayload(app);

  presentLectureReminder(app, payload);

  try {
    await window.soosta.showLectureReminder(payload);
    showBanner(app, { tone: 'success', text: '테스트 알림을 보냈어요. 팝업과 소리를 확인해보세요.' });
  } catch (error) {
    showBanner(app, { tone: 'error', text: `테스트 알림을 보내지 못했어요. ${app.getErrorMessage(error)}` });
  }
};

const presentLectureReminder = (app: SoostaApp, payload: NativeLectureReminderPayload): void => {
  app.activeLectureReminder = {
    reminderId: payload.reminderId,
    leadMinutes: payload.leadMinutes,
    courseTitle: payload.courseTitle,
    location: payload.location,
    startsAt: payload.startsAt,
    body: payload.body,
    isTest: payload.isTest,
  };
  playLectureReminderSound(app);
  renderBannerToast(app);
  scheduleReminderCardDismiss(app);
};

export const dismissLectureReminder = (app: SoostaApp): void => {
  if (!app.activeLectureReminder) {
    return;
  }

  app.activeLectureReminder = null;
  clearReminderCardTimer(app);
  renderBannerToast(app);
};

const scheduleReminderCardDismiss = (app: SoostaApp): void => {
  if (!app.activeLectureReminder) {
    return;
  }

  clearReminderCardTimer(app);
  app.reminderCardTimer = setTimeout(() => {
    app.reminderCardTimer = null;
    dismissLectureReminder(app);
  }, REMINDER_CARD_AUTO_DISMISS_MS);
};

export const clearReminderCardTimer = (app: SoostaApp): void => {
  if (app.reminderCardTimer !== null) {
    clearTimeout(app.reminderCardTimer);
    app.reminderCardTimer = null;
  }
};

const playLectureReminderSound = (app: SoostaApp): void => {
  const AudioContextCtor = window.AudioContext;
  if (!AudioContextCtor) {
    return;
  }

  if (!app.reminderAudioContext) {
    app.reminderAudioContext = new AudioContextCtor();
  }

  const context = app.reminderAudioContext;
  const playSequence = (): void => {
    const baseTime = context.currentTime;

    [0, 0.24, 0.48].forEach((offset, index) => {
      const oscillator = context.createOscillator();
      const gain = context.createGain();

      oscillator.type = 'triangle';
      oscillator.frequency.value = index === 2 ? 1046.5 : 880;
      gain.gain.setValueAtTime(0.0001, baseTime + offset);
      gain.gain.exponentialRampToValueAtTime(0.16, baseTime + offset + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, baseTime + offset + 0.18);

      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(baseTime + offset);
      oscillator.stop(baseTime + offset + 0.18);
    });
  };

  if (context.state === 'suspended') {
    void context.resume().then(playSequence).catch((): void => undefined);
    return;
  }

  playSequence();
};

export const showBanner = (app: SoostaApp, banner: Banner): void => {
  const isSameBanner = app.banner?.tone === banner.tone && app.banner?.text === banner.text && app.bannerVisibility !== 'leaving';

  if (isSameBanner) {
    clearBannerAnimationAndCleanupTimers(app);
    app.banner = banner;
    app.bannerVisibility = 'visible';
    renderBannerToast(app);
    scheduleBannerAutoDismiss(app);
    return;
  }

  clearBannerTimers(app);
  app.banner = banner;
  app.isBannerHovered = false;
  app.isBannerFocused = false;

  if (prefersReducedMotion()) {
    app.bannerVisibility = 'visible';
    renderBannerToast(app);
    scheduleBannerAutoDismiss(app);
    return;
  }

  app.bannerVisibility = 'entering';
  renderBannerToast(app);
  app.bannerAnimationFrame = window.requestAnimationFrame(() => {
    app.bannerAnimationFrame = null;
    if (!app.banner) {
      return;
    }

    app.bannerVisibility = 'visible';
    renderBannerToast(app);
    scheduleBannerAutoDismiss(app);
  });
};

export const dismissBanner = (app: SoostaApp, immediate = false): void => {
  if (!app.banner) {
    return;
  }

  clearBannerTimers(app);

  if (immediate || prefersReducedMotion()) {
    app.banner = null;
    app.bannerVisibility = 'hidden';
    renderBannerToast(app);
    return;
  }

  app.bannerVisibility = 'leaving';
  renderBannerToast(app);
  app.bannerCleanupTimer = setTimeout(() => {
    app.bannerCleanupTimer = null;
    app.banner = null;
    app.bannerVisibility = 'hidden';
    renderBannerToast(app);
  }, BANNER_EXIT_DURATION_MS);
};

export const clearBannerTimers = (app: SoostaApp): void => {
  clearBannerAnimationAndCleanupTimers(app);
  clearBannerAutoDismissTimer(app);

  app.isBannerHovered = false;
  app.isBannerFocused = false;
};

const scheduleBannerAutoDismiss = (app: SoostaApp): void => {
  if (!app.banner) {
    return;
  }

  const timeoutMs = BANNER_AUTO_DISMISS_MS[app.banner.tone];
  if (timeoutMs <= 0) {
    return;
  }

  clearBannerAutoDismissTimer(app, false);
  app.bannerAutoDismissRemainingMs = timeoutMs;
  app.bannerAutoDismissStartedAt = null;

  if (app.isBannerHovered || app.isBannerFocused) {
    return;
  }

  startBannerAutoDismissTimer(app, timeoutMs);
};

const startBannerAutoDismissTimer = (app: SoostaApp, timeoutMs: number): void => {
  clearBannerAutoDismissTimer(app, false);
  app.bannerAutoDismissRemainingMs = timeoutMs;
  app.bannerAutoDismissStartedAt = Date.now();
  app.bannerAutoDismissTimer = setTimeout(() => {
    clearBannerAutoDismissTimer(app);
    dismissBanner(app);
  }, timeoutMs);
};

const clearBannerAutoDismissTimer = (app: SoostaApp, resetState = true): void => {
  if (app.bannerAutoDismissTimer !== null) {
    clearTimeout(app.bannerAutoDismissTimer);
    app.bannerAutoDismissTimer = null;
  }

  if (resetState) {
    app.bannerAutoDismissStartedAt = null;
    app.bannerAutoDismissRemainingMs = null;
  }
};

const clearBannerAnimationAndCleanupTimers = (app: SoostaApp): void => {
  if (app.bannerAnimationFrame !== null) {
    window.cancelAnimationFrame(app.bannerAnimationFrame);
    app.bannerAnimationFrame = null;
  }

  if (app.bannerCleanupTimer !== null) {
    clearTimeout(app.bannerCleanupTimer);
    app.bannerCleanupTimer = null;
  }
};

const pauseBannerAutoDismiss = (app: SoostaApp): void => {
  if (app.bannerAutoDismissTimer === null || app.bannerAutoDismissStartedAt === null || app.bannerAutoDismissRemainingMs === null) {
    return;
  }

  const elapsed = Date.now() - app.bannerAutoDismissStartedAt;
  app.bannerAutoDismissRemainingMs = Math.max(0, app.bannerAutoDismissRemainingMs - elapsed);
  clearBannerAutoDismissTimer(app, false);
  app.bannerAutoDismissStartedAt = null;
};

const resumeBannerAutoDismissIfIdle = (app: SoostaApp): void => {
  if (app.isBannerHovered || app.isBannerFocused || !app.banner) {
    return;
  }

  if (app.bannerAutoDismissRemainingMs === null) {
    return;
  }

  if (app.bannerAutoDismissRemainingMs <= 0) {
    dismissBanner(app);
    return;
  }

  startBannerAutoDismissTimer(app, app.bannerAutoDismissRemainingMs);
};
