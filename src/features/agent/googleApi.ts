import { invoke } from "@tauri-apps/api/core";

export type GoogleService = "gmail" | "drive" | "calendar";
export type GoogleServiceStatus = {
  service: GoogleService;
  connected: boolean;
  email: string | null;
  loginPending: boolean;
  lastError: string | null;
};
export type GoogleSettings = {
  clientId: string;
  hasClientSecret: boolean;
  services: GoogleServiceStatus[];
};
export type GoogleDriveFile = {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string | null;
  webViewLink: string;
};
export type GoogleDriveContent = {
  id: string;
  name: string;
  mimeType: string;
  content: string;
  truncated: boolean;
  url: string;
};
export type GoogleCalendar = {
  id: string;
  summary: string;
  timeZone: string | null;
  primary: boolean;
  accessRole: string;
};
export type GoogleEventTime = { dateTime?: string; date?: string; timeZone?: string };
export type GoogleCalendarEvent = {
  id: string;
  title: string;
  description: string;
  start: GoogleEventTime;
  end: GoogleEventTime;
  location: string;
  url: string;
  status: string;
};
export type CalendarEventDraft = {
  expectedAccountEmail: string;
  calendarId: string;
  draftId: string;
  title: string;
  description?: string;
  location?: string;
  start: GoogleEventTime;
  end: GoogleEventTime;
};

// 연결 자격 증명은 Rust에 남기고 화면에는 서비스별 상태만 전달합니다.
export const getGoogleSettings = () => invoke<GoogleSettings>("get_google_settings");
export const saveGoogleSettings = (input: { clientId: string; clientSecret?: string }) =>
  invoke<GoogleSettings>("save_google_settings", { input });
export const beginGoogleLogin = (service: GoogleService) =>
  invoke<{ authorizationUrl: string }>("begin_google_login", { service });
export const cancelGoogleLogin = (service: GoogleService) =>
  invoke<void>("cancel_google_login", { service });
export const disconnectGoogleService = (service: GoogleService) =>
  invoke<GoogleSettings>("disconnect_google_service", { service });
export const listGoogleDriveFiles = (input: { query?: string; pageToken?: string }) =>
  invoke<{ files: GoogleDriveFile[]; nextPageToken: string | null; incompleteSearch: boolean }>(
    "list_google_drive_files",
    { input }
  );
export const readGoogleDriveFile = (fileId: string) =>
  invoke<GoogleDriveContent>("read_google_drive_file", { fileId });
export const listGoogleCalendars = (pageToken?: string) =>
  invoke<{ calendars: GoogleCalendar[]; nextPageToken: string | null }>("list_google_calendars", {
    pageToken,
  });
export const listGoogleCalendarEvents = (input: {
  calendarId?: string;
  timeMin: string;
  timeMax: string;
  query?: string;
  pageToken?: string;
}) =>
  invoke<{ events: GoogleCalendarEvent[]; nextPageToken: string | null; timeZone: string | null }>(
    "list_google_calendar_events",
    { input }
  );
// 이 쓰기 API는 사람이 검토한 일정 대화상자의 등록 버튼에서만 호출합니다.
export const createGoogleCalendarEvent = (input: CalendarEventDraft) =>
  invoke<GoogleCalendarEvent>("create_google_calendar_event", { input });
