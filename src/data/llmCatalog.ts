import type { LLMConfig, LLMSettings } from "@/types/chat";

import PROMPT_ANTHROPIC from "./prompts/anthropic.txt?raw";
import PROMPT_CODEX from "./prompts/codex.txt?raw";
import PROMPT_DEFAULT from "./prompts/default.txt?raw";
import PROMPT_GEMINI from "./prompts/gemini.txt?raw";
import PROMPT_GPT from "./prompts/gpt.txt?raw";

export type ProviderId = LLMConfig["providerId"];
export type ProviderKind = LLMConfig["providerKind"];
export type ProviderProtocol =
  | "openai-compatible"
  | "anthropic"
  | "google-gemini"
  | "chatgpt-responses";
export type PromptProfile = "default" | "gpt" | "codex" | "gemini" | "anthropic";

export type ModelCatalogEntry = {
  id: string;
  label: string;
  promptProfile?: PromptProfile;
};

export type ProviderCatalogEntry = {
  id: ProviderId;
  label: string;
  description: string;
  providerKind: ProviderKind;
  protocol: ProviderProtocol;
  baseUrl: string;
  modelDefault: string;
  authLabel: string;
  models: ModelCatalogEntry[];
};

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_ANTHROPIC_BASE_URL = "https://api.anthropic.com/v1";
const DEFAULT_GEMINI_BASE_URL = "https://generativelanguage.googleapis.com/v1beta";
const DEFAULT_OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1";
const CHATGPT_BASE_URL = "https://chatgpt.com/backend-api/codex";

const PROMPTS: Record<PromptProfile, string> = {
  default: PROMPT_DEFAULT.trim(),
  gpt: PROMPT_GPT.trim(),
  codex: PROMPT_CODEX.trim(),
  gemini: PROMPT_GEMINI.trim(),
  anthropic: PROMPT_ANTHROPIC.trim(),
};

const providerEntries: ProviderCatalogEntry[] = [
  {
    id: "openai",
    label: "OpenAI",
    description: "OpenAI Responses and Chat Completions compatible models.",
    providerKind: "api_key",
    protocol: "openai-compatible",
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    modelDefault: "gpt-4o-mini",
    authLabel: "API Key",
    models: [
      { id: "gpt-5.4", label: "GPT-5.4", promptProfile: "gpt" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", promptProfile: "gpt" },
      { id: "gpt-4.1", label: "GPT-4.1", promptProfile: "gpt" },
      { id: "gpt-4o", label: "GPT-4o", promptProfile: "gpt" },
      { id: "gpt-4o-mini", label: "GPT-4o Mini", promptProfile: "gpt" },
      { id: "codex-mini-latest", label: "Codex Mini", promptProfile: "codex" },
      { id: "o3", label: "o3", promptProfile: "gpt" },
      { id: "o4-mini", label: "o4-mini", promptProfile: "gpt" },
    ],
  },
  {
    id: "chatgpt",
    label: "ChatGPT",
    description: "ChatGPT OAuth-backed models through the Codex backend.",
    providerKind: "chatgpt_oauth",
    protocol: "chatgpt-responses",
    baseUrl: CHATGPT_BASE_URL,
    modelDefault: "gpt-5.2",
    authLabel: "ChatGPT Login",
    models: [
      { id: "gpt-5.2", label: "GPT-5.2", promptProfile: "gpt" },
      { id: "gpt-5.4", label: "GPT-5.4", promptProfile: "gpt" },
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", promptProfile: "gpt" },
      { id: "codex-mini-latest", label: "Codex Mini", promptProfile: "codex" },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Claude models using the native Anthropic Messages API.",
    providerKind: "api_key",
    protocol: "anthropic",
    baseUrl: DEFAULT_ANTHROPIC_BASE_URL,
    modelDefault: "claude-3-5-sonnet-latest",
    authLabel: "API Key",
    models: [
      { id: "claude-3-7-sonnet-latest", label: "Claude 3.7 Sonnet", promptProfile: "anthropic" },
      { id: "claude-3-5-sonnet-latest", label: "Claude 3.5 Sonnet", promptProfile: "anthropic" },
      { id: "claude-3-5-haiku-latest", label: "Claude 3.5 Haiku", promptProfile: "anthropic" },
    ],
  },
  {
    id: "google",
    label: "Google Gemini",
    description: "Gemini models using the Google Generative Language API.",
    providerKind: "api_key",
    protocol: "google-gemini",
    baseUrl: DEFAULT_GEMINI_BASE_URL,
    modelDefault: "gemini-2.5-pro",
    authLabel: "API Key",
    models: [
      { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", promptProfile: "gemini" },
      { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", promptProfile: "gemini" },
      { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", promptProfile: "gemini" },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "OpenRouter using the OpenAI-compatible chat completions interface.",
    providerKind: "api_key",
    protocol: "openai-compatible",
    baseUrl: DEFAULT_OPENROUTER_BASE_URL,
    modelDefault: "openai/gpt-4o-mini",
    authLabel: "API Key",
    models: [
      { id: "openai/gpt-4o-mini", label: "OpenAI GPT-4o Mini", promptProfile: "gpt" },
      { id: "openai/gpt-4o", label: "OpenAI GPT-4o", promptProfile: "gpt" },
      { id: "anthropic/claude-3.5-sonnet", label: "Claude 3.5 Sonnet", promptProfile: "anthropic" },
      { id: "google/gemini-2.5-pro", label: "Gemini 2.5 Pro", promptProfile: "gemini" },
    ],
  },
  {
    id: "custom_openai",
    label: "Custom OpenAI-Compatible",
    description: "Any custom base URL that implements the OpenAI chat completions shape.",
    providerKind: "api_key",
    protocol: "openai-compatible",
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    modelDefault: "gpt-4o-mini",
    authLabel: "API Key",
    models: [],
  },
];

const providerCatalog = new Map<ProviderId, ProviderCatalogEntry>(
  providerEntries.map((provider) => [provider.id, provider])
);

export function listProviders(): ProviderCatalogEntry[] {
  return Array.from(providerCatalog.values());
}

export function getProviderCatalog(providerId?: string | null): ProviderCatalogEntry {
  if (providerId && providerCatalog.has(providerId as ProviderId)) {
    return providerCatalog.get(providerId as ProviderId)!;
  }
  return providerCatalog.get("openai")!;
}

export function listProviderModels(providerId?: string | null): ModelCatalogEntry[] {
  return getProviderCatalog(providerId).models;
}

export function getModelCatalog(providerId: ProviderId, modelId?: string | null): ModelCatalogEntry | undefined {
  return getProviderCatalog(providerId).models.find((model) => model.id === modelId);
}

export function replaceProviderModels(providerId: ProviderId, models: ModelCatalogEntry[]): ProviderCatalogEntry {
  const provider = getProviderCatalog(providerId);
  const next = { ...provider, models: [...models] };
  providerCatalog.set(providerId, next);
  return next;
}

export function upsertProviderModels(providerId: ProviderId, models: ModelCatalogEntry[]): ProviderCatalogEntry {
  const provider = getProviderCatalog(providerId);
  const merged = new Map(provider.models.map((model) => [model.id, model]));
  models.forEach((model) => {
    merged.set(model.id, model);
  });
  const next = { ...provider, models: Array.from(merged.values()) };
  providerCatalog.set(providerId, next);
  return next;
}

export function resolvePromptProfile(model?: string, providerId?: string | null): PromptProfile {
  const normalizedModel = model?.toLowerCase() ?? "";
  const provider = providerId ? getProviderCatalog(providerId) : undefined;
  const directMatch =
    provider?.models.find((entry) => entry.id === model)?.promptProfile ??
    provider?.models.find((entry) => normalizedModel === entry.id.toLowerCase())?.promptProfile;

  if (directMatch) {
    return directMatch;
  }

  if (normalizedModel.includes("codex")) return "codex";
  if (normalizedModel.includes("claude") || normalizedModel.includes("anthropic")) return "anthropic";
  if (normalizedModel.includes("gemini")) return "gemini";
  if (
    normalizedModel.includes("gpt") ||
    normalizedModel.includes("o1") ||
    normalizedModel.includes("o3") ||
    normalizedModel.includes("o4")
  ) {
    return "gpt";
  }

  return "default";
}

export function getPromptForModel(model?: string, providerId?: string | null): string {
  return PROMPTS[resolvePromptProfile(model, providerId)];
}

export function createDefaultLlmSettings(env = import.meta.env): LLMSettings {
  const envProviderId = (env.VITE_LLM_PROVIDER_ID as ProviderId | undefined) ?? "openai";
  const provider = getProviderCatalog(envProviderId);
  const model = env.VITE_LLM_MODEL || provider.modelDefault;

  return {
    providerId: provider.id,
    providerKind: provider.providerKind,
    baseUrl: env.VITE_LLM_BASE_URL || provider.baseUrl,
    model,
    apiKey: env.VITE_LLM_API_KEY,
    chatgptLoggedIn: false,
  };
}

export function normalizeLlmSettings(input: Partial<LLMSettings>): LLMSettings {
  const defaults = createDefaultLlmSettings();
  const provider = getProviderCatalog(input.providerId ?? defaults.providerId);
  const model = normalizeModelSelection(provider.id, input.model ?? defaults.model);

  return {
    providerId: provider.id,
    providerKind: provider.providerKind,
    baseUrl: normalizeBaseUrl(input.baseUrl || provider.baseUrl),
    model,
    apiKey: input.apiKey ?? defaults.apiKey,
    chatgptLoggedIn: Boolean(input.chatgptLoggedIn),
    chatgptEmail: input.chatgptEmail,
  };
}

export function applyProviderSelection(
  current: Pick<LLMSettings, "providerId" | "providerKind" | "baseUrl" | "model">,
  providerId: ProviderId
): Pick<LLMSettings, "providerId" | "providerKind" | "baseUrl" | "model"> {
  const provider = getProviderCatalog(providerId);
  const currentProvider = getProviderCatalog(current.providerId);
  const keepsCustomBaseUrl =
    current.providerId === provider.id && normalizeBaseUrl(current.baseUrl) !== normalizeBaseUrl(provider.baseUrl);

  return {
    providerId: provider.id,
    providerKind: provider.providerKind,
    baseUrl: keepsCustomBaseUrl ? normalizeBaseUrl(current.baseUrl) : provider.baseUrl,
    model:
      currentProvider.id === provider.id
        ? normalizeModelSelection(provider.id, current.model)
        : provider.modelDefault,
  };
}

export function applyModelSelection(
  providerId: ProviderId,
  model: string
): Pick<LLMSettings, "model"> {
  return {
    model: normalizeModelSelection(providerId, model),
  };
}

export function normalizeModelSelection(providerId: ProviderId, model?: string | null): string {
  const provider = getProviderCatalog(providerId);
  const trimmed = model?.trim();
  if (!trimmed) {
    return provider.modelDefault;
  }

  if (provider.models.length === 0) {
    return trimmed;
  }

  return provider.models.some((entry) => entry.id === trimmed) ? trimmed : provider.modelDefault;
}

export function normalizeBaseUrl(value?: string | null): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    return DEFAULT_OPENAI_BASE_URL;
  }
  return trimmed.endsWith("/") ? trimmed.slice(0, -1) : trimmed;
}
