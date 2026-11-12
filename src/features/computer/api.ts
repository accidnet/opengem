import { invoke } from "@tauri-apps/api/core";

export type ComputerWindow = { id: string; title: string; processName: string };
export type ComputerStatus = {
  supported: boolean;
  sessionId: string | null;
  window: ComputerWindow | null;
  expiresAt: number | null;
};
export type ComputerObservation = {
  sessionId: string;
  observationId: string;
  width: number;
  height: number;
  imageDataUrl: string;
  windowTitle: string;
  capturedAt: number;
};
export type ComputerAction =
  | { kind: "click"; x: number; y: number; button: "left" | "right"; clickCount: 1 | 2 }
  | { kind: "type"; text: string }
  | { kind: "key"; key: string }
  | { kind: "scroll"; x: number; y: number; deltaY: number }
  | { kind: "wait"; durationMs: number };
export type ComputerSelection = { windowId: string; automatic: boolean };
export type ComputerChooseRequest = {
  modelLabel?: string;
  resolve: (selection: ComputerSelection | null) => void;
};
export type ComputerReviewRequest = {
  observation: ComputerObservation;
  action: ComputerAction;
  reason: string;
  sensitive: boolean;
  resolve: (approved: boolean) => void;
};
export type ComputerProgress = {
  active: boolean;
  sessionId?: string;
  windowTitle?: string;
  step?: number;
  description?: string;
};

// 네이티브 세션이 창과 최신 관찰을 검증하며, 이미지와 입력은 DB에 저장하지 않습니다.
export const listComputerWindows = () => invoke<ComputerWindow[]>("list_computer_windows");
export const getComputerStatus = () => invoke<ComputerStatus>("get_computer_status");
export const startComputerSession = (windowId: string) =>
  invoke<ComputerStatus>("start_computer_session", { windowId });
export const observeComputerSession = (sessionId: string) =>
  invoke<ComputerObservation>("observe_computer_session", { sessionId });
export const actComputerSession = (input: {
  sessionId: string;
  observationId: string;
  action: ComputerAction;
}) => invoke<ComputerObservation>("act_computer_session", { input });
export const stopComputerSession = (sessionId: string) =>
  invoke<void>("stop_computer_session", { sessionId });
