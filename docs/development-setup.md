# 개발 환경 설정 가이드 (Windows, macOS, Linux)

`opengem`은 Tauri 2.x + React 19 기반 프로젝트입니다.

## 공통 요구 사항

- `node` 설치: [Node.js 공식 설치 가이드](https://nodejs.org/ko/download)
- pnpm 설치

  ```bash
  npm install -g pnpm
  ```

- Rust 설치 (`rustc`, `cargo`): [Rust 공식 설치 가이드](https://rustup.rs)

- 프로젝트 루트에서 의존성 설치:

  ```bash
  pnpm install
  ```

설치 확인:

```bash
pnpm run env:check
```

## OS별 필수 설치

### Windows

- Microsoft Visual Studio C++ Build Tools
  - "Desktop development with C++" 워크로드 포함
- Microsoft Edge WebView2 Runtime

### macOS

- Xcode Command Line Tools

  ```bash
  xcode-select --install
  ```

### Linux

- Tauri 빌드 의존성

  ```bash
  sudo apt update
  sudo apt install -y build-essential pkg-config libgtk-3-dev libwebkit2gtk-4.1-dev libayatana-appindicator3-dev librsvg2-dev
  ```

- Linux 한글 글꼴 깨짐(ㅁ) 대응
  - `pnpm run tauri:dev` 실행 시 GUI에서 한글이 `ㅁ`으로 보이면 CJK/한글 폰트가 없을 가능성이 큽니다.
  - 아래 패키지를 설치한 뒤 폰트 캐시를 갱신하세요.

  ```bash
  sudo apt-get update
  sudo apt-get install -y fonts-noto-cjk fonts-nanum
  fc-cache -f
  ```

  - 설치 확인:

  ```bash
  fc-list :lang=ko
  ```

## 실행 명령어

- `pnpm run dev`: 웹 UI만 실행
- `pnpm run tauri:dev`: 데스크톱 앱 실행
- `pnpm run build`: 프론트엔드 빌드
- `pnpm run tauri:build`: 데스크톱 배포 빌드
