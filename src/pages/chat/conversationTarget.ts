import type { AgentItem, SessionItem } from "@/types/chat";

/** 개별 대화 대상이 사라졌을 때 다른 에이전트로 조용히 전환하지 않습니다. */
export function resolveConversationAgent(agents: AgentItem[], agentId: string | null) {
  return agentId
    ? (agents.find((agent) => agent.agentId === agentId) ?? null)
    : (agents.find((agent) => agent.role === "main") ?? agents[0] ?? null);
}

export function findAgentSession(sessions: SessionItem[], modeName: string, agentId: string) {
  return sessions
    .filter((session) => session.modeName === modeName && session.agentId === agentId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export function conversationDraftKey(
  sessionId: string | null,
  modeName: string,
  agentId: string | null
) {
  return sessionId ? `session:${sessionId}` : JSON.stringify([modeName, agentId]);
}
