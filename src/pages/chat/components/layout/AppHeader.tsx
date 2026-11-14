import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { AppSettingsDialog } from "@/components/AppSettingsDialog";

import "./AppHeader.css";

import type { ThemeMode } from "@/types/chat";

type AppHeaderProps = {
  isConversationBusy: boolean;
  theme: ThemeMode;
  isLoggedIn: boolean;
  sessionTitle: string;
  hasActiveSession: boolean;
  onNewChat: () => void;
  onExportChat: () => void;
  onClearContext: () => void;
  onThemeToggle: () => void;
  onOpenPanelModal: () => void;
  onOpenEmailSettings: () => void;
  openPanel: "left" | "right" | null;
  onTogglePanel: (panel: "left" | "right") => void;
};

export function AppHeader({
  isConversationBusy,
  theme,
  isLoggedIn,
  sessionTitle,
  hasActiveSession,
  onNewChat,
  onExportChat,
  onClearContext,
  onThemeToggle,
  onOpenPanelModal,
  onOpenEmailSettings,
  openPanel,
  onTogglePanel,
}: AppHeaderProps) {
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const [appSettingsOpen, setAppSettingsOpen] = useState(false);
  const [appVersion, setAppVersion] = useState<string | null>(null);
  const profileMenuRef = useRef<HTMLDivElement>(null);
  const profileButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isTauri()) return;

    // 설치된 실행 파일의 버전을 표시합니다.
    let active = true;
    void getVersion()
      .then((version) => {
        if (active) setAppVersion(version);
      })
      .catch(() => {
        if (active) setAppVersion("확인 불가");
      });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    const handleOutsideClick = (event: MouseEvent) => {
      if (!profileMenuRef.current?.contains(event.target as Node)) {
        setIsProfileMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsProfileMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener("keydown", handleEscape);
    };
  }, []);

  return (
    <header className="top-bar">
      <div className="top-left">
        <button
          className="icon-btn panel-toggle panel-toggle-left"
          type="button"
          aria-label="작업 공간 메뉴"
          aria-expanded={openPanel === "left"}
          onClick={() => onTogglePanel("left")}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            menu
          </span>
        </button>
        <div className="brand-chip">
          <div className="brand-mark">
            <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
              smart_toy
            </span>
          </div>
          <div className="brand-copy">
            <p className="brand-title">OpenGem</p>
            {appVersion && <p className="brand-subtitle">버전 {appVersion}</p>}
          </div>
        </div>
        <div className="separator" />
        <div className="session-label-wrap">
          <h2>{sessionTitle}</h2>
          <span className="running-pill">{hasActiveSession ? "Session" : "Draft"}</span>
        </div>
        <button
          className="new-session-btn"
          type="button"
          title="새 채팅 시작"
          onClick={onNewChat}
          disabled={isConversationBusy}
        >
          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
            add
          </span>
          <span className="new-session-label">New Session</span>
        </button>
      </div>

      <div className="top-right">
        <button
          className="icon-btn panel-toggle panel-toggle-right"
          type="button"
          aria-label="활동 기록"
          aria-expanded={openPanel === "right"}
          onClick={() => onTogglePanel("right")}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            view_sidebar
          </span>
        </button>
        <button className="icon-btn" title="Export Chat" onClick={onExportChat}>
          <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
            ios_share
          </span>
        </button>
        <button
          className="icon-btn"
          title="Clear Context"
          onClick={onClearContext}
          disabled={isConversationBusy}
        >
          <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
            delete_sweep
          </span>
        </button>
        <button
          className="theme-toggle-btn"
          type="button"
          onClick={onThemeToggle}
          title={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
        <div className="profile-menu-wrap" ref={profileMenuRef}>
          <button
            className="profile-dot"
            ref={profileButtonRef}
            type="button"
            aria-haspopup="menu"
            aria-expanded={isProfileMenuOpen}
            aria-label="사용자 메뉴 열기"
            title={isLoggedIn ? "ChatGPT 연결됨" : "로그인되지 않음"}
            onClick={() => setIsProfileMenuOpen((prev) => !prev)}
          >
            <span className="material-symbols-outlined profile-dot-icon" aria-hidden="true">
              {isLoggedIn ? "person" : "person_off"}
            </span>
          </button>

          {isProfileMenuOpen && (
            <div className="profile-menu" role="menu" aria-label="프로필 메뉴">
              {appVersion && <div className="profile-menu-version">버전 {appVersion}</div>}
              <button
                className="profile-menu-item"
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  setAppSettingsOpen(true);
                }}
              >
                앱 설정
              </button>
              <button
                className="profile-menu-item"
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  onOpenPanelModal();
                }}
              >
                Provider
              </button>
              <button
                className="profile-menu-item"
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  onOpenEmailSettings();
                }}
              >
                Google 연동
              </button>
            </div>
          )}
        </div>
      </div>
      {appSettingsOpen && (
        <AppSettingsDialog
          onClose={() => setAppSettingsOpen(false)}
          onReturnFocus={() => profileButtonRef.current?.focus()}
        />
      )}
    </header>
  );
}
