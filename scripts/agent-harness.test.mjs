import assert from "node:assert/strict";
import test from "node:test";
import { parseManagementPlan, appendMemoryNote } from "../src/features/agent/management.ts";
import { prepareEmailDigest } from "../src/features/agent/digest.ts";

const request = "내 이메일을 30분마다 요약해 줘";
const plan = {
  memoryNote: null,
  routine: { action: "save", instruction: request, intervalMinutes: 30, sourceQuote: request },
};
test("관리 동작은 현재 요청의 근거와 유효한 간격이 있어야 한다", () => {
  assert.equal(parseManagementPlan(JSON.stringify(plan), request).routine.intervalMinutes, 30);
  for (const routine of [
    { ...plan.routine, action: "shell" },
    { ...plan.routine, intervalMinutes: 0 },
    { ...plan.routine, intervalMinutes: 5.5 },
    { ...plan.routine, sourceQuote: "다른 대화" },
  ]) {
    assert.throws(() => parseManagementPlan(JSON.stringify({ ...plan, routine }), request));
  }
  assert.throws(() => parseManagementPlan("saved", request));
});
test("기억은 중복·비밀값·용량 초과를 방지하고 기존 내용을 보존한다", () => {
  assert.equal(
    appendMemoryNote("- 기존 기억", "새 기억", "2026-11-12"),
    "- 기존 기억\n- 2026-11-12: 새 기억"
  );
  assert.equal(appendMemoryNote("새 기억", "새 기억", "today"), "새 기억");
  assert.throws(() => appendMemoryNote("한".repeat(8000), "더 기억", "today"));
  assert.equal(
    parseManagementPlan(JSON.stringify({ memoryNote: "password=secret123", routine: null }), "")
      .memoryNote,
    null
  );
});
const message = (id, receivedAt = 1500) => ({
  id,
  receivedAt,
  threadId: id,
  from: "sender",
  subject: "회의",
  body: "내일",
  url: "https://mail.google.com/mail/u/0/#inbox/" + id,
  truncated: false,
});
const page = (input, messages, nextPageToken = null, accountEmail = "user@example.test") => ({
  ...input,
  messages,
  nextPageToken,
  accountEmail,
});
test("첫 실행은 업무 생성 전 메일을 포함하지 않고 모든 페이지 성공 후 체크포인트를 반환한다", async () => {
  const calls = [];
  const result = await prepareEmailDigest({ checkpoint: 1000, mailboxEmail: null }, 3000, {
    fetchPage: async (input) => {
      calls.push(input);
      return input.pageToken
        ? page(input, [message("b", 2000)])
        : page(input, [message("a"), message("old", 900)], "next");
    },
    getSeenIds: async () => [],
    summarize: async (messages) => messages.map((m) => m.id).join(","),
  });
  assert.deepEqual(calls, [
    { since: 1000, until: 3000, pageToken: undefined },
    { since: 1000, until: 3000, pageToken: "next" },
  ]);
  assert.deepEqual(result.messageIds, ["a", "b"]);
  assert.equal(result.checkpoint, 3000);
  assert.match(result.report, /a,b/);
});
test("겹치는 조회 기간과 페이지의 중복 메일은 한 번만 요약한다", async () => {
  let summaries = 0;
  const result = await prepareEmailDigest(
    { checkpoint: 121000, mailboxEmail: "user@example.test" },
    130000,
    {
      fetchPage: async (input) => {
        assert.equal(input.since, 1000);
        return page(input, [
          message("seen", 120000),
          message("new", 125000),
          message("new", 125000),
        ]);
      },
      getSeenIds: async () => ["seen"],
      summarize: async (messages) => {
        summaries++;
        assert.deepEqual(
          messages.map((m) => m.id),
          ["new"]
        );
        return "회의 1건";
      },
    }
  );
  assert.equal(summaries, 1);
  assert.equal(result.hasNewMessages, true);
});
test("계정 변경·페이지 실패·요약 실패에는 완료 체크포인트를 만들지 않는다", async () => {
  const base = {
    fetchPage: async (input) => page(input, [message("a")]),
    getSeenIds: async () => [],
    summarize: async () => "요약",
  };
  await assert.rejects(
    prepareEmailDigest({ checkpoint: 1000, mailboxEmail: "other@example.test" }, 3000, base),
    /계정/
  );
  await assert.rejects(
    prepareEmailDigest({ checkpoint: 1000, mailboxEmail: null }, 3000, {
      ...base,
      fetchPage: async () => {
        throw Error("offline");
      },
    }),
    /offline/
  );
  await assert.rejects(
    prepareEmailDigest({ checkpoint: 1000, mailboxEmail: null }, 3000, {
      ...base,
      summarize: async () => "",
    }),
    /비어/
  );
  await assert.rejects(
    prepareEmailDigest({ checkpoint: 1000, mailboxEmail: null }, 3000, {
      ...base,
      fetchPage: async (input) => page(input, [], "same"),
    }),
    /반복/
  );
});
test("새 메일이 없으면 모델을 호출하지 않는다", async () => {
  const result = await prepareEmailDigest({ checkpoint: 1000, mailboxEmail: null }, 3000, {
    fetchPage: async (input) => page(input, []),
    getSeenIds: async () => [],
    summarize: async () => {
      throw Error("should not run");
    },
  });
  assert.equal(result.hasNewMessages, false);
  assert.equal(result.checkpoint, 3000);
});
test("밀린 메일이 많으면 조회 기간을 줄여 성공한 부분부터 진행한다", async () => {
  const result = await prepareEmailDigest({ checkpoint: 1000, mailboxEmail: null }, 10000, {
    fetchPage: async (input) =>
      page(input, [], input.until > 5500 ? String(Number(input.pageToken || 0) + 1) : null),
    getSeenIds: async () => [],
    summarize: async () => "unused",
  });
  assert.equal(result.checkpoint, 5500);
});
