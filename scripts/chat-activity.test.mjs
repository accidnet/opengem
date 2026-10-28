import assert from "node:assert/strict";
import test from "node:test";
import { buildActivityFromMessages, finalizeAssistantMessage } from "../src/pages/chat/activity.ts";

const user = { id: "user", side: "user", type: "text", text: "파일 확인" };
const assistant = {
  id: "assistant",
  side: "agent",
  sender: "Assistant",
  type: "text",
  isStreaming: true,
  text: "분석 중인 첫 토큰",
};
const tool = {
  id: "tool",
  side: "agent",
  sender: "Assistant Tool",
  type: "search",
  text: "workspace_read_file",
  logs: ["파일 읽기 완료"],
};

test("첫 토큰이 text 메시지로 표시돼도 응답은 진행 중이다", () => {
  const activities = buildActivityFromMessages([user, assistant]);
  assert.equal(activities.length, 1);
  assert.equal(activities[0].state, "working");
  assert.equal(activities[0].text, assistant.text);
});

test("완료 응답은 앞서 실행한 도구 뒤에 표시되고 다시 읽어도 순서가 같다", () => {
  const completed = { ...assistant, text: "분석 완료", byline: "10:05" };
  const messages = finalizeAssistantMessage([user, assistant, tool], assistant.id, completed);
  const activities = buildActivityFromMessages(messages);
  assert.deepEqual(
    activities.map(({ id }) => id),
    ["activity-tool", "activity-assistant"]
  );
  assert.equal(activities[1].state, "done");
  assert.equal(activities[1].text, "Agent response completed.");
  assert.equal(activities[1].byline, "10:05");
  assert.deepEqual(buildActivityFromMessages(JSON.parse(JSON.stringify(messages))), activities);
});

test("도구와 요청 실패는 완료나 진행 중 상태와 구분된다", () => {
  const toolFailure = { ...tool, icon: "error", text: "workspace_read_file failed" };
  const requestFailure = { ...assistant, isStreaming: false, text: "Request failed: offline" };
  const messages = finalizeAssistantMessage(
    [user, assistant, toolFailure],
    assistant.id,
    requestFailure
  );
  assert.deepEqual(
    buildActivityFromMessages(messages).map(({ state }) => state),
    ["failed", "failed"]
  );
});

test("다른 채팅으로 바뀌어 대상 메시지가 없으면 완료 응답을 끼워 넣지 않는다", () => {
  const otherChat = [{ ...user, id: "other-user" }];
  assert.strictEqual(finalizeAssistantMessage(otherChat, assistant.id, assistant), otherChat);
});

test("이전 저장 메시지는 streaming 필드 없이도 완료로 표시한다", () => {
  const saved = { id: "saved", side: "agent", type: "text", text: "저장된 응답" };
  assert.equal(buildActivityFromMessages([saved])[0].state, "done");
  assert.deepEqual(buildActivityFromMessages([]), []);
});
