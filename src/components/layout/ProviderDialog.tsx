import { applyModelSelection, applyProviderSelection, getProviderCatalog, listProviders } from "@/data/llmCatalog";
import type { LLMSettings } from "@/types/chat";

type ProviderDialogProps = {
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
  chatgpt: "chat",
  anthropic: "psychiatry",
  google: "temp_preferences_custom",
  openrouter: "route",
  custom_openai: "tune",
};

export function ProviderDialog({
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
}: ProviderDialogProps) {
  if (!isOpen) {
    return null;
  }

  const providers = listProviders();
  const activeProvider = getProviderCatalog(settings.providerId);
  const modelOptions = activeProvider.models;
  const requiresChatGptLogin = activeProvider.providerKind === "chatgpt_oauth";

  return (
    <div className="settings-overlay" role="presentation" onClick={onClose}>
      <section
        className="provider-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="provider-header">
          <div className="provider-header-title-wrap">
            <span className="provider-header-icon material-symbols-outlined" aria-hidden="true">
              settings
            </span>
            <h3 id="settings-title" className="settings-title">
              Providers
            </h3>
          </div>
          <button className="provider-close-btn" type="button" aria-label="Close provider dialog" onClick={onClose}>
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </header>

        <div className="provider-body">
          <aside className="provider-sidebar" aria-label="Provider list">
            <p className="provider-sidebar-label">PROVIDERS</p>
            <p className="provider-sidebar-help">Manage model families, prompts, and credentials.</p>

            {providers.map((provider) => {
              const isActive = provider.id === activeProvider.id;
              return (
                <button
                  key={provider.id}
                  className={`provider-nav-item ${isActive ? "is-active" : ""}`}
                  type="button"
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => onChange(applyProviderSelection(settings, provider.id))}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">
                    {PROVIDER_ICONS[provider.id]}
                  </span>
                  <span>{provider.label}</span>
                </button>
              );
            })}
          </aside>

          <main className="provider-main">
            <div className="provider-main-copy">
              <h4>{activeProvider.label} Configuration</h4>
              <p>{activeProvider.description}</p>
            </div>

            {requiresChatGptLogin && (
              <section className="settings-card">
                <div className="settings-card-head">
                  <div>
                    <h4>ChatGPT Login</h4>
                    <p>Use ChatGPT OAuth when you want account-backed access instead of a raw API key.</p>
                  </div>
                  <span className={`settings-badge ${settings.chatgptLoggedIn ? "is-connected" : "is-idle"}`}>
                    {settings.chatgptLoggedIn ? "Status: Connected" : "Status: Not Logged In"}
                  </span>
                </div>
                <div className="settings-auth-row">
                  <div className="settings-auth-copy">
                    <strong>{settings.chatgptEmail || "No ChatGPT account connected"}</strong>
                    <span>OAuth tokens are refreshed automatically when the saved session is still valid.</span>
                  </div>
                  {settings.chatgptLoggedIn ? (
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
                {!settings.chatgptLoggedIn && loginUrl && (
                  <p className="settings-oauth-help">
                    If the browser did not open automatically, press the login button again to retry the OAuth flow.
                  </p>
                )}
              </section>
            )}

            <section className="settings-card settings-form-grid">
              <div className="settings-card-head settings-card-head-column">
                <div>
                  <h4>Model Defaults</h4>
                  <p>Model prompt selection is now resolved from the provider/model catalog instead of raw string checks.</p>
                </div>
              </div>

              <label className="settings-field">
                <span>Provider</span>
                <input className="settings-input" type="text" value={activeProvider.label} readOnly />
              </label>

              <label className="settings-field">
                <span>Model</span>
                {modelOptions.length > 0 ? (
                  <select
                    className="settings-input"
                    value={settings.model}
                    onChange={(event) => onChange(applyModelSelection(activeProvider.id, event.target.value))}
                  >
                    {modelOptions.map((model) => (
                      <option key={model.id} value={model.id}>
                        {model.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    className="settings-input"
                    type="text"
                    value={settings.model}
                    onChange={(event) => onChange({ model: event.target.value })}
                    placeholder={activeProvider.modelDefault}
                  />
                )}
              </label>

              <label className="settings-field settings-field-wide">
                <span>Base URL</span>
                <input
                  className="settings-input"
                  type="text"
                  value={settings.baseUrl}
                  onChange={(event) => onChange({ baseUrl: event.target.value })}
                  placeholder={activeProvider.baseUrl}
                />
              </label>

              {!requiresChatGptLogin && (
                <label className="settings-field settings-field-wide">
                  <span>{activeProvider.authLabel}</span>
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
          <button className="settings-primary-btn" type="button" onClick={onSave} disabled={isSaving || isLoginBusy}>
            {isSaving ? "Saving..." : "Done"}
          </button>
        </footer>
      </section>
    </div>
  );
}
