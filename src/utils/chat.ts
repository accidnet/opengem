import type { LLMMessage } from "@/lib/llm";

import { LLM_SYSTEM_PROMPT } from "@/data/appData";
import type { ActivityItem, Message } from "@/types/chat";

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

export function buildLLMMessages(messages: Message[]): LLMMessage[] {
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

  return [{ role: "system", content: LLM_SYSTEM_PROMPT }, ...chatMessages];
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

export function buildTypingMessage(text: string): Message {
  return {
    id: `typing-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
    side: "agent",
    sender: "연구 에이전트",
    byline: nowTime(),
    icon: "travel_explore",
    iconColor: "#86efac",
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
