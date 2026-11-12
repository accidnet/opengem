import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  beginGoogleLogin,
  cancelGoogleLogin,
  disconnectGoogleService,
  getGoogleSettings,
  saveGoogleSettings,
  type GoogleSettings,
  type GoogleService,
} from "@/features/agent/googleApi";
import { openExternalUrl } from "@/features/backend/api";
import { GoogleWorkspacePanel } from "./GoogleWorkspacePanel";
import "./EmailSettingsModal.css";

type EmailSettingsModalProps = { open: boolean; onClose: () => void };
const SERVICES: { id: GoogleService; name: string; icon: string; description: string }[] = [
  {
    id: "gmail",
    name: "Gmail",
    icon: "mail",
    description: "받은편지함의 새 메일을 읽고 요약해요. 메일을 보내거나 삭제하지 않아요.",
  },
  {
    id: "drive",
    name: "Google Drive",
    icon: "folder",
    description: "파일을 검색하고 지원하는 문서를 읽어요. 파일을 수정하거나 삭제하지 않아요.",
  },
  {
    id: "calendar",
    name: "Google Calendar",
    icon: "calendar_month",
    description:
      "일정을 조회하고, 검토한 초안만 직접 등록해요. 참석자 초대나 이메일 알림은 보내지 않아요.",
  },
];

function GoogleSettingsContent() {
  const [settings, setSettings] = useState<GoogleSettings | null>(null);
  const [tab, setTab] = useState<"connections" | "drive" | "calendar">("connections");
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authorizationUrls, setAuthorizationUrls] = useState<
    Partial<Record<GoogleService, string>>
  >({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(true);
  const busyRef = useRef(false);
  const loginPending = settings?.services.some((service) => service.loginPending) ?? false;

  useEffect(() => {
    alive.current = true;
    void getGoogleSettings()
      .then((next) => {
        if (!alive.current) return;
        setSettings(next);
        setClientId(next.clientId);
      })
      .catch((cause) => {
        if (alive.current) setError(String(cause));
      })
      .finally(() => {
        if (alive.current) setLoading(false);
      });
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    const refresh = () => {
      void getGoogleSettings()
        .then((next) => {
          if (alive.current) setSettings(next);
        })
        .catch((cause) => {
          if (alive.current) setError(String(cause));
        });
    };
    window.addEventListener("google-connections-updated", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("google-connections-updated", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, []);

  // 인증 값 대신 서비스별 연결 상태만 주기적으로 확인합니다.
  useEffect(() => {
    if (!loginPending) return;
    let cancelled = false;
    let polling = false;
    const timer = window.setInterval(() => {
      if (polling) return;
      polling = true;
      void getGoogleSettings()
        .then((next) => {
          if (cancelled) return;
          setSettings(next);
          if (!next.services.some((service) => service.loginPending)) {
            setAuthorizationUrls({});
            setNotice("연결 결과를 아래 서비스 카드에서 확인해 주세요.");
            window.dispatchEvent(new Event("google-connections-updated"));
          }
        })
        .catch((cause) => {
          if (!cancelled) setError(String(cause));
        })
        .finally(() => {
          polling = false;
        });
    }, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [loginPending]);

  const perform = async (operation: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      busyRef.current = false;
      if (alive.current) setBusy(false);
    }
  };
  const credentialsChanged = clientId.trim() !== settings?.clientId || Boolean(clientSecret.trim());
  const save = (event: FormEvent) => {
    event.preventDefault();
    void perform(async () => {
      const next = await saveGoogleSettings({
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim() || undefined,
      });
      if (!alive.current) return;
      setSettings(next);
      setClientSecret("");
      setNotice("Google 설정을 저장했어요. 사용할 서비스를 각각 연결해 주세요.");
      window.dispatchEvent(new Event("google-connections-updated"));
    });
  };
  const connect = (service: GoogleService) =>
    void perform(async () => {
      const result = await beginGoogleLogin(service);
      if (!alive.current) return;
      setAuthorizationUrls((previous) => ({ ...previous, [service]: result.authorizationUrl }));
      setSettings(await getGoogleSettings());
      await openExternalUrl(result.authorizationUrl);
    });

  return (
    <div className="email-settings-body">
      <div className="google-settings-tabs" role="group" aria-label="Google 서비스 설정">
        <button
          type="button"
          aria-pressed={tab === "connections"}
          onClick={() => setTab("connections")}
        >
          연결 설정
        </button>
        <button type="button" aria-pressed={tab === "drive"} onClick={() => setTab("drive")}>
          Drive 파일
        </button>
        <button type="button" aria-pressed={tab === "calendar"} onClick={() => setTab("calendar")}>
          Calendar 일정
        </button>
      </div>
      {error && (
        <p className="email-settings-error" role="alert">
          {error}
        </p>
      )}
      {notice && (
        <p className="email-settings-notice" role="status">
          {notice}
        </p>
      )}
      {loading && <p role="status">Google 연결 상태를 확인하고 있어요.</p>}
      {tab !== "connections" && settings && (
        <GoogleWorkspacePanel
          key={
            tab +
            ":" +
            (settings.services.find((service) => service.service === tab)?.email ?? "") +
            ":" +
            String(settings.services.find((service) => service.service === tab)?.connected)
          }
          service={tab}
          settings={settings}
          onOpenConnections={() => setTab("connections")}
        />
      )}
      {tab === "connections" && (
        <>
          <p className="email-settings-copy">
            연결은 모든 에이전트가 함께 사용해요. 필요한 서비스만 선택해서 연결할 수 있고, 각
            서비스의 계정과 연결 상태를 따로 확인할 수 있어요.
          </p>
          <div className="google-service-list">
            {SERVICES.map((service) => {
              const status = settings?.services.find((item) => item.service === service.id);
              return (
                <section
                  className="google-service-card"
                  key={service.id}
                  aria-label={service.name + " 연결"}
                >
                  <div className="email-settings-status">
                    <span className="material-symbols-outlined" aria-hidden="true">
                      {service.icon}
                    </span>
                    <div>
                      <strong>
                        {service.name} ·{" "}
                        {status?.loginPending
                          ? "연결 대기 중"
                          : status?.connected
                            ? "연결됨"
                            : "연결 필요"}
                      </strong>
                      <p>{status?.email || "사용할 계정을 연결해 주세요."}</p>
                    </div>
                  </div>
                  <p className="email-settings-copy">{service.description}</p>
                  {status?.lastError && (
                    <p className="email-settings-error" role="alert">
                      {status.lastError}
                    </p>
                  )}
                  <div className="email-settings-actions">
                    {status?.loginPending ? (
                      <>
                        {authorizationUrls[service.id] && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void perform(() => openExternalUrl(authorizationUrls[service.id]!))
                            }
                          >
                            로그인 페이지 다시 열기
                          </button>
                        )}
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() =>
                            void perform(async () => {
                              await cancelGoogleLogin(service.id);
                              if (alive.current) setSettings(await getGoogleSettings());
                            })
                          }
                        >
                          연결 취소
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        className="is-primary"
                        disabled={
                          busy ||
                          loading ||
                          !settings?.clientId ||
                          !settings?.hasClientSecret ||
                          credentialsChanged
                        }
                        onClick={() => connect(service.id)}
                      >
                        {status?.connected ? "다시 연결" : service.name + " 연결"}
                      </button>
                    )}
                    {status?.connected && !status.loginPending && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => {
                          if (
                            window.confirm(
                              service.name +
                                " 연결을 해제할까요? 이 서비스를 사용하는 업무는 재연결 전까지 사용할 수 없어요."
                            )
                          )
                            void perform(async () => {
                              const next = await disconnectGoogleService(service.id);
                              if (!alive.current) return;
                              setSettings(next);
                              setNotice(service.name + " 연결을 해제했어요.");
                              window.dispatchEvent(new Event("google-connections-updated"));
                            });
                        }}
                      >
                        연결 해제
                      </button>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
          <details className="email-settings-guide" open={!settings?.clientId}>
            <summary>처음 연결하는 방법</summary>
            <ol>
              <li>
                <button
                  type="button"
                  className="email-settings-link"
                  onClick={() =>
                    void perform(() =>
                      openExternalUrl("https://console.cloud.google.com/apis/library")
                    )
                  }
                >
                  Google Cloud Console
                </button>
                에서 프로젝트를 만들고 사용할 Gmail API, Google Drive API, Google Calendar API를
                사용 설정하세요.
              </li>
              <li>
                Google Auth Platform의 동의 화면을 설정하세요. 테스트 상태라면 연결할 Google 계정을
                테스트 사용자로 추가하세요.
              </li>
              <li>
                클라이언트에서 <strong>데스크톱 앱</strong> 유형의 OAuth 클라이언트를 만들고 아래
                공통 설정에 입력하세요.
              </li>
              <li>
                설정을 저장한 뒤 사용할 서비스의 연결 버튼을 누르고 브라우저에서 표시된 권한을
                확인하세요. 이미 연결한 Gmail만으로 Drive·Calendar가 자동 연결되지는 않아요.
              </li>
            </ol>
            <p>테스트 상태인 Google 앱은 연결이 만료되어 재연결이 필요할 수 있어요.</p>
          </details>
          <form className="email-settings-form" onSubmit={save}>
            <fieldset disabled={loading || busy || loginPending}>
              <legend>공통 Google OAuth 설정</legend>
              <label>
                <span>클라이언트 ID</span>
                <input
                  type="text"
                  value={clientId}
                  required
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="…apps.googleusercontent.com"
                  onChange={(event) => setClientId(event.target.value)}
                />
              </label>
              <label>
                <span>클라이언트 보안 비밀</span>
                <input
                  type="password"
                  value={clientSecret}
                  autoComplete="new-password"
                  placeholder={
                    settings?.hasClientSecret
                      ? "저장됨 · 변경할 때만 입력"
                      : "Google에서 발급한 보안 비밀"
                  }
                  onChange={(event) => setClientSecret(event.target.value)}
                />
              </label>
              <p className="email-settings-copy">
                Google 계정 비밀번호를 입력하는 곳이 아니에요. 인증 정보는 이 기기의 OS 자격 증명
                저장소에 보관하며 에이전트 기억에 넣지 않아요. 클라이언트 설정을 바꾸면 서비스를
                다시 연결해야 해요.
              </p>
              <button
                type="submit"
                disabled={!clientId.trim() || (!credentialsChanged && Boolean(settings?.clientId))}
              >
                공통 설정 저장
              </button>
            </fieldset>
          </form>
          {credentialsChanged && settings?.clientId && (
            <p className="email-settings-copy">변경한 공통 설정을 먼저 저장해 주세요.</p>
          )}
          <p className="email-settings-footnote">
            에이전트에게 요약·분석을 요청하면 읽은 메일, 문서, 일정 내용이 선택한 AI 제공자에게
            전달됩니다. 반복 업무는 앱 실행 중에 동작하며 Calendar 등록은 검토 후 등록 버튼을 누른
            초안만 처리합니다.
          </p>
        </>
      )}
    </div>
  );
}

export function EmailSettingsModal({ open, onClose }: EmailSettingsModalProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="email-settings-dialog">
        <DialogHeader>
          <DialogTitle>전체 환경설정 · Google 연동</DialogTitle>
          <DialogDescription>
            Gmail, Drive, Calendar를 연결하고 각 에이전트에게 필요한 일을 맡겨 보세요.
          </DialogDescription>
        </DialogHeader>
        {open && <GoogleSettingsContent />}
      </DialogContent>
    </Dialog>
  );
}
