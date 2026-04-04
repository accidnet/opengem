import modelCatalog from "@/config/models.json";

import type { AIProvider } from "@/features/ai/types";

export type ModelCatalogResponse = Record<string, AIProvider>;

export function getModelCatalog(): ModelCatalogResponse {
  return modelCatalog as ModelCatalogResponse;
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
