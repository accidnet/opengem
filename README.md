# opengem

`opengem`은 Tauri 2.x + React 19 기반의 데스크톱 AI 에이전트 프로젝트입니다.

## 기술 스택

- Frontend: React 19 + TypeScript + Vite
- Desktop Runtime: Tauri 2 (`src-tauri/src/main.rs`, `src-tauri/Cargo.toml`)
- Language: TypeScript(React), Rust

## 빠른 개발 시작

- 자세한 개발 환경 설정 가이드는 다음 [링크](docs/development-setup.md)를 참고하세요.
- 개발 시에는 기본적으로 `pnpm`을 활용합니다.
- Codex CLI 설치, 인증과 작업 공간 주의 사항은 [Codex CLI 가이드](docs/codex-cli.md)를 참고하세요.

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

Three.js 기반 3D 오피스에서 팀원을 선택하고 직접 움직일 수 있습니다. 에이전트나 아래 카드를 클릭하면 이동 대상으로 선택되며, **대화하기**와 **상세 정보**는 별도 버튼으로 제공합니다.

- **WASD / 방향키**: 현재 카메라 방향을 기준으로 이동, **Shift**: 빠르게 이동
- **Esc**: 선택 해제, **자리로 돌아가기**: 선택한 에이전트를 책상 앞으로 복귀
- **마우스 드래그 / 휠 / +·− 버튼**: 카메라 회전·확대, **시점 초기화**: 기본 시점으로 복귀
- 벽·가구 충돌을 처리하고 에이전트 ID별 위치를 이 기기에 저장합니다. 입력창을 쓰거나 다른 화면으로 전환하면 이동을 멈춥니다.
- 팀원이 늘면 공간도 확장됩니다. WebGL을 사용할 수 없어도 팀원 목록에서 대화·상세 정보를 이용할 수 있습니다.

이동·충돌 회귀 테스트는 `pnpm test`, Chromium에서 실제 선택·키보드 입력을 검증하는 테스트는 `pnpm exec playwright install chromium` 후 `pnpm test:office`로 실행합니다.

![에이전트와 작업 모드가 표시된 OpenGem 오피스](docs/screenshots/agent-office.jpg)

### 대화 작업 공간

대화 화면에서 메시지를 작성하고 세션에 프로젝트 폴더를 연결할 수 있습니다.

![메시지를 작성 중인 OpenGem 대화 화면](docs/screenshots/chat-compose.jpg)

### 에이전트 설정

에이전트의 이름, 모델, 프롬프트와 연결 리소스를 설정할 수 있습니다.

![새 에이전트의 기본 정보를 설정하는 화면](docs/screenshots/agent-settings.jpg)

## 설치 및 업데이트

1. [최신 Windows 릴리즈](https://github.com/accidnet/opengem/releases/latest)에서 `opengem_*_x64-setup.exe`를 내려받아 실행합니다.
2. 현재 버전은 앱 상단의 OpenGem 이름 아래 또는 프로필 메뉴에서 확인할 수 있습니다. 앱이 시작 시 자동으로 업데이트를 확인하며, 왼쪽 작업 공간 패널 하단의 **앱 업데이트**에서 **확인**을 누르고 새 버전이 있으면 **설치**를 누를 수도 있습니다. 업데이트에는 인터넷 연결이 필요하며, 설치 파일의 서명이 검증됩니다.

## 배포

`main`의 변경을 반영한 새 버전은 `pnpm run release -- 0.1.1`처럼 아직 사용하지 않은 버전으로 배포합니다. 스크립트가 버전 변경을 커밋하고 `main`과 태그를 푸시하면 GitHub Actions가 서명된 설치 파일과 업데이트 정보를 릴리즈에 게시합니다. 실행 조건과 서명키 관리 방법은 [릴리즈 가이드](docs/release.md)를 참고하세요.
