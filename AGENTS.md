# Agents

## 프로젝트 구조

- `src/`: React 앱 진입점(`main.tsx`), 루트 화면(`App.tsx`), 스타일(`App.css`)
- `src-tauri/`: Rust 진입점(`src/main.rs`), `tauri.conf.json`, `Cargo.toml`
- `vite.config.js`: Vite 빌드 설정

## 버전 기준

- 현재 기준은 Tauri 2.x, React 19, TypeScript로 맞춰 유지
- `tauri`/`@tauri-apps/*` 및 Rust 설정은 `package.json`과 `src-tauri/Cargo.toml`에서 함께 확인

## 실행 명령

- `pnpm install` — 프로젝트 의존성 패키지 설치
- `pnpm run dev` — Vite 개발 서버 실행 (브라우저 미리보기)
- `pnpm run env:check` — 필수 환경 변수 및 개발 환경 유효성 검사
- `pnpm run tauri:dev` — Tauri 데스크탑 앱 개발 모드 실행 (핫 리로드 포함)
- `pnpm run build` — Vite 프론트엔드 프로덕션 빌드
- `pnpm run tauri:build` — Tauri 데스크탑 앱 최종 배포용 빌드
- `pnpm run preview` — Vite 빌드 결과물 로컬 미리보기

## 코딩 규칙

- TypeScript(React)는 2칸 들여쓰기, 세미콜론, 의미 있는 식별자 사용
- React는 함수형 컴포넌트를 우선 사용
- 네이밍: 함수/변수 `camelCase`, 컴포넌트/클래스 `PascalCase`
- Rust는 `rustfmt` 스타일과 `snake_case`를 따름
- 주석 및 설명은 기본적으로 한글

## 보안

- 비밀키와 토큰은 절대 커밋 금지
