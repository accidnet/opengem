# src

React 19 + TypeScript 기반 프론트엔드 소스 디렉터리입니다.  
앱 진입점과 화면 컴포넌트, 상태 제어 및 Tauri 연동 로직, 스타일 자산을 포함합니다.

## 프로젝트 구조

```text
src/
├─ main.tsx
├─ App.tsx
├─ App.css
├─ vite-env.d.ts
├─ components/
│  ├─ ActivityCard.tsx
│  ├─ IconBadge.tsx
│  ├─ MarkdownText.tsx
│  ├─ MessageCard.tsx
│  ├─ layout/
│  │  ├─ AppHeader.tsx
│  │  ├─ ChatPanel.tsx
│  │  ├─ LeftPanel.tsx
│  │  ├─ PanelModal.tsx
│  │  ├─ RightPanel.tsx
│  │  └─ left-panel/
│  │     ├─ AgentSettingsModal.tsx
│  │     ├─ AgentsSection.tsx
│  │     ├─ ModeSection.tsx
│  │     ├─ ModeSettingsModal.tsx
│  │     ├─ ToolsSection.tsx
│  │     ├─ constants.ts
│  │     ├─ types.ts
│  │     └─ utils.ts
│  └─ ui/
│     ├─ button.tsx
│     ├─ dialog.tsx
│     ├─ input.tsx
│     ├─ label.tsx
│     └─ textarea.tsx
├─ data/
│  ├─ appData.ts
│  └─ prompts/
│     ├─ anthropic.txt
│     ├─ codex.txt
│     ├─ default.txt
│     ├─ gemini.txt
│     └─ gpt.txt
├─ features/
│  ├─ app/
│  │  └─ appHelpers.ts
│  └─ runtime/
│     └─ runtimeOrchestrator.ts
├─ hooks/
│  └─ useAppController.ts
├─ lib/
│  ├─ llm.ts
│  └─ utils.ts
├─ styles/
│  ├─ app.css
│  ├─ base.css
│  ├─ chat.css
│  ├─ layout.css
│  ├─ left-panel.css
│  ├─ media.css
│  ├─ panel-modal.css
│  ├─ right-panel.css
│  ├─ theme-overrides.css
│  ├─ toast.css
│  ├─ tokens.css
│  └─ top-bar.css
├─ types/
│  └─ chat.ts
└─ utils/
   └─ chat.ts
```

## 디렉터리 설명

- `main.tsx`: React 앱 마운트와 전역 초기화 진입점
- `App.tsx`: 최상위 앱 컴포넌트
- `components/`: 화면 UI를 구성하는 재사용 컴포넌트
- `data/`: 기본 데이터와 프롬프트 템플릿
- `features/`: 기능 단위 로직
- `hooks/`: 상태 및 화면 제어용 커스텀 훅
- `lib/`: LLM 연동 및 공통 유틸리티
- `styles/`: 앱 전역 및 영역별 스타일시트
- `types/`: 공유 타입 정의
- `utils/`: 범용 보조 함수
