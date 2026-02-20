import { useEffect, useState } from "react";

const CHAT_MODEL = "gpt-4o-mini";
const STORAGE_KEY = "opengem:chat-session-v1";
const THEME_KEY = "opengem:theme";
const VIEW_MODE_KEY = "opengem:view-mode";
const API_KEY_KEY = "opengem:api-key";
const AGENTS_KEY = "opengem:agent-list";
const SYSTEM_PROMPT = "너는 친절하고 간결한 한국어 챗봇 어시스턴트야.";
const DEFAULT_THEME = "light";
const DEFAULT_VIEW_MODE = "studio";
const DEFAULT_AGENTS = [
  { id: "admin", name: "관리자", emoji: "👤", emojiClass: "agent-emoji-admin" },
  {
    id: "frontend",
    name: "프론트개발자",
    emoji: "👨🏽‍💻",
    emojiClass: "agent-emoji-frontend",
  },
  {
    id: "backend",
    name: "백엔드개발자",
    emoji: "👩🏾‍💻",
    emojiClass: "agent-emoji-backend",
  },
];

function ensureAgentDefaults(agents) {
  const list = Array.isArray(agents) ? agents : [];
  const mapped = list
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const name = typeof item.name === "string" ? item.name.trim() : "";
      const model = typeof item.model === "string" ? item.model.trim() : CHAT_MODEL;
      const prompt =
        typeof item.prompt === "string" ? item.prompt.trim() : SYSTEM_PROMPT;
      if (!name) return null;
      return {
        id: typeof item.id === "string" && item.id.trim() ? item.id.trim() : `agent-${Date.now()}`,
        name,
        emoji: typeof item.emoji === "string" && item.emoji.trim() ? item.emoji.trim() : "👤",
        emojiClass:
          typeof item.emojiClass === "string" && item.emojiClass.trim() ? item.emojiClass.trim() : "",
        model: model || CHAT_MODEL,
        prompt,
      };
    })
    .filter(Boolean);

  if (mapped.length === 0) {
    return DEFAULT_AGENTS.map((item) => ({
      ...item,
      model: CHAT_MODEL,
      prompt: SYSTEM_PROMPT,
    }));
  }

  return mapped;
}

function loadAgents() {
  try {
    const raw = localStorage.getItem(AGENTS_KEY);
    if (!raw) {
      return DEFAULT_AGENTS.map((item) => ({
        ...item,
        model: CHAT_MODEL,
        prompt: SYSTEM_PROMPT,
      }));
    }
    const parsed = JSON.parse(raw);
    const parsedAgents = parsed && typeof parsed === "object" ? parsed.agents : [];
    return ensureAgentDefaults(parsedAgents);
  } catch {
    return DEFAULT_AGENTS.map((item) => ({
      ...item,
      model: CHAT_MODEL,
      prompt: SYSTEM_PROMPT,
    }));
  }
}

function createNewAgentId() {
  return `agent-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function formatTime() {
  return new Date().toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function loadStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      messages: Array.isArray(parsed.messages) ? parsed.messages : [],
    };
  } catch {
    return null;
  }
}

function normalizeMessage(item) {
  if (!item || typeof item !== "object") return null;
  if (item.role !== "user" && item.role !== "assistant") return null;
  const content = typeof item.content === "string" ? item.content.trim() : "";
  if (!content) return null;
  return {
    role: item.role,
    content,
    ts: item.ts || formatTime(),
  };
}

function loadTheme() {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    if (saved === "light" || saved === "dark") return saved;
    return DEFAULT_THEME;
  } catch {
    return DEFAULT_THEME;
  }
}

function loadViewMode() {
  try {
    const saved = localStorage.getItem(VIEW_MODE_KEY);
    if (saved === "messenger" || saved === "studio") return saved;
    return DEFAULT_VIEW_MODE;
  } catch {
    return DEFAULT_VIEW_MODE;
  }
}

function loadApiKey() {
  try {
    return localStorage.getItem(API_KEY_KEY) || "";
  } catch {
    return "";
  }
}

export default function App() {
  const persisted = loadStorage();

  const [apiKey, setApiKey] = useState(loadApiKey);
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState(() => {
    const normalized = (persisted?.messages || []).map(normalizeMessage).filter(Boolean);
    return normalized;
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [errorCode, setErrorCode] = useState("");
  const [theme, setTheme] = useState(loadTheme);
  const [viewMode, setViewMode] = useState(loadViewMode);
  const [agentOptions, setAgentOptions] = useState(loadAgents);
  const [selectedAgent, setSelectedAgent] = useState(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsApiKey, setSettingsApiKey] = useState("");
  const [isAddAgentOpen, setIsAddAgentOpen] = useState(false);
  const [newAgentName, setNewAgentName] = useState("");
  const [newAgentModel, setNewAgentModel] = useState(CHAT_MODEL);
  const [newAgentPrompt, setNewAgentPrompt] = useState("");
  const [activityLogs, setActivityLogs] = useState(() => [
    { type: "system", text: "워크스페이스가 준비되었습니다.", ts: formatTime() },
  ]);

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        messages,
      })
    );
  }, [messages]);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
    }
  }, [theme]);

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_MODE_KEY, viewMode);
    } catch {
    }
  }, [viewMode]);

  useEffect(() => {
    try {
      localStorage.setItem(API_KEY_KEY, apiKey);
    } catch {
    }
  }, [apiKey]);

  useEffect(() => {
    try {
      localStorage.setItem(AGENTS_KEY, JSON.stringify({ agents: agentOptions }));
    } catch {
    }
  }, [agentOptions]);

  useEffect(() => {
    if (!isSettingsOpen) return;
    setSettingsApiKey(apiKey);
  }, [isSettingsOpen, apiKey]);

  useEffect(() => {
    if (!selectedAgent && agentOptions.length > 0) {
      setSelectedAgent(agentOptions[0]);
    }
  }, [agentOptions, selectedAgent]);

  const canSend = apiKey.trim().length > 0 && message.trim().length > 0 && !loading;

  const pushActivity = (type, text) => {
    setActivityLogs((prev) => [...prev, { type, text, ts: formatTime() }]);
  };

  const appendMessage = (role, content) => {
    setMessages((prev) => [...prev, { role, content, ts: formatTime() }]);
  };

  const toggleTheme = () => {
    setTheme((value) => (value === "dark" ? "light" : "dark"));
  };

  const toggleViewMode = () => {
    const nextMode = viewMode === "studio" ? "messenger" : "studio";
    setViewMode(nextMode);
    pushActivity("system", `모드를 ${nextMode === "studio" ? "스튜디오" : "메신저"}로 변경했습니다.`);
  };

  const openSettings = () => {
    setIsSettingsOpen(true);
  };

  const closeSettings = () => {
    setIsSettingsOpen(false);
  };

  const saveSettings = () => {
    const trimmed = settingsApiKey.trim();
    setApiKey(trimmed);
    setIsSettingsOpen(false);
    if (trimmed) {
      pushActivity("system", "설정에서 API 키를 업데이트했습니다.");
    } else {
      pushActivity("system", "설정에서 API 키를 제거했습니다.");
    }
  };

  const openAddAgent = () => {
    setNewAgentName("");
    setNewAgentModel(CHAT_MODEL);
    setNewAgentPrompt("");
    setError("");
    setIsAddAgentOpen(true);
  };

  const closeAddAgent = () => {
    setError("");
    setIsAddAgentOpen(false);
  };

  const saveAddAgent = () => {
    const trimmedName = newAgentName.trim();
    const trimmedModel = newAgentModel.trim() || CHAT_MODEL;
    const trimmedPrompt = newAgentPrompt.trim() || SYSTEM_PROMPT;

    if (!trimmedName) {
      setError("에이전트 이름을 입력해 주세요.");
      return;
    }

    const nextAgent = {
      id: createNewAgentId(),
      name: trimmedName,
      emoji: "👤",
      model: trimmedModel,
      prompt: trimmedPrompt,
    };

    setAgentOptions((prev) => [...prev, nextAgent]);
    setSelectedAgent(nextAgent);
    setIsAddAgentOpen(false);
    setError("");
    pushActivity("system", `${trimmedName} 에이전트를 추가했습니다.`);
  };

  const sendMessage = async () => {
    const text = message.trim();
    if (!text || loading) return;

    if (!apiKey.trim()) {
      setError("설정에서 OpenAI API 키를 먼저 입력하세요.");
      setErrorCode("MISSING_API_KEY");
      pushActivity("error", "API 키가 없어 요청을 보낼 수 없습니다.");
      return;
    }

    if (!apiKey.startsWith("sk-")) {
      setError("유효하지 않은 형식의 API 키일 수 있습니다.");
      setErrorCode("INVALID_API_KEY");
      pushActivity("error", "API 키 형식이 올바르지 않습니다.");
      return;
    }

    const outgoing = { role: "user", content: text, ts: formatTime() };
    setMessages((prev) => [...prev, outgoing]);
    setMessage("");
    setLoading(true);
    setError("");
    setErrorCode("");
    pushActivity("request", "모델로 메시지를 전송했습니다.");

    try {
      const chatHistory = [
        { role: "system", content: selectedAgent?.prompt || SYSTEM_PROMPT },
        ...messages.map(({ role, content }) => ({ role, content })),
        outgoing,
      ];

      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
          model: selectedAgent?.model || CHAT_MODEL,
          messages: chatHistory,
          temperature: 0.6,
        }),
      });

      if (!response.ok) {
        const nextCode = response.status === 401 ? "UNAUTHORIZED" : `HTTP_${response.status}`;
        const err = new Error(`요청 실패: ${response.status} ${response.statusText}`);
        err.code = nextCode;
        throw err;
      }

      const data = await response.json();
      const answer =
        data?.choices?.[0]?.message?.content ??
        "응답 형식이 맞지 않습니다. 잠시 후 다시 시도해 주세요.";
      appendMessage("assistant", answer);
      pushActivity("success", "에이전트 응답을 받았습니다.");
    } catch (e) {
      const errCode = e instanceof Error && "code" in e ? e.code : "NETWORK";
      const msg = e instanceof Error ? e.message : "알 수 없는 오류가 발생했습니다.";
      setErrorCode(typeof errCode === "string" && errCode ? errCode : "NETWORK");
      setError(msg);
      appendMessage(
        "assistant",
        "요청 실패. API 키, 네트워크, 또는 권한 이슈를 확인해 주세요."
      );
      pushActivity("error", `요청 실패: ${typeof errCode === "string" ? errCode : "NETWORK"}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <main className={`desktop-shell mode-${viewMode}`}>
      <header className="top-controls">
        <button className="chip ghost tiny" onClick={toggleViewMode}>
          {viewMode === "studio" ? "Studio" : "Messenger"}
        </button>
        <button
          className="chip ghost tiny icon-btn"
          onClick={toggleTheme}
          aria-label={theme === "light" ? "다크 모드로" : "라이트 모드로"}
        >
          {theme === "light" ? "🌙" : "☀️"}
        </button>
      </header>

      <section className="workspace-grid">
        <aside className="panel session-panel">
          <div className="panel-head">
            <p className="panel-title">Session</p>
          </div>

          <ul className="session-list">
            <li className="session-item">
              <p className="session-title">새 세션</p>
              <p className="session-preview">새 대화를 시작하세요</p>
              <p className="session-meta">초안</p>
            </li>
          </ul>

          <button className="chip settings-btn" onClick={openSettings}>
            설정
          </button>
        </aside>

        <section className="panel chat-panel">
          {errorCode && <p className="error code">마지막 오류: {errorCode}</p>}

          <ul className="message-list">
            {messages.map((item, idx) => (
              <li key={`${item.ts}-${idx}`} className={`bubble ${item.role}`}>
                <span>{item.role === "user" ? "사용자" : "에이전트"}</span>
                <p>{item.content}</p>
                <small>{item.ts}</small>
              </li>
            ))}
            {loading && (
              <li className="bubble assistant loading">
                <span>에이전트</span>
                <p>응답 생성 중...</p>
                <small>{formatTime()}</small>
              </li>
            )}
          </ul>

          <form
            className="composer"
            onSubmit={(e) => {
              e.preventDefault();
              sendMessage();
            }}
          >
            <textarea
              className="input message-input"
              rows={2}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendMessage();
                }
              }}
              placeholder="메시지를 입력하세요"
              disabled={loading}
            />
            <div className="composer-bottom">
              <div className="agents-wrap">
                <div className="agents-grid" role="list" aria-label="에이전트 선택">
                  {agentOptions.map((item) => (
                    <button
                      key={item.id}
                      className={`agent-card${selectedAgent?.id === item.id ? " active" : ""}`}
                      type="button"
                      onClick={() => {
                        setSelectedAgent(item);
                        pushActivity("system", `${item.name}로 전환했습니다.`);
                      }}
                      aria-label={`${item.name}로 변경`}
                    >
                      <span className={`agent-emoji ${item.emojiClass || ""}`.trim()} aria-hidden="true">
                        {item.emoji}
                      </span>
                      <span
                        className={`agent-name${
                          item.id === "frontend" || item.id === "backend" ? " no-wrap" : ""
                        }`}
                      >
                        {item.name}
                      </span>
                    </button>
                  ))}
                  <button
                    className="agent-card agent-card-add"
                    type="button"
                    aria-label="에이전트 추가"
                    onClick={openAddAgent}
                  >
                    <span className="agent-emoji" aria-hidden="true">
                      +
                    </span>
                    <span className="agent-name">추가</span>
                  </button>
                </div>
              </div>
            </div>
            <button className="primary-btn" type="submit" disabled={!canSend}>
              전송
            </button>
          </form>
          {error && <p className="error">{error}</p>}
        </section>

        <aside className="panel activity-panel">
          <div className="panel-head">
            <p className="panel-title">Logs</p>
          </div>

          <ul className="activity-list">
            {[...activityLogs].reverse().map((item, idx) => (
              <li key={`${item.ts}-${idx}`} className={`activity-item ${item.type}`}>
                <p>{item.text}</p>
                <small>{item.ts}</small>
              </li>
            ))}
          </ul>
        </aside>
      </section>

        {isSettingsOpen && (
        <div className="settings-modal-backdrop" onClick={closeSettings}>
          <section
            className="settings-modal"
            role="dialog"
            aria-modal="true"
            aria-label="설정"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="settings-modal-header">
              <h2>설정</h2>
            </header>
            <div className="settings-modal-body">
              <label className="settings-label">
                OpenAI API 키
                <input
                  className="input"
                  type="password"
                  value={settingsApiKey}
                  onChange={(e) => setSettingsApiKey(e.target.value)}
                  placeholder="sk-..."
                />
              </label>
              <p className="meta">API 키는 로컬 저장소에 저장됩니다.</p>
            </div>
            <footer className="settings-modal-actions">
              <button className="chip" type="button" onClick={closeSettings}>
                취소
              </button>
              <button className="primary-btn" type="button" onClick={saveSettings}>
                저장
              </button>
            </footer>
          </section>
        </div>
      )}

      {isAddAgentOpen && (
        <div className="settings-modal-backdrop" onClick={closeAddAgent}>
          <section
            className="settings-modal add-agent-modal"
            role="dialog"
            aria-modal="true"
            aria-label="에이전트 추가"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="settings-modal-header">
              <h2>에이전트 추가</h2>
            </header>
            <div className="settings-modal-body">
              <label className="settings-label">
                에이전트 이름
                <input
                  className="input"
                  type="text"
                  value={newAgentName}
                  onChange={(e) => setNewAgentName(e.target.value)}
                  placeholder="예: 기획자"
                />
              </label>
              <label className="settings-label">
                모델 선택
                <input
                  className="input"
                  type="text"
                  value={newAgentModel}
                  onChange={(e) => setNewAgentModel(e.target.value)}
                  placeholder="예: gpt-4o-mini"
                />
              </label>
              <label className="settings-label">
                프롬프트
                <textarea
                  className="input add-agent-textarea"
                  rows={3}
                  value={newAgentPrompt}
                  onChange={(e) => setNewAgentPrompt(e.target.value)}
                  placeholder="이 에이전트에게 줄 시스템 프롬프트를 입력하세요"
                />
              </label>
            </div>
            <footer className="settings-modal-actions">
              <button className="chip" type="button" onClick={closeAddAgent}>
                취소
              </button>
              <button className="primary-btn" type="button" onClick={saveAddAgent}>
                저장
              </button>
            </footer>
          </section>
        </div>
      )}
    </main>
  );
}
