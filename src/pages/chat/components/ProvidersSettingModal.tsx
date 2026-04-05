import { applyProviderSelection, getProviderCatalog } from "@/features/ai/catalog";
import { useAvailableProviders, useProviders } from "@/hooks/useAI";
import type { LLMSettings } from "@/types/chat";

type ProvidersSettingModalProps = {
  settings: LLMSettings;
  isOpen: boolean;
  isSaving: boolean;
  isLoginBusy: boolean;
  loginUrl: string;
  errorMessage: string;
  onClose: () => void;
  onChange: (patch: Partial<LLMSettings>) => void;
  onSave: () => void;
  onLoginChatGPT: () => void;
  onLogoutChatGPT: () => void;
};

type OpenAICredentialMode = "oauth" | "api-key";

const PROVIDER_ICONS: Record<LLMSettings["providerId"], string> = {
  openai: "auto_awesome",
  anthropic: "psychiatry",
  google: "temp_preferences_custom",
  openrouter: "route",
  custom: "tune",
};

function buildOpenAIPreferencesPatch(
  settings: LLMSettings,
  mode: OpenAICredentialMode,
  input: Partial<
    Pick<
      LLMSettings,
      "openaiOauthEnabled" | "openaiOauthPriority" | "openaiApiKeyEnabled" | "openaiApiKeyPriority"
    >
  >
): Partial<LLMSettings> {
  const oauthEnabled = input.openaiOauthEnabled ?? settings.openaiOauthEnabled;
  const apiKeyEnabled = input.openaiApiKeyEnabled ?? settings.openaiApiKeyEnabled;

  if (mode === "oauth" && typeof input.openaiOauthPriority === "number") {
    const oauthPriority = input.openaiOauthPriority === 2 ? 2 : 1;
    return {
      openaiOauthEnabled: oauthEnabled,
      openaiOauthPriority: oauthPriority,
      openaiApiKeyEnabled: apiKeyEnabled,
      openaiApiKeyPriority: oauthPriority === 1 ? 2 : 1,
    };
  }

  if (mode === "api-key" && typeof input.openaiApiKeyPriority === "number") {
    const apiKeyPriority = input.openaiApiKeyPriority === 2 ? 2 : 1;
    return {
      openaiOauthEnabled: oauthEnabled,
      openaiOauthPriority: apiKeyPriority === 1 ? 2 : 1,
      openaiApiKeyEnabled: apiKeyEnabled,
      openaiApiKeyPriority: apiKeyPriority,
    };
  }

  return {
    openaiOauthEnabled: oauthEnabled,
    openaiOauthPriority: settings.openaiOauthPriority,
    openaiApiKeyEnabled: apiKeyEnabled,
    openaiApiKeyPriority: settings.openaiApiKeyPriority,
  };
}

function resolveOpenAIActiveCredential(input: {
  settings: LLMSettings;
  loggedIn: boolean;
  hasApiKey: boolean;
}): OpenAICredentialMode | null {
  const candidates = [
    {
      mode: "oauth" as const,
      enabled: input.settings.openaiOauthEnabled,
      available: input.loggedIn,
      priority: input.settings.openaiOauthPriority,
    },
    {
      mode: "api-key" as const,
      enabled: input.settings.openaiApiKeyEnabled,
      available: input.hasApiKey,
      priority: input.settings.openaiApiKeyPriority,
    },
  ];

  const active = candidates
    .filter((candidate) => candidate.enabled && candidate.available)
    .sort((left, right) => left.priority - right.priority)[0];

  return active?.mode ?? null;
}

export function ProvidersSettingModal({
  settings,
  isOpen,
  isSaving,
  isLoginBusy,
  loginUrl,
  errorMessage,
  onClose,
  onChange,
  onSave,
  onLoginChatGPT,
  onLogoutChatGPT,
}: ProvidersSettingModalProps) {
  const { data: providers = [] } = useProviders();
  const { data: availableProviders = [] } = useAvailableProviders();
  const activeProvider = getProviderCatalog(settings.providerId);
  const providerLabelMap = new Map(providers.map((provider) => [provider.key, provider.label]));
  const activeProviderLabel = providerLabelMap.get(activeProvider.id) ?? activeProvider.label;
  const supportsChatGPTLogin = activeProvider.providerKinds.includes("oauth");
  const openAIProviderInfo = availableProviders.find(
    (provider) => provider.providerId === "openai"
  );
  const hasSavedOpenAIApiKey = Boolean(openAIProviderInfo?.hasApiKey || settings.apiKey?.trim());
  const activeOpenAICredential =
    settings.providerId === "openai"
      ? resolveOpenAIActiveCredential({
          settings,
          loggedIn: settings.loggedIn,
          hasApiKey: hasSavedOpenAIApiKey,
        })
      : null;

  if (!isOpen) return null;

  return (
    <div className="settings-overlay" role="presentation" onClick={onClose}>
      <section
        className="panel-modal provider"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="panel-modal-header">
          <div className="panel-modal-header-title-wrap">
            <span className="panel-modal-header-icon material-symbols-outlined" aria-hidden="true">
              settings
            </span>
            <h3 id="settings-title" className="settings-title">
              Providers
            </h3>
          </div>
          <button
            className="panel-modal-close-btn"
            type="button"
            aria-label="Close provider dialog"
            onClick={onClose}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </header>

        <div className="panel-modal-body">
          <aside className="panel-modal-sidebar" aria-label="Provider list">
            <p className="panel-modal-sidebar-label">PROVIDERS</p>
            <p className="panel-modal-sidebar-help">
              공급자별 API 키와 로그인 인증 방식을 관리합니다.
            </p>
            {providers.map((provider) => {
              const isActive = provider.key === activeProvider.id;
              return (
                <button
                  key={provider.key}
                  className={`panel-modal-nav-item ${isActive ? "is-active" : ""}`}
                  type="button"
                  aria-current={isActive ? "true" : undefined}
                  onClick={() =>
                    onChange(
                      applyProviderSelection(settings, provider.key as LLMSettings["providerId"])
                    )
                  }
                >
                  <span className="material-symbols-outlined" aria-hidden="true">
                    {PROVIDER_ICONS[provider.key as LLMSettings["providerId"]]}
                  </span>
                  <span>{provider.label}</span>
                </button>
              );
            })}
          </aside>

          <main className="panel-modal-main">
            <div className="panel-modal-main-copy">
              <h4>{activeProviderLabel} 설정</h4>
              <p>{activeProvider.description}</p>
            </div>

            {supportsChatGPTLogin && (
              <section className="settings-card">
                <div className="settings-card-head settings-card-head-column">
                  <div>
                    <h4>로그인</h4>
                    <p>ChatGPT 계정 로그인 상태를 관리합니다.</p>
                  </div>
                </div>

                <div className="settings-auth-row">
                  <div className="settings-auth-copy">
                    <strong>{settings.email || "연동된 ChatGPT 계정이 없습니다."}</strong>
                    <span>
                      {settings.loggedIn
                        ? "로그인 토큰은 필요할 때 자동으로 갱신됩니다."
                        : "ChatGPT 로그인 버튼을 눌러 계정을 연동해 주세요."}
                    </span>
                  </div>
                  {settings.loggedIn ? (
                    <button
                      className="settings-secondary-btn"
                      type="button"
                      onClick={onLogoutChatGPT}
                      disabled={isLoginBusy}
                    >
                      로그아웃
                    </button>
                  ) : (
                    <button
                      className="settings-primary-btn"
                      type="button"
                      onClick={onLoginChatGPT}
                      disabled={isLoginBusy}
                    >
                      {isLoginBusy ? "로그인 준비 중..." : "ChatGPT 로그인"}
                    </button>
                  )}
                </div>
                {!settings.loggedIn && loginUrl && (
                  <p className="settings-oauth-help">
                    브라우저가 자동으로 열리지 않으면 로그인 버튼을 다시 눌러 OAuth 흐름을
                    재시도하세요.
                  </p>
                )}
              </section>
            )}

            <section className="settings-card settings-form-grid">
              <div className="settings-card-head settings-card-head-column">
                <div>
                  <h4>API 키</h4>
                  <p>OpenAI에서 발급받은 API 키를 입력하고 저장합니다.</p>
                </div>
              </div>

              {activeProvider.id === "custom" && (
                <label className="settings-field settings-field-wide">
                  <span>API URL</span>
                  <input
                    className="settings-input"
                    type="url"
                    value={settings.baseUrl}
                    onChange={(event) => onChange({ baseUrl: event.target.value })}
                    placeholder="https://your-endpoint.example/v1"
                  />
                </label>
              )}

              <label className="settings-field settings-field-wide">
                <span>{activeProvider.id === "openai" ? "API Key" : activeProvider.authLabel}</span>
                <input
                  className="settings-input"
                  type="password"
                  value={settings.apiKey || ""}
                  onChange={(event) => onChange({ apiKey: event.target.value })}
                  placeholder="Enter provider secret"
                />
              </label>
            </section>

            {activeProvider.id === "openai" && (
              <section className="settings-card">
                <div className="settings-card-head settings-card-head-column">
                  <div>
                    <h4>권한 설정</h4>
                    <p>로그인 권한과 API 키 권한을 각각 활성화하고 우선순위를 정합니다.</p>
                  </div>
                </div>

                <div className="settings-auth-method-grid">
                  <section
                    className={`settings-auth-method ${settings.openaiOauthEnabled ? "" : "is-disabled"}`}
                    aria-label="ChatGPT 로그인 권한 설정"
                  >
                    <div className="settings-auth-method-head">
                      <div>
                        <h5>로그인 권한</h5>
                        <p>ChatGPT 로그인 세션 기반 권한을 켜거나 끌 수 있습니다.</p>
                      </div>
                      <span
                        className={`settings-badge ${settings.loggedIn ? "is-connected" : "is-idle"}`}
                      >
                        {activeOpenAICredential === "oauth"
                          ? "현재 사용"
                          : settings.loggedIn
                            ? "연결됨"
                            : "미연결"}
                      </span>
                    </div>
                    <div className="settings-auth-method-controls">
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={settings.openaiOauthEnabled}
                          onChange={(event) =>
                            onChange(
                              buildOpenAIPreferencesPatch(settings, "oauth", {
                                openaiOauthEnabled: event.target.checked,
                              })
                            )
                          }
                        />
                        <span>활성화</span>
                      </label>
                      <label className="settings-field settings-priority-field">
                        <span>우선순위</span>
                        <select
                          className="settings-input"
                          value={settings.openaiOauthPriority}
                          disabled={!settings.openaiOauthEnabled}
                          onChange={(event) =>
                            onChange(
                              buildOpenAIPreferencesPatch(settings, "oauth", {
                                openaiOauthPriority: Number(event.target.value),
                              })
                            )
                          }
                        >
                          <option value={1}>1순위</option>
                          <option value={2}>2순위</option>
                        </select>
                      </label>
                    </div>
                  </section>

                  <section
                    className={`settings-auth-method ${settings.openaiApiKeyEnabled ? "" : "is-disabled"}`}
                    aria-label="API 키 권한 설정"
                  >
                    <div className="settings-auth-method-head">
                      <div>
                        <h5>API 키 권한</h5>
                        <p>저장된 OpenAI API 키 기반 권한을 켜거나 끌 수 있습니다.</p>
                      </div>
                      <span
                        className={`settings-badge ${hasSavedOpenAIApiKey ? "is-connected" : "is-idle"}`}
                      >
                        {activeOpenAICredential === "api-key"
                          ? "현재 사용"
                          : hasSavedOpenAIApiKey
                            ? "준비됨"
                            : "미입력"}
                      </span>
                    </div>
                    <div className="settings-auth-method-controls">
                      <label className="settings-toggle">
                        <input
                          type="checkbox"
                          checked={settings.openaiApiKeyEnabled}
                          onChange={(event) =>
                            onChange(
                              buildOpenAIPreferencesPatch(settings, "api-key", {
                                openaiApiKeyEnabled: event.target.checked,
                              })
                            )
                          }
                        />
                        <span>활성화</span>
                      </label>
                      <label className="settings-field settings-priority-field">
                        <span>우선순위</span>
                        <select
                          className="settings-input"
                          value={settings.openaiApiKeyPriority}
                          disabled={!settings.openaiApiKeyEnabled}
                          onChange={(event) =>
                            onChange(
                              buildOpenAIPreferencesPatch(settings, "api-key", {
                                openaiApiKeyPriority: Number(event.target.value),
                              })
                            )
                          }
                        >
                          <option value={1}>1순위</option>
                          <option value={2}>2순위</option>
                        </select>
                      </label>
                    </div>
                  </section>
                </div>

                <p className="settings-auth-priority-help">
                  활성화된 권한 중 실제로 연결 가능한 수단을 우선순위 순서대로 자동 선택합니다.
                </p>
              </section>
            )}
          </main>
        </div>

        {errorMessage && <p className="settings-error">{errorMessage}</p>}

        <footer className="settings-footer">
          <button className="settings-secondary-btn" type="button" onClick={onClose}>
            취소
          </button>
          <button
            className="settings-primary-btn"
            type="button"
            onClick={onSave}
            disabled={isSaving || isLoginBusy}
          >
            {isSaving ? "Saving..." : "Done"}
          </button>
        </footer>
      </section>
    </div>
  );
}
