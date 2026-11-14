import { expect, test } from "@playwright/test";

for (const providerId of ["openai", "anthropic"] as const) {
  test(`${providerId} 에이전트가 앱 전역 지침을 받아 자신의 MEMORY.md에 기록한다`, async ({
    page,
  }) => {
    const prompt = "사용자가 알려 준 회의 선호를 MEMORY.md에 기록해 주세요.";
    const preference = "회의는 오전이 좋아요.";
    const note = "오전 회의를 선호함";
    await page.setViewportSize({ width: 1500, height: 900 });
    // 실제 앱에서 Tauri 명령과 모델의 네트워크 응답만 대체합니다.
    await page.addInitScript((providerId) => {
      const mode = "Orchestration";
      const agent = {
        agentId: "agent-1",
        name: "메모담당",
        active: true,
        role: "main",
        color: "indigo",
        icon: "smart_toy",
        model: providerId === "openai" ? "gpt-4o-mini" : "claude-3-5-sonnet-latest",
        prompt: "한국어로 답하세요.",
      };
      const session = {
        id: "session-1",
        agentId: agent.agentId,
        title: "기억 테스트",
        modeName: mode,
        projectPaths: [],
        updatedAt: 1,
      };
      const settings = {
        providerId,
        providerKind: "api-key",
        model: agent.model,
        baseUrl: "https://memory.example.test/v1",
        apiKey: "fixture-only",
      };
      const memory = { content: "# 기존 기억", updatedAt: 1 };
      const messages: unknown[] = [];
      let globalPrompt: string | null = null;
      Object.assign(window, {
        isTauri: true,
        __TAURI_INTERNALS__: {
          invoke: async (
            cmd: string,
            args: {
              modeName: string;
              agentId: string;
              prompt: string;
              input: {
                message: unknown;
                modeName: string;
                agentId: string;
                expectedUpdatedAt: number;
                content: string;
              };
            }
          ) => {
            switch (cmd) {
              case "load_operation_mode":
                return { modes: [mode], selectedMode: mode, items: [{ name: mode }] };
              case "load_mode_agents":
                return [agent];
              case "list_chat_sessions":
                return [session];
              case "get_chat_session":
                return { session, messages };
              case "append_chat_message":
                messages.push(args.input.message);
                return;
              case "get_llm_settings":
              case "resolve_llm_settings":
                return settings;
              case "get_available_providers":
                return [
                  {
                    providerId,
                    hasApiKey: true,
                    credentialTypes: ["api-key"],
                    apiUrls: { "api-key": settings.baseUrl },
                  },
                ];
              case "get_global_prompt":
                return globalPrompt;
              case "save_global_prompt":
                globalPrompt = args.prompt;
                return;
              case "get_agent_memory":
                if (args.agentId !== agent.agentId || args.modeName !== mode)
                  throw new Error("잘못된 에이전트");
                return { ...memory };
              case "save_agent_memory":
                if (
                  args.input.agentId !== agent.agentId ||
                  args.input.modeName !== mode ||
                  args.input.expectedUpdatedAt !== memory.updatedAt
                )
                  throw new Error("잘못된 기억 버전 또는 에이전트");
                memory.content = args.input.content;
                memory.updatedAt++;
                return { ...memory };
              case "get_agent_recent_context":
                return "";
              case "get_google_settings":
                return { services: [] };
              case "get_email_settings":
                return { connected: false };
              case "plugin:app|version":
                return "0.1.2";
              default:
                return [];
            }
          },
        },
      });
    }, providerId);
    const functionCall = {
      type: "function_call",
      call_id: "call_memory",
      name: "append_agent_memory",
      arguments: JSON.stringify({ note, sourceQuote: preference }),
    };
    const reasoning = {
      type: "reasoning",
      id: "rs_fixture",
      summary: [],
      encrypted_content: "fixture",
    };
    const requests: { instructions: string; input: unknown[]; tools?: unknown[] }[] = [];
    const finalText = "회의 선호를 기억했어요.";
    await page.route("https://memory.example.test/v1/*", async (route) => {
      const body = route.request().postDataJSON();
      if (providerId === "anthropic") {
        requests.push({ instructions: body.system, input: body.messages, tools: body.tools });
        const text =
          requests.length === 1
            ? JSON.stringify({ memoryNote: note, google: null, routine: null })
            : finalText;
        await route.fulfill({
          contentType: "text/event-stream",
          body:
            "data: " +
            JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text } }) +
            "\n\n",
        });
        return;
      }
      requests.push(body);
      const delta =
        requests.length === 1
          ? {
              type: "response.output_text.delta",
              delta: JSON.stringify({ memoryNote: note, google: null, routine: null }),
            }
          : requests.length === 2
            ? { type: "response.function_call_arguments.delta", delta: functionCall.arguments }
            : { type: "response.output_text.delta", delta: finalText };
      const events = [
        delta,
        {
          type: "response.completed",
          response: {
            status: "completed",
            output: requests.length === 2 ? [reasoning, functionCall] : [],
          },
        },
      ];
      await route.fulfill({
        contentType: "text/event-stream",
        body: events.map((event) => "data: " + JSON.stringify(event) + "\n\n").join(""),
      });
    });
    await page.goto("/");
    await page.getByRole("button", { name: "사용자 메뉴 열기" }).click();
    await page.getByRole("menuitem", { name: "앱 설정" }).click();
    await page.getByLabel("전역 프롬프트").fill(prompt);
    await page.getByRole("button", { name: "저장", exact: true }).click();
    await page.getByTitle("메모담당와 대화", { exact: true }).click();
    await page.getByLabel("메시지 입력").fill(preference);
    await page.getByRole("button", { name: "메시지 보내기" }).click();
    await expect(page.getByText(finalText, { exact: true })).toBeVisible();

    expect(requests).toHaveLength(providerId === "openai" ? 3 : 2);
    for (const request of requests) {
      expect(request.instructions).toContain(prompt);
      expect(JSON.stringify(request.input)).not.toContain(prompt);
    }
    if (providerId === "openai") {
      expect(requests[1].tools).toContainEqual(
        expect.objectContaining({ type: "function", name: functionCall.name })
      );
      expect(requests[2].input).toEqual(
        expect.arrayContaining([
          reasoning,
          functionCall,
          expect.objectContaining({ type: "function_call_output", call_id: functionCall.call_id }),
        ])
      );
    } else {
      expect(requests[1].tools).toBeUndefined();
    }
    await page.getByRole("button", { name: "MEMORY.md 열기" }).click();
    const dialog = page.getByRole("dialog", { name: "메모담당의 기억" });
    await expect(dialog.getByLabel("MEMORY.md")).toHaveValue(
      new RegExp("^# 기존 기억\\n- .*" + note + "$")
    );
  });
}
