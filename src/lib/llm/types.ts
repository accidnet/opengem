import type { LLMConfig } from "@/types/chat";

export type LLMRole = "user" | "assistant" | "system";

export type LLMMessage = {
  role: LLMRole;
  content: string;
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
  stream?: boolean;
  signal?: AbortSignal;
  onChunk?: (chunk: string) => void;
  onEvent?: (event: LLMStreamEvent) => void;
};

export type LLMResponse = {
  text: string;
  usage?: LLMUsage;
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
