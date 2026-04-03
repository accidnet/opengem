import { CHATGPT_API_BASE_URL } from "@/lib/llm/constants";
import type { LLMRequest, LLMResponse } from "@/lib/llm/types";
import { safeReadText } from "@/lib/llm/http";
import { parseSSEStream } from "@/lib/llm/stream";

export async function sendToChatGptOAuth(input: LLMRequest): Promise<LLMResponse> {
  const response = await fetch(`${CHATGPT_API_BASE_URL}/responses`, {
    method: "POST",
    headers: buildChatGptHeaders(input.accessToken, input.accountId),
    body: JSON.stringify(buildChatGptRequestBody(input)),
    signal: input.signal,
  });

  if (!response.ok) {
    const detail = await safeReadText(response);
    throw new Error(`ChatGPT API error (${response.status}): ${detail || response.statusText}`);
  }

  if (!response.body) {
    throw new Error("ChatGPT response body is missing.");
  }

  if (input.stream ?? true) {
    return parseSSEStream(response, "chatgpt-responses", input.onChunk, input.onEvent);
  }

  return parseSSEStream(response, "chatgpt-responses");
}

function buildChatGptRequestBody(input: LLMRequest) {
  const transformedMessages = input.messages.map((message) => ({
    role: message.role === "assistant" ? "assistant" : "user",
    content: [
      {
        type: message.role === "assistant" ? "output_text" : "input_text",
        text: message.content,
      },
    ],
  }));

  const firstMessage = input.messages[0];
  const hasSystemPrompt = firstMessage?.role === "system";

  return {
    model: input.model,
    instructions: hasSystemPrompt ? firstMessage.content : "You are a helpful assistant.",
    input: hasSystemPrompt ? transformedMessages.slice(1) : transformedMessages,
    store: false,
    stream: true,
  };
}

function buildChatGptHeaders(accessToken?: string, accountId?: string): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    originator: "opengem",
  };

  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`;
  }

  if (accountId) {
    headers["ChatGPT-Account-Id"] = accountId;
  }

  return headers;
}
