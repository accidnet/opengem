import { useQuery } from "@tanstack/react-query";

import { getAvailableProviders, type AvailableProviderInfo } from "@/features/api";

export const providerQueryKeys = {
  all: ["providers"] as const,
  available: ["providers", "available"] as const,
};

export function useAvailableProviders() {
  return useQuery<AvailableProviderInfo[]>({
    queryKey: providerQueryKeys.available,
    queryFn: getAvailableProviders,
    staleTime: 60_000,
  });
}
