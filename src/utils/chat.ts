import type { LLMMessage } from "@/lib/llm";

import { composeAgentSystemPrompt, LLM_SYSTEM_PROMPT } from "@/data/appData";
import type { ActivityItem, Message } from "@/types/chat";

const SESSION_TITLE_MAX_LENGTH = 40;

export function extractLLMMessageText(message: Message): string | undefined {
  if (message.type === "plan") {
    const planParts = [message.planTitle, ...(message.steps ?? [])];
    const planText = planParts.filter(Boolean).join("\n");
    if (planText) {
      return `${message.sender ?? "Assistant"} 계획:\n${planText}`;
    }
  }

  if (message.type === "search") {
    const lines: string[] = [];
    if (message.text) {
      lines.push(message.text);
    }
    if (Array.isArray(message.logs)) {
      lines.push(...message.logs);
    }
    const searchText = lines.filter((line) => line.trim().length > 0).join("\n");
    if (searchText) {
      return `${message.sender ?? "Assistant"} 검색:\n${searchText}`;
    }
  }

  if (message.type === "typing") {
    if (message.text && message.text.trim().length > 0) {
      return message.text;
    }
    return undefined;
  }

  if (message.text && message.text.trim().length > 0) {
    return message.text;
  }

  if (Array.isArray(message.logs)) {
    const logs = message.logs.filter((line) => line.trim().length > 0);
    if (logs.length > 0) {
      return logs.join("\n");
    }
  }

  return undefined;
}

/** AgentColor → 실제 CSS 색상값 매핑 */
export const AGENT_COLOR_VALUES: Record<string, string> = {
  indigo: "#a5b4fc",
  emerald: "#86efac",
  amber: "#fcd34d",
  violet: "#c4b5fd",
  rose: "#fda4af",
};

/**
 * LLM에 전송할 메시지 배열을 구성한다.
 * @param messages 현재 세션의 메시지 목록
 * @param systemPrompt 메인 에이전트의 프롬프트 (없으면 기본 시스템 프롬프트 사용)
 */
export function buildLLMMessages(
  messages: Message[],
  systemPrompt?: string,
  model?: string
): LLMMessage[] {
  const resolvedSystemPrompt =
    model || systemPrompt ? composeAgentSystemPrompt(model, systemPrompt) : LLM_SYSTEM_PROMPT;

  const chatMessages = messages
    .filter((message) => message.side !== "status" && message.type !== "status")
    .map((message) => {
      const content = extractLLMMessageText(message);
      if (!content) {
        return undefined;
      }

      return {
        role: message.side === "user" ? "user" : "assistant",
        content,
      };
    })
    .filter((entry): entry is LLMMessage => Boolean(entry));

  return [{ role: "system", content: resolvedSystemPrompt }, ...chatMessages];
}

export function appendChunkToMessage(messages: Message[], id: string, text: string): Message[] {
  return messages.map((entry) => (entry.id === id ? { ...entry, type: "text", text } : entry));
}

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

/**
 * 타이핑 중 상태 메시지를 생성한다.
 * @param text 타이핑 중 표시할 텍스트
 * @param agentName 에이전트 이름 (없으면 기본값)
 * @param agentIcon 에이전트 아이콘 (없으면 기본값)
 * @param agentIconColor 에이전트 아이콘 색상 (없으면 기본값)
 */
export function buildTypingMessage(
  text: string,
  agentName?: string,
  agentIcon?: string,
  agentIconColor?: string
): Message {
  return {
    id: `typing-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    side: "agent",
    sender: agentName ?? "연구 에이전트",
    byline: nowTime(),
    icon: agentIcon ?? "travel_explore",
    iconColor: agentIconColor ?? "#86efac",
    type: "typing",
    text,
  };
}

export function buildReplyMessage(input: string): Message {
  const summary = input.length > 120 ? `${input.slice(0, 120)}...` : input;
  return {
    id: `reply-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    side: "agent",
    sender: "기획 에이전트",
    byline: nowTime(),
    icon: "account_tree",
    iconColor: "#a5b4fc",
    type: "text",
    text: `요청을 반영해 실행 계획을 갱신했습니다. 핵심 키워드는 "${summary}"이며, Researcher/Analyst 에이전트를 추가로 할당해 자금 조달 및 기술 차별화 항목을 정리하겠습니다.`,
  };
}

export function buildActivity(statusText: string, source: string): ActivityItem {
  return {
    id: `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    source,
    byline: nowTime(),
    text: statusText,
    state: "working",
  };
}
