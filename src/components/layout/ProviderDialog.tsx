import type { LLMSettings } from "@/types/chat";
import { useMemo, useState } from "react";

type ProviderDialogProps = {
  settings: LLMSettings;
  isOpen: boolean;
  isSaving: boolean;
  isLoginBusy: boolean;
  isLoginWaiting: boolean;
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
  isLoginWaiting,
  loginUrl,
  errorMessage,
  onClose,
  onChange,
  onSave,
  onLoginChatGPT,
  onLogoutChatGPT,
}: ProviderDialogProps) {
  const providers = useMemo(
    () => [
      {
        id: "chatgpt",
        label: "ChatGPT",
        description: "OAuth 로그인으로 ChatGPT Plus/Pro 연결",
      },
      {
        id: "openai-compatible",
        label: "OpenAI Compatible",
        description: "직접 Base URL, Model, API Key 설정",
      },
    ],
    []
  );
  const defaultProvider =
    settings.providerKind === "chatgpt_oauth" ? "chatgpt" : "openai-compatible";
  const [selectedProvider, setSelectedProvider] = useState(defaultProvider);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="settings-overlay" role="presentation" onClick={onClose}>
      <section
        className="settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="settings-header">
          <div>
            <h3 id="settings-title" className="settings-title">
              프로바이더
            </h3>
            <p className="settings-description">
              ChatGPT 로그인과 OpenAI 호환 API 연결 정보를 여기서 관리해.
            </p>
          </div>
          <button
            className="small-icon-btn"
            type="button"
            aria-label="프로바이더 다이얼로그 닫기"
            onClick={onClose}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
              close
            </span>
          </button>
        </header>

        <div className="settings-stack">
          <section className="settings-provider-tabs" aria-label="provider 목록" role="tablist">
            {providers.map((provider) => {
              const isActive = selectedProvider === provider.id;

              return (
                <button
                  key={provider.id}
                  className={`settings-provider-tab ${isActive ? "is-active" : ""}`}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  onClick={() => setSelectedProvider(provider.id)}
                >
                  <strong>{provider.label}</strong>
                  <span>{provider.description}</span>
                </button>
              );
            })}
          </section>

          {selectedProvider === "chatgpt" ? (
            <section className="settings-card">
              <div className="settings-card-head">
                <div>
                  <h4>ChatGPT 로그인</h4>
                  <p>OpenAI OAuth로 ChatGPT Plus/Pro 계정을 연결해 바로 사용할 수 있어.</p>
                </div>
                <span
                  className={`settings-badge ${settings.chatgptLoggedIn ? "is-connected" : "is-idle"}`}
                >
                  {settings.chatgptLoggedIn ? "연결됨" : "미연결"}
                </span>
              </div>
              <div className="settings-auth-row">
                <div className="settings-auth-copy">
                  <strong>{settings.chatgptEmail || "ChatGPT 계정 연결 안 됨"}</strong>
                  <span>연결 시 모델은 기본적으로 `gpt-5.2`로 전환돼.</span>
                </div>
                {settings.chatgptLoggedIn ? (
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
                    disabled={isLoginBusy || isLoginWaiting}
                  >
                    {isLoginBusy
                      ? "로그인 링크 준비 중..."
                      : isLoginWaiting
                        ? "로그인 확인 중..."
                        : "ChatGPT 로그인"}
                  </button>
                )}
              </div>
              {!settings.chatgptLoggedIn && loginUrl && (
                <p className="settings-oauth-help">
                  브라우저가 자동으로 안 열리면 로그인 버튼을 한 번 더 눌러 외부 브라우저에서 다시
                  열어줘.
                </p>
              )}

              <label className="settings-field settings-field-wide">
                <span>연결 방식</span>
                <select
                  className="settings-input"
                  value={settings.providerKind}
                  onChange={(event) =>
                    onChange({ providerKind: event.target.value as LLMSettings["providerKind"] })
                  }
                >
                  <option value="api_key">OpenAI 호환 API</option>
                  <option value="chatgpt_oauth" disabled={!settings.chatgptLoggedIn}>
                    ChatGPT OAuth
                  </option>
                </select>
              </label>
            </section>
          ) : (
            <section className="settings-card settings-form-grid">
              <div className="settings-card-head settings-card-head-column">
                <div>
                  <h4>OpenAI Compatible</h4>
                  <p>직접 Base URL, Model, API Key를 입력해서 원하는 호환 서버를 사용할 수 있어.</p>
                </div>
              </div>

              <label className="settings-field">
                <span>연결 방식</span>
                <select
                  className="settings-input"
                  value={settings.providerKind}
                  onChange={(event) =>
                    onChange({ providerKind: event.target.value as LLMSettings["providerKind"] })
                  }
                >
                  <option value="api_key">OpenAI 호환 API</option>
                  <option value="chatgpt_oauth" disabled={!settings.chatgptLoggedIn}>
                    ChatGPT OAuth
                  </option>
                </select>
              </label>

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

              <label className="settings-field">
                <span>Model</span>
                <input
                  className="settings-input"
                  type="text"
                  value={settings.model}
                  onChange={(event) => onChange({ model: event.target.value })}
                  placeholder="gpt-4o-mini"
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
          )}
        </div>

        {errorMessage && <p className="settings-error">{errorMessage}</p>}

        <footer className="settings-footer">
          <button className="settings-secondary-btn" type="button" onClick={onClose}>
            닫기
          </button>
          <button
            className="settings-primary-btn"
            type="button"
            onClick={onSave}
            disabled={isSaving || isLoginBusy}
          >
            {isSaving ? "저장 중..." : "저장"}
          </button>
        </footer>
      </section>
    </div>
  );
}
