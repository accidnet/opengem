import type { LLMConfig, LLMSettings } from "@/types/chat";

import PROMPT_ANTHROPIC from "@/features/chat/prompts/anthropic.txt?raw";
import PROMPT_CODEX from "@/features/chat/prompts/codex.txt?raw";
import PROMPT_DEFAULT from "@/features/chat/prompts/default.txt?raw";
import PROMPT_GEMINI from "@/features/chat/prompts/gemini.txt?raw";
import PROMPT_GPT from "@/features/chat/prompts/gpt.txt?raw";

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
  providerKinds: ProviderKind[];
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
export const CHATGPT_BASE_URL = "https://chatgpt.com/backend-api/codex";

function normalizeOpenAIPriority(value?: number | null): 1 | 2 {
  return value === 2 ? 2 : 1;
}

function normalizeOpenAIPreferences(input: Partial<LLMSettings>) {
  const oauthEnabled = input.openaiOauthEnabled ?? true;
  const apiKeyEnabled = input.openaiApiKeyEnabled ?? true;
  const oauthPriority = normalizeOpenAIPriority(input.openaiOauthPriority);
  const apiKeyPriority = normalizeOpenAIPriority(input.openaiApiKeyPriority);

  if (oauthPriority === apiKeyPriority) {
    return oauthPriority === 1
      ? {
          openaiOauthEnabled: oauthEnabled,
          openaiOauthPriority: 1 as const,
          openaiApiKeyEnabled: apiKeyEnabled,
          openaiApiKeyPriority: 2 as const,
        }
      : {
          openaiOauthEnabled: oauthEnabled,
          openaiOauthPriority: 2 as const,
          openaiApiKeyEnabled: apiKeyEnabled,
          openaiApiKeyPriority: 1 as const,
        };
  }

  return {
    openaiOauthEnabled: oauthEnabled,
    openaiOauthPriority: oauthPriority,
    openaiApiKeyEnabled: apiKeyEnabled,
    openaiApiKeyPriority: apiKeyPriority,
  };
}

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
    description: "OpenAI는 ChatGPT 로그인과 API 키를 입력하여 사용할 수 있습니다.",
    providerKind: "api-key",
    providerKinds: ["api-key", "oauth"],
    protocol: "openai-compatible",
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    modelDefault: "gpt-5.4-mini",
    authLabel: "Credential",
    models: [
      { id: "gpt-5.4-mini", label: "GPT-5.4 Mini", promptProfile: "gpt" },
      { id: "gpt-5.4", label: "GPT-5.4", promptProfile: "gpt" },
      { id: "gpt-6.1-sol", label: "GPT-6.1 Sol", promptProfile: "gpt" },
    ],
  },
  {
    id: "anthropic",
    label: "Anthropic",
    description: "Claude models using the native Anthropic Messages API.",
    providerKind: "api-key",
    providerKinds: ["api-key"],
    protocol: "anthropic",
    baseUrl: DEFAULT_ANTHROPIC_BASE_URL,
    modelDefault: "claude-sonnet-4-6",
    authLabel: "API Key",
    models: [
      { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", promptProfile: "anthropic" },
      { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", promptProfile: "anthropic" },
    ],
  },
  {
    id: "google",
    label: "Google Gemini",
    description: "Gemini models using the Google Generative Language API.",
    providerKind: "api-key",
    providerKinds: ["api-key"],
    protocol: "google-gemini",
    baseUrl: DEFAULT_GEMINI_BASE_URL,
    modelDefault: "gemini-flash-latest",
    authLabel: "API Key",
    models: [
      { id: "gemini-flash-latest", label: "Gemini Flash Latest", promptProfile: "gemini" },
      { id: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash Lite", promptProfile: "gemini" },
    ],
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    description: "OpenRouter using the OpenAI-compatible chat completions interface.",
    providerKind: "api-key",
    providerKinds: ["api-key"],
    protocol: "openai-compatible",
    baseUrl: DEFAULT_OPENROUTER_BASE_URL,
    modelDefault: "openai/gpt-5.4-mini",
    authLabel: "API Key",
    models: [
      { id: "openai/gpt-5.4-mini", label: "OpenAI GPT-5.4 Mini", promptProfile: "gpt" },
      { id: "anthropic/claude-sonnet-4.6", label: "Claude Sonnet 4.6", promptProfile: "anthropic" },
    ],
  },
  {
    id: "custom",
    label: "Custom OpenAI-Compatible",
    description: "Any custom base URL that implements the OpenAI chat completions shape.",
    providerKind: "api-key",
    providerKinds: ["api-key"],
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

export function getProviderCatalog(providerId?: string | null): ProviderCatalogEntry {
  if (providerId && providerCatalog.has(providerId as ProviderId)) {
    return providerCatalog.get(providerId as ProviderId)!;
  }
  return providerCatalog.get("openai")!;
}

// 조회에 실패한 연결에는 해당 인증 방식에서 호출할 수 있는 대표 모델을 제안합니다.
export function getFallbackModels(providerId: string, credentialType: ProviderKind) {
  if (providerId === "openai" && credentialType === "oauth") {
    return [
      { id: "gpt-6.1-sol", name: "GPT-6.1 Sol" },
      { id: "gpt-6.1-terra", name: "GPT-6.1 Terra" },
      { id: "gpt-6-luna", name: "GPT-6 Luna" },
    ];
  }
  return (providerCatalog.get(providerId as ProviderId)?.models ?? []).map(({ id, label }) => ({
    id,
    name: label,
  }));
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
  if (normalizedModel.includes("claude") || normalizedModel.includes("anthropic"))
    return "anthropic";
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
  const providerKind =
    provider.id === "openai" && env.VITE_LLM_PROVIDER_KIND === "oauth"
      ? "oauth"
      : provider.providerKind;

  return {
    providerId: provider.id,
    providerKind,
    baseUrl: providerKind === "oauth" ? CHATGPT_BASE_URL : provider.baseUrl,
    model,
    apiKey: env.VITE_LLM_API_KEY,
    loggedIn: false,
    openaiOauthEnabled: true,
    openaiOauthPriority: 1,
    openaiApiKeyEnabled: true,
    openaiApiKeyPriority: 2,
  };
}

export function normalizeLlmSettings(input: Partial<LLMSettings>): LLMSettings {
  const defaults = createDefaultLlmSettings();
  const provider = getProviderCatalog(input.providerId ?? defaults.providerId);
  const providerKind =
    provider.id === "openai" && input.providerKind === "oauth" ? "oauth" : "api-key";
  const model = normalizeModelSelection(
    provider.id,
    input.model ?? (provider.id === defaults.providerId ? defaults.model : undefined)
  );
  const openaiPreferences = normalizeOpenAIPreferences(input);

  return {
    providerId: provider.id,
    providerKind,
    baseUrl:
      provider.id === "custom"
        ? (input.baseUrl ?? provider.baseUrl)
        : providerKind === "oauth"
          ? CHATGPT_BASE_URL
          : provider.baseUrl,
    model,
    apiKey: input.apiKey,
    loggedIn: Boolean(input.loggedIn),
    email: input.email,
    ...openaiPreferences,
  };
}

export function applyProviderSelection(
  current: Pick<LLMSettings, "providerId" | "providerKind" | "baseUrl" | "model" | "apiKey">,
  providerId: ProviderId
): Pick<LLMSettings, "providerId" | "providerKind" | "baseUrl" | "model" | "apiKey"> {
  const provider = getProviderCatalog(providerId);
  const currentProvider = getProviderCatalog(current.providerId);
  const providerKind =
    provider.id === "openai" && currentProvider.id === "openai"
      ? current.providerKind
      : provider.providerKind;

  return {
    providerId: provider.id,
    providerKind,
    baseUrl: providerKind === "oauth" ? CHATGPT_BASE_URL : provider.baseUrl,
    model:
      currentProvider.id === provider.id
        ? normalizeModelSelection(provider.id, current.model)
        : provider.modelDefault,
    apiKey:
      currentProvider.id === provider.id && providerKind === "api-key" ? current.apiKey : undefined,
  };
}

export function applyProviderKindSelection(
  current: Pick<LLMSettings, "providerId" | "providerKind" | "baseUrl" | "model" | "apiKey">,
  providerKind: ProviderKind
): Pick<LLMSettings, "providerKind" | "baseUrl" | "model" | "apiKey"> {
  const nextProviderKind =
    current.providerId === "openai" && providerKind === "oauth" ? "oauth" : "api-key";
  return {
    providerKind: nextProviderKind,
    baseUrl:
      nextProviderKind === "oauth"
        ? CHATGPT_BASE_URL
        : getProviderCatalog(current.providerId).baseUrl,
    model: normalizeModelSelection(current.providerId, current.model),
    apiKey: nextProviderKind === "api-key" ? current.apiKey : undefined,
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
  return model?.trim() || getProviderCatalog(providerId).modelDefault;
}
