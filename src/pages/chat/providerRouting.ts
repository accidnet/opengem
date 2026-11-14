import type { AvailableModelInfo, AvailableProviderInfo } from "@/features/ai/types";
import type { ResolvedLLMSettings } from "@/types/chat";

type ProviderId = ResolvedLLMSettings["providerId"];
type ProviderKind = ResolvedLLMSettings["providerKind"];
type Connection = { providerId: ProviderId; providerKind: ProviderKind };

const SUPPORTED_PROVIDERS: ProviderId[] = ["openai", "anthropic", "google", "openrouter", "custom"];

function credentialKinds(provider: AvailableProviderInfo, settings: ResolvedLLMSettings) {
  const kinds: ProviderKind[] = [];
  if (
    provider.providerId === "openai" &&
    provider.loggedIn &&
    provider.credentialTypes.includes("oauth") &&
    settings.openaiOauthEnabled !== false
  )
    kinds.push("oauth");
  if (
    (provider.hasApiKey || provider.providerId === "custom") &&
    provider.credentialTypes.includes("api-key") &&
    (provider.providerId !== "openai" || settings.openaiApiKeyEnabled !== false)
  )
    kinds.push("api-key");
  if ((settings.openaiApiKeyPriority ?? 2) < (settings.openaiOauthPriority ?? 1)) kinds.reverse();
  return kinds;
}

export function selectModelProvider(input: {
  model?: string;
  activeSettings: ResolvedLLMSettings;
  availableProviders: AvailableProviderInfo[];
  availableModels: Pick<
    AvailableModelInfo,
    "providerId" | "credentialType" | "source" | "models"
  >[];
  hasCatalogModel: (providerId: ProviderId, model: string) => boolean;
}): Connection & { model: string } {
  const { activeSettings, availableProviders, availableModels, hasCatalogModel } = input;
  const model = input.model?.trim() || activeSettings.model.trim();
  if (!model) throw new Error("사용할 모델이 설정되지 않았습니다.");

  const connections: Connection[] = [];
  for (const provider of availableProviders) {
    const providerId = SUPPORTED_PROVIDERS.find((id) => id === provider.providerId);
    if (!providerId) continue;
    const group = credentialKinds(provider, activeSettings).map((providerKind) => ({
      providerId,
      providerKind,
    }));
    if (providerId === activeSettings.providerId) connections.unshift(...group);
    else connections.push(...group);
  }

  // 같은 모델이라도 계정에서 실제 조회한 연결을 먼저 사용합니다.
  for (const source of ["live", "fallback"] as const) {
    const match = connections.find(({ providerId, providerKind }) =>
      availableModels.some(
        (catalog) =>
          catalog.providerId === providerId &&
          catalog.credentialType === providerKind &&
          catalog.source === source &&
          catalog.models.some((entry) => entry.id === model)
      )
    );
    if (match) return { ...match, model };
  }

  // 기존에 저장된 모델은 번들의 원래 공급자에서 찾습니다.
  const legacyProviders = SUPPORTED_PROVIDERS.filter((id) => hasCatalogModel(id, model));
  const legacyMatch = connections.find(({ providerId }) => legacyProviders.includes(providerId));
  if (legacyMatch) return { ...legacyMatch, model };

  // 어느 공급자에도 등록되지 않은 ID는 사용자가 현재 설정한 서버로 전달합니다.
  const knownProviders = availableModels.filter((catalog) =>
    catalog.models.some((entry) => entry.id === model)
  );
  if (knownProviders.length === 0 && legacyProviders.length === 0) {
    const current = connections.find(({ providerId }) => providerId === activeSettings.providerId);
    if (current) return { ...current, model };
    if (activeSettings.providerId === "custom")
      return { providerId: "custom", providerKind: activeSettings.providerKind, model };
  }

  if (
    activeSettings.openaiOauthEnabled === false &&
    activeSettings.openaiApiKeyEnabled === false &&
    (activeSettings.providerId === "openai" ||
      legacyProviders.includes("openai") ||
      knownProviders.some((provider) => provider.providerId === "openai"))
  ) {
    throw new Error(
      "OpenAI 인증 수단이 모두 비활성화되어 있습니다. Provider 설정을 확인해 주세요."
    );
  }
  throw new Error(
    "선택한 모델을 사용할 수 있는 Provider가 없습니다. 모델과 Provider 설정을 확인해 주세요."
  );
}
