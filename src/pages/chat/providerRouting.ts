import type { AvailableModelInfo, AvailableProviderInfo } from "@/features/ai/types";
import type { LLMSettings, ResolvedLLMSettings } from "@/types/chat";

type ProviderId = ResolvedLLMSettings["providerId"];
type ProviderKind = ResolvedLLMSettings["providerKind"];
type ProviderPreferences = Partial<
  Pick<
    LLMSettings,
    "openaiOauthEnabled" | "openaiOauthPriority" | "openaiApiKeyEnabled" | "openaiApiKeyPriority"
  >
>;

// 인증 수단이 비활성화됐거나 자격 증명이 없으면 우선순위 대상에서 제외합니다.
function selectProviderKind(
  provider: AvailableProviderInfo,
  settings: ProviderPreferences
): ProviderKind | null {
  if (provider.providerId !== "openai") return provider.hasApiKey ? "api-key" : null;

  const oauthEnabled = settings.openaiOauthEnabled ?? true;
  const apiKeyEnabled = settings.openaiApiKeyEnabled ?? true;
  if (!oauthEnabled && !apiKeyEnabled) {
    throw new Error(
      "OpenAI 인증 수단이 모두 비활성화되어 있습니다. Provider 설정을 확인해 주세요."
    );
  }
  const candidates: { kind: ProviderKind; priority: number }[] = [];
  if (oauthEnabled && provider.loggedIn) {
    candidates.push({ kind: "oauth", priority: settings.openaiOauthPriority ?? 1 });
  }
  if (apiKeyEnabled && provider.hasApiKey) {
    candidates.push({ kind: "api-key", priority: settings.openaiApiKeyPriority ?? 2 });
  }
  candidates.sort((a, b) => a.priority - b.priority);
  return candidates[0]?.kind ?? null;
}

type ModelProvider = { providerId: string; models: { id: string }[] };

type ProviderSelection = {
  providerId: ProviderId;
  providerKind: ProviderKind;
  model: string;
};

const SUPPORTED_PROVIDERS: ProviderId[] = ["openai", "anthropic", "google", "openrouter", "custom"];

// 동일 모델을 제공하는 경우 현재 공급자를 우선하고, 설정되지 않은 공급자는 선택하지 않습니다.
export function selectModelProvider(input: {
  model?: string;
  activeSettings: ResolvedLLMSettings & ProviderPreferences;
  availableProviders: AvailableProviderInfo[];
  availableModels: Pick<AvailableModelInfo, "providerId" | "models">[];
  catalogModels: ModelProvider[];
}): ProviderSelection {
  const requestedModel = input.model?.trim();
  const model = requestedModel || input.activeSettings.model.trim();
  if (!model) throw new Error("사용할 모델이 설정되지 않았습니다.");

  if (input.activeSettings.providerId === "custom") {
    return { providerId: "custom", providerKind: input.activeSettings.providerKind, model };
  }

  const currentProvider = input.availableProviders.find(
    (provider) => provider.providerId === input.activeSettings.providerId
  );
  const hasModel = (providerId: string) =>
    [...input.availableModels, ...input.catalogModels].some(
      (provider) =>
        provider.providerId === providerId && provider.models.some((entry) => entry.id === model)
    );
  const currentMatches =
    !requestedModel ||
    model === input.activeSettings.model ||
    hasModel(input.activeSettings.providerId);
  if (currentProvider && currentMatches) {
    const providerKind = selectProviderKind(currentProvider, input.activeSettings);
    if (providerKind) {
      return { providerId: input.activeSettings.providerId, providerKind, model };
    }
  }

  for (const provider of input.availableProviders) {
    if (
      !SUPPORTED_PROVIDERS.includes(provider.providerId as ProviderId) ||
      provider.providerId === "custom" ||
      !hasModel(provider.providerId)
    )
      continue;
    const providerKind = selectProviderKind(provider, input.activeSettings);
    if (providerKind) return { providerId: provider.providerId as ProviderId, providerKind, model };
  }

  throw new Error(
    "선택한 모델을 사용할 수 있는 Provider가 없습니다. 모델과 Provider 설정을 확인해 주세요."
  );
}
