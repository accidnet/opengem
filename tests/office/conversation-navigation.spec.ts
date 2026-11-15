import { expect, test } from "@playwright/test";
import type { SessionItem } from "@/types/chat";

test("새 대화의 초안과 삭제 후 열리는 기록은 같은 참여 범위에 머문다", async ({ page }) => {
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.addInitScript(() => {
    const mode = "회의실";
    const reviewer = {
      agentId: "reviewer",
      name: "리뷰어",
      role: "sub",
      active: true,
      icon: "fact_check",
      color: "indigo",
      model: "gpt-4o-mini",
    };
    const sessions: SessionItem[] = [
      { id: "group", agentId: null, updatedAt: 5 },
      { id: "review-old", agentId: "reviewer", updatedAt: 1 },
      { id: "review-new", agentId: "reviewer", updatedAt: 4 },
      { id: "archived", agentId: "deleted-agent", updatedAt: 10 },
    ].map((session) => ({ ...session, title: session.id, modeName: mode, projectPaths: [] }));
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: {
        invoke: async (command: string, args: { sessionId: string }) => {
          switch (command) {
            case "load_operation_mode":
              return { modes: [mode], selectedMode: mode, items: [{ name: mode }] };
            case "load_mode_agents":
              return [reviewer];
            case "list_chat_sessions":
              return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
            case "get_chat_session":
              return {
                session: sessions.find((session) => session.id === args.sessionId),
                messages: [],
              };
            case "delete_chat_session":
              sessions.splice(
                sessions.findIndex((session) => session.id === args.sessionId),
                1
              );
              return;
            case "get_agent_memory":
              return { content: "", updatedAt: 0 };
            case "get_google_settings":
              return { services: [] };
            default:
              return [];
          }
        },
      },
    });
  });
  await page.goto("/");
  const group = page.getByRole("button", { name: "회의실 전체 대화", exact: true });
  const direct = page.getByTitle("리뷰어와 대화", { exact: true });
  const composer = page.getByRole("textbox", { name: "메시지 입력" });
  const title = page.getByRole("banner").getByRole("heading", { level: 2 });
  await group.click();
  await expect(title).toHaveText("group");
  await composer.fill("전체 메시지 초안");
  await direct.click();
  await expect(title).toHaveText("review-new");
  await page.getByTitle("새 채팅 시작").click();
  await composer.fill("개별 메시지 초안");
  await group.click();
  await expect(composer).toHaveValue("전체 메시지 초안");
  await direct.click();
  await expect(composer).toHaveValue("개별 메시지 초안");
  await expect(title).toHaveText("새 채팅");

  const directHistory = page.getByRole("group", { name: "리뷰어 개별 대화 기록" });
  await directHistory
    .getByRole("button", { name: /^review-new / })
    .first()
    .click();
  await expect(title).toHaveText("review-new");
  await directHistory.getByRole("button", { name: "review-new 세션 삭제" }).click();
  await expect(title).toHaveText("review-old");
  await directHistory.getByRole("button", { name: "review-old 세션 삭제" }).click();
  await expect(title).toHaveText("새 채팅");
  await expect(composer).toHaveValue("개별 메시지 초안");

  await page
    .getByRole("group", { name: "삭제된 에이전트 대화 기록" })
    .getByRole("button", { name: /^archived / })
    .first()
    .click();
  await expect(page.getByText("삭제된 에이전트 개별 대화", { exact: true })).toBeVisible();
  await composer.fill("보낼 수 없는 초안");
  await expect(page.getByRole("button", { name: "메시지 보내기" })).toBeDisabled();
  await group.click();
  await expect(composer).toHaveValue("전체 메시지 초안");
});
