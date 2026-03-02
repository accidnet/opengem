# Agents

## 프로젝트 구조

- `src/`: React 앱 진입점(`main.tsx`), 루트 화면(`App.tsx`), 스타일(`App.css`)
- `src-tauri/`: Rust 진입점(`src/main.rs`), `tauri.conf.json`, `Cargo.toml`
- `vite.config.js`: Vite 빌드 설정

## 버전 기준

- 현재 기준은 Tauri 2.x, React 19, TypeScript로 맞춰 유지
- `tauri`/`@tauri-apps/*` 및 Rust 설정은 `package.json`과 `src-tauri/Cargo.toml`에서 함께 확인

## 개발 규칙

- `pnpm` 사용
- 주석 및 설명은 기본적으로 한글 사용

## 보안

- 비밀키와 토큰은 절대 커밋 금지
