import { useState, type FormEvent } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { saveSchedule, type Schedule, type ScheduleScope } from "@/features/agent/schedules";
import {
  calendarDateTimeToLocalInput,
  calendarLocalInputToIso,
} from "@/features/agent/calendarDraftTime";
import type { AgentItem } from "@/types/chat";
import { intervalLabel } from "./intervalLabel";

export type ScheduleTemplate = Pick<Schedule, "title" | "kind" | "instruction" | "intervalMinutes">;
type ScheduleEditorProps = {
  item?: Schedule;
  scope: ScheduleScope;
  template?: ScheduleTemplate;
  modes: readonly string[];
  agentsByMode: Record<string, Pick<AgentItem, "agentId" | "name">[]>;
  unavailableModes: string[];
  onSaved: (item: Schedule) => void;
  onCancel: () => void;
  onOpenPlugins: () => void;
};

const intervals = [60, 1440, 10080];

export function ScheduleEditor({
  item,
  scope,
  template,
  modes,
  agentsByMode,
  unavailableModes,
  onSaved,
  onCancel,
  onOpenPlugins,
}: ScheduleEditorProps) {
  const source = item ?? template;
  const [modeName, setModeName] = useState(scope.modeName);
  const [agentId, setAgentId] = useState(scope.agentId ?? "");
  const [kind, setKind] = useState<Schedule["kind"]>(source?.kind ?? "prompt");
  const [title, setTitle] = useState(source?.title ?? "");
  const [instruction, setInstruction] = useState(source?.instruction ?? "");
  const initialInterval = source?.intervalMinutes ?? 1440;
  const [preset, setPreset] = useState(
    intervals.includes(initialInterval) ? String(initialInterval) : "custom"
  );
  const [customInterval, setCustomInterval] = useState(String(initialInterval));
  // 편집 중 실행이 끝나도 사용자가 건드리지 않은 다음 시각은 그대로 둡니다.
  const [originalTime] = useState(() =>
    item ? calendarDateTimeToLocalInput(new Date(item.nextRunAt).toISOString()) : ""
  );
  const [firstRun, setFirstRun] = useState(originalTime);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const agents = agentsByMode[modeName] ?? [];

  async function save(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError("");
    setSaving(true);
    try {
      const firstRunAt =
        firstRun && firstRun !== originalTime
          ? Date.parse(calendarLocalInputToIso(firstRun))
          : undefined;
      if (firstRunAt !== undefined && firstRunAt <= Date.now())
        throw new Error("다음 실행 시각을 현재보다 늦게 설정해 주세요.");
      const result = await saveSchedule({
        id: item?.id,
        modeName,
        agentId: agentId || null,
        kind,
        title: title.trim(),
        instruction: instruction.trim(),
        intervalMinutes: Number(preset === "custom" ? customInterval : preset),
        firstRunAt,
      });
      onSaved(result);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="schedule-editor" onSubmit={(event) => void save(event)}>
      <h2>{item ? "예약 수정" : "새 작업"}</h2>
      <fieldset disabled={saving}>
        <label>
          작업 이름
          <input
            autoFocus
            required
            maxLength={120}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="예: 주간 업무 회고"
          />
        </label>
        <div className="schedule-fields">
          <label>
            오퍼레이션 모드
            <select
              disabled={!!item}
              value={modeName}
              onChange={(e) => {
                setModeName(e.target.value);
                setAgentId("");
              }}
            >
              {modes.map((mode) => (
                <option key={mode}>{mode}</option>
              ))}
            </select>
          </label>
          <label>
            실행 대상
            <select disabled={!!item} value={agentId} onChange={(e) => setAgentId(e.target.value)}>
              <option value="">모드 전체</option>
              {agentId && !agents.some((a) => a.agentId === agentId) && (
                <option value={agentId}>선택한 에이전트</option>
              )}
              {agents
                .filter((a) => a.agentId)
                .map((a) => (
                  <option key={a.agentId} value={a.agentId}>
                    {a.name}
                  </option>
                ))}
            </select>
          </label>
        </div>
        {unavailableModes.includes(modeName) && (
          <p role="alert">에이전트 목록을 불러오지 못했어요. 예약 화면을 다시 열어 주세요.</p>
        )}
        <label>
          작업 유형
          <select
            disabled={!!item}
            value={kind}
            onChange={(e) => setKind(e.target.value as Schedule["kind"])}
          >
            <option value="prompt">대화 기반 작업</option>
            <option value="email">Gmail 요약</option>
          </select>
        </label>
        {kind === "email" ? (
          <p className="schedule-hint">
            연결한 Gmail의 새 메일을 설정한 AI 모델로 요약합니다.{" "}
            <button type="button" className="schedule-text-button" onClick={onOpenPlugins}>
              플러그인 열기
            </button>
          </p>
        ) : (
          <p className="schedule-hint">
            {agentId
              ? "이 에이전트의 모델이 자신의 기억과 최근 대화를 바탕으로 보고서를 작성해요."
              : "모드의 기본 모델이 이 모드의 최근 일반 대화를 바탕으로 보고서를 작성해요."}
          </p>
        )}
        <label>
          맡길 일
          <textarea
            required
            rows={4}
            maxLength={4000}
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="실행할 때마다 어떤 결과를 받을지 적어 주세요."
          />
        </label>
        <div className="schedule-fields">
          <label>
            반복
            <select value={preset} onChange={(e) => setPreset(e.target.value)}>
              {intervals.map((n) => (
                <option key={n} value={n}>
                  {intervalLabel(n)}
                </option>
              ))}
              <option value="custom">직접 설정</option>
            </select>
          </label>
          {preset === "custom" && (
            <label>
              실행 간격 (분)
              <input
                type="number"
                required
                min={5}
                max={10080}
                step={1}
                value={customInterval}
                onChange={(e) => setCustomInterval(e.target.value)}
              />
            </label>
          )}
          <label>
            {item ? "다음 실행 시각" : "첫 실행 시각 (선택)"}
            <input
              type="datetime-local"
              required={!!item}
              value={firstRun}
              onChange={(e) => setFirstRun(e.target.value)}
            />
          </label>
        </div>
        <p className="schedule-hint">
          {!item && !firstRun && "첫 실행 시각을 비우면 저장 후 한 주기 뒤에 시작합니다. "}
          {isTauri()
            ? "데스크톱 앱을 열어 두면 예약이 실행됩니다. 종료 중 놓친 작업은 다음에 열 때 처리합니다."
            : "이 브라우저에 저장됩니다. 자동 실행은 데스크톱 앱에서 예약해 주세요."}
        </p>
        {error && (
          <p className="schedule-error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" className="schedule-button" onClick={onCancel}>
            취소
          </button>
          <button
            type="submit"
            className="schedule-button primary"
            disabled={!title.trim() || !instruction.trim() || !modeName}
          >
            {saving ? "저장 중…" : "예약 저장"}
          </button>
        </footer>
      </fieldset>
    </form>
  );
}
