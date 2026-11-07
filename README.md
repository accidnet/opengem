# opengem

`opengem`은 Tauri 2.x + React 19 기반의 데스크톱 AI 에이전트 프로젝트입니다.

## 기술 스택

- Frontend: React 19 + TypeScript + Vite
- Desktop Runtime: Tauri 2 (`src-tauri/src/main.rs`, `src-tauri/Cargo.toml`)
- Language: TypeScript(React), Rust

## 빠른 개발 시작

- 자세한 개발 환경 설정 가이드는 다음 [링크](docs/development-setup.md)를 참고하세요.
- 개발 시에는 기본적으로 `pnpm`을 활용합니다.

### 1. 사전 설치

- `node` 설치: [Node.js 공식 설치 가이드](https://nodejs.org/ko/download)
- `pnpm` 설치:

  ```bash
  npm install -g pnpm
  ```

- `rustc`/`cargo` 설치: [rustup](https://rustup.rs)

- Linux에서 Tauri 실행 시, 아래 시스템 패키지가 필요합니다.

  ```bash
  sudo apt update
  sudo apt install -y build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev
  ```

### 2. 의존성 설치

```bash
pnpm install
```

### 3. 실행

```bash
pnpm run tauri:dev
```

#### 실행 명령 참고

- `pnpm run dev`: 웹 UI만 개발 시 실행
- `pnpm run tauri:dev`: 데스크톱 앱 실행
- `pnpm run build`: 프론트엔드 빌드 (`dist/`)
- `pnpm run tauri:build`: Tauri 앱 배포 빌드
- `pnpm run preview`: 빌드 결과 미리보기
- `cargo clean`: 백엔드 캐시 클린

## UI 미리보기

아래 화면은 예시 데이터로 촬영한 현재 UI입니다.

### 에이전트 오피스

픽셀 오피스에서 팀의 에이전트를 살펴보고 원하는 에이전트와 대화를 시작할 수 있습니다.

![에이전트와 작업 모드가 표시된 OpenGem 오피스](docs/screenshots/agent-office.jpg)

### 대화 작업 공간

대화 화면에서 메시지를 작성하고 세션에 프로젝트 폴더를 연결할 수 있습니다.

![메시지를 작성 중인 OpenGem 대화 화면](docs/screenshots/chat-compose.jpg)

### 에이전트 설정

에이전트의 이름, 모델, 프롬프트와 연결 리소스를 설정할 수 있습니다.

![새 에이전트의 기본 정보를 설정하는 화면](docs/screenshots/agent-settings.jpg)

## 배포

- 릴리즈와 자동 업데이트 절차는 다음 [링크](docs/release.md)를 참고하세요.
