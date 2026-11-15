import { expect, test } from "@playwright/test";
import type { Message, SessionItem } from "@/types/chat";

test("전체 대화의 팀원들은 한 기록을 공유하고 개별 대화는 선택한 팀원만 이어간다", async ({
  page,
}) => {
  const mode = "출시 준비";
  const groupQuestion = "출시 전에 무엇을 확인할까요?";
  const leadReply = "가입부터 첫 프로젝트 생성까지 확인하겠습니다.";
  const reviewerReply = "저는 초대받은 팀원이 프로젝트를 열 수 있는지 확인하겠습니다.";
  const privateNote = "리뷰어에게만 남긴 메모입니다.";
  await page.setViewportSize({ width: 1500, height: 900 });
  // 기존 개별 기록 하나로 시작해 첫 전체 대화를 실제 화면에서 생성합니다.
  await page.addInitScript(
    ({ mode, privateNote }) => {
      const agents = [
        { agentId: "lead", name: "기획자", role: "main", prompt: "가입 흐름을 검토하세요." },
        { agentId: "reviewer", name: "리뷰어", role: "sub", prompt: "초대 흐름을 검토하세요." },
        { agentId: "offline", name: "기록자", role: "sub", prompt: "결과를 기록하세요." },
      ].map((agent) => ({
        ...agent,
        active: agent.agentId !== "offline",
        color: agent.agentId === "lead" ? "indigo" : "emerald",
        icon: agent.agentId === "lead" ? "assignment" : "fact_check",
        model: agent.agentId === "lead" ? "gpt-4o" : "gpt-4o-mini",
      }));
      const dm: SessionItem = {
        id: "direct",
        agentId: "reviewer",
        title: "이전 검토",
        modeName: mode,
        updatedAt: 9,
        projectPaths: [],
      };
      const sessions = [dm];
      const messages: Record<string, Message[]> = {
        direct: [{ id: "note", side: "user", type: "text", text: privateNote }],
      };
      const settings = {
        providerId: "openai",
        providerKind: "api-key",
        model: "gpt-4o",
        apiKey: "fixture-only",
        baseUrl: "https://scope.example.test/v1",
      };
      Object.assign(window, {
        isTauri: true,
        conversationTestData: { sessions, messages },
        __TAURI_INTERNALS__: {
          invoke: async (
            cmd: string,
            args: {
              sessionId: string;
              input: {
                title: string;
                modeName: string;
                agentId: string | null;
                sessionId: string;
                message: Message;
              };
            }
          ) => {
            switch (cmd) {
              case "load_operation_mode":
                return { modes: [mode], selectedMode: mode, items: [{ name: mode }] };
              case "load_mode_agents":
                return agents;
              case "list_chat_sessions":
                return [...sessions].sort((a, b) => b.updatedAt - a.updatedAt);
              case "get_chat_session":
                return {
                  session: sessions.find((s) => s.id === args.sessionId),
                  messages: [...messages[args.sessionId]],
                };
              case "create_chat_session": {
                const session = {
                  ...args.input,
                  id: "new-" + sessions.length,
                  projectPaths: [],
                  updatedAt: 1,
                };
                sessions.push(session);
                messages[session.id] = [];
                return session;
              }
              case "append_chat_message":
                messages[args.input.sessionId].push(args.input.message);
                return;
              case "get_llm_settings":
              case "resolve_llm_settings":
                return settings;
              case "get_available_providers":
                return [
                  {
                    providerId: "openai",
                    hasApiKey: true,
                    credentialTypes: ["api-key"],
                    apiUrls: { "api-key": settings.baseUrl },
                  },
                ];
              case "get_agent_memory":
                return { content: privateNote, updatedAt: 1 };
              case "get_global_prompt":
                return "";
              case "get_google_settings":
                return { services: [] };
              case "plugin:app|version":
                return "0.1.2";
              default:
                return [];
            }
          },
        },
      });
    },
    { mode, privateNote }
  );

  const requests: { model: string; instructions: string; input: unknown[] }[] = [];
  const directReply = "검토 메모를 확인했습니다.";
  const followUp = "다음으로 초대 이메일의 링크도 확인하겠습니다.";
  const replies = [
    leadReply,
    reviewerReply,
    JSON.stringify({ memoryNote: null, google: null, routine: null }),
    directReply,
    null, // 첫 번째 참여자에게만 발생한 공급자 오류입니다.
    followUp,
  ];
  await page.route("https://scope.example.test/v1/responses", async (route) => {
    const body = route.request().postDataJSON();
    requests.push(body);
    const text = replies[requests.length - 1];
    if (text == null) {
      await route.fulfill({ status: 503, body: "기획자 모델 일시 중단" });
      return;
    }
    const events = [
      { type: "response.output_text.delta", delta: text },
      { type: "response.completed", response: { status: "completed", output: [] } },
    ];
    await route.fulfill({
      contentType: "text/event-stream",
      body: events.map((event) => "data: " + JSON.stringify(event) + "\n\n").join(""),
    });
  });
  await page.goto("/");
  const openGroup = page.getByRole("button", { name: mode + " 전체 대화", exact: true });
  await openGroup.click();
  const compose = page.getByRole("textbox", { name: "메시지 입력" });
  const send = page.getByRole("button", { name: "메시지 보내기" });
  await compose.fill(groupQuestion);
  await send.click();
  const bubbles = page.locator(".message-row");
  await expect(bubbles.filter({ hasText: reviewerReply })).toBeVisible();
  expect(requests.map(({ model }) => model)).toEqual(["gpt-4o", "gpt-4o-mini"]);
  expect(requests[0].instructions).toContain("가입 흐름을 검토하세요.");
  expect(requests[1].instructions).toContain("초대 흐름을 검토하세요.");
  expect(JSON.stringify(requests[1].input)).toContain(leadReply);
  expect(JSON.stringify(requests)).not.toContain(privateNote);

  await page.getByTitle("리뷰어와 대화", { exact: true }).click();
  await expect(bubbles.filter({ hasText: privateNote })).toBeVisible();
  await expect(bubbles.filter({ hasText: groupQuestion })).toHaveCount(0);
  await compose.fill("이전 검토 메모를 확인해 주세요.");
  await send.click();
  await expect(bubbles.filter({ hasText: directReply })).toBeVisible();
  expect(requests.slice(2).map(({ model }) => model)).toEqual(["gpt-4o-mini", "gpt-4o-mini"]);
  expect(JSON.stringify(requests.slice(2))).not.toContain(groupQuestion);
  await openGroup.click();
  await expect(bubbles.filter({ hasText: reviewerReply })).toBeVisible();
  await expect(bubbles.filter({ hasText: privateNote })).toHaveCount(0);

  await compose.fill("추가할 항목이 있나요?");
  await send.click();
  await expect(bubbles.filter({ hasText: followUp })).toBeVisible();
  expect(requests.slice(4).map(({ model }) => model)).toEqual(["gpt-4o", "gpt-4o-mini"]);
  expect(JSON.stringify(requests[5].input)).not.toContain("기획자 모델 일시 중단");
  expect(JSON.stringify(requests[5])).not.toContain(directReply);

  const stored = (await page.evaluate(() => Reflect.get(window, "conversationTestData"))) as {
    messages: Record<string, Message[]>;
    sessions: SessionItem[];
  };
  const group = stored.sessions.find((session) => !session.agentId)!;
  expect(group.modeName).toBe(mode);
  expect(stored.messages[group.id].map((m) => m.agentId ?? m.side)).toEqual([
    "user",
    "lead",
    "reviewer",
    "user",
    "lead",
    "reviewer",
  ]);
  expect(stored.messages.direct.map((m) => m.agentId ?? m.side)).toEqual([
    "user",
    "user",
    "reviewer",
  ]);
});
