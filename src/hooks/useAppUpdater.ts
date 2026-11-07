import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent } from "@tauri-apps/plugin-updater";

type AppUpdateStatus =
  | "unsupported"
  | "idle"
  | "checking"
  | "available"
  | "downloading"
  | "installing"
  | "up-to-date"
  | "error";

type CheckForUpdateOptions = {
  install?: boolean;
};

function formatPercent(downloadedBytes: number, contentLength?: number) {
  if (!contentLength) {
    return "";
  }

  return ` ${Math.min(Math.round((downloadedBytes / contentLength) * 100), 100)}%`;
}

export function useAppUpdater() {
  const [status, setStatus] = useState<AppUpdateStatus>(() => (isTauri() ? "idle" : "unsupported"));
  const [message, setMessage] = useState(() =>
    isTauri() ? "업데이트 확인 가능" : "데스크톱 앱에서 사용 가능"
  );
  const [latestVersion, setLatestVersion] = useState<string | null>(null);
  const isCheckingRef = useRef(false);
  const isInstallingRef = useRef(false);
  const [isInstallingUpdate, setIsInstallingUpdate] = useState(false);

  const checkForUpdate = useCallback(async ({ install = false }: CheckForUpdateOptions = {}) => {
    if (!isTauri()) {
      setStatus("unsupported");
      setMessage("데스크톱 앱에서 사용 가능");
      return;
    }

    // 시작 시 자동 확인과 사용자의 수동 확인이 겹치지 않도록 합니다.
    if (isCheckingRef.current) return;
    isCheckingRef.current = true;
    // 설치 확인부터 재시작까지 새 대화 작업이 시작되지 않도록 잠급니다.
    if (install) {
      isInstallingRef.current = true;
      setIsInstallingUpdate(true);
    }

    setStatus("checking");
    setMessage("업데이트 확인 중");
    let update: Awaited<ReturnType<typeof check>> = null;

    try {
      const foundUpdate = await check({ timeout: 15000 });
      update = foundUpdate;

      if (!foundUpdate) {
        setLatestVersion(null);
        setStatus("up-to-date");
        setMessage("최신 버전");
        return;
      }

      setLatestVersion(foundUpdate.version);

      if (!install) {
        // 확인만 한 업데이트는 백엔드 리소스를 해제합니다.
        await foundUpdate.close();
        update = null;
        setStatus("available");
        setMessage(`새 버전 ${foundUpdate.version}`);
        return;
      }

      let downloadedBytes = 0;
      let contentLength: number | undefined;

      setStatus("downloading");
      setMessage(`다운로드 중 ${foundUpdate.version}`);

      await foundUpdate.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength;
          downloadedBytes = 0;
          setMessage(`다운로드 중 ${foundUpdate.version}`);
          return;
        }

        if (event.event === "Progress") {
          downloadedBytes += event.data.chunkLength;
          setMessage(`다운로드 중${formatPercent(downloadedBytes, contentLength)}`);
          return;
        }

        setStatus("installing");
        setMessage("설치 후 재시작 중");
      });

      await relaunch();
    } catch (error) {
      if (update) await update.close().catch(() => {});
      setStatus("error");
      const detail =
        error instanceof Error ? error.message : typeof error === "string" ? error : "";
      setMessage(detail ? `업데이트 실패: ${detail}` : "업데이트 확인 또는 설치 실패");
    } finally {
      isCheckingRef.current = false;
      isInstallingRef.current = false;
      setIsInstallingUpdate(false);
    }
  }, []);

  useEffect(() => {
    if (!import.meta.env.PROD || !isTauri()) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void checkForUpdate();
    }, 1500);

    return () => window.clearTimeout(timeoutId);
  }, [checkForUpdate]);

  return useMemo(
    () => ({
      canCheck: status !== "unsupported",
      checkForUpdate,
      isBusy: status === "checking" || status === "downloading" || status === "installing",
      isUpdateAvailable: status === "available",
      isInstallingRef,
      isInstallingUpdate,
      latestVersion,
      message,
      status,
    }),
    [checkForUpdate, isInstallingUpdate, latestVersion, message, status]
  );
}
