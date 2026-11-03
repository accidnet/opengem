import assert from "node:assert/strict";
import test from "node:test";
import {
  conversationDraftKey,
  findAgentSession,
  resolveConversationAgent,
} from "../src/pages/chat/conversationTarget.ts";

const agents = [
  { agentId: "main", name: "팀장", role: "main", model: "model-a", prompt: "조율" },
  { agentId: "designer", name: "디자이너", role: "sub", model: "model-b", prompt: "디자인 검토" },
];

test("보조 에이전트 직접 대화는 선택한 대상의 모델과 프롬프트를 사용한다", () => {
  assert.equal(resolveConversationAgent(agents, null), agents[0]);
  assert.equal(resolveConversationAgent(agents, "designer"), agents[1]);
  assert.equal(resolveConversationAgent(agents, "designer").model, "model-b");
  assert.equal(resolveConversationAgent(agents, "designer").prompt, "디자인 검토");
});

test("이름 변경과 재정렬 뒤에도 같은 ID를 참조하며 삭제 대상은 메인으로 대체하지 않는다", () => {
  const renamed = [{ ...agents[1], name: "UX 디자이너" }, agents[0]];
  assert.equal(resolveConversationAgent(renamed, "designer"), renamed[0]);
  assert.equal(resolveConversationAgent([agents[0]], "designer"), null);
});

test("모드와 에이전트가 모두 일치하는 최신 대화만 재개한다", () => {
  const sessions = [
    { id: "general", modeName: "A", agentId: null, updatedAt: 50 },
    { id: "old", modeName: "A", agentId: "designer", updatedAt: 10 },
    { id: "other-agent", modeName: "A", agentId: "main", updatedAt: 90 },
    { id: "latest", modeName: "A", agentId: "designer", updatedAt: 20 },
    { id: "other-mode", modeName: "B", agentId: "designer", updatedAt: 100 },
  ];
  assert.equal(findAgentSession(sessions, "A", "designer").id, "latest");
  assert.equal(findAgentSession(sessions, "A", "missing"), undefined);
  assert.equal(sessions[0].id, "general");
});

test("미전송 초안은 모드와 대상별로 분리하고 기존 세션은 ID로 복원한다", () => {
  assert.notEqual(
    conversationDraftKey(null, "A", "main"),
    conversationDraftKey(null, "A", "designer")
  );
  assert.notEqual(conversationDraftKey(null, "A", "main"), conversationDraftKey(null, "B", "main"));
  assert.equal(
    conversationDraftKey("saved", "A", "main"),
    conversationDraftKey("saved", "renamed", "main")
  );
});
