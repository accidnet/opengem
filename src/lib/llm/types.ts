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
  onChunk?: (chunk: string) => void;
  onEvent?: (event: LLMStreamEvent) => void;
};

export type LLMResponse = {
  text: string;
  usage?: LLMUsage;
  toolCalls?: LLMToolCall[];
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
