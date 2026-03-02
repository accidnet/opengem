import type { ThemeMode } from "@/types/chat";

type AppHeaderProps = {
  theme: ThemeMode;
  onNewChat: () => void;
  onExportChat: () => void;
  onClearContext: () => void;
  onThemeToggle: () => void;
};

export function AppHeader({
  theme,
  onNewChat,
  onExportChat,
  onClearContext,
  onThemeToggle,
}: AppHeaderProps) {
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
          <h2>Market Analysis Session #42</h2>
          <span className="running-pill">Running</span>
        </div>
        <button className="new-session-btn" type="button" title="새 채팅 시작" onClick={onNewChat}>
          <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
            add
          </span>
          <span className="new-session-label">New Chat</span>
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
          onClick={onThemeToggle}
          title={theme === "dark" ? "라이트 모드로 전환" : "다크 모드로 전환"}
        >
          {theme === "dark" ? "☀️" : "🌙"}
        </button>
        <span className="profile-dot">JD</span>
      </div>
    </header>
  );
}
