import type { AgentItem, Message } from "@/types/chat";

export { buildActivityFromMessages } from "./activity";

const SESSION_TITLE_MAX_LENGTH = 40;

/** AgentColor → 실제 CSS 색상값 매핑 */
const AGENT_COLOR_VALUES: Record<AgentItem["color"], string> = {
  indigo: "#a5b4fc",
  emerald: "#86efac",
  amber: "#fcd34d",
  violet: "#c4b5fd",
  rose: "#fda4af",
};

export function nowTime(): string {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function buildSessionTitle(input: string): string {
  const normalized = input.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return "새 채팅";
  }

  if (normalized.length <= SESSION_TITLE_MAX_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, SESSION_TITLE_MAX_LENGTH)}...`;
}

export function formatSessionTime(updatedAt: number): string {
  if (!updatedAt) {
    return "방금 전";
  }

  const date = new Date(updatedAt);
  const now = new Date();
  const sameDay = date.toDateString() === now.toDateString();
  const diffMs = now.getTime() - date.getTime();
  const diffMinutes = Math.max(0, Math.floor(diffMs / 60000));

  if (sameDay) {
    if (diffMinutes < 1) {
      return "방금 전";
    }

    if (diffMinutes < 60) {
      return `${diffMinutes}분 전`;
    }

    return date.toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });
  }

  return date.toLocaleDateString([], {
    month: "short",
    day: "numeric",
  });
}

/** 스트리밍 중에도 메시지와 발화자의 ID가 바뀌지 않습니다. */
export function buildTypingMessage(agent: AgentItem): Message {
  return {
    id: `assistant-${crypto.randomUUID()}`,
    side: "agent",
    agentId: agent.agentId,
    sender: agent.name,
    byline: nowTime(),
    icon: agent.icon,
    iconColor: AGENT_COLOR_VALUES[agent.color],
    type: "typing",
    isStreaming: true,
    text: "Thinking...",
  };
}
