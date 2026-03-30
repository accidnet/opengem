import { AppHeader } from "./components/layout/AppHeader";
import { ChatPanel } from "./components/layout/ChatPanel";
import { LeftPanel } from "./components/layout/LeftPanel";
import { ProviderDialog } from "./components/layout/ProviderDialog";
import { RightPanel } from "./components/layout/RightPanel";
import { TOOLS } from "./data/appData";
import { useAppController } from "./hooks/useAppController";

export default function App() {
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

      <main className="body-grid">
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
