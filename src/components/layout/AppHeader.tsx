import { useEffect, useRef, useState } from "react";

import type { ThemeMode } from "@/types/chat";

type AppHeaderProps = {
  theme: ThemeMode;
  isLoggedIn: boolean;
  sessionTitle: string;
  hasActiveSession: boolean;
  onNewChat: () => void;
  onExportChat: () => void;
  onClearContext: () => void;
  onThemeToggle: () => void;
  onOpenProviderDialog: () => void;
};

export function AppHeader({
  theme,
  isLoggedIn,
  sessionTitle,
  hasActiveSession,
  onNewChat,
  onExportChat,
  onClearContext,
  onThemeToggle,
  onOpenProviderDialog,
}: AppHeaderProps) {
  const [isProfileMenuOpen, setIsProfileMenuOpen] = useState(false);
  const profileMenuRef = useRef<HTMLDivElement>(null);

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
        <div className="brand-chip">
          <div className="brand-mark">
            <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
              smart_toy
            </span>
          </div>
          <div className="brand-copy">
            <p className="brand-title">OpenGem</p>
          </div>
        </div>
        <div className="separator" />
        <div className="session-label-wrap">
          <h2>{sessionTitle}</h2>
          <span className="running-pill">{hasActiveSession ? "Session" : "Draft"}</span>
        </div>
        <button className="new-session-btn" type="button" title="새 채팅 시작" onClick={onNewChat}>
          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
            add
          </span>
          <span className="new-session-label">New Session</span>
        </button>
      </div>

      <div className="top-center">
        <button className="nav-link active">Chat</button>
        <button className="nav-link">Dashboard</button>
      </div>

      <div className="top-right">
        <button className="icon-btn" title="Export Chat" onClick={onExportChat}>
          <span className="material-symbols-outlined" style={{ fontSize: "20px" }}>
            ios_share
          </span>
        </button>
        <button className="icon-btn" title="Clear Context" onClick={onClearContext}>
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
            type="button"
            aria-haspopup="menu"
            aria-expanded={isProfileMenuOpen}
            aria-label="사용자 메뉴 열기"
            title={isLoggedIn ? "ChatGPT 연결됨" : "로그인 안 됨"}
            onClick={() => setIsProfileMenuOpen((prev) => !prev)}
          >
            <span className="material-symbols-outlined profile-dot-icon" aria-hidden="true">
              {isLoggedIn ? "person" : "person_off"}
            </span>
          </button>

          {isProfileMenuOpen && (
            <div className="profile-menu" role="menu" aria-label="프로필 메뉴">
              <button
                className="profile-menu-item"
                type="button"
                role="menuitem"
                onClick={() => {
                  setIsProfileMenuOpen(false);
                  onOpenProviderDialog();
                }}
              >
                Provider
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
