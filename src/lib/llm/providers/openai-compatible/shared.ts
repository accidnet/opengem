import { normalizeBaseUrl } from "@/data/llmCatalog";

import { DEFAULT_API_BASE_URL } from "../../constants";

export function resolveOpenAICompatibleUrl(baseUrl: string): string {
  const normalizedBaseUrl = normalizeBaseUrl(baseUrl || DEFAULT_API_BASE_URL);
  return `${normalizedBaseUrl}/chat/completions`;
}

export function buildOpenAIHeaders(apiKey?: string): HeadersInit {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  return headers;
}
