import { getProviderCredential } from "@/features/backend/api";

import type { LLMConfig } from "@/types/chat";

type ProviderCredentialType = LLMConfig["providerKind"];

type ProviderCredentialResult =
  | {
      providerId: string;
      credentialType: "oauth";
      accessToken?: string;
      accountId?: string;
    }
  | {
      providerId: string;
      credentialType: "api-key";
      apiKey?: string;
    };

export async function resolveProviderCredential(
  providerId: LLMConfig["providerId"],
  credentialType: ProviderCredentialType,
): Promise<ProviderCredentialResult> {
  return getProviderCredential({
    providerId,
    credentialType,
  });
}
