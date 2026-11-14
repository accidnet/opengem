import modelsJson from "@/config/models.json";
import type { ModelCatalog } from "@/features/ai/types";
import { CHATGPT_BASE_URL, getProviderCatalog } from "@/features/ai/catalog";
import { normalizeBaseUrl } from "@/lib/utils";

export function getModelCatalog(): ModelCatalog {
  return modelsJson as ModelCatalog;
}

export function resolveProviderApiUrl(
  providerId: string,
  credentialType: "oauth" | "api-key",
  configuredUrl?: string | null
): string {
  if (providerId === "openai" && credentialType === "oauth") return CHATGPT_BASE_URL;
  return normalizeBaseUrl(configuredUrl) || getProviderCatalog(providerId).baseUrl;
}
