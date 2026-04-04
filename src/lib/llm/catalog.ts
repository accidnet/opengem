import type { LLMConfig, LLMSettings } from "@/types/chat";
import { normalizeBaseUrl } from "@/lib/utils";
import { getModelCatalog } from "@/config/loadModels";

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
  modelsSource?: "static" | "models.dev";
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
    description: "OpenAI API key and ChatGPT login are handled under the same provider.",
    providerKind: "api_key",
    providerKinds: ["api_key", "oauth"],
    protocol: "openai-compatible",
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    modelDefault: "gpt-4o-mini",
    authLabel: "Credential",
    modelsSource: "static",
    models: [
      { id: "gpt-5.2", label: "GPT-5.2", promptProfile: "gpt" },
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
    id: "anthropic",
    label: "Anthropic",
    description: "Claude models using the native Anthropic Messages API.",
    providerKind: "api_key",
    providerKinds: ["api_key"],
    protocol: "anthropic",
    baseUrl: DEFAULT_ANTHROPIC_BASE_URL,
    modelDefault: "claude-3-5-sonnet-latest",
    authLabel: "API Key",
    modelsSource: "static",
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
    providerKinds: ["api_key"],
    protocol: "google-gemini",
    baseUrl: DEFAULT_GEMINI_BASE_URL,
    modelDefault: "gemini-2.5-pro",
    authLabel: "API Key",
    modelsSource: "static",
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
    providerKinds: ["api_key"],
    protocol: "openai-compatible",
    baseUrl: DEFAULT_OPENROUTER_BASE_URL,
    modelDefault: "openai/gpt-4o-mini",
    authLabel: "API Key",
    modelsSource: "static",
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
    providerKinds: ["api_key"],
    protocol: "openai-compatible",
    baseUrl: DEFAULT_OPENAI_BASE_URL,
    modelDefault: "gpt-4o-mini",
    authLabel: "API Key",
    modelsSource: "static",
    models: [],
  },
];

const providerCatalog = new Map<ProviderId, ProviderCatalogEntry>(
  providerEntries.map((provider) => [provider.id, provider])
);

const modelsDevProviderMap: Partial<Record<string, ProviderId>> = {
  anthropic: "anthropic",
  google: "google",
  openai: "openai",
  openrouter: "openrouter",
};

function toModelsDevEntries(
  models: Record<string, { id?: string; name?: string }> | undefined
): ModelCatalogEntry[] {
  if (!models) {
    return [];
  }

  return Object.entries(models)
    .map(([id, model]) => {
      const modelId = model.id?.trim() || id;
      return {
        id: modelId,
        label: model.name?.trim() || modelId,
        promptProfile: resolvePromptProfile(modelId),
      };
    })
    .sort((left, right) => left.label.localeCompare(right.label));
}

function applyModelsDevProviderCatalog(
  providerId: ProviderId,
  models: ModelCatalogEntry[]
): ProviderCatalogEntry {
  const provider = getProviderCatalog(providerId);
  const next = {
    ...provider,
    models: models.length > 0 ? models : provider.models,
    modelDefault: models.some((entry) => entry.id === provider.modelDefault)
      ? provider.modelDefault
      : models[0]?.id || provider.modelDefault,
    modelsSource: models.length > 0 ? "models.dev" : provider.modelsSource,
  } satisfies ProviderCatalogEntry;

  providerCatalog.set(providerId, next);
  return next;
}

export function syncProviderCatalogWithModelsDev() {
  const payload = getModelCatalog();
  let changed = false;

  for (const [externalId, provider] of Object.entries(payload)) {
    const providerId = modelsDevProviderMap[externalId];
    if (!providerId) {
      continue;
    }

    const nextModels = toModelsDevEntries(provider.models);
    if (nextModels.length === 0) {
      continue;
    }

    const current = getProviderCatalog(providerId);
    const currentSignature = JSON.stringify(current.models.map((entry) => entry.id));
    const nextSignature = JSON.stringify(nextModels.map((entry) => entry.id));
    if (currentSignature === nextSignature) {
      continue;
    }

    applyModelsDevProviderCatalog(providerId, nextModels);
    changed = true;
  }

  return changed;
}

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

export function replaceProviderModels(
  providerId: ProviderId,
  models: ModelCatalogEntry[]
): ProviderCatalogEntry {
  const provider = getProviderCatalog(providerId);
  const next = {
    ...provider,
    models: [...models],
    modelsSource: "static",
  };
  providerCatalog.set(providerId, next);
  return next;
}

export function upsertProviderModels(
  providerId: ProviderId,
  models: ModelCatalogEntry[]
): ProviderCatalogEntry {
  const provider = getProviderCatalog(providerId);
  const merged = new Map(provider.models.map((model) => [model.id, model]));
  models.forEach((model) => {
    merged.set(model.id, model);
  });
  const next = {
    ...provider,
    models: Array.from(merged.values()),
    modelsSource: "static",
  };
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
  };
}

export function normalizeLlmSettings(input: Partial<LLMSettings>): LLMSettings {
  const defaults = createDefaultLlmSettings();
  const provider = getProviderCatalog(input.providerId ?? defaults.providerId);
  const providerKind =
    provider.id === "openai" && input.providerKind === "oauth" ? "oauth" : "api_key";
  const model = normalizeModelSelection(provider.id, input.model ?? defaults.model);

  return {
    providerId: provider.id,
    providerKind,
    baseUrl:
      normalizeBaseUrl(providerKind === "oauth" ? CHATGPT_BASE_URL : provider.baseUrl) ??
      DEFAULT_OPENAI_BASE_URL,
    model,
    apiKey: input.apiKey ?? defaults.apiKey,
    loggedIn: Boolean(input.loggedIn),
    email: input.email,
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
      currentProvider.id === provider.id && providerKind === "api_key" ? current.apiKey : undefined,
  };
}

export function applyProviderKindSelection(
  current: Pick<LLMSettings, "providerId" | "providerKind" | "baseUrl" | "model" | "apiKey">,
  providerKind: ProviderKind
): Pick<LLMSettings, "providerKind" | "baseUrl" | "model" | "apiKey"> {
  const nextProviderKind =
    current.providerId === "openai" && providerKind === "oauth" ? "oauth" : "api_key";
  return {
    providerKind: nextProviderKind,
    baseUrl:
      nextProviderKind === "oauth"
        ? CHATGPT_BASE_URL
        : getProviderCatalog(current.providerId).baseUrl,
    model: normalizeModelSelection(current.providerId, current.model),
    apiKey: nextProviderKind === "api_key" ? current.apiKey : undefined,
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
