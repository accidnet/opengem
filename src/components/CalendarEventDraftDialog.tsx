import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  createGoogleCalendarEvent,
  getGoogleSettings,
  listGoogleCalendars,
  type CalendarEventDraft,
  type GoogleCalendar,
  type GoogleCalendarEvent,
} from "@/features/agent/googleApi";
import {
  calendarDateTimeToLocalInput,
  calendarLocalInputToIso,
  calendarTimedToAllDay,
  calendarAllDayToTimed,
} from "@/features/agent/calendarDraftTime";
import { openExternalUrl } from "@/features/backend/api";
import "./GoogleWorkspacePanel.css";

type CalendarEventDraftDialogProps = {
  draft: CalendarEventDraft | null;
  onClose: () => void;
  onCreated: (event: GoogleCalendarEvent) => void;
};

function CalendarEventDraftContent({
  draft,
  onClose,
  onCreated,
}: CalendarEventDraftDialogProps & { draft: CalendarEventDraft }) {
  const [calendarId, setCalendarId] = useState(draft.calendarId || "primary");
  const [draftId, setDraftId] = useState(draft.draftId);
  const [title, setTitle] = useState(draft.title);
  const [description, setDescription] = useState(draft.description ?? "");
  const [location, setLocation] = useState(draft.location ?? "");
  const [allDay, setAllDay] = useState(Boolean(draft.start.date));
  const [start, setStart] = useState(
    draft.start.date ?? calendarDateTimeToLocalInput(draft.start.dateTime)
  );
  const [end, setEnd] = useState(
    draft.end.date ?? calendarDateTimeToLocalInput(draft.end.dateTime)
  );
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [calendars, setCalendars] = useState<GoogleCalendar[]>([]);
  const [pageToken, setPageToken] = useState<string | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState<GoogleCalendarEvent | null>(null);
  const alive = useRef(true);
  const submitting = useRef(false);

  useEffect(() => {
    alive.current = true;
    let cancelled = false;
    setLoading(true);
    setAccount(null);
    void Promise.all([getGoogleSettings(), listGoogleCalendars()])
      .then(([settings, result]) => {
        if (cancelled) return;
        const connection = settings.services.find((service) => service.service === "calendar");
        if (!connection?.connected || !connection.email)
          throw new Error(
            "Calendar 연결이 필요합니다. 전체 Google 연동에서 Calendar를 연결해 주세요."
          );
        if (connection.email !== draft.expectedAccountEmail)
          throw new Error(
            "Calendar 계정이 초안 작성 때와 다릅니다. 현재 계정을 확인한 뒤 새 초안을 작성해 주세요."
          );
        setAccount(draft.expectedAccountEmail);
        setCalendars(result.calendars);
        setPageToken(result.nextPageToken);
      })
      .catch((cause) => {
        if (!cancelled) setError(String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
      alive.current = false;
    };
  }, [draft.expectedAccountEmail]);

  // 같은 초안의 재시도는 ID를 유지하고, 사용자가 내용을 바꾸면 새 초안으로 구분합니다.
  const changed = () => {
    setDraftId(crypto.randomUUID());
    setError("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (submitting.current || !account || created) return;
    submitting.current = true;
    setBusy(true);
    setError("");
    try {
      if (!title.trim()) throw new Error("일정 제목을 입력해 주세요.");
      if (allDay) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || end <= start)
          throw new Error(
            "종일 일정의 종료일은 시작일 다음 날 이후여야 해요. 종료일은 일정에 포함되지 않아요."
          );
      } else {
        const startTime = calendarLocalInputToIso(start, draft.start.dateTime);
        const endTime = calendarLocalInputToIso(end, draft.end.dateTime);
        if (Date.parse(endTime) <= Date.parse(startTime))
          throw new Error("종료 시각은 시작 시각보다 늦어야 해요.");
      }
      const settings = await getGoogleSettings();
      const connection = settings.services.find((service) => service.service === "calendar");
      if (!connection?.connected || connection.email !== account)
        throw new Error(
          "Calendar 계정이 변경되었습니다. 초안을 닫고 현재 계정에서 다시 확인해 주세요."
        );
      const input: CalendarEventDraft = {
        calendarId,
        expectedAccountEmail: account,
        draftId,
        title: title.trim(),
        description: description.trim(),
        location: location.trim(),
        start: allDay
          ? { date: start }
          : { dateTime: calendarLocalInputToIso(start, draft.start.dateTime), timeZone },
        end: allDay
          ? { date: end }
          : { dateTime: calendarLocalInputToIso(end, draft.end.dateTime), timeZone },
      };
      const result = await createGoogleCalendarEvent(input);
      if (!alive.current) return;
      setCreated(result);
      onCreated(result);
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      submitting.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const loadMore = async () => {
    if (!pageToken || busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await listGoogleCalendars(pageToken);
      if (alive.current) {
        setCalendars((previous) => [...previous, ...result.calendars]);
        setPageToken(result.nextPageToken);
      }
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  return (
    <div className="google-workspace">
      {loading && <p role="status">등록할 Calendar 계정을 확인하고 있어요.</p>}
      {account && (
        <p className="google-workspace-help">
          등록 계정: <strong>{account}</strong>
        </p>
      )}
      <p className="google-workspace-help">
        제목, 날짜, 시간대와 대상 캘린더를 확인한 뒤 등록하세요. 참석자를 초대하거나 이메일 알림을
        보내지 않아요.
      </p>
      {error && (
        <p className="google-workspace-error" role="alert">
          {error}
        </p>
      )}
      {!created && (
        <p className="google-workspace-help">
          아직 등록하지 않은 초안이에요. 아래 등록 버튼을 누르기 전에는 Calendar를 변경하지 않아요.
        </p>
      )}
      {created ? (
        <div className="google-workspace-notice" role="status">
          <strong>일정을 등록했어요.</strong>
          <p>{created.title}</p>
          <div className="google-workspace-actions">
            {created.url && (
              <button
                type="button"
                onClick={() =>
                  void openExternalUrl(created.url).catch((cause) => setError(String(cause)))
                }
              >
                Google Calendar에서 보기
              </button>
            )}
            <button type="button" onClick={onClose}>
              완료
            </button>
          </div>
        </div>
      ) : (
        <form className="google-workspace-form" onSubmit={(event) => void submit(event)}>
          <fieldset disabled={loading || busy || !account}>
            <label>
              <span>등록할 캘린더</span>
              <select
                value={calendarId}
                onChange={(event) => {
                  setCalendarId(event.target.value);
                  changed();
                }}
              >
                <option value="primary">기본 캘린더</option>
                {calendars.map((calendar) => (
                  <option
                    key={calendar.id}
                    value={calendar.id}
                    disabled={
                      !["owner", "writer", "writerWithoutPrivateAccess"].includes(
                        calendar.accessRole
                      )
                    }
                  >
                    {calendar.summary}
                    {!["owner", "writer", "writerWithoutPrivateAccess"].includes(
                      calendar.accessRole
                    )
                      ? " (읽기 전용)"
                      : ""}
                  </option>
                ))}
              </select>
            </label>
            {pageToken && (
              <button type="button" onClick={() => void loadMore()}>
                캘린더 더 불러오기
              </button>
            )}
            <label>
              <span>제목</span>
              <input
                required
                value={title}
                maxLength={500}
                onChange={(event) => {
                  setTitle(event.target.value);
                  changed();
                }}
              />
            </label>
            <label className="google-checkbox">
              <input
                type="checkbox"
                checked={allDay}
                onChange={(event) => {
                  const next = event.target.checked;
                  const converted = next
                    ? calendarTimedToAllDay(start, end)
                    : calendarAllDayToTimed(start, end);
                  setAllDay(next);
                  setStart(converted.start);
                  setEnd(converted.end);
                  changed();
                }}
              />
              <span>종일 일정</span>
            </label>
            <div className="google-workspace-columns">
              <label>
                <span>시작 {allDay ? "날짜" : "시각"}</span>
                <input
                  type={allDay ? "date" : "datetime-local"}
                  required
                  value={start}
                  onChange={(event) => {
                    setStart(event.target.value);
                    changed();
                  }}
                />
              </label>
              <label>
                <span>종료 {allDay ? "날짜 (포함하지 않음)" : "시각"}</span>
                <input
                  type={allDay ? "date" : "datetime-local"}
                  required
                  value={end}
                  onChange={(event) => {
                    setEnd(event.target.value);
                    changed();
                  }}
                />
              </label>
            </div>
            {allDay ? (
              <p className="google-workspace-help">
                예: 11월 12일 하루 일정은 시작 11월 12일, 종료 11월 13일로 입력해요.
              </p>
            ) : (
              <p className="google-workspace-help">
                이 기기의 시간대({timeZone})로 표시하고 등록해요. 다른 시간대로 작성된 초안도 같은
                시점으로 변환해요.
              </p>
            )}
            <label>
              <span>장소 (선택)</span>
              <input
                value={location}
                maxLength={1000}
                onChange={(event) => {
                  setLocation(event.target.value);
                  changed();
                }}
              />
            </label>
            <label>
              <span>설명·근거 (선택)</span>
              <textarea
                rows={4}
                value={description}
                maxLength={8000}
                onChange={(event) => {
                  setDescription(event.target.value);
                  changed();
                }}
              />
            </label>
            <button type="submit" className="is-primary" disabled={!title.trim() || !start || !end}>
              {busy ? "등록 중…" : "검토한 일정 등록"}
            </button>
          </fieldset>
        </form>
      )}
    </div>
  );
}

export function CalendarEventDraftDialog({
  draft,
  onClose,
  onCreated,
}: CalendarEventDraftDialogProps) {
  return (
    <Dialog
      open={Boolean(draft)}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="google-event-draft-dialog">
        <DialogHeader>
          <DialogTitle>Calendar 일정 등록 검토</DialogTitle>
          <DialogDescription>
            제목, 날짜와 대상 캘린더를 확인하고 직접 등록할 수 있습니다.
          </DialogDescription>
        </DialogHeader>
        {draft && (
          <CalendarEventDraftContent
            key={draft.draftId}
            draft={draft}
            onClose={onClose}
            onCreated={onCreated}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
