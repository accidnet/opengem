import type { AgentItem } from "@/types/chat";

// 저장된 에이전트는 DB 식별자로, 브라우저 미리보기는 이름과 순서로 구분합니다.
export function getOfficeAgentId(agent: AgentItem, index: number): string {
  return agent.agentId || "preview:" + index + ":" + agent.name;
}
