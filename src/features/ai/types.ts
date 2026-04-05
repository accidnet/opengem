export type AIModel = {
  id?: string;
  name?: string;
};

export type AIProvider = {
  id?: string;
  name?: string;
  models?: Record<string, AIModel>;
};

export type AvailableProviderInfo = {
  providerId: string;
  credentialTypes: string[];
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
