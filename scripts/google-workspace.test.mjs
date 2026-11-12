import assert from "node:assert/strict";
import test from "node:test";
import { parseGoogleWorkspaceRequest } from "../src/features/agent/googlePlan.ts";
import { executeGoogleWorkspace } from "../src/features/agent/googleExecution.ts";
import { parseManagementPlan } from "../src/features/agent/management.ts";

const user = "내일 일정을 확인하고 드라이브에서 보고서를 찾아줘";
const times = { timeMin: "2026-11-13T00:00:00+09:00", timeMax: "2026-11-14T00:00:00+09:00" };
const draft = {
  calendarId: "primary",
  title: "회의",
  start: { dateTime: "2026-11-13T14:00:00+09:00" },
  end: { dateTime: "2026-11-13T15:00:00+09:00" },
};
const service = (name, connected = true, email = "owner@example.test") => ({
  service: name,
  connected,
  email,
  loginPending: false,
  lastError: null,
});
const file = (id) => ({
  id,
  name: id,
  mimeType: "text/plain",
  modifiedTime: null,
  webViewLink: "https://drive.google.com/file/d/" + id + "/view",
});
const calls = [];
const dependencies = () => ({
  newDraftId: () => "12345678-1234-4234-9234-123456789abc",
  listGoogleDriveFiles: async () => ({
    files: [file("one"), file("two"), file("three"), file("four")],
    nextPageToken: "more",
    incompleteSearch: false,
  }),
  readGoogleDriveFile: async (id) => {
    calls.push(id);
    return {
      id,
      name: id,
      mimeType: "text/plain",
      content: "본문",
      truncated: false,
      url: file(id).webViewLink,
    };
  },
  listGoogleCalendars: async () => ({
    calendars: [
      {
        id: "primary",
        summary: "나의 일정",
        timeZone: "Asia/Seoul",
        primary: true,
        accessRole: "owner",
      },
    ],
    nextPageToken: null,
  }),
  listGoogleCalendarEvents: async () => ({
    events: [],
    nextPageToken: null,
    timeZone: "Asia/Seoul",
  }),
});

test("Google 요청은 현재 사용자 근거와 허용된 읽기/초안 동작만 허용한다", () => {
  const result = parseGoogleWorkspaceRequest(
    { sourceQuote: user, drive: { query: "보고서", readContent: true }, calendar: times },
    user
  );
  assert.equal(result.calendar.calendarId, "primary");
  assert.throws(() =>
    parseGoogleWorkspaceRequest({ sourceQuote: "다른 대화", calendar: times }, user)
  );
  assert.throws(() => parseGoogleWorkspaceRequest({ sourceQuote: user, deleteFile: "id" }, user));
  assert.throws(() =>
    parseGoogleWorkspaceRequest(
      { sourceQuote: user, drive: { fileId: "foreign", query: "", readContent: true } },
      user
    )
  );
  assert.equal(
    parseManagementPlan(
      JSON.stringify({
        memoryNote: null,
        routine: null,
        google: { sourceQuote: user, calendar: times },
      }),
      user
    ).google.calendar.timeMin,
    times.timeMin
  );
});
test("시간대 없는 시간·잘못된 날짜·역전된 범위·참석자 초대는 거부한다", () => {
  const parse = (calendar) => parseGoogleWorkspaceRequest({ sourceQuote: user, calendar }, user);
  assert.throws(() => parse({ ...times, timeMin: "2026-11-13T00:00:00" }));
  assert.throws(() => parse({ ...times, timeMin: "2026-02-30T00:00:00Z" }));
  assert.throws(() => parse({ ...times, timeMax: times.timeMin }));
  assert.throws(() => parse({ ...times, timeMax: "2028-11-13T00:00:00Z" }));
  assert.throws(() =>
    parseGoogleWorkspaceRequest(
      { sourceQuote: user, calendarDraft: { ...draft, attendees: ["other@example.test"] } },
      user
    )
  );
  assert.throws(() =>
    parseGoogleWorkspaceRequest(
      { sourceQuote: user, calendarDraft: { ...draft, end: draft.start } },
      user
    )
  );
});
test("종일 일정은 종료일 제외 규칙으로 검증한다", () => {
  const result = parseGoogleWorkspaceRequest(
    {
      sourceQuote: user,
      calendarDraft: { ...draft, start: { date: "2026-11-13" }, end: { date: "2026-11-14" } },
    },
    user
  );
  assert.equal(result.calendarDraft.end.date, "2026-11-14");
  assert.throws(() =>
    parseGoogleWorkspaceRequest(
      { sourceQuote: user, calendarDraft: { ...draft, start: { date: "2026-11-13" } } },
      user
    )
  );
});
test("서비스가 연결되지 않으면 호출 없이 해당 서비스 설정을 안내한다", async () => {
  const deps = Object.fromEntries(
    Object.keys(dependencies()).map((key) => [
      key,
      async () => {
        throw Error("must not call");
      },
    ])
  );
  const result = await executeGoogleWorkspace(
    {
      sourceQuote: user,
      drive: { query: "", readContent: true },
      calendar: times,
      calendarDraft: draft,
    },
    [service("gmail")],
    deps
  );
  assert.match(result.text, /Drive가 연결되지/);
  assert.match(result.text, /Calendar가 연결되지/);
  assert.equal(result.data, "");
  assert.equal(result.draft, null);
});
test("문서는 최대3개만 읽으며 일부 결과와 잘림을 보존한다", async () => {
  calls.length = 0;
  const deps = dependencies();
  deps.readGoogleDriveFile = async (id) => {
    calls.push(id);
    return { ...file(id), content: "x".repeat(15000), truncated: false, url: file(id).webViewLink };
  };
  const result = await executeGoogleWorkspace(
    { sourceQuote: user, drive: { query: "보고서", readContent: true } },
    [service("drive")],
    deps
  );
  const data = JSON.parse(result.data);
  assert.deepEqual(calls, ["one", "two", "three"]);
  assert.equal(data.driveFiles.nextPageToken, "more");
  assert.equal(data.driveContents[0].content.length, 12000);
  assert.equal(data.driveContents[0].truncated, true);
});
test("검색만 요청하면 본문을 읽지 않고 일부 문서 오류는 성공 결과와 구분한다", async () => {
  calls.length = 0;
  await executeGoogleWorkspace(
    { sourceQuote: user, drive: { query: "", readContent: false } },
    [service("drive")],
    dependencies()
  );
  assert.equal(calls.length, 0);
  const deps = dependencies();
  deps.readGoogleDriveFile = async (id) => {
    if (id === "two") throw Error("파일 권한 오류");
    return { ...file(id), content: "text", truncated: false, url: "https://drive.google.com" };
  };
  const result = await executeGoogleWorkspace(
    { sourceQuote: user, drive: { query: "", readContent: true } },
    [service("drive")],
    deps
  );
  assert.match(JSON.parse(result.data).driveContents[1].error, /권한 오류/);
});
test("일정 초안은 계정과 UUID를 고정하며 쓰기 API를 호출하지 않는다", async () => {
  let writes = 0;
  const deps = {
    ...dependencies(),
    createGoogleCalendarEvent: () => {
      writes++;
    },
  };
  const result = await executeGoogleWorkspace(
    { sourceQuote: user, calendarList: true, calendar: times, calendarDraft: draft },
    [service("calendar")],
    deps
  );
  assert.equal(writes, 0);
  assert.equal(result.draft.expectedAccountEmail, "owner@example.test");
  assert.equal(result.draft.draftId, "12345678-1234-4234-9234-123456789abc");
  assert.match(result.text, /저장되지 않습니다/);
  assert.equal(JSON.parse(result.data).calendarEvents.events.length, 0);
});

test("백엔드와 같은 RFC3339 초/시각/최대기간을 강제한다", () => {
  for (const timeMin of ["2026-11-13T00:00Z", "2026-11-13T24:00:00Z"])
    assert.throws(() =>
      parseGoogleWorkspaceRequest({ sourceQuote: user, calendar: { ...times, timeMin } }, user)
    );
  assert.throws(() =>
    parseGoogleWorkspaceRequest(
      {
        sourceQuote: user,
        calendarDraft: { ...draft, end: { dateTime: "2028-11-13T15:00:00+09:00" } },
      },
      user
    )
  );
});
test("파일 ID만 있어도 읽기 요청 없이는 본문을 조회하지 않는다", async () => {
  calls.length = 0;
  const result = await executeGoogleWorkspace(
    { sourceQuote: user, drive: { query: "", fileId: "one", readContent: false } },
    [service("drive")],
    dependencies()
  );
  assert.equal(calls.length, 0);
  assert.equal(JSON.parse(result.data).driveFileReference.contentRead, false);
});
