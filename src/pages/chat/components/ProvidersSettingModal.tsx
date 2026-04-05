import {
  applyProviderKindSelection,
  applyProviderSelection,
  getProviderCatalog,
} from "@/features/ai/catalog";
import { useProviders } from "@/hooks/useAI";
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

const PROVIDER_ICONS: Record<LLMSettings["providerId"], string> = {
  openai: "auto_awesome",
  anthropic: "psychiatry",
  google: "temp_preferences_custom",
  openrouter: "route",
  custom: "tune",
};

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
  const activeProvider = getProviderCatalog(settings.providerId);
  const providerLabelMap = new Map(providers.map((provider) => [provider.key, provider.label]));
  const activeProviderLabel = providerLabelMap.get(activeProvider.id) ?? activeProvider.label;
  const supportsChatGPTLogin = activeProvider.providerKinds.includes("oauth");
  const usesChatGPTLogin = settings.providerId === "openai" && settings.providerKind === "oauth";

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
            <p className="panel-modal-sidebar-help">Provider API 키 및 로그인을 관리합니다.</p>
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
              <h4>{activeProviderLabel} Configuration</h4>
              <p>{activeProvider.description}</p>
            </div>

            {supportsChatGPTLogin && (
              <section className="settings-card">
                <div className="settings-card-head settings-card-head-column">
                  <div>
                    <h4>Authentication</h4>
                    <p>OpenAI can use either a saved API key or a ChatGPT login.</p>
                  </div>
                </div>

                <div className="settings-auth-row">
                  <button
                    className={`settings-secondary-btn${!usesChatGPTLogin ? " is-active" : ""}`}
                    type="button"
                    onClick={() => onChange(applyProviderKindSelection(settings, "api_key"))}
                  >
                    API Key
                  </button>
                  <button
                    className={`settings-secondary-btn${usesChatGPTLogin ? " is-active" : ""}`}
                    type="button"
                    onClick={() => onChange(applyProviderKindSelection(settings, "oauth"))}
                  >
                    ChatGPT Login
                  </button>
                </div>

                <div className="settings-auth-row">
                  <div className="settings-auth-copy">
                    <strong>{settings.email || "No ChatGPT account connected"}</strong>
                    <span>
                      {settings.loggedIn
                        ? "OAuth tokens will be refreshed automatically when needed."
                        : "Login once to use OpenAI through your ChatGPT account session."}
                    </span>
                  </div>
                  {settings.loggedIn ? (
                    <button
                      className="settings-secondary-btn"
                      type="button"
                      onClick={onLogoutChatGPT}
                      disabled={isLoginBusy}
                    >
                      Log out
                    </button>
                  ) : (
                    <button
                      className="settings-primary-btn"
                      type="button"
                      onClick={onLoginChatGPT}
                      disabled={isLoginBusy}
                    >
                      {isLoginBusy ? "Preparing login..." : "Login with ChatGPT"}
                    </button>
                  )}
                </div>

                {!settings.loggedIn && loginUrl && (
                  <p className="settings-oauth-help">
                    If the browser did not open automatically, press the login button again to retry
                    the OAuth flow.
                  </p>
                )}
              </section>
            )}

            <section className="settings-card settings-form-grid">
              <div className="settings-card-head settings-card-head-column">
                <div>
                  <h4>Credentials</h4>
                  <p>Saved credentials are managed per provider and auth method.</p>
                </div>
              </div>

              {(!supportsChatGPTLogin || !usesChatGPTLogin) && (
                <label className="settings-field settings-field-wide">
                  <span>
                    {activeProvider.id === "openai" ? "API Key" : activeProvider.authLabel}
                  </span>
                  <input
                    className="settings-input"
                    type="password"
                    value={settings.apiKey || ""}
                    onChange={(event) => onChange({ apiKey: event.target.value })}
                    placeholder="Enter provider secret"
                  />
                </label>
              )}
            </section>
          </main>
        </div>

        {errorMessage && <p className="settings-error">{errorMessage}</p>}

        <footer className="settings-footer">
          <button className="settings-secondary-btn" type="button" onClick={onClose}>
            Cancel
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
