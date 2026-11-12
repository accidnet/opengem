import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  listGoogleDriveFiles,
  readGoogleDriveFile,
  listGoogleCalendars,
  listGoogleCalendarEvents,
  type GoogleSettings,
  type GoogleDriveFile,
  type GoogleCalendar,
  type GoogleCalendarEvent,
  type CalendarEventDraft,
} from "@/features/agent/googleApi";
import { openExternalUrl } from "@/features/backend/api";
import { CalendarEventDraftDialog } from "./CalendarEventDraftDialog";
import "./GoogleWorkspacePanel.css";

type GoogleWorkspacePanelProps = {
  service: "drive" | "calendar";
  settings: GoogleSettings;
  onOpenConnections: () => void;
};
type DriveDocument = Awaited<ReturnType<typeof readGoogleDriveFile>>;

function localDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}
function eventTime(event: GoogleCalendarEvent) {
  if (event.start.date)
    return event.start.date + " ~ " + (event.end.date ?? "미정") + " (종료일 제외)";
  const display = (value?: string) => (value ? new Date(value).toLocaleString("ko-KR") : "미정");
  return display(event.start.dateTime) + " ~ " + display(event.end.dateTime);
}

function DriveWorkspace() {
  const [query, setQuery] = useState("");
  const [searchedQuery, setSearchedQuery] = useState("");
  const [files, setFiles] = useState<GoogleDriveFile[]>([]);
  const [document, setDocument] = useState<DriveDocument | null>(null);
  const [pageToken, setPageToken] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [incomplete, setIncomplete] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const perform = async (operation: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const search = (nextPage = false) =>
    void perform(async () => {
      const activeQuery = nextPage ? searchedQuery : query.trim();
      const result = await listGoogleDriveFiles({
        query: activeQuery,
        ...(nextPage && pageToken ? { pageToken } : {}),
      });
      if (!alive.current) return;
      setFiles((previous) => (nextPage ? [...previous, ...result.files] : result.files));
      setPageToken(result.nextPageToken);
      setIncomplete(result.incompleteSearch);
      setSearched(true);
      setSearchedQuery(activeQuery);
      if (!nextPage) setDocument(null);
    });
  const read = (fileId: string) =>
    void perform(async () => {
      const result = await readGoogleDriveFile(fileId);
      if (alive.current) setDocument(result);
    });
  return (
    <div className="google-workspace">
      <p className="google-workspace-help">
        파일명으로 검색하거나 비워 두고 최근 파일을 확인하세요. Google 문서와 지원하는 텍스트 파일을
        읽을 수 있어요. 지원하지 않는 형식은 원문에서 열어 주세요.
      </p>
      <form
        className="google-search-form"
        onSubmit={(event: FormEvent) => {
          event.preventDefault();
          search();
        }}
      >
        <label>
          <span>Drive 파일 검색</span>
          <input
            value={query}
            maxLength={500}
            placeholder="예: 프로젝트 기획안"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <button type="submit" disabled={busy}>
          {busy ? "조회 중…" : "파일 찾기"}
        </button>
      </form>
      {error && (
        <p className="google-workspace-error" role="alert">
          {error}
        </p>
      )}
      {incomplete && (
        <p className="google-workspace-help">
          일부 위치의 결과가 생략되었을 수 있어요. 파일 이름을 더 구체적으로 검색해 주세요.
        </p>
      )}
      {searched && !busy && files.length === 0 && <p>검색한 파일이 없어요.</p>}
      <ul className="google-result-list">
        {files.map((file) => (
          <li key={file.id}>
            <div>
              <strong>{file.name}</strong>
              <small>
                {file.mimeType}
                {file.modifiedTime
                  ? " · " + new Date(file.modifiedTime).toLocaleString("ko-KR")
                  : ""}
              </small>
            </div>
            <div className="google-workspace-actions">
              <button type="button" disabled={busy} onClick={() => read(file.id)}>
                내용 읽기
              </button>
              {file.webViewLink && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void perform(() => openExternalUrl(file.webViewLink))}
                >
                  Drive에서 열기
                </button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {pageToken && (
        <button type="button" disabled={busy} onClick={() => search(true)}>
          파일 더 불러오기
        </button>
      )}
      {document && (
        <section className="google-document-preview" aria-label="Drive 문서 내용">
          <div className="google-workspace-heading">
            <h3>{document.name}</h3>
            <button type="button" onClick={() => setDocument(null)}>
              내용 닫기
            </button>
          </div>
          {document.truncated && (
            <p className="google-workspace-help">
              긴 문서의 일부만 표시했어요. 전체 내용은 원문에서 확인하세요.
            </p>
          )}
          <pre>{document.content || "텍스트 내용이 없습니다."}</pre>
          <button type="button" onClick={() => void perform(() => openExternalUrl(document.url))}>
            문서 원문 열기
          </button>
        </section>
      )}
    </div>
  );
}

function CalendarWorkspace({ accountEmail }: { accountEmail: string }) {
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [calendarPage, setCalendarPage] = useState<string | null>(null);
  const [calendarId, setCalendarId] = useState("primary");
  const [from, setFrom] = useState(() => localDate(new Date()));
  const [through, setThrough] = useState(() => localDate(new Date(Date.now() + 7 * 86400000)));
  const [events, setEvents] = useState<GoogleCalendarEvent[]>([]);
  const [eventPage, setEventPage] = useState<string | null>(null);
  const [lastQuery, setLastQuery] = useState<{
    calendarId: string;
    timeMin: string;
    timeMax: string;
  } | null>(null);
  const [draft, setDraft] = useState<CalendarEventDraft | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(true);
  const pending = useRef(false);
  useEffect(() => {
    alive.current = true;
    void listGoogleCalendars()
      .then((result) => {
        if (alive.current) {
          setCalendars(result.calendars);
          setCalendarPage(result.nextPageToken);
        }
      })
      .catch((cause) => {
        if (alive.current) setError(String(cause));
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
    };
  }, []);
  const perform = async (operation: () => Promise<void>) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      await operation();
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      pending.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const loadEvents = (nextPage = false) =>
    void perform(async () => {
      const start = new Date(from + "T00:00:00");
      const end = new Date(through + "T00:00:00");
      end.setDate(end.getDate() + 1);
      if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()) || end <= start)
        throw new Error("조회 시작일과 종료일을 확인해 주세요.");
      const query =
        nextPage && lastQuery
          ? lastQuery
          : { calendarId, timeMin: start.toISOString(), timeMax: end.toISOString() };
      const result = await listGoogleCalendarEvents({
        ...query,
        ...(nextPage && eventPage ? { pageToken: eventPage } : {}),
      });
      if (!alive.current) return;
      setEvents((previous) => (nextPage ? [...previous, ...result.events] : result.events));
      setEventPage(result.nextPageToken);
      setLastQuery(query);
    });
  const moreCalendars = () =>
    void perform(async () => {
      if (!calendarPage) return;
      const result = await listGoogleCalendars(calendarPage);
      if (alive.current) {
        setCalendars((previous) => [...previous, ...result.calendars]);
        setCalendarPage(result.nextPageToken);
      }
    });
  useEffect(() => {
    let active = true;
    const refresh = () => {
      if (!lastQuery || pending.current) return;
      pending.current = true;
      setBusy(true);
      void listGoogleCalendarEvents(lastQuery)
        .then((result) => {
          if (!active || !alive.current) return;
          setEvents(result.events);
          setEventPage(result.nextPageToken);
        })
        .catch((cause) => {
          if (active && alive.current) setError(String(cause));
        })
        .finally(() => {
          pending.current = false;
          if (alive.current) setBusy(false);
        });
    };
    window.addEventListener("google-calendar-updated", refresh);
    return () => {
      active = false;
      window.removeEventListener("google-calendar-updated", refresh);
    };
  }, [lastQuery]);

  const newDraft = () => {
    const start = new Date(Date.now() + 3600000);
    start.setMinutes(0, 0, 0);
    setDraft({
      calendarId,
      expectedAccountEmail: accountEmail,
      draftId: crypto.randomUUID(),
      title: "",
      start: {
        dateTime: start.toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
      end: {
        dateTime: new Date(start.getTime() + 3600000).toISOString(),
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });
  };
  return (
    <div className="google-workspace">
      <p className="google-workspace-help">
        조회 결과의 시각은 이 기기의 시간대({Intl.DateTimeFormat().resolvedOptions().timeZone})로
        표시해요. 에이전트에게 “이번 주 일정 알려 줘”라고 요청할 수도 있어요.
      </p>
      {loading && <p role="status">캘린더 목록을 불러오고 있어요.</p>}
      {error && (
        <p className="google-workspace-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="google-workspace-notice" role="status">
          {notice}
        </p>
      )}
      <form
        className="google-workspace-form"
        onSubmit={(event) => {
          event.preventDefault();
          loadEvents();
        }}
      >
        <fieldset disabled={loading || busy}>
          <label>
            <span>조회할 캘린더</span>
            <select
              value={calendarId}
              onChange={(event) => {
                setCalendarId(event.target.value);
                setEventPage(null);
                setLastQuery(null);
                setEvents([]);
              }}
            >
              <option value="primary">기본 캘린더</option>
              {calendars.map((calendar) => (
                <option key={calendar.id} value={calendar.id}>
                  {calendar.summary}
                  {calendar.primary ? " (기본)" : ""}
                </option>
              ))}
            </select>
          </label>
          {calendarPage && (
            <button type="button" onClick={moreCalendars}>
              캘린더 더 불러오기
            </button>
          )}
          <div className="google-workspace-columns">
            <label>
              <span>조회 시작일</span>
              <input
                type="date"
                required
                value={from}
                onChange={(event) => setFrom(event.target.value)}
              />
            </label>
            <label>
              <span>조회 종료일 (포함)</span>
              <input
                type="date"
                required
                value={through}
                min={from}
                onChange={(event) => setThrough(event.target.value)}
              />
            </label>
          </div>
          <div className="google-workspace-actions">
            <button type="submit">일정 조회</button>
            <button type="button" onClick={newDraft}>
              일정 초안 작성
            </button>
          </div>
        </fieldset>
      </form>
      {lastQuery && !busy && events.length === 0 && <p>이 기간에 일정이 없어요.</p>}
      <ul className="google-result-list">
        {events.map((event) => (
          <li key={event.id}>
            <div>
              <strong>
                {event.title || "제목 없는 일정"}
                {event.status === "cancelled" ? " (취소됨)" : ""}
              </strong>
              <p>{eventTime(event)}</p>
              {event.location && <small>{event.location}</small>}
              {event.description && <p className="google-event-description">{event.description}</p>}
            </div>
            {event.url && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void perform(() => openExternalUrl(event.url))}
              >
                Calendar에서 보기
              </button>
            )}
          </li>
        ))}
      </ul>
      {eventPage && (
        <button type="button" disabled={busy} onClick={() => loadEvents(true)}>
          일정 더 불러오기
        </button>
      )}
      <CalendarEventDraftDialog
        draft={draft}
        onClose={() => setDraft(null)}
        onCreated={(event) => {
          setNotice("일정을 등록했어요: " + event.title);
          window.dispatchEvent(new Event("google-calendar-updated"));
        }}
      />
    </div>
  );
}

export function GoogleWorkspacePanel({
  service,
  settings,
  onOpenConnections,
}: GoogleWorkspacePanelProps) {
  const connection = settings.services.find((item) => item.service === service);
  if (!connection?.connected || !connection.email)
    return (
      <div className="google-workspace">
        <p>{service === "drive" ? "Google Drive" : "Google Calendar"} 연결이 필요해요.</p>
        <p className="google-workspace-help">
          연결 설정에서 사용할 서비스에 필요한 권한을 허용해 주세요. Gmail 연결과 별도로 연결합니다.
        </p>
        <button type="button" onClick={onOpenConnections}>
          Google 연결 설정 열기
        </button>
      </div>
    );
  return (
    <section
      className="google-workspace"
      aria-label={service === "drive" ? "Google Drive 파일" : "Google Calendar 일정"}
    >
      <p className="google-workspace-account">연결 계정 · {connection.email}</p>
      {service === "drive" ? (
        <DriveWorkspace />
      ) : (
        <CalendarWorkspace accountEmail={connection.email} />
      )}
    </section>
  );
}
