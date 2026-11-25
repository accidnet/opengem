import type { AgentItem, SessionItem } from "@/types/chat";

/** 개별 대화 대상이 사라졌을 때 다른 에이전트로 조용히 전환하지 않습니다. */
export function resolveConversationAgent(agents: AgentItem[], agentId: string | null) {
  return agentId
    ? (agents.find((agent) => agent.agentId === agentId) ?? null)
    : (agents.find((agent) => agent.role === "main") ?? agents[0] ?? null);
}

/** 대상이 기록되지 않은 이전 세션은 오퍼레이션 모드의 대화로 복원합니다. */
export function sessionsForTarget(
  sessions: SessionItem[],
  modeName: string,
  agentId: string | null
) {
  return sessions
    .filter((session) => session.modeName === modeName && (session.agentId ?? null) === agentId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

export function conversationDraftKey(
  sessionId: string | null,
  modeName: string,
  agentId: string | null
) {
  return sessionId ? `session:${sessionId}` : JSON.stringify([modeName, agentId]);
}
