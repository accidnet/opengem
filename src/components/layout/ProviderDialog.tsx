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
          <button
            className="provider-close-btn"
            type="button"
            aria-label="프로바이더 다이얼로그 닫기"
            onClick={onClose}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </header>

        <div className="provider-body">
          <aside className="provider-sidebar" aria-label="providers 목록">
            <p className="provider-sidebar-label">PROVIDERS</p>
            <p className="provider-sidebar-help">Manage your AI credentials</p>

            <button className="provider-nav-item is-active" type="button" aria-current="true">
              <span className="material-symbols-outlined" aria-hidden="true">
                auto_awesome
              </span>
              <span>OpenAI</span>
            </button>
            <span className="provider-nav-item is-muted">
              <span className="material-symbols-outlined" aria-hidden="true">
                psychiatry
              </span>
              <span>Anthropic</span>
            </span>
            <span className="provider-nav-item is-muted">
              <span className="material-symbols-outlined" aria-hidden="true">
                temp_preferences_custom
              </span>
              <span>Google Gemini</span>
            </span>
            <span className="provider-nav-item is-muted">
              <span className="material-symbols-outlined" aria-hidden="true">
                network_node
              </span>
              <span>Meta Llama</span>
            </span>
            <span className="provider-nav-item is-muted">
              <span className="material-symbols-outlined" aria-hidden="true">
                cloud
              </span>
              <span>Mistral AI</span>
            </span>
          </aside>

          <main className="provider-main">
            <div className="provider-main-copy">
              <h4>OpenAI Configuration</h4>
              <p>
                Configure your OpenAI account, connect ChatGPT, or use your private API keys for
                agent tasks.
              </p>
            </div>

            <section className="settings-card">
              <div className="settings-card-head">
                <div>
                  <h4>ChatGPT Login</h4>
                  <p>OpenAI OAuth로 ChatGPT Plus/Pro 계정을 연결해 바로 사용할 수 있어.</p>
                </div>
                <span
                  className={`settings-badge ${settings.chatgptLoggedIn ? "is-connected" : "is-idle"}`}
                >
                  {settings.chatgptLoggedIn ? "Status: Connected" : "Status: Not Logged In"}
                </span>
              </div>
              <div className="settings-auth-row">
                <div className="settings-auth-copy">
                  <strong>{settings.chatgptEmail || "ChatGPT 계정 연결 안 됨"}</strong>
                  <span>OpenAI OAuth로 ChatGPT Plus/Pro 계정을 연결해서 바로 사용할 수 있어.</span>
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
                  브라우저가 자동으로 안 열리면 로그인 버튼을 한 번 더 눌러 외부 브라우저에서 다시
                  열어줘.
                </p>
              )}
            </section>

            <section className="settings-card settings-form-grid">
              <div className="settings-card-head settings-card-head-column">
                <div>
                  <h4>OpenAI API Key</h4>
                  <p>OpenAI 호환 API를 직접 연결할 때 필요한 정보만 입력해.</p>
                </div>
              </div>

              <label className="settings-field">
                <span>Base URL</span>
                <input
                  className="settings-input"
                  type="text"
                  value={settings.baseUrl}
                  onChange={(event) => onChange({ baseUrl: event.target.value })}
                  placeholder="https://api.openai.com/v1"
                />
              </label>

              <label className="settings-field settings-field-wide">
                <span>API Key</span>
                <input
                  className="settings-input"
                  type="password"
                  value={settings.apiKey || ""}
                  onChange={(event) => onChange({ apiKey: event.target.value })}
                  placeholder="sk-..."
                />
              </label>
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
