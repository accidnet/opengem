import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AppHeader } from "./components/layout/AppHeader";
import { ChatPanel } from "./components/layout/ChatPanel";
import { LeftPanel } from "./components/layout/LeftPanel";
import { ProviderDialog } from "./components/layout/ProviderDialog";
import { RightPanel } from "./components/layout/RightPanel";
import { TOOLS } from "./data/appData";
import { useAppController } from "./hooks/useAppController";

export default function App() {
  const bodyGridRef = useRef<HTMLElement | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(232);
  const [rightPanelWidth, setRightPanelWidth] = useState(270);
  const [isResizingLeftPanel, setIsResizingLeftPanel] = useState(false);
  const [isResizingRightPanel, setIsResizingRightPanel] = useState(false);

  const {
    activity,
    agents,
    canSend,
    chatGPTLoginUrl,
    clearContext,
    costPercent,
    currentSessionId,
    currentSessionTitle,
    exportChat,
    getModeIcon,
    handleApprovePlan,
    handleModifyPlan,
    handleSessionDelete,
    handleSessionSelect,
    inputValue,
    isChatGPTLoginBusy,
    isProviderDialogOpen,
    isSavingProvider,
    loginChatGPT,
    logoutChatGPT,
    messages,
    modes,
    onEnterSubmit,
    openSelectedModeSignal,
    providerError,
    resourceCost,
    resourceToken,
    saveAgentsForSelectedMode,
    saveOperationModeSettings,
    saveProviderSettings,
    selectOperationMode,
    selectedMode,
    sendMessage,
    sessionsByMode,
    setInputValue,
    setIsProviderDialogOpen,
    setProviderError,
    setSettings,
    settings,
    startNewChat,
    theme,
    toggleTheme,
    tokenPercent,
  } = useAppController();

  useEffect(() => {
    if (!isResizingLeftPanel && !isResizingRightPanel) {
      return undefined;
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (!bodyGridRef.current) {
        return;
      }

      const gridBounds = bodyGridRef.current.getBoundingClientRect();

      if (isResizingLeftPanel && window.innerWidth > 980) {
        const nextWidth = event.clientX - gridBounds.left;
        const clampedWidth = Math.min(Math.max(nextWidth, 0), 420);
        setLeftPanelWidth(clampedWidth);
      }

      if (isResizingRightPanel && window.innerWidth > 1280) {
        const nextWidth = gridBounds.right - event.clientX;
        const clampedWidth = Math.min(Math.max(nextWidth, 0), 420);
        setRightPanelWidth(clampedWidth);
      }
    };

    const stopResizing = () => {
      setIsResizingLeftPanel(false);
      setIsResizingRightPanel(false);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopResizing);
    window.addEventListener("pointercancel", stopResizing);

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopResizing);
      window.removeEventListener("pointercancel", stopResizing);
    };
  }, [isResizingLeftPanel, isResizingRightPanel]);

  useEffect(() => {
    if (!isResizingLeftPanel && !isResizingRightPanel) {
      return undefined;
    }

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;

    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    return () => {
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [isResizingLeftPanel, isResizingRightPanel]);

  return (
    <div className="app-shell">
      <AppHeader
        theme={theme}
        isLoggedIn={settings.chatgptLoggedIn}
        sessionTitle={currentSessionTitle}
        hasActiveSession={Boolean(currentSessionId)}
        onNewChat={startNewChat}
        onExportChat={exportChat}
        onClearContext={clearContext}
        onThemeToggle={toggleTheme}
        onOpenProviderDialog={() => setIsProviderDialogOpen(true)}
      />

      <main
        ref={bodyGridRef}
        className={`body-grid${
          isResizingLeftPanel || isResizingRightPanel ? " is-resizing" : ""
        }${leftPanelWidth === 0 ? " is-left-panel-collapsed" : ""}${
          rightPanelWidth === 0 ? " is-right-panel-collapsed" : ""
        }`}
        style={
          {
            "--left-panel-width": `${leftPanelWidth}px`,
            "--right-panel-width": `${rightPanelWidth}px`,
          } as CSSProperties
        }
      >
        <LeftPanel
          modes={modes}
          selectedMode={selectedMode}
          openSelectedModeSignal={openSelectedModeSignal}
          onModeSelect={selectOperationMode}
          onSaveModeSettings={saveOperationModeSettings}
          onSaveAgents={saveAgentsForSelectedMode}
          getModeIcon={getModeIcon}
          agents={agents}
          sessionsByMode={sessionsByMode}
          onSessionSelect={handleSessionSelect}
          onSessionDelete={handleSessionDelete}
          tools={TOOLS}
        />

        <div
          className="panel-resizer panel-resizer-left"
          role="separator"
          aria-label="왼쪽 패널 너비 조절"
          aria-orientation="vertical"
          onPointerDown={(event) => {
            if (window.innerWidth <= 980) {
              return;
            }

            event.preventDefault();
            setIsResizingLeftPanel(true);
          }}
        />

        <ChatPanel
          messages={messages}
          inputValue={inputValue}
          canSend={canSend}
          onInputChange={setInputValue}
          onSubmit={sendMessage}
          onEnterSubmit={onEnterSubmit}
          onApprovePlan={handleApprovePlan}
          onModifyPlan={handleModifyPlan}
        />

        <div
          className="panel-resizer panel-resizer-right"
          role="separator"
          aria-label="오른쪽 패널 너비 조절"
          aria-orientation="vertical"
          onPointerDown={(event) => {
            if (window.innerWidth <= 1280) {
              return;
            }

            event.preventDefault();
            setIsResizingRightPanel(true);
          }}
        />

        <RightPanel
          activity={activity}
          resourceToken={resourceToken}
          resourceCost={resourceCost}
          tokenPercent={tokenPercent}
          costPercent={costPercent}
        />
      </main>

      <ProviderDialog
        settings={settings}
        isOpen={isProviderDialogOpen}
        isSaving={isSavingProvider}
        isLoginBusy={isChatGPTLoginBusy}
        loginUrl={chatGPTLoginUrl}
        errorMessage={providerError}
        onClose={() => setIsProviderDialogOpen(false)}
        onChange={(patch) => {
          setSettings((prev) => ({ ...prev, ...patch }));
          if (providerError) {
            setProviderError("");
          }
        }}
        onSave={saveProviderSettings}
        onLoginChatGPT={loginChatGPT}
        onLogoutChatGPT={logoutChatGPT}
      />
    </div>
  );
}
