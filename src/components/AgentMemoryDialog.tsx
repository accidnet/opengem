import { useEffect, useState } from "react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { getAgentMemory, saveAgentMemory, type AgentMemory } from "@/features/agent/api";

type AgentMemoryDialogProps = {
  modeName: string;
  agentId: string;
  agentName: string;
  onSaved: () => void;
};

export function AgentMemoryDialog({
  modeName,
  agentId,
  agentName,
  onSaved,
}: AgentMemoryDialogProps) {
  const [open, setOpen] = useState(false);
  const [saved, setSaved] = useState<AgentMemory | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const editing = draft !== null;
  const content = draft ?? saved?.content ?? "";
  const bytes = new TextEncoder().encode(content).length;
  const tooLarge = bytes > 24 * 1024;

  // 편집하는 동안은 원본 버전을 유지해 에이전트가 새로 기록한 기억을 덮어쓰지 않습니다.
  useEffect(() => {
    if (!open || editing) return;
    let version = 0;
    const load = async () => {
      const request = ++version;
      try {
        const result = await getAgentMemory({ modeName, agentId });
        if (request === version) {
          setSaved(result);
          setError("");
        }
      } catch (cause) {
        if (request === version) setError(String(cause));
      }
    };
    const handleUpdate = (event: Event) => {
      const scope = (event as CustomEvent<{ modeName: string; agentId: string }>).detail;
      if (scope?.modeName === modeName && scope.agentId === agentId) void load();
    };
    void load();
    window.addEventListener("agent-workspace-updated", handleUpdate);
    return () => {
      version += 1;
      window.removeEventListener("agent-workspace-updated", handleUpdate);
    };
  }, [open, editing, modeName, agentId]);

  const changeOpen = (next: boolean) => {
    if (saving) return;
    setSaved(null);
    setDraft(null);
    setError("");
    setOpen(next);
  };

  const save = async () => {
    if (!saved || draft === null || saving || tooLarge) return;
    setSaving(true);
    setError("");
    try {
      await saveAgentMemory({
        modeName,
        agentId,
        content: draft,
        expectedUpdatedAt: saved.updatedAt,
      });
      setOpen(false);
      onSaved();
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={changeOpen}>
      <DialogTrigger asChild>
        <button type="button">MEMORY.md 열기</button>
      </DialogTrigger>
      <DialogContent className="agent-memory-dialog" showCloseButton={false}>
        <DialogHeader>
          <DialogTitle>{agentName}의 기억</DialogTitle>
          <DialogDescription>
            에이전트가 다음 대화에서도 기억할 내용을 Markdown으로 기록해요. 직접 추가하거나 수정할
            수 있어요.
          </DialogDescription>
        </DialogHeader>
        <label className="settings-field">
          <span>MEMORY.md</span>
          <textarea
            rows={12}
            value={content}
            readOnly={!saved || saving}
            aria-invalid={tooLarge || undefined}
            placeholder="예: 나는 오전 회의를 선호해. 일정은 한국 시간으로 알려 줘."
            onChange={(event) => {
              setDraft(event.target.value === saved?.content ? null : event.target.value);
              setError("");
            }}
          />
        </label>
        {!saved && !error && <p role="status">기억을 불러오는 중이에요.</p>}
        {saved && (
          <div className="agent-memory-info">
            <span>{(bytes / 1024).toFixed(1)} / 24 KB</span>
            {saved.updatedAt && (
              <span>마지막 수정 {new Date(saved.updatedAt).toLocaleString("ko-KR")}</span>
            )}
          </div>
        )}
        {tooLarge && <p role="alert">24 KB 이내로 줄여 주세요.</p>}
        {error && <p role="alert">{error}</p>}
        <DialogFooter>
          <button
            type="button"
            className="settings-secondary-btn"
            disabled={saving}
            onClick={() => changeOpen(false)}
          >
            {editing ? "취소" : "닫기"}
          </button>
          <button
            type="button"
            className="settings-primary-btn"
            disabled={!saved || !editing || saving || tooLarge}
            onClick={() => void save()}
          >
            {saving ? "저장 중…" : "기억 저장"}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
