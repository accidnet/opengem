import type { LLMMessage } from "../types";

export function splitSystemMessages(messages: LLMMessage[]) {
  const system = messages
    .filter((message) => message.role === "system")
    .map((message) => message.content.trim())
    .filter(Boolean)
    .join("\n\n");

  return {
    system,
    messages: messages.filter((message) => message.role !== "system"),
  };
}
