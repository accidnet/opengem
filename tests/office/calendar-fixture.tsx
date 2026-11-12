import { createRoot } from "react-dom/client";
import { CalendarEventDraftDialog } from "@/components/CalendarEventDraftDialog";
import type { CalendarEventDraft, GoogleCalendar } from "@/features/agent/googleApi";
import "@/App.css";

const options = new URLSearchParams(window.location.search);
const calendarId = options.get("calendarId") || "later-calendar";
const laterRole = options.get("accessRole") || "writer";
const account = "calendar@example.test";
const submitted: CalendarEventDraft[] = [];
Reflect.set(window, "calendarTestCalls", submitted);
Reflect.set(window, "calendarTestAccount", account);
const calendar = (id: string, summary: string, accessRole: string): GoogleCalendar => ({
  id,
  summary,
  accessRole,
  primary: false,
  timeZone: "Asia/Seoul",
});

// 실제 대화상자를 렌더링하며 Google 요청은 페이지가 나뉜 예시 데이터로 대체합니다.
Reflect.set(window, "__TAURI_INTERNALS__", {
  invoke: async (command: string, args?: { pageToken?: string; input?: CalendarEventDraft }) => {
    if (command === "get_google_settings")
      return {
        clientId: "test-client",
        hasClientSecret: true,
        services: [
          {
            service: "calendar",
            connected: true,
            email: Reflect.get(window, "calendarTestAccount"),
            loginPending: false,
            lastError: null,
          },
        ],
      };
    if (command === "list_google_calendars")
      return args?.pageToken
        ? {
            calendars: [calendar("later-calendar", "추가 페이지 캘린더", laterRole)],
            nextPageToken: null,
          }
        : {
            calendars: [calendar("listed-calendar", "확인된 캘린더", "owner")],
            nextPageToken: "page-two",
          };
    if (command === "create_google_calendar_event" && args?.input) {
      submitted.push(args.input);
      return { ...args.input, id: "created-event", url: "", status: "confirmed" };
    }
    throw new Error("예상하지 못한 테스트 요청: " + command);
  },
});

createRoot(document.getElementById("root")!).render(
  <CalendarEventDraftDialog
    draft={{
      calendarId,
      expectedAccountEmail: account,
      draftId: "test-draft",
      title: "대상 캘린더 확인",
      start: { date: "2026-11-12" },
      end: { date: "2026-11-13" },
    }}
    onClose={() => {}}
    onCreated={() => {}}
  />
);
