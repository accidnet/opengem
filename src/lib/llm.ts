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

export type LLMRequest = {
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

export type LLMStreamEvent = {
  event: string;
  data: string;
  id?: string;
};

const DEFAULT_API_BASE_URL = "https://api.openai.com/v1";
const CHATGPT_API_BASE_URL = "https://chatgpt.com/backend-api/codex";

type OpenAIChoice = {
  finish_reason?: string;
  delta?: {
    content?: string;
  };
  message?: {
    role?: string;
    content?: string;
  };
};

type OpenAIUsage = {
  prompt_tokens?: number;
  completion_tokens?: number;
  total_tokens?: number;
};

type OpenAIResponse = {
  choices?: OpenAIChoice[];
  usage?: OpenAIUsage;
};

export async function sendToLLM(input: LLMRequest): Promise<LLMResponse> {
  if (input.providerKind === "chatgpt_oauth") {
    return sendToChatGptOAuth(input);
  }

  const requestUrl = resolveRequestUrl(input);
  const shouldStream = input.stream ?? true;
  const response = await fetch(requestUrl, {
    method: "POST",
    headers: buildHeaders(input.apiKey),
    body: JSON.stringify(buildRequestBody(input, shouldStream)),
    signal: input.signal,
  });

  if (!response.ok) {
    const detail = await safeReadText(response);
    throw new Error(`LLM API 오류 (${response.status}): ${detail || response.statusText}`);
  }

  if (!response.body) {
    throw new Error("LLM 응답 본문을 읽을 수 없습니다.");
  }

  if (shouldStream) {
    return parseSSEStream(response, input.onChunk, input.onEvent);
  }

  const json = (await response.json()) as OpenAIResponse;
  const message = (json.choices?.[0]?.message?.content || "") as string;
  const usage = toUsage(json.usage);
  return { text: message, usage };
}

async function sendToChatGptOAuth(input: LLMRequest): Promise<LLMResponse> {
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
    return parseSSEStream(response, input.onChunk, input.onEvent);
  }

  return parseSSEStream(response);
}

function buildRequestBody(input: LLMRequest, stream: boolean) {
  return {
    model: input.model,
    messages: input.messages,
    temperature: 0.4,
    stream,
  };
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

function buildHeaders(apiKey?: string): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }
  return headers;
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

function resolveRequestUrl(input: LLMRequest): string {
  const baseUrl = normalizeBaseUrl(input.apiBaseUrl || DEFAULT_API_BASE_URL);
  return `${baseUrl}/chat/completions`;
}

function normalizeBaseUrl(value: string): string {
  return value.endsWith("/") ? value.slice(0, -1) : value;
}

async function parseSSEStream(
  response: Response,
  onChunk?: (chunk: string) => void,
  onEvent?: (event: LLMStreamEvent) => void
): Promise<LLMResponse> {
  const reader = response.body?.getReader();
  if (!reader) {
    return { text: "" };
  }

  const decoder = new TextDecoder();
  let usage: LLMUsage | undefined;
  let text = "";
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const parsed = extractCompleteSSEEvents(buffer);
    buffer = parsed.remainder;

    for (const event of parsed.events) {
      onEvent?.(event);

      if (event.data === "[DONE]") {
        continue;
      }

      const json = safeJsonParse<Record<string, unknown> & OpenAIResponse>(event.data);
      if (!json) {
        if (event.event === "chunk" || event.event === "message") {
          text += event.data;
          onChunk?.(event.data);
        }
        continue;
      }

      if (!usage && "usage" in json) {
        usage = toUsage(json.usage as OpenAIUsage | undefined);
      }

      const chunk = extractTextChunk(json);
      if (!chunk) {
        continue;
      }

      text += chunk;
      onChunk?.(chunk);
    }
  }

  if (buffer.trim().length > 0) {
    const fallback = parseSSEEventBlock(buffer);
    if (fallback) {
      onEvent?.(fallback);
      const json = safeJsonParse<Record<string, unknown> & OpenAIResponse>(fallback.data);
      if (json) {
        if (!usage && "usage" in json) {
          usage = toUsage(json.usage as OpenAIUsage | undefined);
        }
        const chunk = extractTextChunk(json);
        if (chunk) {
          text += chunk;
          onChunk?.(chunk);
        }
      }
    }
  }

  return { text, usage };
}

function extractCompleteSSEEvents(buffer: string): {
  events: LLMStreamEvent[];
  remainder: string;
} {
  const normalized = buffer.replace(/\r\n/g, "\n");
  const blocks = normalized.split("\n\n");
  const remainder = blocks.pop() ?? "";
  const events = blocks.map(parseSSEEventBlock).filter((event): event is LLMStreamEvent => Boolean(event));
  return {
    events,
    remainder,
  };
}

function parseSSEEventBlock(block: string): LLMStreamEvent | null {
  const lines = block.split("\n");
  let eventName = "message";
  let eventId: string | undefined;
  const dataLines: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    if (!line || line.startsWith(":")) {
      continue;
    }

    if (line.startsWith("event:")) {
      eventName = line.slice(6).trim() || "message";
      continue;
    }

    if (line.startsWith("id:")) {
      eventId = line.slice(3).trim() || undefined;
      continue;
    }

    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  if (dataLines.length === 0) {
    return null;
  }

  return {
    event: eventName,
    data: dataLines.join("\n"),
    id: eventId,
  };
}

function extractTextChunk(payload: Record<string, unknown> & OpenAIResponse): string {
  const openAIChunk = payload.choices?.[0]?.delta?.content;
  if (typeof openAIChunk === "string" && openAIChunk.length > 0) {
    return openAIChunk;
  }

  const openAIMessage = payload.choices?.[0]?.message?.content;
  if (typeof openAIMessage === "string" && openAIMessage.length > 0) {
    return openAIMessage;
  }

  const directDelta = payload.delta;
  if (typeof directDelta === "string" && directDelta.length > 0) {
    return directDelta;
  }

  const directText = payload.text;
  if (typeof directText === "string" && directText.length > 0) {
    return directText;
  }

  return "";
}

function toUsage(raw?: OpenAIUsage): LLMUsage | undefined {
  if (!raw) {
    return undefined;
  }
  return {
    promptTokens: raw.prompt_tokens,
    completionTokens: raw.completion_tokens,
    totalTokens: raw.total_tokens,
  };
}

async function safeReadText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return "";
  }
}

function safeJsonParse<T>(value: string): T | undefined {
  try {
    return JSON.parse(value) as T;
  } catch {
    return undefined;
  }
}
