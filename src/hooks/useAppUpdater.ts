import { useCallback, useEffect, useMemo, useState } from "react";
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

  const checkForUpdate = useCallback(async ({ install = false }: CheckForUpdateOptions = {}) => {
    if (!isTauri()) {
      setStatus("unsupported");
      setMessage("데스크톱 앱에서 사용 가능");
      return;
    }

    setStatus("checking");
    setMessage("업데이트 확인 중");

    try {
      const update = await check({ timeout: 15000 });

      if (!update) {
        setLatestVersion(null);
        setStatus("up-to-date");
        setMessage("최신 버전");
        return;
      }

      setLatestVersion(update.version);

      if (!install) {
        setStatus("available");
        setMessage(`새 버전 ${update.version}`);
        return;
      }

      let downloadedBytes = 0;
      let contentLength: number | undefined;

      setStatus("downloading");
      setMessage(`다운로드 중 ${update.version}`);

      await update.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === "Started") {
          contentLength = event.data.contentLength;
          downloadedBytes = 0;
          setMessage(`다운로드 중 ${update.version}`);
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
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "업데이트 확인 실패");
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
      latestVersion,
      message,
      status,
    }),
    [checkForUpdate, latestVersion, message, status]
  );
}
