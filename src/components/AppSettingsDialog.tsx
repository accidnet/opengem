import { useEffect, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  DEFAULT_GLOBAL_PROMPT,
  getGlobalPrompt,
  saveGlobalPrompt,
} from "@/features/app/globalPrompt";

type AppSettingsDialogProps = {
  onClose: () => void;
  onReturnFocus: () => void;
};

export function AppSettingsDialog({ onClose, onReturnFocus }: AppSettingsDialogProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void getGlobalPrompt()
      .then((value) => {
        if (active) setDraft(value);
      })
      .catch((reason) => {
        if (active) setError("전역 프롬프트를 불러오지 못했어요. " + String(reason));
      });
    return () => {
      active = false;
    };
  }, []);

  const save = async () => {
    if (saving || draft === null) return;
    setSaving(true);
    setError("");
    try {
      await saveGlobalPrompt(draft);
      onClose();
    } catch (reason) {
      setError("전역 프롬프트를 저장하지 못했어요. " + String(reason));
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-xl max-h-[90dvh] overflow-y-auto bg-[var(--panel)] border-[var(--border)] text-[var(--text-main)]"
        showCloseButton={!saving}
        onCloseAutoFocus={(event) => {
          // 설정을 열 때 메뉴 항목이 사라지므로 상시 표시되는 사용자 메뉴 버튼으로 돌아갑니다.
          event.preventDefault();
          onReturnFocus();
        }}
      >
        <DialogHeader>
          <DialogTitle>앱 설정</DialogTitle>
          <DialogDescription className="text-[var(--text-soft)]">
            모든 에이전트가 다음 요청부터 따를 공통 지침을 설정하세요.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          <Label htmlFor="app-global-prompt">전역 프롬프트</Label>
          <Textarea
            id="app-global-prompt"
            className="resize-y border-[var(--border)] bg-[var(--panel-soft)] leading-relaxed focus-visible:outline-2 focus-visible:outline-[var(--primary)]"
            rows={7}
            value={draft ?? ""}
            disabled={draft === null || saving}
            onChange={(event) => setDraft(event.target.value)}
          />
          {draft === null && !error && <p role="status">불러오는 중…</p>}
          {error && <p role="alert">{error}</p>}
        </div>
        <DialogFooter className="flex-row flex-wrap items-center justify-end gap-2">
          <button
            type="button"
            className="settings-secondary-btn mr-auto"
            disabled={saving || draft === null || draft === DEFAULT_GLOBAL_PROMPT}
            onClick={() => setDraft(DEFAULT_GLOBAL_PROMPT)}
          >
            기본값 복원
          </button>
          <button
            type="button"
            className="settings-secondary-btn"
            onClick={onClose}
            disabled={saving}
          >
            취소
          </button>
          <button
            type="button"
            className="settings-primary-btn"
            onClick={() => void save()}
            disabled={draft === null || saving}
          >
            {saving ? "저장 중…" : "저장"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
