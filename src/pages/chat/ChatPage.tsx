import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CalendarEventDraftDialog } from "@/components/CalendarEventDraftDialog";
import type { CalendarEventDraft } from "@/features/agent/googleApi";
import { EmailSettingsModal } from "@/components/EmailSettingsModal";
import { useAgentRoutines } from "@/features/agent/useAgentRoutines";

import { AppHeader } from "./components/layout/AppHeader";
import { ChatPanel } from "./components/layout/ChatPanel";
import { ProvidersSettingModal } from "./components/ProvidersSettingModal";
import { LeftPanel } from "../../components/layout/LeftPanel";
import { RightPanel } from "../../components/layout/RightPanel";
import { AgentDetailPanel } from "@/components/AgentDetailPanel";
import { TOOLS } from "@/features/app/config/appData";
import { useAppController } from "../../hooks/useAppController";
import { useAppUpdater } from "../../hooks/useAppUpdater";
import { useChatController } from "./hooks/useChatController";
import type { AgentItem } from "@/types/chat";

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
  const [openPanel, setOpenPanel] = useState<"left" | "right" | null>(null);
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [workspaceView, setWorkspaceView] = useState<"office" | "chat">("office");
  const pendingAgentIdRef = useRef<string | null>(null);
  const [agentPanelTab, setAgentPanelTab] = useState<"memory" | "reports">("memory");
  const [agentPanelOpenCount, setAgentPanelOpenCount] = useState(0);
  const appUpdater = useAppUpdater();
  const [emailSettingsOpen, setEmailSettingsOpen] = useState(false);
  const [calendarDraft, setCalendarDraft] = useState<CalendarEventDraft | null>(null);
  useEffect(() => {
    const showDraft = (event: Event) =>
      setCalendarDraft((event as CustomEvent<CalendarEventDraft>).detail);
    window.addEventListener("google-calendar-draft", showDraft);
    return () => window.removeEventListener("google-calendar-draft", showDraft);
  }, []);
  const agentRoutines = useAgentRoutines(appUpdater.isInstallingRef, appUpdater.backgroundBusyRef);

  useEffect(() => {
    if (!openPanel) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenPanel(null);
    };
    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [openPanel]);

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
    executionMode,
    setExecutionMode,
    cancelCodexTask,
    isCodexRunning,
    canSend,
    clearContext,
    costPercent,
    currentSessionId,
    currentAgentId,
    conversationAgent,
    conversationError,
    unavailableReason,
    isConversationBusy,
    startAgentChat,
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
  } = useChatController({
    settings,
    isInstallingUpdate: appUpdater.isInstallingUpdate,
    isInstallingRef: appUpdater.isInstallingRef,
  });

  const selectedAgentIndex = agents.findIndex((agent) => agent.agentId === selectedAgentId);
  const selectedAgent = selectedAgentIndex >= 0 ? agents[selectedAgentIndex] : null;

  useEffect(() => {
    setSelectedAgentId(pendingAgentIdRef.current);
    pendingAgentIdRef.current = null;
  }, [selectedMode]);

  useEffect(() => {
    if (selectedAgentId && selectedAgentIndex < 0) setSelectedAgentId(null);
  }, [selectedAgentIndex, selectedAgentId]);

  const openAgentConversation = async (agent: AgentItem) => {
    if (await startAgentChat(agent)) {
      setAgentPanelTab("memory");
      setWorkspaceView("chat");
      setSelectedAgentId(agent.agentId ?? null);
      setOpenPanel(null);
    }
  };

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
        const clampedWidth = Math.min(
          Math.max(nextWidth, MIN_LEFT_PANEL_WIDTH),
          MAX_LEFT_PANEL_WIDTH
        );
        setLeftPanelWidth(clampedWidth);
      }

      if (isResizingRightPanel && window.innerWidth > 1280) {
        const nextWidth = gridBounds.right - event.clientX;
        const clampedWidth = Math.min(
          Math.max(nextWidth, MIN_RIGHT_PANEL_WIDTH),
          MAX_RIGHT_PANEL_WIDTH
        );
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
        isConversationBusy={isConversationBusy}
        theme={theme}
        isLoggedIn={settings.loggedIn}
        sessionTitle={currentSessionTitle}
        hasActiveSession={Boolean(currentSessionId)}
        onNewChat={async () => {
          if (await startNewChat()) {
            setWorkspaceView("chat");
            setSelectedAgentId(null);
          }
        }}
        onExportChat={exportChat}
        onClearContext={clearContext}
        onThemeToggle={toggleTheme}
        openPanel={openPanel}
        onTogglePanel={(panel) => {
          if (panel === "right" && selectedAgentId) {
            setSelectedAgentId(null);
            setOpenPanel("right");
            return;
          }
          setOpenPanel((current) => (current === panel ? null : panel));
        }}
        onOpenEmailSettings={() => setEmailSettingsOpen(true)}
        onOpenPanelModal={() => setIsPanelModalOpen(true)}
      />

      {agentRoutines.notice && (
        <div className="routine-notice" role="status">
          <span>
            {agentRoutines.notice.agentName}: {agentRoutines.notice.text}
          </span>
          <button
            type="button"
            disabled={isConversationBusy}
            onClick={async () => {
              const notice = agentRoutines.notice;
              if (!notice) return;
              if (notice.modeName !== selectedMode) {
                pendingAgentIdRef.current = notice.agentId;
                if (!(await selectOperationMode(notice.modeName))) {
                  pendingAgentIdRef.current = null;
                  return;
                }
              }
              setAgentPanelTab("reports");
              setAgentPanelOpenCount((count) => count + 1);
              setSelectedAgentId(notice.agentId);
              setOpenPanel("right");
              agentRoutines.clearNotice();
            }}
          >
            실행 기록 보기
          </button>
          <button type="button" aria-label="알림 닫기" onClick={agentRoutines.clearNotice}>
            닫기
          </button>
        </div>
      )}

      <main
        ref={bodyGridRef}
        className={`body-grid${isResizingLeftPanel || isResizingRightPanel ? " is-resizing" : ""}${openPanel ? ` is-${openPanel}-open` : ""}`}
        style={
          {
            "--left-panel-width": `${leftPanelWidth}px`,
            "--right-panel-width": `${rightPanelWidth}px`,
          } as CSSProperties
        }
      >
        {openPanel && (
          <button
            className="panel-backdrop"
            type="button"
            aria-label="패널 닫기"
            onClick={() => setOpenPanel(null)}
          />
        )}
        <LeftPanel
          onAgentChat={(agent) => void openAgentConversation(agent)}
          isConversationBusy={isConversationBusy}
          currentAgentId={currentAgentId}
          modes={modes}
          selectedMode={selectedMode}
          openSelectedModeSignal={openSelectedModeSignal}
          onModeSelect={async (mode) => {
            await selectOperationMode(mode);
          }}
          onSaveModeSettings={saveOperationModeSettings}
          onSaveAgents={saveAgentsForSelectedMode}
          getModeIcon={getModeIcon}
          getModeProjectPaths={getModeProjectPaths}
          getModeDefaultModel={getModeDefaultModel}
          agents={agents}
          sessionsByMode={sessionsByMode}
          onSessionSelect={async (session) => {
            if (!(await handleSessionSelect(session))) return;
            setOpenPanel(null);
            setWorkspaceView("chat");
          }}
          onSessionDelete={async (session) => {
            await handleSessionDelete(session);
          }}
          tools={TOOLS}
          updater={appUpdater}
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
          conversationLabel={
            currentAgentId ? (conversationAgent?.name ?? "삭제된 에이전트") : "일반 대화"
          }
          conversationModel={conversationAgent?.model ?? ""}
          conversationError={conversationError || unavailableReason}
          executionMode={executionMode}
          onExecutionModeChange={setExecutionMode}
          canUseCodex={Boolean(currentAgentId)}
          isCodexRunning={isCodexRunning}
          onCancelCodex={cancelCodexTask}
          isConversationBusy={isConversationBusy}
          onStartAgentChat={(index) => {
            if (agents[index]) void openAgentConversation(agents[index]);
          }}
          agents={agents}
          selectedAgentIndex={selectedAgentIndex >= 0 ? selectedAgentIndex : null}
          onSelectAgent={(index) => {
            const agent = agents[index];
            if (!agent) return;
            setAgentPanelTab("memory");
            setSelectedAgentId(agent.agentId ?? null);
            if (window.innerWidth <= 1280) setOpenPanel("right");
          }}
          workspaceView={workspaceView}
          onWorkspaceViewChange={setWorkspaceView}
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

        {selectedAgent ? (
          <AgentDetailPanel
            key={selectedMode + ":" + selectedAgent.agentId + ":" + agentPanelOpenCount}
            initialWorkspaceTab={agentPanelTab}
            modeName={selectedMode}
            onOpenEmailSettings={() => setEmailSettingsOpen(true)}
            isConversationBusy={isConversationBusy}
            onStartChat={() => void openAgentConversation(selectedAgent)}
            agent={selectedAgent}
            activity={activity}
            onClose={() => {
              setSelectedAgentId(null);
              setOpenPanel(null);
            }}
          />
        ) : (
          <RightPanel
            activity={activity}
            resourceToken={resourceToken}
            resourceCost={resourceCost}
            tokenPercent={tokenPercent}
            costPercent={costPercent}
          />
        )}
      </main>

      <CalendarEventDraftDialog
        draft={calendarDraft}
        onClose={() => setCalendarDraft(null)}
        onCreated={() => window.dispatchEvent(new Event("google-calendar-updated"))}
      />
      <EmailSettingsModal open={emailSettingsOpen} onClose={() => setEmailSettingsOpen(false)} />
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
