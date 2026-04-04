import { useQuery, useQueryClient } from "@tanstack/react-query";

import { mapProvidersWithModels } from "@/config/loadModels";
import { getAvailableProviders } from "@/features/api";
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
      const providerModelsMap = new Map(
        mapProvidersWithModels(providers.map((provider) => provider.providerId)).map((provider) => [
          provider.id,
          Object.values(provider.models ?? {}),
        ])
      );

      return providers
        .map((provider) => ({
          ...provider,
          models: providerModelsMap.get(provider.providerId) ?? [],
        }))
        .filter((provider) => provider.models.length > 0);
    },
    staleTime: Infinity,
  });
}
