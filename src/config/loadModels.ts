import modelsJson from "@/config/models.json";

import type { AIProvider, ModelCatalog } from "@/features/ai/types";

import { normalizeBaseUrl } from "@/lib/utils";

export function getModelCatalog(): ModelCatalog {
  const catalog = modelsJson as ModelCatalog;
  const openaiProvider = catalog.openai;

  if (openaiProvider) {
    openaiProvider.apis = [
      {
        url: "https://chatgpt.com/backend-api/codex",
        credentialType: "oauth",
        description: "OpenAI OAuth (ChatGPT Pro/Plus Account)",
        priority: 1,
      },
      {
        url: "https://api.openai.com/v1",
        credentialType: "api-key",
        description: "OpenAI API",
        priority: 2,
      },
    ];
  }

  return catalog;
}

export function mapProvidersWithModels(providerIds: string[]): AIProvider[] {
  const catalog = getModelCatalog();

  return providerIds
    .map((providerId) => {
      const catalogEntry = catalog[providerId];
      const models = Object.fromEntries(
        Object.entries(catalogEntry?.models ?? {}).map(([id, model]) => {
          const modelId = model.id?.trim() || id;
          return [
            modelId,
            {
              id: modelId,
              name: model.name?.trim() || modelId,
            },
          ];
        })
      );

      return {
        id: providerId,
        name: catalogEntry?.name,
        models,
      };
    })
    .filter((provider) => Object.keys(provider.models ?? {}).length > 0);
}

export function resolveProviderApiUrl(
  providerId: string,
  credentialType: "oauth" | "api-key",
  fallbackUrl?: string | null
): string {
  const catalog = getModelCatalog();
  const provider = catalog[providerId];
  const normalizedFallback = normalizeBaseUrl(fallbackUrl);

  if (!provider) {
    return normalizedFallback || "";
  }

  const matchedApi = [...(provider.apis ?? [])]
    .sort(
      (left, right) =>
        (left.priority ?? Number.MAX_SAFE_INTEGER) - (right.priority ?? Number.MAX_SAFE_INTEGER)
    )
    .find((api) => api.url && api.credentialType === credentialType);

  if (matchedApi?.url) {
    return matchedApi.url;
  }

  if (provider.api?.trim()) {
    return provider.api.trim();
  }

  return normalizedFallback || "";
}
