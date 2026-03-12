export type DayKey = 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT';

export interface CourseSession {
  id: string;
  day: DayKey;
  start: string;
  end: string;
  location: string;
}

export interface Course {
  id: string;
  title: string;
  code: string;
  instructor: string;
  location: string;
  credits: number | null;
  memo: string;
  color: string;
  sessions: CourseSession[];
}

export interface TimetableBoard {
  id: string;
  name: string;
  semester: string;
  note: string;
  createdAt: string;
  updatedAt: string;
  courses: Course[];
}

export interface AppPreferences {
  lectureRemindersEnabled: boolean;
  lectureReminderLeadMinutes: LectureReminderLeadMinutes[];
}

export interface AppData {
  version: number;
  activeBoardId: string;
  boards: TimetableBoard[];
  preferences: AppPreferences;
}

export interface FlattenedSession {
  courseId: string;
  courseTitle: string;
  instructor: string;
  courseLocation: string;
  courseColor: string;
  sessionId: string;
  day: DayKey;
  start: string;
  end: string;
  location: string;
  startMinutes: number;
  endMinutes: number;
}

export interface PositionedSession extends FlattenedSession {
  leftPercent: number;
  widthPercent: number;
  isConflict: boolean;
}

export interface ConflictRecord {
  day: DayKey;
  sessionIds: string[];
  courseIds: string[];
  startMinutes: number;
  endMinutes: number;
}

export interface BoardStats {
  totalCredits: number;
  courseCount: number;
  sessionCount: number;
  conflictCount: number;
}

export interface AgendaItem {
  courseId: string;
  sessionId: string;
  title: string;
  day: DayKey;
  start: string;
  end: string;
  location: string;
  instructor: string;
  color: string;
  isOngoing: boolean;
  isNext: boolean;
}

export interface FreeWindow {
  start: string;
  end: string;
  durationMinutes: number;
}

export interface ExportResult {
  cancelled: boolean;
  filePath?: string;
}

export interface ImportResult {
  cancelled: boolean;
  filePath?: string;
  data?: AppData;
}

export type LectureReminderLeadMinutes = number;

export interface NativeLectureReminderPayload {
  reminderId: string;
  leadMinutes: LectureReminderLeadMinutes;
  courseTitle: string;
  location: string;
  startsAt: string;
  title: string;
  body: string;
  isTest?: boolean;
}

export type WindowMaximizedListener = (isMaximized: boolean) => void;
export type Unsubscribe = () => void;

export interface WindowControlsApi {
  minimizeWindow: () => Promise<void>;
  toggleMaximizeWindow: () => Promise<void>;
  closeWindow: () => Promise<void>;
  isWindowMaximized: () => Promise<boolean>;
  subscribeWindowMaximized: (listener: WindowMaximizedListener) => Unsubscribe;
}

export interface SoostaApi extends WindowControlsApi {
  loadData: () => Promise<AppData>;
  saveData: (data: AppData) => Promise<AppData>;
  exportData: (data: AppData) => Promise<ExportResult>;
  importData: () => Promise<ImportResult>;
  showLectureReminder: (payload: NativeLectureReminderPayload) => Promise<void>;
}
