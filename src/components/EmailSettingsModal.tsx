import { useEffect, useRef, useState, type FormEvent } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  beginEmailLogin,
  cancelEmailLogin,
  disconnectEmail,
  getEmailSettings,
  saveEmailSettings,
  type EmailSettings,
} from "@/features/agent/api";
import { openExternalUrl } from "@/features/backend/api";

import "./EmailSettingsModal.css";

type EmailSettingsModalProps = { open: boolean; onClose: () => void };

function EmailSettingsContent() {
  const [settings, setSettings] = useState<EmailSettings | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [authorizationUrl, setAuthorizationUrl] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    void getEmailSettings()
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

  // 로그인 결과는 토큰을 받지 않고 연결 상태만 확인합니다.
  useEffect(() => {
    if (!settings?.loginPending) return;
    let cancelled = false;
    let polling = false;
    const timer = window.setInterval(() => {
      if (polling) return;
      polling = true;
      void getEmailSettings()
        .then((next) => {
          if (cancelled) return;
          setSettings(next);
          if (!next.loginPending) {
            setAuthorizationUrl("");
            if (next.connected)
              setNotice("Gmail을 연결했어요. 에이전트에게 이메일 업무를 맡길 수 있어요.");
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
  }, [settings?.loginPending]);

  const perform = async (operation: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch (cause) {
      if (alive.current) setError(String(cause));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const save = (event: FormEvent) => {
    event.preventDefault();
    void perform(async () => {
      const next = await saveEmailSettings({
        clientId: clientId.trim(),
        clientSecret: clientSecret.trim() || undefined,
      });
      if (!alive.current) return;
      setSettings(next);
      setClientSecret("");
      setNotice("이메일 설정을 저장했어요. Gmail 연결을 눌러 계정을 연결해 주세요.");
    });
  };

  const connect = () =>
    void perform(async () => {
      const result = await beginEmailLogin();
      if (!alive.current) return;
      setAuthorizationUrl(result.authorizationUrl);
      setSettings(await getEmailSettings());
      await openExternalUrl(result.authorizationUrl);
    });

  const credentialsChanged = clientId.trim() !== settings?.clientId || Boolean(clientSecret.trim());

  return (
    <div className="email-settings-body">
      <section className="email-settings-status" aria-label="이메일 연결 상태">
        <span className="material-symbols-outlined" aria-hidden="true">
          mail
        </span>
        <div>
          <strong>
            {loading
              ? "연결 상태 확인 중…"
              : settings?.connected
                ? "Gmail 연결됨"
                : "Gmail 연결 필요"}
          </strong>
          <p>{settings?.email || "전체 에이전트가 이 계정의 연결을 사용해요."}</p>
        </div>
      </section>
      <p className="email-settings-copy">
        받은편지함의 새 메일을 읽어 요약하고 일정을 정리합니다. 요약할 메일 내용은 업무를 맡긴
        에이전트의 AI 제공자에게 전달됩니다.
      </p>
      <p className="email-settings-copy">
        메일은 읽기 전용으로 연결되며, 일정은 에이전트 보고서에 표시됩니다.
      </p>
      {error && (
        <p className="email-settings-error" role="alert">
          {error}
        </p>
      )}
      {settings?.lastError && settings.lastError !== error && (
        <p className="email-settings-error" role="alert">
          {settings.lastError}
        </p>
      )}
      {notice && (
        <p className="email-settings-notice" role="status">
          {notice}
        </p>
      )}
      <details className="email-settings-guide" open={!settings?.clientId}>
        <summary>처음 연결하는 방법</summary>
        <ol>
          <li>
            <button
              type="button"
              className="email-settings-link"
              onClick={() =>
                void perform(() =>
                  openExternalUrl(
                    "https://console.cloud.google.com/apis/library/gmail.googleapis.com"
                  )
                )
              }
            >
              Google Cloud Console
            </button>
            에서 프로젝트를 만들고 Gmail API를 사용 설정하세요.
          </li>
          <li>
            Google Auth Platform의 동의 화면을 설정하세요. 테스트 상태라면 사용할 Gmail 주소를
            테스트 사용자로 추가하세요.
          </li>
          <li>
            클라이언트에서 <strong>데스크톱 앱</strong> 유형의 OAuth 클라이언트를 만들고, 아래에
            클라이언트 ID와 보안 비밀을 입력하세요.
          </li>
          <li>
            설정을 저장한 뒤 Gmail 연결을 눌러 브라우저에서 계정을 선택하고 읽기 권한을 허용하세요.
          </li>
        </ol>
        <p>테스트 상태인 Google 앱의 연결은 만료되어 재연결이 필요할 수 있어요.</p>
      </details>
      <form className="email-settings-form" onSubmit={save}>
        <fieldset disabled={loading || busy || settings?.loginPending}>
          <legend>Google OAuth 설정</legend>
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
            계정 연결 정보는 이 기기에 안전하게 저장되며, 에이전트의 기억에는 포함되지 않아요.
          </p>
          <button
            type="submit"
            disabled={!clientId.trim() || (!credentialsChanged && Boolean(settings?.clientId))}
          >
            설정 저장
          </button>
        </fieldset>
      </form>
      <div className="email-settings-actions">
        {settings?.loginPending ? (
          <>
            <p role="status">브라우저에서 Gmail 연결을 완료해 주세요.</p>
            {authorizationUrl && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void perform(() => openExternalUrl(authorizationUrl))}
              >
                로그인 페이지 다시 열기
              </button>
            )}
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void perform(async () => {
                  await cancelEmailLogin();
                  if (alive.current) {
                    setSettings(await getEmailSettings());
                    setAuthorizationUrl("");
                  }
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
            onClick={connect}
          >
            {settings?.connected ? "Gmail 다시 연결" : "Gmail 연결"}
          </button>
        )}
        {settings?.connected && !settings.loginPending && (
          <button
            type="button"
            disabled={busy}
            onClick={() => {
              if (
                window.confirm(
                  "Gmail 연결을 해제할까요? 반복 이메일 업무는 다시 연결할 때까지 실행할 수 없어요."
                )
              )
                void perform(async () => {
                  const next = await disconnectEmail();
                  if (alive.current) {
                    setSettings(next);
                    setNotice("Gmail 연결을 해제했어요.");
                  }
                });
            }}
          >
            연결 해제
          </button>
        )}
      </div>
      {credentialsChanged && settings?.clientId && (
        <p className="email-settings-copy">변경한 설정을 먼저 저장해 주세요.</p>
      )}
      <p className="email-settings-footnote">
        앱이 실행 중일 때 반복 업무를 확인합니다. 앱을 다시 열면 놓친 새 메일부터 이어서 확인해요.
      </p>
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
          <DialogTitle>전체 환경설정 · 이메일</DialogTitle>
          <DialogDescription>
            한 번 연결하면 각 에이전트에게 이메일 요약과 일정 정리를 맡길 수 있어요.
          </DialogDescription>
        </DialogHeader>
        {open && <EmailSettingsContent />}
      </DialogContent>
    </Dialog>
  );
}
