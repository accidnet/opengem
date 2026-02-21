# Repository Guidelines

## 프로젝트 구조
- `src/`: React 앱 진입점(`main.tsx`), 루트 화면(`App.tsx`), 스타일(`App.css`)
- `src-tauri/`: Rust 진입점(`src/main.rs`), `tauri.conf.json`, `Cargo.toml`
- `vite.config.js`: Vite 빌드 설정

## 버전 기준
- 현재 기준은 Tauri 2.x, React 19, TypeScript로 맞춰 유지한다.
- `tauri`/`@tauri-apps/*` 및 Rust 설정은 `package.json`과 `src-tauri/Cargo.toml`에서 함께 확인한다.

## 실행 명령
- `npm install`
- `npm run dev`
- `npm run env:check`
- `npm run tauri:dev`
- `npm run build`
- `npm run tauri:build`
- `npm run preview`

## 코딩 규칙
- TypeScript(React)는 2칸 들여쓰기, 세미콜론, 의미 있는 식별자 사용
- React는 함수형 컴포넌트를 우선 사용
- 네이밍: 함수/변수 `camelCase`, 컴포넌트/클래스 `PascalCase`
- Rust는 `rustfmt` 스타일과 `snake_case`를 따른다
- 주석 및 설명은 기본적으로 한글로 합니다.

## 검증
- 테스트 프레임워크 미설치 상태
- Rust 변경 시 `cargo test` 권장
- UI/빌드 변경 후 `npm run build` 먼저 확인

## 보안
- 비밀키와 토큰은 절대 커밋 금지
- 최소 권한 원칙을 우선하고, `tauri.conf.json`의 권한·허용 목록을 함께 점검
