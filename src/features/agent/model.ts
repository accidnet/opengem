import {
  getAvailableProviders,
  getProviderCredential,
  resolveLlmSettings,
} from "@/features/backend/api";
import { getProviderCatalog } from "@/features/ai/catalog";
import { getModelCatalog, resolveProviderApiUrl } from "@/config/loadModels";
import { selectModelProvider } from "@/pages/chat/providerRouting";
import { getAvailableModels } from "@/hooks/useAI";
import type { AvailableProviderInfo } from "@/features/ai/types";
import type { ResolvedLLMSettings } from "@/types/chat";

export async function resolveAgentModel(
  model?: string | null,
  context?: { activeSettings: ResolvedLLMSettings; availableProviders: AvailableProviderInfo[] }
): Promise<ResolvedLLMSettings> {
  const [activeSettings, availableProviders] = context
    ? ([context.activeSettings, context.availableProviders] as const)
    : await Promise.all([resolveLlmSettings(), getAvailableProviders()]);
  const legacyCatalog = getModelCatalog();
  const selected = selectModelProvider({
    model: model ?? undefined,
    activeSettings,
    availableProviders,
    availableModels: await getAvailableModels(availableProviders),
    hasCatalogModel: (providerId, id) =>
      Object.prototype.hasOwnProperty.call(legacyCatalog[providerId]?.models ?? {}, id) ||
      getProviderCatalog(providerId).models.some((entry) => entry.id === id),
  });
  if (selected.providerId === "custom") {
    // 설정을 바꾸는 중에도 같은 DB 행에서 읽은 서버 주소와 키를 함께 사용합니다.
    const credential = await getProviderCredential({
      providerId: selected.providerId,
      credentialType: selected.providerKind,
    });
    if (credential.providerId !== "custom" || credential.credentialType !== "api-key")
      throw new Error("Provider 인증 설정을 확인해 주세요.");
    if (!credential.baseUrl?.trim()) throw new Error("선택한 Provider의 API 주소를 확인해 주세요.");
    return {
      ...selected,
      providerKind: "api-key",
      baseUrl: credential.baseUrl,
      apiKey: credential.apiKey,
    };
  }
  // 다른 연결로 전환하면 해당 연결에 저장된 주소와 자격 증명을 함께 사용합니다.
  const provider = availableProviders.find((p) => p.providerId === selected.providerId);
  const sameCredential =
    selected.providerId === activeSettings.providerId &&
    selected.providerKind === activeSettings.providerKind;
  const baseUrl =
    provider?.apiUrls[selected.providerKind] ||
    (sameCredential ? activeSettings.baseUrl : undefined) ||
    resolveProviderApiUrl(
      selected.providerId,
      selected.providerKind,
      getProviderCatalog(selected.providerId).baseUrl
    );
  if (!baseUrl) throw new Error("선택한 Provider의 API 주소를 확인해 주세요.");
  if (
    sameCredential &&
    (selected.providerKind === "api-key"
      ? activeSettings.apiKey?.trim()
      : activeSettings.accessToken?.trim())
  ) {
    return { ...activeSettings, model: selected.model, baseUrl };
  }
  const credential = await getProviderCredential({
    providerId: selected.providerId,
    credentialType: selected.providerKind,
  });
  if (
    credential.providerId !== selected.providerId ||
    credential.credentialType !== selected.providerKind
  )
    throw new Error("Provider 인증 설정을 확인해 주세요.");
  if (
    credential.credentialType === "api-key"
      ? !credential.apiKey?.trim()
      : !credential.accessToken?.trim()
  )
    throw new Error("Provider 인증 설정을 확인해 주세요.");
  return {
    ...selected,
    baseUrl,
    ...(credential.credentialType === "api-key"
      ? { apiKey: credential.apiKey }
      : { accessToken: credential.accessToken, accountId: credential.accountId }),
  };
}
