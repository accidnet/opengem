export type AIModel = {
  id?: string;
  name?: string;
};

type ApiEndpoint = {
  url?: string;
  credentialType?: "oauth" | "api-key";
  description?: string;
  priority?: number;
};

export type AIProvider = {
  id?: string;
  name?: string;
  api?: string;
  apis?: ApiEndpoint[];
  models?: Record<string, AIModel>;
};

export type ModelCatalog = Record<string, AIProvider>;

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
  models: AIModel[];
};
