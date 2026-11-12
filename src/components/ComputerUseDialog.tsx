import { useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getComputerStatus,
  listComputerWindows,
  type ComputerAction,
  type ComputerChooseRequest,
  type ComputerProgress,
  type ComputerReviewRequest,
  type ComputerSelection,
  type ComputerWindow,
} from "@/features/computer/api";
import "./ComputerUseDialog.css";

function actionLabel(action: ComputerAction): string {
  switch (action.kind) {
    case "click":
      return `${action.button === "right" ? "오른쪽" : "왼쪽"} ${action.clickCount === 2 ? "더블 클릭" : "클릭"} · (${action.x}, ${action.y})`;
    case "type":
      return "텍스트 입력";
    case "key":
      return "키 입력 · " + action.key;
    case "scroll":
      return `스크롤 · ${action.deltaY > 0 ? "아래" : "위"} ${Math.abs(action.deltaY)}`;
    case "wait":
      return `화면 대기 · ${action.durationMs / 1000}초`;
  }
}

function WindowChooser({
  onResolve,
  modelLabel,
}: {
  modelLabel?: string;
  onResolve: (selection: ComputerSelection | null) => void;
}) {
  const [windows, setWindows] = useState<ComputerWindow[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [automatic, setAutomatic] = useState(false);
  const [loading, setLoading] = useState(true);
  const [supported, setSupported] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true);
  const requestId = useRef(0);

  const refresh = async () => {
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const status = await getComputerStatus();
      if (!alive.current || requestId.current !== id) return;
      setSupported(status.supported);
      if (!status.supported) {
        setWindows([]);
        return;
      }
      const next = await listComputerWindows();
      if (!alive.current || requestId.current !== id) return;
      setWindows(next);
      setSelectedId((previous) => (next.some((window) => window.id === previous) ? previous : ""));
    } catch (cause) {
      if (alive.current && requestId.current === id) {
        setWindows([]);
        setSelectedId("");
        setError(String(cause));
      }
    } finally {
      if (alive.current && requestId.current === id) setLoading(false);
    }
  };

  useEffect(() => {
    alive.current = true;
    void refresh();
    return () => {
      alive.current = false;
      requestId.current += 1;
    };
  }, []);

  return (
    <div className="computer-use-content">
      <p className="computer-use-intro">
        선택한 창의 화면을 {modelLabel || "현재 모델"}에 보내고, 에이전트가 클릭·입력·스크롤을
        수행합니다. 화면을 읽을 수 있는 이미지 지원 모델이 필요해요.
      </p>
      <div className="computer-use-section-head">
        <strong>제어할 창</strong>
        <button type="button" onClick={() => void refresh()} disabled={loading}>
          목록 새로고침
        </button>
      </div>
      {loading && <p role="status">열린 창을 확인하고 있어요.</p>}
      {!loading && !supported && !error && (
        <p className="computer-use-notice">컴퓨터 제어는 현재 Windows에서 사용할 수 있어요.</p>
      )}
      {error && (
        <p className="computer-use-error" role="alert">
          {error}
        </p>
      )}
      {!loading && supported && !windows.length && !error && (
        <p className="computer-use-notice">
          제어할 창이 없어요. 사용할 앱을 열고 목록을 새로고침해 주세요.
        </p>
      )}
      {windows.length > 0 && (
        <div className="computer-use-window-list" role="radiogroup" aria-label="제어할 창">
          {windows.map((target) => (
            <label key={target.id} className={selectedId === target.id ? "is-selected" : ""}>
              <input
                type="radio"
                name="computer-window"
                value={target.id}
                checked={selectedId === target.id}
                disabled={loading}
                onChange={() => setSelectedId(target.id)}
              />
              <span>
                <strong>{target.title}</strong>
                <small>{target.processName}</small>
              </span>
            </label>
          ))}
        </div>
      )}
      <label className="computer-use-automatic">
        <input
          type="checkbox"
          checked={automatic}
          onChange={(event) => setAutomatic(event.target.checked)}
        />
        <span>
          <strong>이번 요청의 일반 동작 자동 실행</strong>
          <small>
            선택하지 않으면 입력 전에 매번 확인합니다. 중요한 변경은 자동 실행 중에도 확인해요.
          </small>
        </span>
      </label>
      <p className="computer-use-footnote">
        한 요청은 최대 12단계·5분입니다. 제어 중에는 대상 창을 조작하지 마세요. 중지 버튼이나 F8로
        멈출 수 있어요. 캡처 화면은 대화 기록에 저장하지 않습니다.
      </p>
      <div className="computer-use-actions">
        <button type="button" onClick={() => onResolve(null)}>
          취소
        </button>
        <button
          type="button"
          className="is-primary"
          disabled={
            loading ||
            !supported ||
            !selectedId ||
            !windows.some((target) => target.id === selectedId)
          }
          onClick={() => onResolve({ windowId: selectedId, automatic })}
        >
          이 창으로 시작
        </button>
      </div>
    </div>
  );
}

// 제어 요청은 현재 화면에서만 유지하고, 닫기·중지·언마운트 시 대기 중인 입력을 거절합니다.
export function ComputerUseDialog() {
  const [choose, setChoose] = useState<ComputerChooseRequest | null>(null);
  const [review, setReview] = useState<ComputerReviewRequest | null>(null);
  const [progress, setProgress] = useState<ComputerProgress>({ active: false });
  const chooseRef = useRef<ComputerChooseRequest | null>(null);
  const reviewRef = useRef<ComputerReviewRequest | null>(null);

  const resolveChoose = (selection: ComputerSelection | null) => {
    const pending = chooseRef.current;
    chooseRef.current = null;
    setChoose(null);
    pending?.resolve(selection);
  };
  const resolveReview = (approved: boolean) => {
    const pending = reviewRef.current;
    reviewRef.current = null;
    setReview(null);
    pending?.resolve(approved);
  };
  const stop = () => window.dispatchEvent(new Event("computer-stop"));

  useEffect(() => {
    const closePending = () => {
      const choosing = chooseRef.current;
      const reviewing = reviewRef.current;
      chooseRef.current = null;
      reviewRef.current = null;
      setChoose(null);
      setReview(null);
      choosing?.resolve(null);
      reviewing?.resolve(false);
    };
    const onChoose = (event: Event) => {
      closePending();
      const detail = (event as CustomEvent<ComputerChooseRequest>).detail;
      chooseRef.current = detail;
      setChoose(detail);
    };
    const onReview = (event: Event) => {
      closePending();
      const detail = (event as CustomEvent<ComputerReviewRequest>).detail;
      reviewRef.current = detail;
      setReview(detail);
    };
    const onProgress = (event: Event) => {
      const detail = (event as CustomEvent<ComputerProgress>).detail;
      setProgress(detail);
      if (!detail.active) closePending();
    };
    window.addEventListener("computer-choose-window", onChoose);
    window.addEventListener("computer-review-action", onReview);
    window.addEventListener("computer-progress", onProgress);
    window.addEventListener("computer-stop", closePending);
    return () => {
      window.removeEventListener("computer-choose-window", onChoose);
      window.removeEventListener("computer-review-action", onReview);
      window.removeEventListener("computer-progress", onProgress);
      window.removeEventListener("computer-stop", closePending);
      const choosing = chooseRef.current;
      const reviewing = reviewRef.current;
      chooseRef.current = null;
      reviewRef.current = null;
      choosing?.resolve(null);
      reviewing?.resolve(false);
      window.dispatchEvent(new Event("computer-stop"));
    };
  }, []);

  return (
    <>
      {progress.active && (
        <aside className="computer-use-progress" aria-live="polite" aria-label="컴퓨터 제어 상태">
          <span className="material-symbols-outlined" aria-hidden="true">
            computer
          </span>
          <div>
            <strong>{progress.windowTitle || "컴퓨터 제어 준비 중"}</strong>
            <span>
              {typeof progress.step === "number" ? `${progress.step}/12단계 · ` : ""}
              {progress.description || "화면을 확인하고 있어요."}
            </span>
          </div>
          <button type="button" onClick={stop}>
            중지 · F8
          </button>
        </aside>
      )}
      <Dialog
        open={Boolean(choose || review)}
        onOpenChange={(open) => {
          if (!open) {
            resolveChoose(null);
            resolveReview(false);
          }
        }}
      >
        <DialogContent className="computer-use-dialog">
          <DialogHeader>
            <DialogTitle>{review ? "컴퓨터 동작 확인" : "컴퓨터 제어 시작"}</DialogTitle>
            <DialogDescription>
              {review
                ? "현재 화면과 수행할 동작을 확인해 주세요."
                : "이번 요청에서 사용할 창과 실행 방식을 선택하세요."}
            </DialogDescription>
          </DialogHeader>
          {choose && (
            <WindowChooser key="choose" modelLabel={choose.modelLabel} onResolve={resolveChoose} />
          )}
          {review && (
            <div className="computer-use-content">
              {review.sensitive && (
                <p className="computer-use-sensitive">
                  중요한 변경이 포함된 동작입니다. 대상과 내용을 확인한 뒤 실행하세요.
                </p>
              )}
              <div className="computer-use-review-summary">
                <span>{review.observation.windowTitle}</span>
                <strong>{actionLabel(review.action)}</strong>
                <p>{review.reason}</p>
              </div>
              {review.action.kind === "type" && (
                <pre className="computer-use-input-preview">{review.action.text}</pre>
              )}
              <div className="computer-use-image-wrap">
                <img
                  src={review.observation.imageDataUrl}
                  alt={review.observation.windowTitle + " 현재 화면"}
                />
                {(review.action.kind === "click" || review.action.kind === "scroll") && (
                  <span
                    className="computer-use-target"
                    aria-label="동작 위치"
                    style={{
                      left: `${(review.action.x / review.observation.width) * 100}%`,
                      top: `${(review.action.y / review.observation.height) * 100}%`,
                    }}
                  />
                )}
              </div>
              <p className="computer-use-footnote">
                한 동작만 실행합니다. 창 위치·크기가 바뀌거나 관찰이 오래되면 입력을 중지해요.
              </p>
              <div className="computer-use-actions">
                <button type="button" onClick={() => resolveReview(false)}>
                  취소하고 중지
                </button>
                <button type="button" className="is-primary" onClick={() => resolveReview(true)}>
                  이 동작 실행
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
