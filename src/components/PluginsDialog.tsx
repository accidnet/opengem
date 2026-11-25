import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  beginGoogleLogin,
  cancelGoogleLogin,
  disconnectGoogleService,
  getGoogleSettings,
  saveGoogleSettings,
  type GoogleService,
  type GoogleSettings,
} from "@/features/agent/googleApi";
import { openExternalUrl } from "@/features/backend/api";
import { GoogleWorkspacePanel } from "./GoogleWorkspacePanel";
import "./PluginsDialog.css";

const plugins = [
  {
    id: "gmail",
    name: "Gmail",
    icon: "mail",
    summary: "받은 메일 읽기 및 요약",
    permission: "받은편지함의 새 메일을 읽고 요약할 수 있어요.",
  },
  {
    id: "drive",
    name: "Google Drive",
    icon: "drive_file_move",
    summary: "파일 검색 및 문서 읽기",
    permission: "Drive에서 파일을 검색하고 지원하는 문서의 내용을 읽을 수 있어요.",
  },
  {
    id: "calendar",
    name: "Google Calendar",
    icon: "calendar_month",
    summary: "일정 조회 및 등록",
    permission: "캘린더의 일정을 조회하고, 직접 검토한 초안을 일정으로 등록할 수 있어요.",
  },
] as const satisfies ReadonlyArray<{
  id: GoogleService;
  name: string;
  icon: string;
  summary: string;
  permission: string;
}>;

type Plugin = (typeof plugins)[number];

function PluginIcon({ plugin }: { plugin: Plugin }) {
  return (
    <span className={"plugin-icon plugin-icon-" + plugin.id} aria-hidden="true">
      <span className="material-symbols-outlined">{plugin.icon}</span>
    </span>
  );
}

function OAuthClientForm({
  settings,
  disabled,
  onOpenConsole,
  onSave,
}: {
  settings: GoogleSettings;
  disabled: boolean;
  onOpenConsole: () => void;
  onSave: (input: { clientId: string; clientSecret?: string }) => void;
}) {
  const [clientId, setClientId] = useState(settings.clientId);
  const [clientSecret, setClientSecret] = useState("");
  const clientChanged = clientId.trim() !== settings.clientId;
  const needsSecret = clientChanged || !settings.hasClientSecret;
  const submit = (event: FormEvent) => {
    event.preventDefault();
    onSave({ clientId: clientId.trim(), clientSecret: clientSecret.trim() || undefined });
  };
  return (
    <form className="plugin-client-form" onSubmit={submit}>
      <p>
        <button type="button" className="plugin-console-link" onClick={onOpenConsole}>
          Google Cloud Console
        </button>
        에서 사용할 서비스의 API를 활성화하고 데스크톱 앱용 OAuth 클라이언트를 등록하세요.
      </p>
      <fieldset disabled={disabled}>
        <label>
          클라이언트 ID
          <input
            required
            autoComplete="off"
            spellCheck={false}
            maxLength={256}
            value={clientId}
            placeholder="…apps.googleusercontent.com"
            onChange={(event) => setClientId(event.target.value)}
          />
        </label>
        <label>
          클라이언트 보안 비밀
          <input
            type="password"
            required={needsSecret}
            autoComplete="new-password"
            value={clientSecret}
            placeholder={needsSecret ? "Google에서 발급한 값" : "저장됨"}
            onChange={(event) => setClientSecret(event.target.value)}
          />
        </label>
        <p>
          이 설정은 Google 플러그인이 공유해요. 값을 변경하면 연결된 플러그인에 다시 로그인해야
          해요.
        </p>
        <button
          className="settings-secondary-btn"
          disabled={!clientId.trim() || (!clientChanged && !clientSecret.trim())}
          type="submit"
        >
          저장
        </button>
      </fieldset>
    </form>
  );
}

function PluginWorkspace() {
  const [selected, setSelected] = useState<Plugin | null>(null);
  const [query, setQuery] = useState("");
  const [settings, setSettings] = useState<GoogleSettings | null>(null);
  const [editingClient, setEditingClient] = useState(false);
  const [authorizationUrls, setAuthorizationUrls] = useState<
    Partial<Record<GoogleService, string>>
  >({});
  const [error, setError] = useState("");
  const [loadError, setLoadError] = useState("");
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const generation = useRef(0);
  const alive = useRef(true);
  const native = isTauri();
  const pending = settings?.services.some((service) => service.loginPending) ?? false;
  const refresh = useCallback(async () => {
    if (!native) return;
    const request = ++generation.current;
    try {
      const next = await getGoogleSettings();
      if (request === generation.current && alive.current) {
        setSettings(next);
        setLoadError("");
      }
    } catch (cause) {
      if (request === generation.current && alive.current) setLoadError(String(cause));
    }
  }, [native]);

  useEffect(() => {
    alive.current = true;
    void refresh();
    window.addEventListener("focus", refresh);
    window.addEventListener("google-connections-updated", refresh);
    return () => {
      alive.current = false;
      window.removeEventListener("focus", refresh);
      window.removeEventListener("google-connections-updated", refresh);
    };
  }, [refresh]);

  // 기본 브라우저에서 돌아온 뒤에도 각 플러그인의 실제 인증 결과를 확인합니다.
  useEffect(() => {
    if (!pending) return;
    let active = true;
    let timer: number;
    const poll = async () => {
      await refresh();
      if (active) timer = window.setTimeout(poll, 1500);
    };
    timer = window.setTimeout(poll, 1500);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [pending, refresh]);

  const perform = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      await refresh();
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const pick = (plugin: Plugin | null) => {
    setSelected(plugin);
    setEditingClient(false);
    setError("");
  };
  const connect = (service: GoogleService) =>
    void perform(async () => {
      const { authorizationUrl } = await beginGoogleLogin(service);
      if (alive.current)
        setAuthorizationUrls((previous) => ({ ...previous, [service]: authorizationUrl }));
      await openExternalUrl(authorizationUrl);
    });
  const disconnect = (plugin: Plugin) => {
    if (
      !window.confirm(
        plugin.name +
          " 연결을 해제할까요? 이 플러그인을 사용하는 예약은 다시 연결해야 실행할 수 있어요."
      )
    )
      return;
    void perform(async () => {
      await disconnectGoogleService(plugin.id);
      window.dispatchEvent(new Event("google-connections-updated"));
    });
  };
  const byService = (id: GoogleService) =>
    settings?.services.find((service) => service.service === id);
  const connections = plugins.filter((plugin) => byService(plugin.id)?.connected);
  const visible = plugins.filter((plugin) =>
    (plugin.name + " " + plugin.summary)
      .toLocaleLowerCase()
      .includes(query.trim().toLocaleLowerCase())
  );
  const status = selected && byService(selected.id);
  const ready = Boolean(settings?.clientId && settings.hasClientSecret);

  return (
    <>
      <aside className="plugins-sidebar" aria-label="플러그인 탐색">
        <button
          type="button"
          className="plugins-nav-item"
          aria-current={!selected ? "page" : undefined}
          onClick={() => pick(null)}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            extension
          </span>
          전체 플러그인
        </button>
        <div className="plugins-connected">
          <h3>연결됨</h3>
          {connections.map((plugin) => (
            <button
              key={plugin.id}
              className="plugins-nav-item"
              type="button"
              aria-current={selected?.id === plugin.id ? "page" : undefined}
              onClick={() => pick(plugin)}
            >
              <PluginIcon plugin={plugin} />
              {plugin.name}
            </button>
          ))}
          {connections.length === 0 && (
            <p>
              {native && !settings
                ? loadError
                  ? "상태 확인 실패"
                  : "확인 중…"
                : "연결된 플러그인 없음"}
            </p>
          )}
        </div>
      </aside>
      <div className="plugins-main">
        <header className="plugins-header">
          <DialogTitle className="plugins-title">
            {selected && <PluginIcon plugin={selected} />}
            {selected?.name ?? "플러그인"}
          </DialogTitle>
          {!selected && (
            <label className="plugins-search">
              <span className="material-symbols-outlined" aria-hidden="true">
                search
              </span>
              <input
                type="search"
                value={query}
                aria-label="플러그인 검색"
                placeholder="플러그인 검색"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
          )}
        </header>
        {loadError && (
          <div className="plugins-feedback" role="alert">
            <p>연결 상태를 불러오지 못했어요. {loadError}</p>
            <button className="settings-secondary-btn" type="button" onClick={() => void refresh()}>
              다시 시도
            </button>
          </div>
        )}
        {error && (
          <p className="plugins-feedback" role="alert">
            {error}
          </p>
        )}
        {!selected ? (
          <div className="plugins-catalog">
            {visible.map((plugin) => {
              const connection = byService(plugin.id);
              return (
                <button
                  key={plugin.id}
                  className="plugin-row"
                  type="button"
                  onClick={() => pick(plugin)}
                >
                  <PluginIcon plugin={plugin} />
                  <span className="plugin-row-copy">
                    <strong>{plugin.name}</strong>
                    <small>{plugin.summary}</small>
                  </span>
                  <span className="material-symbols-outlined plugin-row-action" aria-hidden="true">
                    {connection?.loginPending
                      ? "hourglass_empty"
                      : connection?.connected
                        ? "check_circle"
                        : "add"}
                  </span>
                  {connection?.connected && <span className="sr-only">연결됨</span>}
                </button>
              );
            })}
            {!visible.length && (
              <p className="plugins-empty" role="status">
                검색 결과가 없어요.
              </p>
            )}
          </div>
        ) : (
          <div className="plugin-detail" key={selected.id}>
            <section className="plugin-section">
              <h3>계정 연결</h3>
              <p>{selected.permission} 연결한 계정은 모든 에이전트가 함께 사용해요.</p>
              <p>에이전트에 요약이나 분석을 요청하면 읽은 내용이 선택한 AI 제공자에게 전달돼요.</p>
              {status?.lastError && (
                <p className="plugins-feedback" role="alert">
                  {status.lastError}
                </p>
              )}
              {!native ? (
                <p role="status">OpenGem 데스크톱 앱에서 계정을 연결해 주세요.</p>
              ) : !settings ? (
                !loadError && <p role="status">연결 상태를 확인하고 있어요.</p>
              ) : (
                <>
                  {status?.connected && (
                    <strong className="plugin-account">연결됨 · {status.email}</strong>
                  )}
                  {status?.loginPending ? (
                    <>
                      <p role="status">브라우저에서 Google 로그인을 완료해 주세요.</p>
                      <div className="plugin-actions">
                        {authorizationUrls[selected.id] && (
                          <button
                            className="settings-secondary-btn"
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void perform(() => openExternalUrl(authorizationUrls[selected.id]!))
                            }
                          >
                            로그인 페이지 다시 열기
                          </button>
                        )}
                        <button
                          type="button"
                          className="settings-secondary-btn"
                          disabled={busy}
                          onClick={() => void perform(() => cancelGoogleLogin(selected.id))}
                        >
                          연결 취소
                        </button>
                      </div>
                    </>
                  ) : ready ? (
                    <div className="plugin-actions">
                      <button
                        type="button"
                        className="settings-primary-btn"
                        disabled={busy || editingClient}
                        onClick={() => connect(selected.id)}
                      >
                        {status?.connected ? "다시 연결" : "Google로 로그인"}
                      </button>
                      {status?.connected && (
                        <button
                          className="settings-secondary-btn"
                          type="button"
                          disabled={busy}
                          onClick={() => disconnect(selected)}
                        >
                          연결 해제
                        </button>
                      )}
                    </div>
                  ) : (
                    <p role="status">
                      Google 로그인을 사용하려면 아래에 OAuth 클라이언트를 한 번 등록해 주세요.
                    </p>
                  )}
                </>
              )}
            </section>
            {status?.connected && status.email && selected.id !== "gmail" && (
              <section className="plugin-section">
                <h3>{selected.id === "drive" ? "Drive 파일" : "Calendar 일정"}</h3>
                <GoogleWorkspacePanel
                  key={selected.id + ":" + status.email}
                  service={selected.id}
                  accountEmail={status.email}
                />
              </section>
            )}
            {settings && (
              <section className="plugin-client">
                <button
                  className="plugin-client-toggle"
                  type="button"
                  aria-expanded={editingClient || !ready}
                  disabled={!ready || busy}
                  onClick={() => setEditingClient(!editingClient)}
                >
                  <span className="material-symbols-outlined" aria-hidden="true">
                    settings
                  </span>
                  OAuth 클라이언트 설정
                  <span className="material-symbols-outlined" aria-hidden="true">
                    {editingClient || !ready ? "expand_less" : "expand_more"}
                  </span>
                </button>
                {(editingClient || !ready) && (
                  <OAuthClientForm
                    key={settings.clientId}
                    settings={settings}
                    disabled={busy || pending}
                    onOpenConsole={() =>
                      void perform(() =>
                        openExternalUrl("https://console.cloud.google.com/apis/credentials")
                      )
                    }
                    onSave={(input) =>
                      void perform(async () => {
                        await saveGoogleSettings(input);
                        if (alive.current) setEditingClient(false);
                        window.dispatchEvent(new Event("google-connections-updated"));
                      })
                    }
                  />
                )}
              </section>
            )}
          </div>
        )}
      </div>
    </>
  );
}

export function PluginsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="plugins-dialog" aria-describedby={undefined}>
        {open && <PluginWorkspace />}
      </DialogContent>
    </Dialog>
  );
}
