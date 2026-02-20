# opengem

`opengem`은 Tauri 2.x + React 18 기반의 데스크톱 챗봇 뼈대 프로젝트입니다.

## 기술 스택
- Frontend: React 18 + Vite
- Desktop Runtime: Tauri 2 (`src-tauri/src/main.rs`, `src-tauri/Cargo.toml`)
- Language: JavaScript(React), Rust

## 프로젝트 구조
- `src/main.jsx`: React 엔트리
- `src/App.jsx`: 챗봇 UI/상태 관리
- `src/App.css`: UI 스타일
- `src-tauri/src/main.rs`: Tauri 진입점
- `src-tauri/tauri.conf.json`: Tauri 실행/빌드 설정
- `vite.config.js`: Vite 빌드 설정

## 시작하기
```bash
npm install
npm run env:check
```

## 실행 명령
- `npm run dev`: Vite 개발 서버 실행
- `npm run tauri:dev`: 데스크톱 앱 실행
- `npm run build`: 프론트엔드 빌드 (`dist/`)
- `npm run tauri:build`: Tauri 앱 배포 빌드
- `npm run preview`: 빌드 결과 미리보기

## 데스크톱 실행 전 필수 조건
- `Node.js`와 함께 `cargo`/`rustc`가 필요합니다.
- Rust 설치 확인: `rustc --version`, `cargo --version`

## 주요 동작
- 로그인: API Key 입력 후 `로그인` 클릭
- 채팅: 메시지 입력 후 `Enter`(Shift+Enter는 개행) 또는 `전송`
- 메시지 기록은 세션 기준으로 유지됩니다.
