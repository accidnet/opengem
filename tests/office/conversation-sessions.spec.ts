import { expect, test, type Page } from "@playwright/test";
import type { Message, SessionDetail, SessionItem } from "@/types/chat";

async function mockWorkspace(page: Page) {
  const mode = "Orchestration";
  const settings = {
    providerId: "anthropic",
    providerKind: "api-key",
    baseUrl: "https://sessions.example.test/v1",
    model: "claude-3-5-sonnet-latest",
    apiKey: "fixture-only",
  };
  const agents = [
    { agentId: "lead", name: "팀장", role: "main" },
    { agentId: "writer", name: "작가", role: "sub" },
  ].map((agent) => ({
    ...agent,
    active: true,
    icon: "smart_toy",
    color: "indigo",
    model: settings.model,
  }));
  const details = new Map<string, SessionDetail>();
  function addSession(title: string, agentId?: string | null) {
    const session: SessionItem = {
      id: crypto.randomUUID(),
      title,
      agentId,
      modeName: mode,
      projectPaths: [],
      updatedAt: details.size + 1,
    };
    details.set(session.id, { session, messages: [] });
    return session;
  }
  function seedHistory(title: string, agentId?: string) {
    const session = addSession(title, agentId);
    details.get(session.id)!.messages.push({
      id: crypto.randomUUID(),
      type: "text",
      side: "user",
      text: title + "의 내용",
    });
  }
  seedHistory("기존 모드 대화");
  seedHistory("작가 초안", "writer");
  seedHistory("팀장 회의", "lead");
  seedHistory("보관된 기록", "removed");

  // 모의 저장소는 페이지를 다시 열어도 유지하고, 화면은 실제 앱을 사용합니다.
  type Args = {
    sessionId: string;
    input: { agentId?: string | null; title: string; sessionId: string; message: Message };
  };
  await page.exposeFunction("workspaceInvoke", (command: string, args: Args) => {
    switch (command) {
      case "load_operation_mode":
        return { modes: [mode], selectedMode: mode, items: [{ name: mode }] };
      case "load_mode_agents":
        return agents;
      case "list_chat_sessions":
        return Array.from(details.values(), (value) => value.session).sort(
          (a, b) => b.updatedAt - a.updatedAt
        );
      case "get_chat_session":
        return details.get(args.sessionId);
      case "create_chat_session":
        return addSession(args.input.title, args.input.agentId);
      case "append_chat_message": {
        const detail = details.get(args.input.sessionId)!;
        detail.messages.push(args.input.message);
        detail.session.updatedAt = Date.now();
        return;
      }
      case "delete_chat_session":
        details.delete(args.sessionId);
        return;
      case "get_llm_settings":
      case "resolve_llm_settings":
        return settings;
      case "get_available_providers":
        return [
          {
            providerId: settings.providerId,
            hasApiKey: true,
            credentialTypes: ["api-key"],
            apiUrls: { "api-key": settings.baseUrl },
          },
        ];
      case "get_agent_memory":
        return { content: "", updatedAt: 0 };
      case "get_agent_recent_context":
      case "get_global_prompt":
        return "";
      default:
        return [];
    }
  });
  await page.addInitScript(() => {
    const desktop = window as Window & {
      workspaceInvoke: (...args: unknown[]) => Promise<unknown>;
    };
    Object.assign(window, {
      isTauri: true,
      __TAURI_INTERNALS__: { invoke: (...args: unknown[]) => desktop.workspaceInvoke(...args) },
    });
  });
  await page.route(settings.baseUrl + "/messages", async (route) => {
    const management = JSON.stringify(route.request().postDataJSON().messages).includes(
      "latestUserMessage"
    );
    const text = management ? "{}" : "응답 완료";
    await route.fulfill({
      contentType: "text/event-stream",
      body:
        "data: " +
        JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } }) +
        "\n\n",
    });
  });
}

test("오퍼레이션 모드와 에이전트별 대화 생성·선택·삭제·재시작", async ({ page }) => {
  await mockWorkspace(page);
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto("/");
  const modes = page.getByRole("region", { name: "Operation Mode" });
  const modeButton = modes.getByRole("button", { name: /Orchestration/ });
  const agents = page.getByRole("region", { name: "Active Agents" });
  const writer = agents.getByRole("group", { name: "작가 대화 목록" });
  const composer = page.getByRole("textbox", { name: "메시지 입력" });
  const sessionTitle = page.getByRole("banner").getByRole("heading", { level: 2 });
  const send = async (message: string) => {
    await composer.fill(message);
    await page.getByRole("button", { name: "메시지 보내기" }).click();
    await expect(sessionTitle).toHaveText(message);
    await expect(page.getByTitle("새 채팅 시작")).toBeEnabled();
    await expect(page.getByText("응답 완료", { exact: true }).first()).toBeVisible();
  };

  await expect(sessionTitle).toHaveText("기존 모드 대화");
  await expect(modes).not.toContainText("작가 초안");
  await expect(modes).not.toContainText("보관된 기록");
  await agents.getByTitle("작가와 대화", { exact: true }).click();
  await expect(sessionTitle).toHaveText("작가 초안");
  await expect(writer).not.toContainText("팀장 회의");
  await expect(writer).not.toContainText("기존 모드 대화");
  await modeButton.click();
  await expect(sessionTitle).toHaveText("기존 모드 대화");
  await expect(composer).toHaveAttribute("placeholder", /일반 대화/);
  await agents.getByTitle("작가와 대화", { exact: true }).click();
  await writer.getByRole("button", { name: "작가 새 대화" }).click();
  await send("새 원고");
  await expect(writer.getByText("새 원고", { exact: true })).toBeVisible();
  await expect(modes).not.toContainText("새 원고");
  await page.getByTitle("새 채팅 시작").click();
  await expect(composer).toHaveAttribute("placeholder", /작가/);

  await modes.getByText("기존 모드 대화", { exact: true }).click();
  await expect(sessionTitle).toHaveText("기존 모드 대화");
  await expect(page.getByText("기존 모드 대화의 내용", { exact: true }).first()).toBeVisible();
  await page.getByTitle("새 채팅 시작").click();
  await send("새 모드 대화");
  await expect(modes.getByText("새 모드 대화", { exact: true })).toBeVisible();
  await agents.getByTitle("작가와 대화", { exact: true }).click();
  await expect(sessionTitle).toHaveText("새 원고");
  await expect(writer).not.toContainText("새 모드 대화");
  await writer.getByText("작가 초안", { exact: true }).click();
  await expect(page.getByText("작가 초안의 내용", { exact: true }).first()).toBeVisible();
  await writer.getByRole("button", { name: "작가 초안 세션 삭제" }).click();
  await expect(sessionTitle).toHaveText("새 원고");

  await page.reload();
  await expect(sessionTitle).toHaveText("새 모드 대화");
  await agents.getByTitle("작가와 대화", { exact: true }).click();
  await expect(writer).not.toContainText("작가 초안");
  await expect(sessionTitle).toHaveText("새 원고");
  await writer.getByRole("button", { name: "새 원고 세션 삭제" }).click();
  await expect(composer).toHaveAttribute("placeholder", /작가/);
  await expect(page.getByText("응답 완료", { exact: true })).toHaveCount(0);

  const archived = agents.getByRole("group", { name: "삭제된 에이전트 대화 목록" });
  await archived.getByText("보관된 기록", { exact: true }).click();
  await expect(page.getByText("보관된 기록의 내용", { exact: true }).first()).toBeVisible();
  await expect(page.getByTitle("새 채팅 시작")).toBeDisabled();
  await composer.fill("이어서 작성");
  await expect(page.getByRole("button", { name: "메시지 보내기" })).toBeDisabled();

  await modes.getByRole("button", { name: "기존 모드 대화 세션 삭제" }).click();
  await modes.getByRole("button", { name: "새 모드 대화 세션 삭제" }).click();
  await modeButton.click();
  await expect(sessionTitle).toHaveText("새 채팅");
  await expect(composer).toHaveAttribute("placeholder", /일반 대화/);
  await expect(composer).toHaveValue("");
});

test("모드와 에이전트를 오가도 작성 중인 새 대화는 각 대상에 남는다", async ({ page }) => {
  await mockWorkspace(page);
  await page.setViewportSize({ width: 1500, height: 900 });
  await page.goto("/");
  const composer = page.getByRole("textbox", { name: "메시지 입력" });
  const newSession = page.getByTitle("새 채팅 시작");
  const writer = page.getByTitle("작가와 대화", { exact: true });
  await newSession.click();
  await composer.fill("모드에 보낼 초안");
  await writer.click();
  await newSession.click();
  await composer.fill("작가에게 보낼 초안");
  await page
    .getByRole("region", { name: "Operation Mode" })
    .getByText("Orchestration", { exact: true })
    .click();
  await expect(composer).toHaveValue("모드에 보낼 초안");
  await writer.click();
  await expect(composer).toHaveValue("작가에게 보낼 초안");
  await newSession.click();
  await expect(composer).toHaveValue("");
});
