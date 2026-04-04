import { useAvailableProviders } from "@/hooks/useAI";

export function hasAvailableProvider() {
  const { data = [] } = useAvailableProviders();

  return data.length > 0;
}
