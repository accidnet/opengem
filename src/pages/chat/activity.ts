import type { ActivityItem, ActivityState, Message } from "@/types/chat";

function compactActivityText(text: string): string {
  const normalized = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
  return normalized.length <= 360 ? normalized : `${normalized.slice(0, 360)}...`;
}

function resolveActivityState(message: Message): ActivityState {
  if (message.icon === "error" || message.text?.startsWith("Request failed:")) {
    return "failed";
  }
  if (message.isStreaming || message.type === "typing") {
    return "working";
  }
  return "done";
}

/** 현재 채팅에서 발생한 에이전트 활동을 메시지 순서대로 표시한다. */
export function buildActivityFromMessages(messages: Message[]): ActivityItem[] {
  return messages.reduce<ActivityItem[]>((items, message) => {
    if (message.side !== "agent") {
      return items;
    }

    const state = resolveActivityState(message);
    const isToolLog = message.type === "search" || Boolean(message.logs?.length);
    const text = isToolLog
      ? [message.text, ...(message.logs ?? [])].filter(Boolean).join("\n")
      : state === "working"
        ? message.text || "Agent is working..."
        : state === "failed"
          ? message.text || "Agent request failed."
          : "Agent response completed.";

    if (text.trim()) {
      items.push({
        id: `activity-${message.id}`,
        source: message.sender?.trim().replace(/\s+Tool$/, "") || "Assistant",
        byline: message.byline,
        text: compactActivityText(text),
        state,
      });
    }
    return items;
  }, []);
}

/** 완료된 응답은 먼저 실행된 도구 로그 뒤로 이동한다. */
export function finalizeAssistantMessage(
  messages: Message[],
  messageId: string,
  completedMessage: Message
): Message[] {
  if (!messages.some((message) => message.id === messageId)) {
    return messages;
  }
  return [
    ...messages.filter((message) => message.id !== messageId),
    { ...completedMessage, isStreaming: false },
  ];
}
