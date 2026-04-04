import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";

import { ModelSelect } from "@/components/ModelSelect";
import type { Mode, ModeIcon } from "@/features/app/config/appData";
import type { AgentColor, AgentItem, AgentRole, SessionItem } from "@/types/chat";

import { AgentSettingsModal } from "./left-panel/AgentSettingsModal";
import { AgentsSection } from "./left-panel/AgentsSection";
import { DEFAULT_AGENT_MODEL } from "./left-panel/constants";
import { ModeSection } from "./left-panel/ModeSection";
import { ModeSettingsModal } from "./left-panel/ModeSettingsModal";
import { ToolsSection } from "./left-panel/ToolsSection";
import type { AgentIconOption, AgentSettingsTab, DraftAgentItem, DraftModeItem } from "./left-panel/types";
import { parseConfigList } from "./left-panel/utils";

type QuickEditAgentDraft = {
  name: string;
  model: string;
  role: AgentRole;
  active: boolean;
};

type QuickEditPopoverPosition = {
  top: number;
  left: number;
};

type QuickEditPopoverAnchor = {
  top: number;
  bottom: number;
  right: number;
};

type LeftPanelProps = {
  modes: readonly Mode[];
  selectedMode: Mode;
  openSelectedModeSignal: number;
  onModeSelect: (mode: Mode) => void | Promise<void>;
  onSaveModeSettings: (
    nextModes: Mode[],
    nextModeIcons: Record<Mode, ModeIcon>,
    nextSelectedMode: Mode,
    modeItems: Array<{ name: Mode; originalName?: Mode; projectPaths?: string[]; defaultModel?: string }>
  ) => void | Promise<void>;
  onSaveAgents: (nextAgents: AgentItem[]) => void | Promise<void>;
  getModeIcon: (mode: Mode) => ModeIcon;
  getModeProjectPaths: (mode: Mode) => string[];
  getModeDefaultModel: (mode: Mode) => string;
  agents: AgentItem[];
  sessionsByMode: Record<Mode, SessionItem[]>;
  onSessionSelect: (session: SessionItem) => void | Promise<void>;
  onSessionDelete: (session: SessionItem) => void | Promise<void>;
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
  getModeProjectPaths,
  getModeDefaultModel,
  agents,
  sessionsByMode,
  onSessionSelect,
  onSessionDelete,
  tools,
}: LeftPanelProps) {
  const [openModes, setOpenModes] = useState<Record<Mode, boolean>>({});
  const [isModeSettingsOpen, setIsModeSettingsOpen] = useState(false);
  const [isAgentSettingsOpen, setIsAgentSettingsOpen] = useState(false);
  const [agentSettingsTab, setAgentSettingsTab] = useState<AgentSettingsTab>("create");
  const [newModeName, setNewModeName] = useState("");
  const [newModeIcon, setNewModeIcon] = useState<ModeIcon>("tune");
  const [newModeProjectPath, setNewModeProjectPath] = useState("");
  const [newModeProjectPaths, setNewModeProjectPaths] = useState<string[]>([]);
  const [newModeDefaultModel, setNewModeDefaultModel] = useState(DEFAULT_AGENT_MODEL);
  const [modeNameError, setModeNameError] = useState("");
  const [draftModes, setDraftModes] = useState<DraftModeItem[]>([]);
  const [draftAgents, setDraftAgents] = useState<DraftAgentItem[]>([]);
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentIcon, setNewAgentIcon] = useState<AgentIconOption>("smart_toy");
  const [newAgentColor, setNewAgentColor] = useState<AgentColor>("indigo");
  const [newAgentModel, setNewAgentModel] = useState(DEFAULT_AGENT_MODEL);
  const [newAgentPrompt, setNewAgentPrompt] = useState("");
  const [newAgentTools, setNewAgentTools] = useState("");
  const [newAgentMcpServers, setNewAgentMcpServers] = useState("");
  const [newAgentSkills, setNewAgentSkills] = useState("");
  const [agentNameError, setAgentNameError] = useState("");
  const [quickEditAgentIndex, setQuickEditAgentIndex] = useState<number | null>(null);
  const [quickEditAgentDraft, setQuickEditAgentDraft] = useState<QuickEditAgentDraft | null>(null);
  const [quickEditPopoverPosition, setQuickEditPopoverPosition] = useState<QuickEditPopoverPosition | null>(null);
  const [quickEditPopoverAnchor, setQuickEditPopoverAnchor] = useState<QuickEditPopoverAnchor | null>(null);
  const [quickEditError, setQuickEditError] = useState("");
  const suppressOverlayCloseRef = useRef(false);
  const quickEditPopoverRef = useRef<HTMLElement | null>(null);
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

  useEffect(() => {
    if (!quickEditPopoverAnchor || !quickEditPopoverRef.current) {
      return;
    }

    const reposition = () => {
      if (!quickEditPopoverRef.current) {
        return;
      }

      const viewportPadding = 8;
      const popoverWidth = quickEditPopoverRef.current.offsetWidth;
      const popoverHeight = quickEditPopoverRef.current.offsetHeight;
      const preferredLeft = quickEditPopoverAnchor.right - popoverWidth;
      const preferredTop = quickEditPopoverAnchor.bottom + 6;
      const fallbackTop = quickEditPopoverAnchor.top - popoverHeight - 6;

      const nextLeft = Math.min(
        Math.max(preferredLeft, viewportPadding),
        Math.max(viewportPadding, window.innerWidth - popoverWidth - viewportPadding)
      );
      const nextTop =
        preferredTop + popoverHeight + viewportPadding <= window.innerHeight
          ? preferredTop
          : Math.max(
              viewportPadding,
              Math.min(fallbackTop, window.innerHeight - popoverHeight - viewportPadding)
            );

      setQuickEditPopoverPosition((prev) => {
        if (prev && prev.top === nextTop && prev.left === nextLeft) {
          return prev;
        }
        return { top: nextTop, left: nextLeft };
      });
    };

    reposition();
    window.addEventListener("resize", reposition);
    return () => window.removeEventListener("resize", reposition);
  }, [quickEditPopoverAnchor, quickEditAgentDraft, quickEditError]);

  const openModeSettings = () => {
    setDraftModes(
      modes.map((mode, index) => ({
        id: `saved-${index}-${mode}`,
        name: mode,
        icon: getModeIcon(mode),
        originalName: mode,
        projectPaths: [...getModeProjectPaths(mode)],
        defaultModel: getModeDefaultModel(mode),
      }))
    );
    setNewModeName("");
    setNewModeIcon("tune");
    setNewModeProjectPath("");
    setNewModeProjectPaths([]);
    setNewModeDefaultModel(getModeDefaultModel(selectedMode));
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
    setNewAgentModel(getModeDefaultModel(selectedMode));
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
      setModeNameError("?? ??? ??? ???.");
      return;
    }

    const exists = draftModes.some(
      (mode) => mode.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );
    if (exists) {
      setModeNameError("?? ?? ??? ??? ???.");
      return;
    }

    draftModeIdRef.current += 1;
    setDraftModes((prev) => [
      ...prev,
      {
        id: `draft-${draftModeIdRef.current}`,
        name: trimmedName,
        icon: newModeIcon,
        projectPaths: [...newModeProjectPaths],
        defaultModel: newModeDefaultModel.trim() || DEFAULT_AGENT_MODEL,
      },
    ]);
    setModeNameError("");
    setNewModeName("");
    setNewModeIcon("tune");
    setNewModeProjectPath("");
    setNewModeProjectPaths([]);
    setNewModeDefaultModel(getModeDefaultModel(selectedMode));
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

  const normalizeProjectPath = (value: string) => {
    return value.trim().replace(/[\\/]+$/, "");
  };

  const addProjectPathToMode = (modeId: string, rawValue: string) => {
    const normalizedPath = normalizeProjectPath(rawValue);
    if (!normalizedPath) {
      return false;
    }

    let didAdd = false;
    setDraftModes((prev) =>
      prev.map((mode) => {
        if (mode.id !== modeId) {
          return mode;
        }

        const exists = mode.projectPaths.some(
          (projectPath) => projectPath.toLowerCase() === normalizedPath.toLowerCase()
        );
        if (exists) {
          return mode;
        }

        didAdd = true;
        return {
          ...mode,
          projectPaths: [...mode.projectPaths, normalizedPath],
        };
      })
    );

    return didAdd;
  };

  const handleAddNewModeProjectPath = () => {
    const normalizedPath = normalizeProjectPath(newModeProjectPath);
    if (!normalizedPath) {
      return;
    }

    setNewModeProjectPaths((prev) => {
      const exists = prev.some((projectPath) => projectPath.toLowerCase() === normalizedPath.toLowerCase());
      if (exists) {
        return prev;
      }

      return [...prev, normalizedPath];
    });
    setNewModeProjectPath("");
  };

  const handleAddNewModeProjectPathOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      handleAddNewModeProjectPath();
    }
  };

  const handleAddDraftModeProjectPath = (id: string, value: string) => {
    addProjectPathToMode(id, value);
  };

  const handleRemoveDraftModeProjectPath = (id: string, projectPath: string) => {
    setDraftModes((prev) =>
      prev.map((mode) =>
        mode.id === id
          ? {
              ...mode,
              projectPaths: mode.projectPaths.filter((item) => item !== projectPath),
            }
          : mode
      )
    );
  };

  const pickProjectFolder = async () => {
    const selected = await invoke<string | null>("pick_project_folder");
    return selected ? normalizeProjectPath(selected) : "";
  };

  const handlePickNewModeProjectPath = async () => {
    const selectedPath = await pickProjectFolder();
    if (!selectedPath) {
      return;
    }

    setNewModeProjectPaths((prev) => {
      const exists = prev.some((projectPath) => projectPath.toLowerCase() === selectedPath.toLowerCase());
      if (exists) {
        return prev;
      }

      return [...prev, selectedPath];
    });
    setNewModeProjectPath("");
  };

  const handleRemoveNewModeProjectPath = (projectPath: string) => {
    setNewModeProjectPaths((prev) => prev.filter((item) => item !== projectPath));
  };

  const handlePickDraftModeProjectPath = async (id: string) => {
    const selectedPath = await pickProjectFolder();
    if (!selectedPath) {
      return;
    }

    handleAddDraftModeProjectPath(id, selectedPath);
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
        projectPaths: [],
        defaultModel: getModeDefaultModel(modes[0] || "Orchestration"),
      },
    ]);
    setNewModeName("");
    setNewModeIcon("tune");
    setNewModeProjectPath("");
    setNewModeProjectPaths([]);
    setNewModeDefaultModel(getModeDefaultModel(modes[0] || "Orchestration"));
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
      defaultModel: mode.defaultModel?.trim() || DEFAULT_AGENT_MODEL,
      projectPaths: mode.projectPaths
        .map((projectPath) => normalizeProjectPath(projectPath))
        .filter((projectPath, index, items) => {
          if (!projectPath) {
            return false;
          }

          return items.findIndex((item) => item.toLowerCase() === projectPath.toLowerCase()) === index;
        }),
    }));

    if (normalizedModes.length === 0) {
      setModeNameError("?? ? ?? ??? ????.");
      return;
    }

    if (normalizedModes.some((mode) => !mode.name)) {
      setModeNameError("?? ??? ??? ? ???.");
      return;
    }

    const normalizedNames = normalizedModes.map((mode) => mode.name.toLowerCase());
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      setModeNameError("?? ?? ??? ??? ???.");
      return;
    }

    const nextModes = normalizedModes.map((mode) => mode.name);
    const modeItems = normalizedModes.map((mode) => ({
      name: mode.name,
      originalName: mode.originalName,
      projectPaths: mode.projectPaths,
      defaultModel: mode.defaultModel,
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
      setAgentNameError("???? ??? ??? ???.");
      return;
    }

    const exists = draftAgents.some(
      (agent) => agent.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );
    if (exists) {
      setAgentNameError("?? ?? ??? ????? ???.");
      return;
    }

    const hasMain = draftAgents.some((agent) => agent.role === "main");

    draftAgentIdRef.current += 1;
    setDraftAgents((prev) => [
      ...prev,
      {
        id: `draft-agent-${draftAgentIdRef.current}`,
        name: trimmedName,
        icon: newAgentIcon,
        color: newAgentColor,
        role: (hasMain ? "sub" : "main") as AgentRole,
        model: newAgentModel.trim() || DEFAULT_AGENT_MODEL,
        prompt: newAgentPrompt.trim(),
        tools: parseConfigList(newAgentTools),
        mcpServers: parseConfigList(newAgentMcpServers),
        skills: parseConfigList(newAgentSkills),
        status: "?? ?",
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
    setDraftAgents((prev) => {
      const filtered = prev.filter((agent) => agent.id !== id);
      const hasMain = filtered.some((agent) => agent.role === "main");

      if (hasMain || filtered.length === 0) {
        return filtered;
      }

      return filtered.map((agent, index) => ({
        ...agent,
        role: (index === 0 ? "main" : "sub") as AgentRole,
      }));
    });
  };

  const handleSetMainAgent = (id: string) => {
    setDraftAgents((prev) =>
      prev.map((agent) => ({
        ...agent,
        role: (agent.id === id ? "main" : "sub") as AgentRole,
      }))
    );
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
    const normalizedAgents = draftAgents.map((agent, index) => ({
      name: agent.name.trim(),
      icon: agent.icon,
      status: agent.status,
      color: agent.color,
      active: agent.active,
      role: (agent.role ?? (index === 0 ? "main" : "sub")) as AgentRole,
      model: agent.model?.trim() || DEFAULT_AGENT_MODEL,
      prompt: agent.prompt?.trim() || "",
      tools: agent.tools || [],
      mcpServers: agent.mcpServers || [],
      skills: agent.skills || [],
    }));

    if (normalizedAgents.some((agent) => !agent.name)) {
      setAgentNameError("???? ??? ??? ? ???.");
      return;
    }

    const normalizedNames = normalizedAgents.map((agent) => agent.name.toLowerCase());
    if (new Set(normalizedNames).size !== normalizedNames.length) {
      setAgentNameError("?? ?? ??? ????? ???.");
      return;
    }

    if (!normalizedAgents.some((agent) => agent.role === "main") && normalizedAgents.length > 0) {
      normalizedAgents[0].role = "main";
    }

    await onSaveAgents(normalizedAgents);
    closeAgentSettings();
  };

  const handleStartQuickEditAgent = (index: number, anchorRect: DOMRect) => {
    const target = agents[index];
    if (!target) {
      return;
    }

    setQuickEditAgentIndex(index);
    setQuickEditAgentDraft({
      name: target.name,
      model: target.model?.trim() || getModeDefaultModel(selectedMode),
      role: (target.role ?? (index === 0 ? "main" : "sub")) as AgentRole,
      active: Boolean(target.active),
    });
    setQuickEditPopoverAnchor({
      top: anchorRect.top,
      bottom: anchorRect.bottom,
      right: anchorRect.right,
    });
    setQuickEditPopoverPosition({
      top: Math.max(8, anchorRect.bottom + 6),
      left: Math.max(8, anchorRect.right - 280),
    });
    setQuickEditError("");
  };

  const handleQuickEditAgentChange = <K extends keyof QuickEditAgentDraft>(
    key: K,
    value: QuickEditAgentDraft[K]
  ) => {
    setQuickEditAgentDraft((prev) => (prev ? { ...prev, [key]: value } : prev));
    if (key === "name" && quickEditError) {
      setQuickEditError("");
    }
  };

  const handleCancelQuickEditAgent = () => {
    setQuickEditAgentIndex(null);
    setQuickEditAgentDraft(null);
    setQuickEditPopoverAnchor(null);
    setQuickEditPopoverPosition(null);
    setQuickEditError("");
  };

  const handleSaveQuickEditAgent = async () => {
    if (quickEditAgentIndex === null || !quickEditAgentDraft) {
      return;
    }

    const trimmedName = quickEditAgentDraft.name.trim();
    if (!trimmedName) {
      setQuickEditError("???? ??? ??? ???.");
      return;
    }

    const duplicateName = agents.some(
      (agent, index) => index !== quickEditAgentIndex && agent.name.trim().toLowerCase() === trimmedName.toLowerCase()
    );
    if (duplicateName) {
      setQuickEditError("?? ??? ????? ?? ???.");
      return;
    }

    const nextAgents = agents.map((agent, index) => {
      if (index !== quickEditAgentIndex) {
        return agent;
      }

      return {
        ...agent,
        name: trimmedName,
        model: quickEditAgentDraft.model.trim() || getModeDefaultModel(selectedMode),
        role: quickEditAgentDraft.role,
        active: quickEditAgentDraft.active,
        status: quickEditAgentDraft.active ? "Active" : "Offline",
      };
    });

    const normalizedAgents =
      quickEditAgentDraft.role === "main"
        ? nextAgents.map((agent, index) => ({
            ...agent,
            role: (index === quickEditAgentIndex ? "main" : "sub") as AgentRole,
          }))
        : nextAgents.some((agent) => agent.role === "main")
          ? nextAgents
          : nextAgents.map((agent, index) => ({
              ...agent,
              role: (index === 0 ? "main" : "sub") as AgentRole,
            }));

    await onSaveAgents(normalizedAgents);
    handleCancelQuickEditAgent();
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
        onSessionDelete={onSessionDelete}
      />
      <AgentsSection
        agents={agents}
        onOpenSettings={openAgentSettings}
        quickEditAgentIndex={quickEditAgentIndex}
        quickEditDraft={quickEditAgentDraft}
        quickEditError={quickEditError}
        onStartQuickEditAgent={handleStartQuickEditAgent}
        onQuickEditAgentChange={handleQuickEditAgentChange}
      />
      <ToolsSection tools={tools} />

      <ModeSettingsModal
        isOpen={isModeSettingsOpen}
        newModeName={newModeName}
        newModeIcon={newModeIcon}
        modeNameError={modeNameError}
        draftModes={draftModes}
        newModeProjectPath={newModeProjectPath}
        newModeProjectPaths={newModeProjectPaths}
        newModeDefaultModel={newModeDefaultModel}
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
        onNewModeDefaultModelChange={setNewModeDefaultModel}
        onCreateMode={handleCreateMode}
        onCreateModeOnEnter={handleCreateModeOnEnter}
        onNewModeProjectPathChange={setNewModeProjectPath}
        onAddNewModeProjectPath={handleAddNewModeProjectPath}
        onAddNewModeProjectPathOnEnter={handleAddNewModeProjectPathOnEnter}
        onPickNewModeProjectPath={handlePickNewModeProjectPath}
        onRemoveNewModeProjectPath={handleRemoveNewModeProjectPath}
        onDraftModeNameChange={handleDraftModeNameChange}
        onDraftModeIconChange={handleDraftModeIconChange}
        onDraftModeDefaultModelChange={(id, value) => {
          setDraftModes((prev) => prev.map((mode) => (mode.id === id ? { ...mode, defaultModel: value } : mode)));
        }}
        onAddDraftModeProjectPath={handleAddDraftModeProjectPath}
        onPickDraftModeProjectPath={handlePickDraftModeProjectPath}
        onRemoveDraftModeProjectPath={handleRemoveDraftModeProjectPath}
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
        onSetMainAgent={handleSetMainAgent}
        onMoveDraftAgent={handleMoveDraftAgent}
        onRemoveDraftAgent={handleRemoveDraftAgent}
        onSave={handleSaveAgentSettings}
      />

      {quickEditAgentIndex !== null && quickEditAgentDraft && quickEditPopoverPosition && (
        <div className="agent-quick-popover-backdrop" role="presentation" onClick={handleCancelQuickEditAgent}>
          <section
            className="agent-quick-popover"
            ref={quickEditPopoverRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="agent-quick-edit-title"
            style={{
              top: `${quickEditPopoverPosition.top}px`,
              left: `${quickEditPopoverPosition.left}px`,
            }}
            onClick={(event) => event.stopPropagation()}
          >
            <header className="agent-quick-popover-header">
              <div className="agent-quick-popover-title-wrap">
                <h3 id="agent-quick-edit-title" className="agent-quick-popover-title">
                  Agent Quick Edit
                </h3>
                <p className="agent-quick-popover-subtitle">{agents[quickEditAgentIndex]?.name}</p>
              </div>
              <button
                className="agent-quick-popover-close"
                type="button"
                aria-label="에이전트 빠른 설정 닫기"
                onClick={handleCancelQuickEditAgent}
              >
                <span className="material-symbols-outlined" aria-hidden="true">
                  close
                </span>
              </button>
            </header>

            <div className="agent-quick-popover-body">
              <label className="agent-quick-edit-field">
                <span>이름</span>
                <input
                  className="mode-settings-input"
                  type="text"
                  value={quickEditAgentDraft.name}
                  onChange={(event) => handleQuickEditAgentChange("name", event.target.value)}
                />
              </label>
              <label className="agent-quick-edit-field">
                <span>모델</span>
                <ModelSelect
                  className="agent-quick-model-select"
                  value={quickEditAgentDraft.model}
                  ariaLabel="에이전트 quick edit 모델"
                  onChange={(value) => handleQuickEditAgentChange("model", value)}
                />
              </label>
              <label className="agent-quick-edit-field">
                <span>역할</span>
                <select
                  className="mode-settings-select"
                  value={quickEditAgentDraft.role}
                  onChange={(event) => handleQuickEditAgentChange("role", event.target.value as AgentRole)}
                >
                  <option value="main">main</option>
                  <option value="sub">sub</option>
                </select>
              </label>
              <label className="agent-quick-edit-toggle">
                <input
                  type="checkbox"
                  checked={quickEditAgentDraft.active}
                  onChange={(event) => handleQuickEditAgentChange("active", event.target.checked)}
                />
                <span>활성 상태 유지</span>
              </label>
              {quickEditError && <p className="agent-quick-edit-error">{quickEditError}</p>}
            </div>

            <footer className="agent-quick-popover-footer">
              <button className="settings-secondary-btn agent-quick-popover-btn" type="button" onClick={handleCancelQuickEditAgent}>
                취소
              </button>
              <button className="settings-primary-btn agent-quick-popover-btn" type="button" onClick={() => void handleSaveQuickEditAgent()}>
                저장
              </button>
            </footer>
          </section>
        </div>
      )}
    </aside>
  );
}
