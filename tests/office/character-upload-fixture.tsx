import { StrictMode, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AgentSettingsModal } from "@/components/layout/left-panel/AgentSettingsModal";
import type { AgentSettingsTab, DraftAgentItem } from "@/components/layout/left-panel/types";
import { AIQueryKeys } from "@/hooks/useAI";
import { AgentOffice } from "@/pages/chat/components/office/AgentOffice";
import "@/styles/tokens.css";
import "@/styles/panel-modal.css";
import "@/styles/left-panel.css";
import "./fixture.css";

const agentStorageKey = "opengem.test.character-upload.agents.v1";
const initialAgents: DraftAgentItem[] = [
  {
    id: "upload-agent",
    agentId: "upload-agent",
    characterId: null,
    name: "업로드 확인 에이전트",
    icon: "smart_toy",
    color: "indigo",
    active: true,
    role: "main",
    status: "Active",
  },
];
const queryClient = new QueryClient();
// 캐릭터 테스트에서 모델 목록을 조회하느라 네이티브 API를 호출하지 않습니다.
queryClient.setQueryData(AIQueryKeys.availableModels, []);
const ignore = () => {};

// 실제 업로드 폼과 에이전트 선택 UI를 재사용하고 저장 어댑터만 브라우저로 대체합니다.
// 따라서 새로고침 검증은 브라우저 저장 경로이며 네이티브 SQLite 검증은 아닙니다.
// eslint-disable-next-line react-refresh/only-export-components
function CharacterUploadFixture() {
  const [agents, setAgents] = useState<DraftAgentItem[]>(() => {
    const saved = window.localStorage.getItem(agentStorageKey);
    return saved ? (JSON.parse(saved) as DraftAgentItem[]) : initialAgents;
  });
  const [draftAgents, setDraftAgents] = useState(agents);
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState<AgentSettingsTab>("characters");
  const suppressOverlayCloseRef = useRef(false);
  const close = () => setIsOpen(false);
  return (
    <main className="fixture">
      <button
        type="button"
        onClick={() => {
          setDraftAgents(agents.map((agent) => ({ ...agent })));
          setTab("characters");
          setIsOpen(true);
        }}
      >
        에이전트 설정 열기
      </button>
      <AgentOffice
        modeName="Orchestration"
        agents={agents}
        selectedAgentIndex={null}
        isConversationBusy={false}
        onSelectAgent={ignore}
        onStartChat={ignore}
      />
      <AgentSettingsModal
        isOpen={isOpen}
        isBusy={false}
        agentSettingsTab={tab}
        draftAgents={draftAgents}
        suppressOverlayCloseRef={suppressOverlayCloseRef}
        newAgentName=""
        newAgentIcon="smart_toy"
        newAgentCharacterId=""
        newAgentColor="indigo"
        newAgentModel=""
        newAgentPrompt=""
        newAgentTools=""
        newAgentMcpServers=""
        newAgentSkills=""
        agentNameError=""
        onClose={close}
        onOverlayClick={close}
        onTabChange={setTab}
        onNewAgentNameChange={ignore}
        onNewAgentIconChange={ignore}
        onNewAgentCharacterIdChange={ignore}
        onNewAgentColorChange={ignore}
        onNewAgentModelChange={ignore}
        onNewAgentPromptChange={ignore}
        onNewAgentToolsChange={ignore}
        onNewAgentMcpServersChange={ignore}
        onNewAgentSkillsChange={ignore}
        onCreateAgent={ignore}
        onCreateAgentOnEnter={ignore}
        onSetMainAgent={ignore}
        onMoveDraftAgent={ignore}
        onRemoveDraftAgent={ignore}
        onCharacterRemoved={ignore}
        onDraftAgentChange={(id, key, value) => {
          setDraftAgents((previous) =>
            previous.map((agent) => (agent.id === id ? { ...agent, [key]: value } : agent))
          );
        }}
        onSave={() => {
          window.localStorage.setItem(agentStorageKey, JSON.stringify(draftAgents));
          setAgents(draftAgents);
          close();
        }}
      />
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <CharacterUploadFixture />
    </QueryClientProvider>
  </StrictMode>
);
