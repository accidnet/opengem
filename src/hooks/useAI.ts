import { useQuery } from "@tanstack/react-query";

import { getFallbackModels, getProviderCatalog } from "@/features/ai/catalog";
import type { AvailableModelInfo, AvailableProviderInfo, ProviderInfo } from "@/features/ai/types";
import { getAvailableProviders, getProviders, listProviderModels } from "@/features/backend/api";
import { queryClient } from "@/lib/queryClient";

export const AIQueryKeys = {
  all: ["ai"] as const,
  availableProviders: ["ai", "available", "providers"] as const,
  availableModels: ["ai", "available", "models"] as const,
  providers: ["ai", "providers"] as const,
};

const providerQuery = {
  queryKey: AIQueryKeys.availableProviders,
  queryFn: getAvailableProviders,
  networkMode: "always",
  staleTime: Infinity,
  retry: false,
} as const;

export function useAvailableProviders() {
  return useQuery(providerQuery);
}

export function useProviders() {
  return useQuery<ProviderInfo[]>({
    queryKey: AIQueryKeys.providers,
    queryFn: getProviders,
    networkMode: "always",
    staleTime: Infinity,
  });
}

function fallbackGroups(providers: AvailableProviderInfo[]): AvailableModelInfo[] {
  return providers.flatMap((provider) =>
    provider.credentialTypes.flatMap((credentialType) => {
      if (credentialType !== "api-key" && credentialType !== "oauth") return [];
      return [
        {
          ...provider,
          credentialType,
          providerName: getProviderCatalog(provider.providerId).label,
          source: "fallback" as const,
          models: getFallbackModels(provider.providerId, credentialType),
        },
      ];
    })
  );
}

function modelQuery(providers: AvailableProviderInfo[]) {
  return {
    queryKey: [...AIQueryKeys.availableModels, providers],
    queryFn: () =>
      Promise.all(
        fallbackGroups(providers).map(async (group) => {
          try {
            const models = await listProviderModels({
              providerId: group.providerId,
              credentialType: group.credentialType,
            });
            // 빈 응답도 계정의 실제 목록입니다. 조회가 실패한 연결에만 기본 목록을 씁니다.
            return { ...group, models, source: "live" as const };
          } catch {
            return group;
          }
        })
      ),
    staleTime: 5 * 60_000,
    networkMode: "always" as const,
    refetchOnReconnect: true,
    retry: false,
  };
}

export function getAvailableModels(providers: AvailableProviderInfo[]) {
  return queryClient.ensureQueryData({ ...modelQuery(providers), revalidateIfStale: true });
}

export async function preloadAvailableModels() {
  const providers = await queryClient.fetchQuery(providerQuery);
  await queryClient.prefetchQuery(modelQuery(providers));
}

export function useAvailableModels() {
  const providers = useAvailableProviders();
  const groups = providers.data ?? [];
  const result = useQuery({
    ...modelQuery(groups),
    enabled: providers.isSuccess,
    placeholderData: () => fallbackGroups(groups),
  });

  async function refetch() {
    const refreshed = await providers.refetch();
    if (!refreshed.isSuccess) return;
    const options = modelQuery(refreshed.data);
    await queryClient.invalidateQueries({
      queryKey: options.queryKey,
      exact: true,
      refetchType: "none",
    });
    await queryClient.fetchQuery(options);
  }

  return {
    data: result.data,
    isError: providers.isError || result.isError,
    isFetching: providers.isFetching || result.isFetching,
    refetch,
  };
}
