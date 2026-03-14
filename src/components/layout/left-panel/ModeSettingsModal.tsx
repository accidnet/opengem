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
    <div className="mode-settings-overlay" role="presentation" onClick={onOverlayClick}>
      <section
        className="mode-settings-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="mode-settings-title"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="mode-settings-header">
          <div>
            <h4 id="mode-settings-title" className="mode-settings-title">
              Operation Mode 설정
            </h4>
          </div>
          <button className="small-icon-btn" type="button" aria-label="설정 창 닫기" onClick={onClose}>
            <span className="material-symbols-outlined" style={{ fontSize: "18px" }}>
              close
            </span>
          </button>
        </header>

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
            aria-label="새 operation mode 이름"
          />
          <div className="mode-settings-select-wrap">
            <select
              className="mode-settings-select"
              value={newModeIcon}
              onChange={(event) => onNewModeIconChange(event.target.value as ModeIcon)}
              aria-label="새 operation mode 아이콘"
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

        <div className="mode-settings-list" role="list" aria-label="Operation mode 목록">
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
                  title="모드 제거"
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

        <footer className="mode-settings-footer">
          <button className="mode-settings-sub-action" type="button" onClick={onResetDraftModes}>
            기본 모드로 복원
          </button>
          <button className="mode-settings-action" type="button" onClick={onSave}>
            저장
          </button>
        </footer>
      </section>
    </div>
  );
}
