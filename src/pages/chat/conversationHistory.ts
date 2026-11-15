import type { LLMMessage } from "@/features/ai";
import type { AgentItem, Message } from "@/types/chat";

function extractLLMMessageText(message: Message): string | undefined {
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

/** 같은 세션의 대화만 모델에 전달하고 전체 대화에서는 당시 화자를 표시합니다. */
export function buildConversationMessages(
  messages: Message[],
  groupParticipant?: AgentItem
): LLMMessage[] {
  const history: LLMMessage[] = [];
  for (const message of messages) {
    if (message.side === "status" || message.type === "status" || message.icon === "error")
      continue;
    const text = extractLLMMessageText(message);
    if (!text) continue;
    if (message.side === "user") {
      history.push({ role: "user", content: text });
    } else if (groupParticipant) {
      const ownMessage = message.agentId && message.agentId === groupParticipant.agentId;
      const speaker = JSON.stringify(message.sender || "에이전트");
      history.push({
        role: "assistant",
        content: `[${ownMessage ? "내 발언" : "참여자 발언"} ${speaker}]\n${text}`,
      });
    } else {
      history.push({ role: "assistant", content: text });
    }
  }
  // 후속 참여자의 요청도 사용자의 발언으로 끝나야 앞선 답변의 연속 생성으로 해석되지 않습니다.
  if (groupParticipant && history[history.length - 1]?.role === "assistant") {
    history.push({
      role: "user",
      content: `이제 ${JSON.stringify(groupParticipant.name)} 차례입니다. 앞선 발언을 참고해 마지막 사용자 요청에 답하세요.`,
    });
  }
  return history;
}
