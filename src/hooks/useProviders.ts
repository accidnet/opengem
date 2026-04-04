import { useQuery } from "@tanstack/react-query";

import { getAvailableProviders, type AvailableProviderInfo } from "@/features/api";

export const PROVIDERS_QUERY_KEY = ["providers"] as const;

export function useProviders() {
  return useQuery<AvailableProviderInfo[]>({
    queryKey: PROVIDERS_QUERY_KEY,
    queryFn: getAvailableProviders,
    staleTime: 60_000,
  });
}
