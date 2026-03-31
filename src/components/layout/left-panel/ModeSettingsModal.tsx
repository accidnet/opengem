import type { KeyboardEvent, MutableRefObject } from "react";

import { MODE_ICON_OPTIONS } from "@/data/appData";
import type { ModeIcon } from "@/data/appData";

import { getModeIconLabel } from "./utils";
import type { DraftModeItem } from "./types";

type ModeSettingsModalProps = {
  isOpen: boolean;
  newModeName: string;
  newModeIcon: ModeIcon;
  modeNameError: string;
  draftModes: DraftModeItem[];
  suppressOverlayCloseRef: MutableRefObject<boolean>;
  onClose: () => void;
  onOverlayClick: () => void;
  onNewModeNameChange: (value: string) => void;
  onNewModeIconChange: (icon: ModeIcon) => void;
  onCreateMode: () => void;
  onCreateModeOnEnter: (event: KeyboardEvent<HTMLInputElement>) => void;
  onDraftModeNameChange: (id: string, value: string) => void;
  onDraftModeIconChange: (id: string, icon: ModeIcon) => void;
  onMoveDraftMode: (index: number, direction: "up" | "down") => void;
  onRemoveDraftMode: (id: string) => void;
  onResetDraftModes: () => void;
  onSave: () => void | Promise<void>;
};

export function ModeSettingsModal({
  isOpen,
  newModeName,
  newModeIcon,
  modeNameError,
  draftModes,
  suppressOverlayCloseRef,
  onClose,
  onOverlayClick,
  onNewModeNameChange,
  onNewModeIconChange,
  onCreateMode,
  onCreateModeOnEnter,
  onDraftModeNameChange,
  onDraftModeIconChange,
  onMoveDraftMode,
  onRemoveDraftMode,
  onResetDraftModes,
  onSave,
}: ModeSettingsModalProps) {
  if (!isOpen) {
    return null;
  }

  return (
    <div className="settings-overlay" role="presentation" onClick={onOverlayClick}>
      <section
        className="provider-modal mode-provider-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mode-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="provider-header">
          <div className="provider-header-title-wrap">
            <span className="provider-header-icon material-symbols-outlined" aria-hidden="true">
              tune
            </span>
            <h3 id="mode-settings-title" className="settings-title">
              Modes
            </h3>
          </div>
          <button
            className="provider-close-btn"
            type="button"
            aria-label="모드 설정 닫기"
            onClick={onClose}
          >
            <span className="material-symbols-outlined" aria-hidden="true">
              close
            </span>
          </button>
        </header>

        <div className="provider-body">
          <aside className="provider-sidebar mode-provider-sidebar" aria-label="모드 설정 안내">
            <p className="provider-sidebar-label">MODES</p>
            <p className="provider-sidebar-help">
              작업 모드를 추가하고, 순서와 아이콘을 정리해서 왼쪽 패널 구성을 관리해.
            </p>
          </aside>

          <main className="provider-main mode-provider-main">
            <div className="provider-main-copy">
              <h4>모드 설정</h4>
              <p>에이전트 설정과 같은 모달 구조 안에서 모드 추가, 편집, 순서 변경을 한 번에 할 수 있어.</p>
            </div>

            <section className="settings-card mode-create-card">
              <div className="settings-card-head settings-card-head-column">
                <div>
                  <h4>새 모드 추가</h4>
                  <p>이름과 아이콘을 정하면 즉시 목록에 초안으로 추가돼. 저장 전까지는 실제 목록에 반영되지 않아.</p>
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
                <button className="mode-settings-action" type="button" onClick={onCreateMode}>
                  추가
                </button>
              </div>

              {modeNameError && <p className="mode-settings-error">{modeNameError}</p>}
            </section>

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
                  return (
                    <div className="mode-settings-item" role="listitem" key={mode.id}>
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
                  );
                })}
              </div>
            </section>
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
