import { useEffect, useRef, useState, type KeyboardEvent } from "react";

import type { Mode, ModeIcon } from "@/data/appData";
import type { AgentColor, AgentItem, SessionItem } from "@/types/chat";

import { AgentSettingsModal } from "./left-panel/AgentSettingsModal";
import { AgentsSection } from "./left-panel/AgentsSection";
import { DEFAULT_AGENT_MODEL } from "./left-panel/constants";
import { ModeSection } from "./left-panel/ModeSection";
import { ModeSettingsModal } from "./left-panel/ModeSettingsModal";
import { ToolsSection } from "./left-panel/ToolsSection";
import type { AgentSettingsTab, DraftAgentItem, DraftModeItem } from "./left-panel/types";
import { parseConfigList } from "./left-panel/utils";

type LeftPanelProps = {
  modes: readonly Mode[];
  selectedMode: Mode;
  openSelectedModeSignal: number;
  onModeSelect: (mode: Mode) => void | Promise<void>;
  onSaveModeSettings: (
    nextModes: Mode[],
    nextModeIcons: Record<Mode, ModeIcon>,
    nextSelectedMode: Mode,
    modeItems: Array<{ name: Mode; originalName?: Mode }>
  ) => void | Promise<void>;
  onSaveAgents: (nextAgents: AgentItem[]) => void | Promise<void>;
  getModeIcon: (mode: Mode) => ModeIcon;
  agents: AgentItem[];
  sessionsByMode: Record<Mode, SessionItem[]>;
  onSessionSelect: (session: SessionItem) => void | Promise<void>;
  tools: string[];
};

export function LeftPanel({
  modes,
  selectedMode,
  openSelectedModeSignal,
  onModeSelect,
  onSaveModeSettings,
  onSaveAgents,
  getModeIcon,
  agents,
  sessionsByMode,
  onSessionSelect,
  tools,
}: LeftPanelProps) {
  const [openModes, setOpenModes] = useState<Record<Mode, boolean>>({});
  const [isModeSettingsOpen, setIsModeSettingsOpen] = useState(false);
  const [isAgentSettingsOpen, setIsAgentSettingsOpen] = useState(false);
  const [agentSettingsTab, setAgentSettingsTab] = useState<AgentSettingsTab>("create");
  const [newModeName, setNewModeName] = useState("");
  const [newModeIcon, setNewModeIcon] = useState<ModeIcon>("tune");
  const [modeNameError, setModeNameError] = useState("");
  const [draftModes, setDraftModes] = useState<DraftModeItem[]>([]);
  const [draftAgents, setDraftAgents] = useState<DraftAgentItem[]>([]);
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentIcon, setNewAgentIcon] = useState<DraftAgentItem["icon"]>("smart_toy");
  const [newAgentColor, setNewAgentColor] = useState<AgentColor>("indigo");
  const [newAgentModel, setNewAgentModel] = useState(DEFAULT_AGENT_MODEL);
  const [newAgentPrompt, setNewAgentPrompt] = useState("");
  const [newAgentTools, setNewAgentTools] = useState("");
  const [newAgentMcpServers, setNewAgentMcpServers] = useState("");
  const [newAgentSkills, setNewAgentSkills] = useState("");
  const [agentNameError, setAgentNameError] = useState("");
  const suppressOverlayCloseRef = useRef(false);
  const draftModeIdRef = useRef(0);
  const draftAgentIdRef = useRef(0);
  const isSettingsOpen = isModeSettingsOpen || isAgentSettingsOpen;

  useEffect(() => {
    setOpenModes((prev) => {
      const next = { ...prev };
      modes.forEach((mode) => {
        if (next[mode] === undefined) {
          next[mode] = mode === selectedMode;
        }
      });

      Object.keys(next).forEach((mode) => {
        if (!modes.includes(mode)) {
          delete next[mode];
        }
      });

      return next;
    });
  }, [modes, selectedMode]);

  useEffect(() => {
    setOpenModes((prev) => ({
      ...prev,
      [selectedMode]: true,
    }));
  }, [openSelectedModeSignal, selectedMode]);

  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    const handleEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isAgentSettingsOpen) {
          setIsAgentSettingsOpen(false);
          return;
        }

        setIsModeSettingsOpen(false);
      }
    };

    window.addEventListener("keydown", handleEscape);
    return () => window.removeEventListener("keydown", handleEscape);
  }, [isAgentSettingsOpen, isSettingsOpen]);

  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    const handleMouseUp = () => {
      window.setTimeout(() => {
        suppressOverlayCloseRef.current = false;
      }, 0);
    };

    window.addEventListener("mouseup", handleMouseUp);
    return () => window.removeEventListener("mouseup", handleMouseUp);
  }, [isSettingsOpen]);

  const openModeSettings = () => {
    setDraftModes(
      modes.map((mode, index) => ({
        id: `saved-${index}-${mode}`,
        name: mode,
        icon: getModeIcon(mode),
        originalName: mode,
      }))
    );
    setNewModeName("");
    setNewModeIcon("tune");
    setModeNameError("");
    setIsModeSettingsOpen(true);
  };

  const openAgentSettings = () => {
    setDraftAgents(
      agents.map((agent, index) => ({ ...agent, id: `saved-agent-${index}-${agent.name}` }))
    );
    setAgentSettingsTab("create");
    setNewAgentName("");
    setNewAgentIcon("smart_toy");
    setNewAgentColor("indigo");
    setNewAgentModel(DEFAULT_AGENT_MODEL);
    setNewAgentPrompt("");
    setNewAgentTools("");
    setNewAgentMcpServers("");
    setNewAgentSkills("");
    setAgentNameError("");
    setIsAgentSettingsOpen(true);
  };

  const closeModeSettings = () => {
    setIsModeSettingsOpen(false);
  };

  const closeAgentSettings = () => {
    setIsAgentSettingsOpen(false);
  };

  const toggleModeOpen = (mode: Mode) => {
    setOpenModes((prev) => ({
      ...prev,
      [mode]: !prev[mode],
    }));
  };

  const handleModeClick = (mode: Mode) => {
    const isSelected = selectedMode === mode;
    if (!isSelected) {
      void onModeSelect(mode);
      setOpenModes((prev) => ({
        ...prev,
        [mode]: true,
      }));
      return;
    }

    toggleModeOpen(mode);
  };

  const handleCreateMode = () => {
    const trimmedName = newModeName.trim();
    if (!trimmedName) {
      setModeNameError("모드 이름을 입력해줘.");
      return;
    }

    const exists = draftModes.some(
      (mode) => mode.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );
    if (exists) {
      setModeNameError("이미 같은 이름의 모드가 있어.");
      return;
    }

    draftModeIdRef.current += 1;
    setDraftModes((prev) => [
      ...prev,
      {
        id: `draft-${draftModeIdRef.current}`,
        name: trimmedName,
        icon: newModeIcon,
      },
    ]);
    setModeNameError("");
    setNewModeName("");
    setNewModeIcon("tune");
  };

  const handleCreateModeOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleCreateMode();
    }
  };

  const handleDraftModeNameChange = (id: string, value: string) => {
    setDraftModes((prev) => prev.map((mode) => (mode.id === id ? { ...mode, name: value } : mode)));
    if (modeNameError) {
      setModeNameError("");
    }
  };

  const handleDraftModeIconChange = (id: string, icon: ModeIcon) => {
    setDraftModes((prev) => prev.map((mode) => (mode.id === id ? { ...mode, icon } : mode)));
  };

  const handleMoveDraftMode = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex <= 0 || targetIndex >= draftModes.length) {
      return;
    }

    setDraftModes((prev) => {
      const next = [...prev];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const handleRemoveDraftMode = (id: string) => {
    setDraftModes((prev) => prev.filter((mode) => mode.id !== id));
  };

  const handleResetDraftModes = () => {
    setDraftModes([
      {
        id: "saved-0-Orchestration",
        name: "Orchestration",
        icon: "smart_toy",
        originalName: modes[0] || "Orchestration",
      },
    ]);
    setNewModeName("");
    setNewModeIcon("tune");
    setModeNameError("");
  };

  const handleModeSettingsOverlayClick = () => {
    if (suppressOverlayCloseRef.current) {
      suppressOverlayCloseRef.current = false;
      return;
    }

    closeModeSettings();
  };

  const handleSaveModeSettings = async () => {
    const normalizedModes = draftModes.map((mode) => ({
      ...mode,
      name: mode.name.trim(),
    }));

    if (normalizedModes.length === 0) {
      setModeNameError("최소 한 개의 모드는 필요해.");
      return;
    }

    if (normalizedModes.some((mode) => !mode.name)) {
      setModeNameError("모드 이름을 비워둘 수 없어.");
      return;
    }

    const normalizedNames = normalizedModes.map((mode) => mode.name.toLowerCase());
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      setModeNameError("이미 같은 이름의 모드가 있어.");
      return;
    }

    const nextModes = normalizedModes.map((mode) => mode.name);
    const modeItems = normalizedModes.map((mode) => ({
      name: mode.name,
      originalName: mode.originalName,
    }));
    const nextModeIcons = normalizedModes.reduce<Record<Mode, ModeIcon>>((acc, mode, index) => {
      acc[mode.name] = mode.icon || (index === 0 ? "smart_toy" : "tune");
      return acc;
    }, {});
    const selectedDraftMode = normalizedModes.find((mode) => mode.originalName === selectedMode);
    const nextSelectedMode = selectedDraftMode?.name || nextModes[0];

    await onSaveModeSettings(nextModes, nextModeIcons, nextSelectedMode, modeItems);
    closeModeSettings();
  };

  const handleCreateAgent = () => {
    const trimmedName = newAgentName.trim();
    if (!trimmedName) {
      setAgentNameError("에이전트 이름을 입력해줘.");
      return;
    }

    const exists = draftAgents.some(
      (agent) => agent.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );
    if (exists) {
      setAgentNameError("이미 같은 이름의 에이전트가 있어.");
      return;
    }

    draftAgentIdRef.current += 1;
    setDraftAgents((prev) => [
      ...prev,
      {
        id: `draft-agent-${draftAgentIdRef.current}`,
        name: trimmedName,
        icon: newAgentIcon,
        color: newAgentColor,
        model: newAgentModel.trim() || DEFAULT_AGENT_MODEL,
        prompt: newAgentPrompt.trim(),
        tools: parseConfigList(newAgentTools),
        mcpServers: parseConfigList(newAgentMcpServers),
        skills: parseConfigList(newAgentSkills),
        status: "대기 중",
        active: true,
      },
    ]);
    setAgentNameError("");
    setNewAgentName("");
    setNewAgentIcon("smart_toy");
    setNewAgentColor("indigo");
    setNewAgentModel(DEFAULT_AGENT_MODEL);
    setNewAgentPrompt("");
    setNewAgentTools("");
    setNewAgentMcpServers("");
    setNewAgentSkills("");
    setAgentSettingsTab("list");
  };

  const handleCreateAgentOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleCreateAgent();
    }
  };

  const handleDraftAgentChange = <K extends keyof DraftAgentItem>(
    id: string,
    key: K,
    value: DraftAgentItem[K]
  ) => {
    setDraftAgents((prev) =>
      prev.map((agent) => (agent.id === id ? { ...agent, [key]: value } : agent))
    );
    if (key === "name" && agentNameError) {
      setAgentNameError("");
    }
  };

  const handleRemoveDraftAgent = (id: string) => {
    setDraftAgents((prev) => prev.filter((agent) => agent.id !== id));
  };

  const handleMoveDraftAgent = (index: number, direction: "up" | "down") => {
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= draftAgents.length) {
      return;
    }

    setDraftAgents((prev) => {
      const next = [...prev];
      [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
      return next;
    });
  };

  const handleAgentSettingsOverlayClick = () => {
    if (suppressOverlayCloseRef.current) {
      suppressOverlayCloseRef.current = false;
      return;
    }

    closeAgentSettings();
  };

  const handleSaveAgentSettings = async () => {
    const normalizedAgents = draftAgents.map((agent) => ({
      name: agent.name.trim(),
      icon: agent.icon,
      status: agent.status,
      color: agent.color,
      active: agent.active,
      model: agent.model?.trim() || DEFAULT_AGENT_MODEL,
      prompt: agent.prompt?.trim() || "",
      tools: agent.tools || [],
      mcpServers: agent.mcpServers || [],
      skills: agent.skills || [],
    }));

    if (normalizedAgents.some((agent) => !agent.name)) {
      setAgentNameError("에이전트 이름을 비워둘 수 없어.");
      return;
    }

    const normalizedNames = normalizedAgents.map((agent) => agent.name.toLowerCase());
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      setAgentNameError("이미 같은 이름의 에이전트가 있어.");
      return;
    }

    await onSaveAgents(normalizedAgents);
    closeAgentSettings();
  };

  return (
    <aside className="left-panel">
      <ModeSection
        modes={modes}
        selectedMode={selectedMode}
        openModes={openModes}
        getModeIcon={getModeIcon}
        sessionsByMode={sessionsByMode}
        onModeClick={handleModeClick}
        onOpenSettings={openModeSettings}
        onSessionSelect={onSessionSelect}
      />
      <AgentsSection agents={agents} onOpenSettings={openAgentSettings} />
      <ToolsSection tools={tools} />

      <ModeSettingsModal
        isOpen={isModeSettingsOpen}
        newModeName={newModeName}
        newModeIcon={newModeIcon}
        modeNameError={modeNameError}
        draftModes={draftModes}
        suppressOverlayCloseRef={suppressOverlayCloseRef}
        onClose={closeModeSettings}
        onOverlayClick={handleModeSettingsOverlayClick}
        onNewModeNameChange={(value) => {
          setNewModeName(value);
          if (modeNameError) {
            setModeNameError("");
          }
        }}
        onNewModeIconChange={setNewModeIcon}
        onCreateMode={handleCreateMode}
        onCreateModeOnEnter={handleCreateModeOnEnter}
        onDraftModeNameChange={handleDraftModeNameChange}
        onDraftModeIconChange={handleDraftModeIconChange}
        onMoveDraftMode={handleMoveDraftMode}
        onRemoveDraftMode={handleRemoveDraftMode}
        onResetDraftModes={handleResetDraftModes}
        onSave={handleSaveModeSettings}
      />

      <AgentSettingsModal
        isOpen={isAgentSettingsOpen}
        agentSettingsTab={agentSettingsTab}
        newAgentName={newAgentName}
        newAgentIcon={newAgentIcon}
        newAgentColor={newAgentColor}
        newAgentModel={newAgentModel}
        newAgentPrompt={newAgentPrompt}
        newAgentTools={newAgentTools}
        newAgentMcpServers={newAgentMcpServers}
        newAgentSkills={newAgentSkills}
        agentNameError={agentNameError}
        draftAgents={draftAgents}
        suppressOverlayCloseRef={suppressOverlayCloseRef}
        onClose={closeAgentSettings}
        onOverlayClick={handleAgentSettingsOverlayClick}
        onTabChange={setAgentSettingsTab}
        onNewAgentNameChange={(value) => {
          setNewAgentName(value);
          if (agentNameError) {
            setAgentNameError("");
          }
        }}
        onNewAgentIconChange={setNewAgentIcon}
        onNewAgentColorChange={setNewAgentColor}
        onNewAgentModelChange={setNewAgentModel}
        onNewAgentPromptChange={setNewAgentPrompt}
        onNewAgentToolsChange={setNewAgentTools}
        onNewAgentMcpServersChange={setNewAgentMcpServers}
        onNewAgentSkillsChange={setNewAgentSkills}
        onCreateAgent={handleCreateAgent}
        onCreateAgentOnEnter={handleCreateAgentOnEnter}
        onDraftAgentChange={handleDraftAgentChange}
        onMoveDraftAgent={handleMoveDraftAgent}
        onRemoveDraftAgent={handleRemoveDraftAgent}
        onSave={handleSaveAgentSettings}
      />
    </aside>
  );
}
