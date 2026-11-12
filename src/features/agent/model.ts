import {
  getAvailableProviders,
  getProviderCredential,
  resolveLlmSettings,
} from "@/features/backend/api";
import { getProviderCatalog, listProviders } from "@/features/ai/catalog";
import { resolveProviderApiUrl } from "@/config/loadModels";
import { selectModelProvider } from "@/pages/chat/providerRouting";
import type { ResolvedLLMSettings } from "@/types/chat";

export async function resolveAgentModel(model?: string | null): Promise<ResolvedLLMSettings> {
  const [activeSettings, availableProviders] = await Promise.all([
    resolveLlmSettings(),
    getAvailableProviders(),
  ]);
  const selected = selectModelProvider({
    model: model ?? undefined,
    activeSettings,
    availableProviders,
    availableModels: [],
    catalogModels: listProviders().map((p) => ({ providerId: p.id, models: p.models })),
  });
  if (selected.providerId === "custom") return { ...activeSettings, model: selected.model };
  const credential = await getProviderCredential({
    providerId: selected.providerId,
    credentialType: selected.providerKind,
  });
  if (
    credential.providerId !== selected.providerId ||
    credential.credentialType !== selected.providerKind
  )
    throw new Error("Provider 인증 설정을 확인해 주세요.");
  if (credential.credentialType === "api-key" ? !credential.apiKey : !credential.accessToken)
    throw new Error("Provider 인증 설정을 확인해 주세요.");
  const provider = availableProviders.find((p) => p.providerId === selected.providerId);
  return {
    ...selected,
    baseUrl:
      provider?.apiUrls[selected.providerKind] ||
      resolveProviderApiUrl(
        selected.providerId,
        selected.providerKind,
        getProviderCatalog(selected.providerId).baseUrl
      ),
    ...(credential.credentialType === "api-key"
      ? { apiKey: credential.apiKey }
      : { accessToken: credential.accessToken, accountId: credential.accountId }),
  };
}
