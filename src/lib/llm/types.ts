import type { LLMConfig } from "@/types/chat";

export type LLMRole = "user" | "assistant" | "system" | "developer" | "tool";

export type LLMToolCall = {
  id: string;
  name: string;
  arguments: string;
};

export type LLMToolDefinition = {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
};

export type LLMMessage = {
  role: LLMRole;
  content: string;
  name?: string;
  toolCallId?: string;
  toolCalls?: LLMToolCall[];
  // 도구를 호출한 Responses 모델의 추론·호출 항목은 해당 실행 안에서만 되돌려 줍니다.
  responseOutput?: JsonRecord[];
};

export type LLMUsage = {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};

export type LLMStreamEvent = {
  event: string;
  data: string;
  id?: string;
};

export type LLMRequest = {
  providerId?: LLMConfig["providerId"];
  providerKind?: LLMConfig["providerKind"];
  apiBaseUrl: string;
  apiKey?: string;
  accessToken?: string;
  accountId?: string;
  model: string;
  messages: LLMMessage[];
  tools?: LLMToolDefinition[];
  toolChoice?: "auto" | "none" | "required";
  stream?: boolean;
  signal?: AbortSignal;
  temperature?: number;
  onChunk?: (chunk: string) => void;
  onEvent?: (event: LLMStreamEvent) => void;
};

export type LLMResponse = {
  text: string;
  usage?: LLMUsage;
  toolCalls?: LLMToolCall[];
  responseOutput?: JsonRecord[];
  finishReason?: string;
};

export type OpenAIUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

export type GoogleUsage = {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  totalTokenCount?: number;
};

export type JsonRecord = Record<string, unknown>;
