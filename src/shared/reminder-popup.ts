import { formatLectureReminderLeadMinutes } from './reminders';
import type { NativeLectureReminderPayload } from './types';

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

export const createReminderPopupMarkup = (payload: NativeLectureReminderPayload): string => {
  const leadLabel = payload.isTest ? '테스트 알림' : `${formatLectureReminderLeadMinutes(payload.leadMinutes)} 전 알림`;
  const startsAtLabel = new Intl.DateTimeFormat('ko-KR', {
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(payload.startsAt));

  return `
    <!doctype html>
    <html lang="ko">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Lecture reminder</title>
        <style>
          :root {
            color-scheme: light;
            --accent: #7c72ff;
            --accent-strong: #5e53f6;
            --accent-soft: rgba(124, 114, 255, 0.12);
            --surface: rgba(255, 255, 255, 0.9);
            --surface-soft: rgba(244, 247, 255, 0.92);
            --surface-strong: rgba(255, 255, 255, 0.72);
            --stroke: rgba(121, 136, 184, 0.22);
            --text: #2a3553;
            --muted: #647394;
            --shadow: rgba(79, 97, 150, 0.08);
          }

          * {
            box-sizing: border-box;
          }

          html,
          body {
            width: 100%;
            min-height: 100%;
            margin: 0;
            overflow-x: hidden;
            background: transparent;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
          }

          body {
            padding: 10px;
            overflow-y: auto;
            scrollbar-gutter: stable;
            scrollbar-width: thin;
            scrollbar-color: rgba(121, 136, 184, 0.34) transparent;
          }

          body::-webkit-scrollbar {
            width: 6px;
          }

          body::-webkit-scrollbar-thumb {
            border-radius: 999px;
            background: rgba(121, 136, 184, 0.34);
          }

          .card {
            position: relative;
            display: flex;
            flex-direction: column;
            gap: 14px;
            width: 100%;
            min-height: 0;
            padding: 20px 20px 18px;
            border-radius: 26px;
            background:
              radial-gradient(circle at top right, rgba(124, 114, 255, 0.2), transparent 36%),
              linear-gradient(180deg, var(--surface), var(--surface-soft));
            color: var(--text);
            border: 0;
            box-shadow: 0 10px 20px var(--shadow);
          }

          .header {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto;
            gap: 12px;
            align-items: flex-start;
          }

          .header-copy {
            min-width: 0;
            display: grid;
            gap: 10px;
          }

          .eyebrow {
            display: inline-flex;
            align-items: center;
            gap: 8px;
            width: fit-content;
            max-width: 100%;
            padding: 6px 11px;
            border-radius: 999px;
            background: var(--accent-soft);
            color: var(--accent-strong);
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            overflow-wrap: anywhere;
          }

          .eyebrow::before {
            content: '';
            flex-shrink: 0;
            width: 8px;
            height: 8px;
            border-radius: 999px;
            background: var(--accent);
            box-shadow: 0 0 0 3px rgba(124, 114, 255, 0.12);
          }

          .close-button {
            align-self: flex-start;
            flex-shrink: 0;
            width: 36px;
            height: 36px;
            border: 0;
            border-radius: 999px;
            background: rgba(255, 255, 255, 0.74);
            color: var(--muted);
            font-size: 18px;
            line-height: 1;
            cursor: pointer;
            box-shadow: 0 3px 8px rgba(79, 97, 150, 0.06);
            transition:
              transform 120ms ease,
              background-color 120ms ease,
              border-color 120ms ease,
              color 120ms ease;
          }

          .close-button:hover {
            transform: translateY(-1px);
            background: rgba(124, 114, 255, 0.14);
            color: var(--accent-strong);
          }

          .close-button:focus-visible {
            outline: 2px solid rgba(124, 114, 255, 0.44);
            outline-offset: 2px;
          }

          h1 {
            margin: 0;
            max-width: 100%;
            font-size: 21px;
            line-height: 1.24;
            letter-spacing: -0.04em;
            overflow-wrap: anywhere;
            word-break: break-word;
          }

          .meta,
          .body {
            margin: 0;
            font-size: 13px;
            line-height: 1.6;
            overflow-wrap: anywhere;
            word-break: break-word;
          }

          .meta {
            padding: 11px 14px;
            border: 0;
            border-radius: 18px;
            background: var(--surface-strong);
            color: var(--muted);
            box-shadow: none;
          }

          .body {
            padding-top: 14px;
            border-top: 0;
            color: var(--text);
            white-space: pre-wrap;
          }

          .meta strong {
            color: var(--text);
            font-weight: 700;
          }
        </style>
      </head>
      <body>
        <main class="card" role="alert" aria-live="assertive">
          <div class="header">
            <div class="header-copy">
              <div class="eyebrow">${escapeHtml(leadLabel)}</div>
              <h1>${escapeHtml(payload.courseTitle)}</h1>
            </div>
            <button class="close-button" id="close-reminder" type="button" aria-label="알림 닫기">×</button>
          </div>
          <p class="meta"><strong>${escapeHtml(startsAtLabel)} 시작</strong> · ${escapeHtml(payload.location || '장소 미정')}</p>
          <p class="body">${escapeHtml(payload.body)}</p>
        </main>
        <script>
          const closeButton = document.getElementById('close-reminder');
          const closeReminder = () => window.close();

          closeButton?.addEventListener('click', closeReminder);
          window.addEventListener('keydown', (event) => {
            if (event.key === 'Escape') {
              closeReminder();
            }
          });
        </script>
      </body>
    </html>
  `;
};
