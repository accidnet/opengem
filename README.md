# opengem

`opengem`은 Tauri 2.x + React 19 기반의 데스크톱 챗봇 뼈대 프로젝트입니다.

## 기술 스택
- Frontend: React 19 + TypeScript + Vite
- Desktop Runtime: Tauri 2 (`src-tauri/src/main.rs`, `src-tauri/Cargo.toml`)
- Language: TypeScript(React), Rust

## 프로젝트 구조
- `src/main.tsx`: React 엔트리
- `src/App.tsx`: 챗봇 UI/상태 관리
- `src/App.css`: UI 스타일
- `tsconfig.json`: TypeScript 설정
- `src-tauri/src/main.rs`: Tauri 진입점
- `src-tauri/tauri.conf.json`: Tauri 실행/빌드 설정
- `vite.config.js`: Vite 빌드 설정

## 시작하기
```bash
pnpm install   # 또는 npm install
pnpm run env:check
```

## 실행 명령
- `pnpm run dev`: Vite 개발 서버 실행
- `pnpm run tauri:dev`: 데스크톱 앱 실행
- `pnpm run build`: 프론트엔드 빌드 (`dist/`)
- `pnpm run tauri:build`: Tauri 앱 배포 빌드
- `pnpm run preview`: 빌드 결과 미리보기

## 데스크톱 실행 전 필수 조건
- `Node.js`와 함께 `cargo`/`rustc`가 필요합니다.
- Rust 설치 확인: `rustc --version`, `cargo --version`

## 주요 동작
- **설정**: 상단/세션 패널의 `설정`에서 OpenAI API 키 입력·저장 (로컬 저장)
- **채팅**: 메시지 입력 후 `Enter`(Shift+Enter는 개행) 또는 `전송`
- **에이전트**: 기본 에이전트 선택 또는 `추가`로 커스텀 에이전트 생성
- **모드**: Studio / Messenger 뷰 전환, 라이트/다크 테마 전환
- 메시지·에이전트·테마 등은 로컬 저장소에 유지됩니다.

## LLM 설정 (환경 변수)
- `.env.local` 또는 `.env`에서 아래 값을 설정하면 실제 API 호출로 동작합니다.

```bash
VITE_LLM_BASE_URL=https://api.openai.com/v1
VITE_LLM_MODEL=gpt-4o-mini
VITE_LLM_API_KEY=sk-...
```

- `VITE_LLM_API_KEY`가 비어 있으면 응답은 임시 모의 텍스트로 동작합니다.
