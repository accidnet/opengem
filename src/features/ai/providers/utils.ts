export function hasAvailableProvider(providers?: unknown[]) {
  return (providers?.length ?? 0) > 0;
}
