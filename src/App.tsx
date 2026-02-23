import { useEffect, useMemo, useState, type KeyboardEvent } from "react";

import { sendToLLM } from "./lib/llm";
import { AppHeader } from "./components/layout/AppHeader";
import { ChatPanel } from "./components/layout/ChatPanel";
import { LeftPanel } from "./components/layout/LeftPanel";
import { RightPanel } from "./components/layout/RightPanel";
import {
  AGENTS,
  INITIAL_ACTIVITY,
  LLM_CONFIG,
  MODES,
  SESSIONS,
  SESSION_MESSAGES,
  TOOLS,
  type Mode,
} from "./data/appData";
import {
  appendChunkToMessage,
  buildActivity,
  buildLLMMessages,
  buildReplyMessage,
  buildTypingMessage,
  nowTime,
} from "./utils/chat";
import type { ActivityItem, Message, ThemeMode } from "./types/chat";

export default function App() {
  const [messages, setMessages] = useState<Message[]>(SESSION_MESSAGES);
  const [activity, setActivity] = useState<ActivityItem[]>(INITIAL_ACTIVITY);
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedMode, setSelectedMode] = useState<Mode>(MODES[0]);
  const [resourceToken, setResourceToken] = useState(2405);
  const [resourceCost, setResourceCost] = useState(0.04);
  const [theme, setTheme] = useState<ThemeMode>("dark");

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  useEffect(() => {
    const timer = setInterval(() => {
      setResourceToken((value) => Math.min(9999, value + 9));
      setResourceCost((value) => Number((value + 0.001).toFixed(3)));
    }, 6500);

    return () => clearInterval(timer);
  }, []);

  const canSend = inputValue.trim().length > 0 && !isLoading;

  const tokenPercent = useMemo(() => {
    return Math.max(5, Math.min(90, Math.round((resourceToken / 12000) * 100)));
  }, [resourceToken]);
  const costPercent = useMemo(() => {
    return Math.max(10, Math.min(65, Math.round((resourceCost / 0.35) * 100)));
  }, [resourceCost]);

  const sendMessage = async (): Promise<void> => {
    if (!canSend) {
      return;
    }

    const text = inputValue.trim();
    if (!text) {
      return;
    }

    const userMessage: Message = {
      id: `user-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      side: "user",
      sender: "사용자",
      byline: nowTime(),
      avatarText: "JD",
      type: "text",
      text,
    };

    const typingMessage = buildTypingMessage("응답을 생성 중입니다...");

    setMessages((prev) => [...prev, userMessage, typingMessage]);
    setActivity((prev) => [
      ...prev,
      buildActivity(`새 메시지 수신: "${text.slice(0, 32)}"`, "오케스트레이터"),
    ]);
    setInputValue("");
    setIsLoading(true);

    const latestMessages = [...messages, userMessage];
    const requestMessages = buildLLMMessages(latestMessages);

    if (!LLM_CONFIG.apiKey) {
      const fallbackReply = buildReplyMessage(text);
      setMessages((prev) =>
        prev.map((entry) => (entry.id === typingMessage.id ? fallbackReply : entry))
      );
      setActivity((prev) => [
        ...prev,
        buildActivity("LLM API 키가 없어 샘플 응답으로 대체했습니다.", "기획자"),
      ]);
      setIsLoading(false);
      return;
    }

    setMessages((prev) =>
      prev.map((entry) =>
        entry.id === typingMessage.id
          ? {
              ...entry,
              type: "text",
              text: "",
            }
          : entry
      )
    );

    let streamedText = "";

    try {
      const response = await sendToLLM({
        apiBaseUrl: LLM_CONFIG.baseUrl,
        apiKey: LLM_CONFIG.apiKey,
        model: LLM_CONFIG.model,
        messages: requestMessages,
        stream: true,
        onChunk: (chunk) => {
          streamedText += chunk;
          setMessages((prev) => appendChunkToMessage(prev, typingMessage.id, streamedText));
        },
      });

      setMessages((prev) =>
        prev.map((entry) =>
          entry.id === typingMessage.id
            ? {
                ...entry,
                type: "text",
                text: response.text || streamedText || "(빈 응답)",
              }
            : entry
        )
      );

      const totalTokens = response.usage?.totalTokens;
      if (typeof totalTokens === "number") {
        setResourceToken((prev) => Math.min(9999, prev + totalTokens));
      }

      const estimatedCost = response.usage?.totalTokens ? response.usage.totalTokens * 0.000005 : 0;
      if (estimatedCost > 0) {
        setResourceCost((prev) => Number((prev + estimatedCost).toFixed(3)));
      }

      const usageText = response.usage?.totalTokens
        ? ` 토큰 ${response.usage.totalTokens}개 사용`
        : "";
      setActivity((prev) => [
        ...prev,
        buildActivity(`에이전트 응답 수신 완료${usageText}`.trim(), "기획자"),
      ]);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.";
      setMessages((prev) =>
        prev.map((entry) =>
          entry.id === typingMessage.id
            ? {
                ...entry,
                type: "text",
                text: `요청 처리 실패: ${reason}`,
              }
            : entry
        )
      );
      setActivity((prev) => [
        ...prev,
        buildActivity("LLM 응답 수신 중 오류가 발생했습니다.", "시스템"),
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const appendStatusMessage = (text: string): void => {
    setMessages((prev) => [
      ...prev,
      {
        id: `status-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        side: "status",
        type: "status",
        statusText: text,
      },
    ]);
  };

  const handleApprovePlan = () => {
    appendStatusMessage("사용자가 계획을 승인했습니다");
    setActivity((prev) => [
      ...prev,
      buildActivity("사용자가 계획을 승인했습니다. 연구 에이전트가 실행을 시작합니다.", "기획자"),
    ]);
  };

  const handleModifyPlan = () => {
    setInputValue("실행 전에 계획을 구체적으로 수정해줘.");
    appendStatusMessage("사용자가 계획 수정 요청");
    setActivity((prev) => [
      ...prev,
      buildActivity("사용자가 계획 수정을 요청했습니다.", "Planner"),
    ]);
  };

  const clearContext = () => {
    setMessages(SESSION_MESSAGES);
    setInputValue("");
    setActivity([
      ...INITIAL_ACTIVITY,
      buildActivity("세션이 초기화되어 기본 상태로 되돌아갑니다.", "시스템"),
    ]);
  };

  const exportChat = async () => {
    const text = messages
      .map((item) => {
        if (item.side === "status") {
          return `[status] ${item.statusText}`;
        }
        return `${item.sender} ${item.byline || ""}\n${item.text || ""}`;
      })
      .join("\n\n");

    if (!navigator?.clipboard) {
      return;
    }

    await navigator.clipboard.writeText(text);
    setActivity((prev) => [
      ...prev,
      buildActivity("채팅 기록을 클립보드에 복사했습니다.", "시스템"),
    ]);
  };

  const onEnterSubmit = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      sendMessage();
    }
  };

  const toggleTheme = () => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  };

  return (
    <div className="app-shell">
      <AppHeader
        theme={theme}
        onExportChat={exportChat}
        onClearContext={clearContext}
        onThemeToggle={toggleTheme}
      />

      <main className="body-grid">
        <LeftPanel
          modes={MODES}
          selectedMode={selectedMode}
          onModeSelect={setSelectedMode}
          agents={AGENTS}
          sessions={SESSIONS}
          tools={TOOLS}
        />

        <ChatPanel
          messages={messages}
          inputValue={inputValue}
          canSend={canSend}
          onInputChange={(value) => setInputValue(value)}
          onSubmit={sendMessage}
          onEnterSubmit={onEnterSubmit}
          onApprovePlan={handleApprovePlan}
          onModifyPlan={handleModifyPlan}
        />

        <RightPanel
          activity={activity}
          resourceToken={resourceToken}
          resourceCost={resourceCost}
          tokenPercent={tokenPercent}
          costPercent={costPercent}
        />
      </main>
    </div>
  );
}
