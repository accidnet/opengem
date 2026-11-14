export type AIModel = {
  id?: string;
  name?: string;
};

export type ModelCatalog = Record<string, { models?: Record<string, AIModel> }>;

export type AvailableProviderInfo = {
  providerId: string;
  credentialTypes: string[];
  apiUrl?: string;
  apiUrls: Partial<Record<"oauth" | "api-key", string>>;
  hasApiKey: boolean;
  loggedIn: boolean;
  email?: string;
};

export type ProviderInfo = {
  key: string;
  label: string;
  protocol: string;
};

export type AvailableModelInfo = AvailableProviderInfo & {
  providerName: string;
  credentialType: "oauth" | "api-key";
  source: "live" | "fallback";
  models: AIModel[];
};
