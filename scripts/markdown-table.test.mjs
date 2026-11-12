import assert from "node:assert/strict";
import test from "node:test";
import { parseMarkdownTable } from "../src/components/markdownTable.ts";

test("일정 표의 헤더·정렬·한국어 내용과 원문 링크를 보존한다", () => {
  const result = parseMarkdownTable(
    [
      "| 날짜 | 일정 | 원문 |",
      "| :--- | :---: | ---: |",
      "| 2026-11-13 10:00 | **팀 회의** | [메일](https://mail.google.com/example) |",
      "",
      "후속 설명",
    ],
    0
  );
  assert.deepEqual(result, {
    headers: ["날짜", "일정", "원문"],
    alignments: ["left", "center", "right"],
    rows: [["2026-11-13 10:00", "**팀 회의**", "[메일](https://mail.google.com/example)"]],
    nextIndex: 3,
  });
});

test("바깥 파이프 없는 표와 이스케이프한 파이프를 지원한다", () => {
  const result = parseMarkdownTable(
    ["항목 | 값", "--- | ---", "팀 \\| 담당 | 내용", "다음 문단"],
    0
  );
  assert.deepEqual(result.rows, [["팀 | 담당", "내용"]]);
  assert.equal(result.nextIndex, 3);
});

test("누락된 셀은 비워 두고 초과 셀은 헤더 개수에 맞춘다", () => {
  const result = parseMarkdownTable(
    ["| 날짜 | 장소 |", "| --- | --- |", "| 13일 |", "| 14일 | 서울 | 추가 |"],
    0
  );
  assert.deepEqual(result.rows, [
    ["13일", ""],
    ["14일", "서울"],
  ]);
});

test("구분 행 없는 문장과 열 수가 다른 구분 행은 표로 오인하지 않는다", () => {
  assert.equal(parseMarkdownTable(["A | B", "일반 문장"], 0), null);
  assert.equal(parseMarkdownTable(["A | B", "---"], 0), null);
  assert.equal(parseMarkdownTable(["A | B", "-- | ---"], 0), null);
  assert.equal(parseMarkdownTable(["| A |", "| --- |"], 2), null);
});
