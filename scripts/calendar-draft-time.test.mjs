import assert from "node:assert/strict";
import test from "node:test";
import {
  calendarDateTimeToLocalInput,
  calendarLocalInputToIso,
  calendarTimedToAllDay,
  calendarAllDayToTimed,
} from "../src/features/agent/calendarDraftTime.ts";

// 날짜 변환 검증은 DST가 있는 고정 시간대에서 수행합니다.
process.env.TZ = "America/New_York";

test("다른 시간대의 초안을 기기 시간대로 표시하고 같은 시점으로 저장한다", () => {
  const source = "2026-11-12T14:00:00+09:00";
  assert.equal(calendarDateTimeToLocalInput(source), "2026-11-12T00:00");
  assert.equal(calendarLocalInputToIso("2026-11-12T00:00", source), "2026-11-12T05:00:00.000Z");
  assert.equal(calendarLocalInputToIso("2026-11-12T09:00"), "2026-11-12T14:00:00.000Z");
});
test("존재하지 않는 DST 시각이나 잘못된 날짜는 임의로 보정하지 않는다", () => {
  assert.throws(() => calendarLocalInputToIso("2026-03-08T02:30"), /존재하지/);
  assert.throws(() => calendarLocalInputToIso("2026-02-30T09:00"));
  assert.throws(() => calendarLocalInputToIso("2026-11-12T24:00"));
  assert.throws(() => calendarLocalInputToIso(""));
});
test("편집하지 않은 DST 중복 시각과 초 단위의 원래 시점을 유지한다", () => {
  const source = "2026-11-01T01:30:42-05:00";
  assert.equal(calendarDateTimeToLocalInput(source), "2026-11-01T01:30");
  assert.equal(calendarLocalInputToIso("2026-11-01T01:30", source), "2026-11-01T06:30:42.000Z");
});
test("종일 전환은 종료일 제외 규칙을 유지하고 시각 전환 시 기본 시간을 제공한다", () => {
  assert.deepEqual(calendarTimedToAllDay("2026-11-12T14:00", "2026-11-12T15:00"), {
    start: "2026-11-12",
    end: "2026-11-13",
  });
  assert.deepEqual(calendarTimedToAllDay("2026-11-12T23:00", "2026-11-13T00:00"), {
    start: "2026-11-12",
    end: "2026-11-13",
  });
  assert.deepEqual(calendarTimedToAllDay("2026-12-31T23:00", "2027-01-01T01:00"), {
    start: "2026-12-31",
    end: "2027-01-02",
  });
  assert.deepEqual(calendarAllDayToTimed("2026-11-12", "2026-11-13"), {
    start: "2026-11-12T09:00",
    end: "2026-11-12T10:00",
  });
  assert.deepEqual(calendarAllDayToTimed("2026-11-12", "2026-11-14"), {
    start: "2026-11-12T09:00",
    end: "2026-11-13T10:00",
  });
});
