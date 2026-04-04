import { useEffect, useRef, useState, type CSSProperties } from "react";
import { AppHeader } from "./layout/AppHeader";
import { ChatPanel } from "./layout/ChatPanel";
import { ProvidersSettingModal } from "./ProvidersSettingModal";
import { LeftPanel } from "../../components/layout/LeftPanel";
import { RightPanel } from "../../components/layout/RightPanel";
import { TOOLS } from "@/features/app/config/appData";
import { useAppController } from "../../hooks/useAppController";
import { useChatController } from "./hooks/useChat";

const MIN_LEFT_PANEL_WIDTH = 180;
const MAX_LEFT_PANEL_WIDTH = 420;
const MIN_RIGHT_PANEL_WIDTH = 220;
const MAX_RIGHT_PANEL_WIDTH = 420;

export function ChatPage() {
  const bodyGridRef = useRef<HTMLElement | null>(null);
  const [leftPanelWidth, setLeftPanelWidth] = useState(250);
  const [rightPanelWidth, setRightPanelWidth] = useState(270);
  const [isResizingLeftPanel, setIsResizingLeftPanel] = useState(false);
  const [isResizingRightPanel, setIsResizingRightPanel] = useState(false);

  const {
    chatGPTLoginUrl,
    isChatGPTLoginBusy,
    isPanelModalOpen,
    isSavingProvider,
    loginChatGPT,
    logoutChatGPT,
    panelModalError,
    savePanelModalSettings,
    setIsPanelModalOpen,
    setPanelModalError,
    setSettings,
    settings,
    theme,
    toggleTheme,
  } = useAppController();
  const {
    activity,
    agents,
    canSend,
    clearContext,
    costPercent,
    currentSessionId,
    currentSessionProjectPaths,
    currentSessionTitle,
    exportChat,
    getModeDefaultModel,
    getModeIcon,
    getModeProjectPaths,
    handleApprovePlan,
    handleModifyPlan,
    handleSessionDelete,
    handleSessionSelect,
    inputValue,
    messages,
    modes,
    onEnterSubmit,
    openSelectedModeSignal,
    openProjectFolder,
    resourceCost,
    resourceToken,
    saveAgentsForSelectedMode,
    saveOperationModeSettings,
    selectOperationMode,
    selectedMode,
    sendMessage,
    sessionsByMode,
    setInputValue,
    startNewChat,
    tokenPercent,
    updateCurrentSessionProjectPaths,
  } = useChatController({ settings });

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
        const clampedWidth = Math.min(Math.max(nextWidth, MIN_LEFT_PANEL_WIDTH), MAX_LEFT_PANEL_WIDTH);
        setLeftPanelWidth(clampedWidth);
      }

      if (isResizingRightPanel && window.innerWidth > 1280) {
        const nextWidth = gridBounds.right - event.clientX;
        const clampedWidth = Math.min(Math.max(nextWidth, MIN_RIGHT_PANEL_WIDTH), MAX_RIGHT_PANEL_WIDTH);
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
        onOpenPanelModal={() => setIsPanelModalOpen(true)}
      />

      <main
        ref={bodyGridRef}
        className={`body-grid${isResizingLeftPanel || isResizingRightPanel ? " is-resizing" : ""}`}
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
          getModeProjectPaths={getModeProjectPaths}
          getModeDefaultModel={getModeDefaultModel}
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
          currentSessionId={currentSessionId}
          currentSessionProjectPaths={currentSessionProjectPaths}
          defaultProjectPaths={getModeProjectPaths(selectedMode)}
          inputValue={inputValue}
          canSend={canSend}
          onOpenProjectFolder={openProjectFolder}
          onUpdateSessionProjectPaths={updateCurrentSessionProjectPaths}
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

      <ProvidersSettingModal
        settings={settings}
        isOpen={isPanelModalOpen}
        isSaving={isSavingProvider}
        isLoginBusy={isChatGPTLoginBusy}
        loginUrl={chatGPTLoginUrl}
        errorMessage={panelModalError}
        onClose={() => setIsPanelModalOpen(false)}
        onChange={(patch) => {
          setSettings((prev) => ({ ...prev, ...patch }));
          if (panelModalError) {
            setPanelModalError("");
          }
        }}
        onSave={savePanelModalSettings}
        onLoginChatGPT={loginChatGPT}
        onLogoutChatGPT={logoutChatGPT}
      />
    </div>
  );
}
