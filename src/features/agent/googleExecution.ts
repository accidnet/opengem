import type { CalendarEventDraft, GoogleServiceStatus } from "./googleApi";
import type { GoogleWorkspaceRequest } from "./googlePlan";

type Dependencies = Pick<
  typeof import("./googleApi"),
  | "listGoogleDriveFiles"
  | "readGoogleDriveFile"
  | "listGoogleCalendars"
  | "listGoogleCalendarEvents"
> & { newDraftId: () => string };

// 읽기 도구만 주입하므로 문서/일정 안의 지시가 캘린더 쓰기로 이어지지 않습니다.
export async function executeGoogleWorkspace(
  plan: GoogleWorkspaceRequest,
  services: GoogleServiceStatus[],
  deps: Dependencies
) {
  const outcomes: string[] = [];
  const data: Record<string, unknown> = {};
  let draft: CalendarEventDraft | null = null;
  const connected = (service: string) =>
    services.some((item) => item.service === service && item.connected);
  const errorText = (error: unknown) => {
    const text = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    return /^(Google|Drive|Calendar|이메일|캘린더|문서|파일|지원하지|연결)/.test(text)
      ? text.slice(0, 500)
      : "서비스 요청에 실패했습니다. Google 연동에서 연결과 권한을 확인해 주세요.";
  };
  if (plan.drive) {
    if (!connected("drive"))
      outcomes.push(
        "Google Drive가 연결되지 않았습니다. 사용자 메뉴 → Google 연동에서 Drive를 연결해 주세요."
      );
    else {
      try {
        const request = plan.drive;
        const files = request.fileId
          ? null
          : await deps.listGoogleDriveFiles({ query: request.query });
        if (files) data.driveFiles = files;
        const ids = request.readContent
          ? request.fileId
            ? [request.fileId]
            : (files?.files.slice(0, 3).map((file) => file.id) ?? [])
          : [];
        if (request.fileId && !request.readContent)
          data.driveFileReference = {
            id: request.fileId,
            url: "https://drive.google.com/file/d/" + request.fileId + "/view",
            contentRead: false,
          };
        const contents = [];
        for (const fileId of ids) {
          try {
            const file = await deps.readGoogleDriveFile(fileId);
            contents.push({
              ...file,
              content: file.content.slice(0, 12000),
              truncated: file.truncated || file.content.length > 12000,
            });
          } catch (error) {
            contents.push({ id: fileId, error: errorText(error) });
          }
        }
        if (ids.length) data.driveContents = contents;
        outcomes.push(
          "Drive 조회를 마쳤습니다. 반환된 검색 결과와 실제 읽은 문서만 근거로 답하세요. 검색은 첫 페이지, 본문 읽기는 최대 3개이며 잘리거나 읽기에 실패한 내용을 확인했다고 주장하지 마세요."
        );
      } catch (error) {
        outcomes.push("Drive 조회 실패: " + errorText(error));
      }
    }
  }
  if (plan.calendar || plan.calendarList || plan.calendarDraft) {
    if (!connected("calendar"))
      outcomes.push(
        "Google Calendar가 연결되지 않았습니다. 사용자 메뉴 → Google 연동에서 Calendar를 연결해 주세요. 일정은 아직 등록하지 않았습니다."
      );
    else {
      if (plan.calendarList) {
        try {
          data.calendars = await deps.listGoogleCalendars();
          outcomes.push(
            "캘린더 목록을 조회했습니다. 다음 페이지가 있으면 전체 목록이라고 표현하지 마세요."
          );
        } catch (error) {
          outcomes.push("캘린더 목록 조회 실패: " + errorText(error));
        }
      }
      if (plan.calendar) {
        try {
          data.calendarEvents = await deps.listGoogleCalendarEvents(plan.calendar);
          outcomes.push(
            "캘린더 일정 조회 결과입니다. 요청한 기간/캘린더만 대상으로 하며 다음 페이지가 있으면 일부 결과임을 표시하세요."
          );
        } catch (error) {
          outcomes.push("캘린더 조회 실패: " + errorText(error));
        }
      }
      if (plan.calendarDraft) {
        const email = services.find((item) => item.service === "calendar" && item.connected)?.email;
        if (!email) throw new Error("캘린더 연결 계정을 확인할 수 없습니다.");
        draft = { ...plan.calendarDraft, draftId: deps.newDraftId(), expectedAccountEmail: email };
        outcomes.push(
          "일정 초안을 검토 창에 준비했습니다. 사용자가 등록 버튼을 누르기 전에는 Google Calendar에 저장되지 않습니다. 일정 생성에 성공했다고 말하지 마세요."
        );
      }
    }
  }
  return {
    text: outcomes.join("\n"),
    data: Object.keys(data).length ? JSON.stringify(data) : "",
    draft,
  };
}
