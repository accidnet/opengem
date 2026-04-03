import { useMemo, useState } from "react";
import type { KeyboardEvent, MutableRefObject } from "react";

import { MODE_ICON_OPTIONS } from "@/data/appData";
import type { ModeIcon } from "@/data/appData";

import type { DraftModeItem } from "./types";
import { getModeIconLabel } from "./utils";

type ModeSettingsModalProps = {
  isOpen: boolean;
  newModeName: string;
  newModeIcon: ModeIcon;
  newModeProjectPath: string;
  newModeProjectPaths: string[];
  newModeDefaultModel: string;
  modeNameError: string;
  draftModes: DraftModeItem[];
  suppressOverlayCloseRef: MutableRefObject<boolean>;
  onClose: () => void;
  onOverlayClick: () => void;
  onNewModeNameChange: (value: string) => void;
  onNewModeIconChange: (icon: ModeIcon) => void;
  onNewModeDefaultModelChange: (value: string) => void;
  onNewModeProjectPathChange: (value: string) => void;
  onAddNewModeProjectPath: () => void;
  onAddNewModeProjectPathOnEnter: (event: KeyboardEvent<HTMLInputElement>) => void;
  onPickNewModeProjectPath: () => void | Promise<void>;
  onRemoveNewModeProjectPath: (projectPath: string) => void;
  onCreateMode: () => void;
  onCreateModeOnEnter: (event: KeyboardEvent<HTMLInputElement>) => void;
  onDraftModeNameChange: (id: string, value: string) => void;
  onDraftModeIconChange: (id: string, icon: ModeIcon) => void;
  onDraftModeDefaultModelChange: (id: string, value: string) => void;
  onAddDraftModeProjectPath: (id: string, value: string) => void;
  onPickDraftModeProjectPath: (id: string) => void | Promise<void>;
  onRemoveDraftModeProjectPath: (id: string, projectPath: string) => void;
  onMoveDraftMode: (index: number, direction: "up" | "down") => void;
  onRemoveDraftMode: (id: string) => void;
  onResetDraftModes: () => void;
  onSave: () => void | Promise<void>;
};

function ProjectPathList({
  paths,
  onRemove,
}: {
  paths: string[];
  onRemove: (projectPath: string) => void;
}) {
  if (paths.length === 0) {
    return <p className="mode-project-paths-empty">아직 연결된 프로젝트 폴더가 없어요.</p>;
  }

  return (
    <div className="mode-project-paths-list" role="list" aria-label="프로젝트 폴더 목록">
      {paths.map((projectPath) => (
        <div className="mode-project-path-chip" role="listitem" key={projectPath}>
          <span className="material-symbols-outlined" aria-hidden="true">
            folder
          </span>
          <span className="mode-project-path-text">{projectPath}</span>
          <button
            className="small-icon-btn danger"
            type="button"
            title="프로젝트 폴더 제거"
            aria-label={`${projectPath} 제거`}
            onClick={() => onRemove(projectPath)}
          >
            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
              close
            </span>
          </button>
        </div>
      ))}
    </div>
  );
}

export function ModeSettingsModal({
  isOpen,
  newModeName,
  newModeIcon,
  newModeProjectPath,
  newModeProjectPaths,
  newModeDefaultModel,
  modeNameError,
  draftModes,
  suppressOverlayCloseRef,
  onClose,
  onOverlayClick,
  onNewModeNameChange,
  onNewModeIconChange,
  onNewModeDefaultModelChange,
  onNewModeProjectPathChange,
  onAddNewModeProjectPath,
  onAddNewModeProjectPathOnEnter,
  onPickNewModeProjectPath,
  onRemoveNewModeProjectPath,
  onCreateMode,
  onCreateModeOnEnter,
  onDraftModeNameChange,
  onDraftModeIconChange,
  onDraftModeDefaultModelChange,
  onAddDraftModeProjectPath,
  onPickDraftModeProjectPath,
  onRemoveDraftModeProjectPath,
  onMoveDraftMode,
  onRemoveDraftMode,
  onResetDraftModes,
  onSave,
}: ModeSettingsModalProps) {
  const [activeTab, setActiveTab] = useState<"create" | "list">("create");
  const [projectPathDrafts, setProjectPathDrafts] = useState<Record<string, string>>({});

  const projectPathCounts = useMemo(() => {
    return draftModes.reduce<Record<string, number>>((acc, mode) => {
      acc[mode.id] = mode.projectPaths.length;
      return acc;
    }, {});
  }, [draftModes]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="settings-overlay" role="presentation" onClick={onOverlayClick}>
      <section
        className="panel-modal mode-panel-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mode-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="panel-modal-header">
          <div className="panel-modal-header-title-wrap">
            <span className="panel-modal-header-icon material-symbols-outlined" aria-hidden="true">
              tune
            </span>
            <h3 id="mode-settings-title" className="settings-title">
              Modes
            </h3>
          </div>
          <button className="panel-modal-close-btn" type="button" aria-label="모드 설정 닫기" onClick={onClose}>
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </header>

        <div className="panel-modal-body">
          <aside className="panel-modal-sidebar mode-panel-modal-sidebar" aria-label="모드 설정 안내">
            <p className="panel-modal-sidebar-label">MODES</p>
            <p className="panel-modal-sidebar-help">
              모드마다 기본 모델과 프로젝트 폴더를 함께 관리할 수 있어요.
            </p>

            <div className="mode-panel-modal-tabs" role="tablist" aria-label="모드 설정 탭">
              <button
                type="button"
                role="tab"
                className={`mode-panel-modal-tab ${activeTab === "create" ? "is-active" : ""}`}
                aria-selected={activeTab === "create"}
                onClick={() => setActiveTab("create")}
              >
                모드 추가
              </button>
              <button
                type="button"
                role="tab"
                className={`mode-panel-modal-tab ${activeTab === "list" ? "is-active" : ""}`}
                aria-selected={activeTab === "list"}
                onClick={() => setActiveTab("list")}
              >
                모드 목록
              </button>
            </div>
          </aside>

          <main className="panel-modal-main mode-panel-modal-main">
            <div className="panel-modal-main-copy">
              <h4>{activeTab === "create" ? "모드 추가" : "모드 목록"}</h4>
              <p>
                {activeTab === "create"
                  ? "새 모드의 기본 모델과 기본 프로젝트 폴더 설정을 미리 준비할 수 있어요."
                  : "기존 모드별 이름, 아이콘, 기본 모델, 기본 프로젝트 폴더 설정을 한 번에 관리할 수 있어요."}
              </p>
            </div>

            {activeTab === "create" ? (
              <section className="settings-card mode-create-card">
                <div className="settings-card-head settings-card-head-column">
                  <div>
                    <h4>새 모드 추가</h4>
                    <p>이름, 아이콘, 기본 모델, 기본 프로젝트 폴더 설정을 초안 목록에 추가해요.</p>
                  </div>
                </div>

                <div className="mode-settings-create">
                  <div className="mode-settings-mode-btn is-selected" aria-hidden="true">
                    <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                      {newModeIcon}
                    </span>
                  </div>
                  <input
                    type="text"
                    className="mode-settings-input"
                    placeholder="새 모드 이름"
                    value={newModeName}
                    onMouseDown={() => {
                      suppressOverlayCloseRef.current = true;
                    }}
                    onChange={(event) => onNewModeNameChange(event.target.value)}
                    onKeyDown={onCreateModeOnEnter}
                    aria-label="새 모드 이름"
                  />
                  <div className="mode-settings-select-wrap">
                    <select
                      className="mode-settings-select"
                      value={newModeIcon}
                      onChange={(event) => onNewModeIconChange(event.target.value as ModeIcon)}
                      aria-label="새 모드 아이콘"
                    >
                      {MODE_ICON_OPTIONS.map((iconName) => (
                        <option key={iconName} value={iconName}>
                          {getModeIconLabel(iconName)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <input
                    type="text"
                    className="mode-settings-input"
                    placeholder="기본 모델 예: gpt-5.4"
                    value={newModeDefaultModel}
                    onMouseDown={() => {
                      suppressOverlayCloseRef.current = true;
                    }}
                    onChange={(event) => onNewModeDefaultModelChange(event.target.value)}
                    aria-label="새 모드 기본 모델"
                  />
                  <button className="mode-settings-action" type="button" onClick={onCreateMode}>
                    추가
                  </button>
                </div>

                <div className="mode-project-path-section">
                  <div className="mode-project-path-copy">
                    <h5>기본 프로젝트 폴더 설정</h5>
                    <p>Operation Mode에서 생성되는 session에 기본값으로 설정될 프로젝트 폴더예요.</p>
                  </div>

                  <div className="mode-project-path-input-row">
                    <input
                      type="text"
                      className="mode-settings-input"
                      placeholder="예: C:\\workspace\\my-project"
                      value={newModeProjectPath}
                      onMouseDown={() => {
                        suppressOverlayCloseRef.current = true;
                      }}
                      onChange={(event) => onNewModeProjectPathChange(event.target.value)}
                      onKeyDown={onAddNewModeProjectPathOnEnter}
                      aria-label="새 모드 프로젝트 폴더 경로"
                    />
                    <button className="mode-settings-sub-action" type="button" onClick={onAddNewModeProjectPath}>
                      경로 추가
                    </button>
                    <button className="mode-settings-sub-action" type="button" onClick={onPickNewModeProjectPath}>
                      폴더 선택
                    </button>
                  </div>

                  <ProjectPathList paths={newModeProjectPaths} onRemove={onRemoveNewModeProjectPath} />
                </div>

                {modeNameError && <p className="mode-settings-error">{modeNameError}</p>}
              </section>
            ) : (
              <section className="settings-card mode-list-card">
                <div className="settings-card-head">
                  <div>
                    <h4>모드 목록</h4>
                    <p>총 {draftModes.length}개 모드</p>
                  </div>
                </div>

                <div className="mode-settings-list" role="list" aria-label="모드 목록">
                  {draftModes.map((mode, index) => {
                    const isProtectedMode = index === 0;
                    const projectPathDraft = projectPathDrafts[mode.id] || "";

                    return (
                      <div className="mode-settings-item" role="listitem" key={mode.id}>
                        <div className="mode-settings-item-main">
                          <div className="mode-settings-mode-btn" aria-hidden="true">
                            <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
                              {mode.icon}
                            </span>
                          </div>
                          <input
                            className="mode-settings-input"
                            value={mode.name}
                            aria-label={`${mode.name || "mode"} 이름 수정`}
                            onMouseDown={() => {
                              suppressOverlayCloseRef.current = true;
                            }}
                            onChange={(event) => onDraftModeNameChange(mode.id, event.target.value)}
                          />
                          <div className="mode-settings-select-wrap">
                            <select
                              className="mode-settings-select"
                              value={mode.icon}
                              onChange={(event) => onDraftModeIconChange(mode.id, event.target.value as ModeIcon)}
                              aria-label={`${mode.name || "mode"} 아이콘 변경`}
                            >
                              {MODE_ICON_OPTIONS.map((iconName) => (
                                <option key={iconName} value={iconName}>
                                  {getModeIconLabel(iconName)}
                                </option>
                              ))}
                            </select>
                          </div>
                          <input
                            className="mode-settings-input"
                            value={mode.defaultModel || ""}
                            placeholder="기본 모델 예: gpt-5.4"
                            aria-label={`${mode.name || "mode"} 기본 모델 설정`}
                            onMouseDown={() => {
                              suppressOverlayCloseRef.current = true;
                            }}
                            onChange={(event) => onDraftModeDefaultModelChange(mode.id, event.target.value)}
                          />
                          <button
                            className="small-icon-btn"
                            type="button"
                            title="위로 이동"
                            onClick={() => onMoveDraftMode(index, "up")}
                            disabled={isProtectedMode || index === 1}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                              arrow_upward
                            </span>
                          </button>
                          <button
                            className="small-icon-btn"
                            type="button"
                            title="아래로 이동"
                            onClick={() => onMoveDraftMode(index, "down")}
                            disabled={index === draftModes.length - 1 || isProtectedMode}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                              arrow_downward
                            </span>
                          </button>
                          <button
                            className="small-icon-btn danger"
                            type="button"
                            title="모드 삭제"
                            onClick={() => onRemoveDraftMode(mode.id)}
                            disabled={isProtectedMode}
                          >
                            <span className="material-symbols-outlined" style={{ fontSize: "16px" }}>
                              delete
                            </span>
                          </button>
                        </div>

                        <div className="mode-settings-item-folders">
                          <div className="mode-project-path-copy">
                            <h5>기본 프로젝트 폴더 설정</h5>
                            <p>
                              Operation Mode에서 생성되는 session에 기본값으로 설정될 프로젝트 폴더
                              {` (${projectPathCounts[mode.id] || 0}개 연결됨)`}
                            </p>
                          </div>

                          <div className="mode-project-path-input-row">
                            <input
                              type="text"
                              className="mode-settings-input"
                              placeholder="프로젝트 폴더 경로 입력"
                              value={projectPathDraft}
                              onMouseDown={() => {
                                suppressOverlayCloseRef.current = true;
                              }}
                              onChange={(event) =>
                                setProjectPathDrafts((prev) => ({
                                  ...prev,
                                  [mode.id]: event.target.value,
                                }))
                              }
                              onKeyDown={(event) => {
                                if (event.key === "Enter") {
                                  event.preventDefault();
                                  onAddDraftModeProjectPath(mode.id, projectPathDraft);
                                  setProjectPathDrafts((prev) => ({
                                    ...prev,
                                    [mode.id]: "",
                                  }));
                                }
                              }}
                              aria-label={`${mode.name || "mode"} 프로젝트 폴더 경로`}
                            />
                            <button
                              className="mode-settings-sub-action"
                              type="button"
                              onClick={() => {
                                onAddDraftModeProjectPath(mode.id, projectPathDraft);
                                setProjectPathDrafts((prev) => ({
                                  ...prev,
                                  [mode.id]: "",
                                }));
                              }}
                            >
                              경로 추가
                            </button>
                            <button
                              className="mode-settings-sub-action"
                              type="button"
                              onClick={() => void onPickDraftModeProjectPath(mode.id)}
                            >
                              폴더 선택
                            </button>
                          </div>

                          <ProjectPathList
                            paths={mode.projectPaths}
                            onRemove={(projectPath) => onRemoveDraftModeProjectPath(mode.id, projectPath)}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </main>
        </div>

        <footer className="settings-footer mode-settings-footer-shell">
          <button className="settings-secondary-btn" type="button" onClick={onResetDraftModes}>
            기본 모드로 복원
          </button>
          <div className="mode-settings-footer-actions">
            <button className="settings-secondary-btn" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="settings-primary-btn" type="button" onClick={onSave}>
              Done
            </button>
          </div>
        </footer>
      </section>
    </div>
  );
}
