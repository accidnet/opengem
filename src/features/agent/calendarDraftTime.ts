// 화면의 시각은 기기 시간대로 표시하고, 저장 직전에 절대 시각으로 변환합니다.
export function calendarDateTimeToLocalInput(value: string | undefined): string {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return (
    String(date.getFullYear()).padStart(4, "0") +
    "-" +
    pad(date.getMonth() + 1) +
    "-" +
    pad(date.getDate()) +
    "T" +
    pad(date.getHours()) +
    ":" +
    pad(date.getMinutes())
  );
}

export function calendarLocalInputToIso(value: string, original?: string): string {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value))
    throw new Error("날짜와 시각을 모두 입력해 주세요.");
  const date = new Date(value);
  if (
    !Number.isFinite(date.getTime()) ||
    calendarDateTimeToLocalInput(date.toISOString()) !== value
  )
    throw new Error("이 시간대에 존재하지 않는 시각이에요. 날짜와 시각을 다시 선택해 주세요.");
  // DST가 끝나는 날의 중복 시각이나 초 단위가 있는 초안은 편집하지 않으면 원래 시각을 유지합니다.
  if (original && calendarDateTimeToLocalInput(original) === value)
    return new Date(original).toISOString();
  return date.toISOString();
}

function offsetDate(value: string, days: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const date = new Date(value + "T00:00:00Z");
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) return "";
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function calendarTimedToAllDay(start: string, end: string): { start: string; end: string } {
  const startDate = offsetDate(start.slice(0, 10), 0);
  const endDate = offsetDate(end.slice(0, 10), end.slice(11) === "00:00" ? 0 : 1);
  return {
    start: startDate,
    end: endDate && endDate > startDate ? endDate : offsetDate(startDate, 1),
  };
}

export function calendarAllDayToTimed(start: string, end: string): { start: string; end: string } {
  const startDate = offsetDate(start, 0);
  const lastDate = offsetDate(end, -1);
  const endDate = lastDate && lastDate >= startDate ? lastDate : startDate;
  return { start: startDate ? startDate + "T09:00" : "", end: endDate ? endDate + "T10:00" : "" };
}
