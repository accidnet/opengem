import assert from "node:assert/strict";
import test from "node:test";
import { buildConversationMessages } from "../src/pages/chat/conversationHistory.ts";
import {
  conversationDraftKey,
  findLatestConversationSession,
  remapConversationDrafts,
  resolveConversationParticipants,
} from "../src/pages/chat/conversationTarget.ts";

const agents = [
  { agentId: "main", name: "팀장", role: "main", active: true, model: "model-a", prompt: "조율" },
  {
    agentId: "designer",
    name: "디자이너",
    role: "sub",
    active: true,
    model: "model-b",
    prompt: "디자인 검토",
  },
];

test("전체 대화에서는 역할에 관계없이 활성 에이전트가 설정 순서로 참여한다", () => {
  const offline = { agentId: "offline", active: false, role: "main" };
  assert.deepEqual(resolveConversationParticipants([agents[1], offline, agents[0]], null), [
    agents[1],
    agents[0],
  ]);
  assert.deepEqual(resolveConversationParticipants([offline], null), []);
  assert.deepEqual(resolveConversationParticipants([{ active: true }], null), []);
  assert.deepEqual(resolveConversationParticipants([offline], "offline"), []);
});

test("보조 에이전트 직접 대화는 선택한 대상의 모델과 프롬프트를 사용한다", () => {
  assert.deepEqual(resolveConversationParticipants(agents, "designer"), [agents[1]]);
});

test("이름 변경과 재정렬 뒤에도 같은 ID를 참조하며 삭제 대상은 메인으로 대체하지 않는다", () => {
  const renamed = [{ ...agents[1], name: "UX 디자이너" }, agents[0]];
  assert.deepEqual(resolveConversationParticipants(renamed, "designer"), [renamed[0]]);
  assert.deepEqual(resolveConversationParticipants([agents[0]], "designer"), []);
});

test("전체 대화에서 화자를 ID로 구분하고 이전 참여자의 답변과 도구 실행을 공유한다", () => {
  const history = [
    { side: "user", type: "text", text: "수정할 내용이 있나요?" },
    { side: "agent", type: "text", agentId: "designer", sender: "옛 이름", text: "첫 검토" },
    { side: "agent", type: "text", sender: "옛 이름", text: "이전 버전 기록" },
    { side: "agent", type: "text", agentId: "main", sender: "옛 이름", text: "수정 완료" },
    {
      side: "agent",
      type: "text",
      agentId: "main",
      sender: "옛 이름",
      icon: "error",
      text: "응답 실패",
    },
    {
      side: "agent",
      type: "search",
      agentId: "main",
      sender: "팀장 Tool",
      text: "파일 저장",
      logs: ["완료"],
    },
    { side: "status", type: "status", statusText: "안내" },
  ];
  const messages = buildConversationMessages(history, agents[1]);
  assert.equal(messages[0].content, history[0].text);
  assert.match(messages[1].content, /내 발언 "옛 이름".*첫 검토/s);
  assert.match(messages[2].content, /참여자 발언 "옛 이름".*이전 버전 기록/s);
  assert.match(messages[3].content, /참여자 발언 "옛 이름".*수정 완료/s);
  assert.match(messages[4].content, /팀장 Tool.*파일 저장.*완료/s);
  assert.equal(messages[5].role, "user");
  assert.match(messages[5].content, /디자이너/);
  assert.equal(messages.length, 6);
  assert.deepEqual(buildConversationMessages(history.slice(0, 2)), [
    { role: "user", content: history[0].text },
    { role: "assistant", content: "첫 검토" },
  ]);
});

test("모드와 에이전트가 모두 일치하는 최신 대화만 재개한다", () => {
  const sessions = [
    { id: "general", modeName: "A", agentId: null, updatedAt: 50 },
    { id: "old", modeName: "A", agentId: "designer", updatedAt: 10 },
    { id: "other-agent", modeName: "A", agentId: "main", updatedAt: 90 },
    { id: "latest", modeName: "A", agentId: "designer", updatedAt: 20 },
    { id: "other-mode", modeName: "B", agentId: "designer", updatedAt: 100 },
  ];
  assert.equal(findLatestConversationSession(sessions, "A", "designer").id, "latest");
  assert.equal(findLatestConversationSession(sessions, "A", "missing"), undefined);
  assert.equal(findLatestConversationSession(sessions, "A", null).id, "general");
  assert.equal(findLatestConversationSession(sessions, "B", null), undefined);
  const legacy = { id: "legacy", modeName: "A", updatedAt: 99 };
  assert.equal(findLatestConversationSession([...sessions, legacy], "A", null), legacy);
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

test("이름이 바뀐 모드는 초안을 유지하고 같은 이름으로 새로 만든 모드는 빈 대화로 시작한다", () => {
  const groupDraft = conversationDraftKey(null, "이전 팀", null);
  const deletedDraft = conversationDraftKey(null, "삭제 팀", null);
  const savedDraft = conversationDraftKey("saved", "이전 팀", "main");
  const drafts = remapConversationDrafts(
    new Map([
      [groupDraft, "팀 메모"],
      [deletedDraft, "이전 기록"],
      [savedDraft, "개별 메모"],
    ]),
    [{ originalName: "이전 팀", name: "새 팀" }, { name: "이전 팀" }, { name: "삭제 팀" }]
  );
  assert.equal(drafts.get(conversationDraftKey(null, "새 팀", null)), "팀 메모");
  assert.equal(drafts.get(savedDraft), "개별 메모");
  assert.equal(drafts.has(groupDraft), false);
  assert.equal(drafts.has(deletedDraft), false);
});
