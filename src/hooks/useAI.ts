import { useQuery, useQueryClient } from "@tanstack/react-query";

import { mapProvidersWithModels } from "@/config/loadModels";
import { getAvailableProviders } from "@/features/backend/api";
import type { AvailableModelInfo, AvailableProviderInfo } from "@/features/ai/types";

export const AIQueryKeys = {
  all: ["ai"] as const,
  availableProviders: ["ai", "available", "providers"] as const,
  availableModels: ["ai", "available", "models"] as const,
};

function getAvailableProvidersQueryOptions() {
  return {
    queryKey: AIQueryKeys.availableProviders,
    queryFn: getAvailableProviders,
    staleTime: Infinity,
  } as const;
}

export function useAvailableProviders() {
  return useQuery<AvailableProviderInfo[]>(getAvailableProvidersQueryOptions());
}

export function useAvailableModels() {
  const queryClient = useQueryClient();
  return useQuery<AvailableModelInfo[]>({
    queryKey: AIQueryKeys.availableModels,
    queryFn: async () => {
      const providers = await queryClient.ensureQueryData(getAvailableProvidersQueryOptions());
      const providersWithModels = mapProvidersWithModels(
        providers.map((provider) => provider.providerId)
      );
      const providerModelsMap = new Map(
        providersWithModels.map((provider) => [provider.id, Object.values(provider.models ?? {})])
      );
      const providerNameMap = new Map(
        providersWithModels.map((provider) => [provider.id, provider.name?.trim() || provider.id])
      );

      return providers
        .map((provider) => ({
          ...provider,
          providerName: providerNameMap.get(provider.providerId) ?? provider.providerId,
          models: providerModelsMap.get(provider.providerId) ?? [],
        }))
        .filter((provider) => provider.models.length > 0);
    },
    staleTime: Infinity,
  });
}
