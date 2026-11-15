import type { AgentItem, SessionItem } from "@/types/chat";

/** 전체 대화는 모드에 설정된 순서로, 개별 대화는 지정된 한 명만 참여합니다. */
export function resolveConversationParticipants(agents: AgentItem[], agentId: string | null) {
  return agents.filter(
    (agent) => agent.active && agent.agentId && (agentId === null || agent.agentId === agentId)
  );
}

export function findLatestConversationSession(
  sessions: SessionItem[],
  modeName: string,
  agentId: string | null
) {
  return sessions
    .filter((session) => session.modeName === modeName && (session.agentId ?? null) === agentId)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export function conversationDraftKey(
  sessionId: string | null,
  modeName: string,
  agentId: string | null
) {
  return sessionId ? `session:${sessionId}` : JSON.stringify([modeName, agentId]);
}

/** 새 세션 초안은 모드 이름 변경을 따라가고, 삭제한 모드의 이름을 재사용해도 복원되지 않습니다. */
export function remapConversationDrafts(
  drafts: Map<string, string>,
  modes: { originalName?: string; name: string }[]
) {
  const result = new Map<string, string>();
  for (const [key, text] of drafts) {
    if (key.startsWith("session:")) {
      result.set(key, text);
      continue;
    }
    const [modeName, agentId] = JSON.parse(key) as [string, string | null];
    const renamed = modes.find((mode) => mode.originalName === modeName);
    if (renamed) result.set(conversationDraftKey(null, renamed.name, agentId), text);
  }
  return result;
}
