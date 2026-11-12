import type { GoogleEventTime } from "./googleApi";

export type GoogleWorkspaceRequest = {
  sourceQuote: string;
  calendarList?: boolean;
  drive?: { query: string; readContent: boolean; fileId?: string };
  calendar?: { calendarId: string; timeMin: string; timeMax: string; query?: string };
  calendarDraft?: {
    calendarId: string;
    title: string;
    description?: string;
    location?: string;
    start: GoogleEventTime;
    end: GoogleEventTime;
  };
};

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Google 요청 형식이 올바르지 않습니다.");
  return value as Record<string, unknown>;
}
function bounded(value: unknown, max: number, fallback = ""): string {
  if (value == null) return fallback;
  if (typeof value !== "string" || value.length > max)
    throw new Error("Google 요청 내용이 너무 길거나 올바르지 않습니다.");
  return value.trim();
}
function timestamp(value: string): number {
  if (
    !/^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/.test(
      value
    ) ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error("일정에는 시간대가 포함된 날짜와 시간이 필요합니다.");
  const date = value.slice(0, 10);
  if (new Date(date + "T00:00:00Z").toISOString().slice(0, 10) !== date)
    throw new Error("유효하지 않은 날짜입니다.");
  return Date.parse(value);
}
function eventTime(value: unknown): GoogleEventTime {
  const item = record(value);
  if (Object.keys(item).some((key) => !["date", "dateTime", "timeZone"].includes(key)))
    throw new Error("지원하지 않는 일정 시간 필드입니다.");
  const date = bounded(item.date, 10);
  const dateTime = bounded(item.dateTime, 40);
  const timeZone = bounded(item.timeZone, 100);
  if (Boolean(date) === Boolean(dateTime))
    throw new Error("종일 일정 또는 시간 일정을 선택해 주세요.");
  if (date) {
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      !Number.isFinite(Date.parse(date)) ||
      new Date(date).toISOString().slice(0, 10) !== date
    )
      throw new Error("유효하지 않은 종일 일정 날짜입니다.");
    return { date };
  }
  timestamp(dateTime);
  if (timeZone) {
    try {
      new Intl.DateTimeFormat("en", { timeZone });
    } catch {
      throw new Error("유효하지 않은 시간대입니다.");
    }
  }
  return { dateTime, ...(timeZone ? { timeZone } : {}) };
}

// 모델은 조회와 초안만 제안합니다. 실제 일정 생성은 별도 UI가 담당합니다.
export function parseGoogleWorkspaceRequest(
  value: unknown,
  userText: string
): GoogleWorkspaceRequest | null {
  if (value == null) return null;
  const item = record(value);
  if (
    Object.keys(item).some(
      (key) => !["sourceQuote", "drive", "calendar", "calendarDraft", "calendarList"].includes(key)
    )
  )
    throw new Error("지원하지 않는 Google 작업입니다.");
  const sourceQuote = bounded(item.sourceQuote, 4000);
  if (!sourceQuote || !userText.includes(sourceQuote))
    throw new Error("현재 요청에 없는 Google 작업입니다.");
  const result: GoogleWorkspaceRequest = { sourceQuote };
  if (item.calendarList != null) {
    if (typeof item.calendarList !== "boolean")
      throw new Error("캘린더 목록 요청이 올바르지 않습니다.");
    result.calendarList = item.calendarList;
  }
  if (item.drive != null) {
    const drive = record(item.drive);
    const fileId = bounded(drive.fileId, 256);
    if (fileId && (!/^[a-zA-Z0-9_-]+$/.test(fileId) || !userText.includes(fileId)))
      throw new Error("사용자 요청에서 Drive 파일을 확인할 수 없습니다.");
    if (typeof drive.readContent !== "boolean")
      throw new Error("Drive 읽기 범위가 올바르지 않습니다.");
    result.drive = {
      query: bounded(drive.query, 300),
      readContent: drive.readContent,
      ...(fileId ? { fileId } : {}),
    };
  }
  if (item.calendar != null) {
    const calendar = record(item.calendar);
    const timeMin = bounded(calendar.timeMin, 40);
    const timeMax = bounded(calendar.timeMax, 40);
    const duration = timestamp(timeMax) - timestamp(timeMin);
    if (duration <= 0 || duration > 366 * 24 * 60 * 60 * 1000)
      throw new Error("일정 조회 기간은 1년 이내여야 합니다.");
    result.calendar = {
      calendarId: bounded(calendar.calendarId, 1024, "primary") || "primary",
      timeMin,
      timeMax,
      query: bounded(calendar.query, 300),
    };
  }
  if (item.calendarDraft != null) {
    const draft = record(item.calendarDraft);
    if (
      Object.keys(draft).some(
        (key) => !["calendarId", "title", "description", "location", "start", "end"].includes(key)
      )
    )
      throw new Error("참석자 초대 등 지원하지 않는 일정 필드가 있습니다.");
    const start = eventTime(draft.start);
    const end = eventTime(draft.end);
    if (
      Boolean(start.date) !== Boolean(end.date) ||
      Date.parse(end.date || end.dateTime || "") <= Date.parse(start.date || start.dateTime || "")
    )
      throw new Error("일정 종료는 시작보다 뒤여야 합니다.");
    if (
      Date.parse(end.date || end.dateTime || "") - Date.parse(start.date || start.dateTime || "") >
      366 * 24 * 60 * 60 * 1000
    )
      throw new Error("일정 기간은 1년 이내여야 합니다.");
    const title = bounded(draft.title, 300);
    if (!title) throw new Error("일정 제목이 필요합니다.");
    result.calendarDraft = {
      calendarId: bounded(draft.calendarId, 1024, "primary") || "primary",
      title,
      description: bounded(draft.description, 8000),
      location: bounded(draft.location, 1000),
      start,
      end,
    };
  }
  return result.drive || result.calendar || result.calendarDraft || result.calendarList
    ? result
    : null;
}
