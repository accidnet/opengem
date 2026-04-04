# Agents

- 기본적으로 언어는 한국어를 사용

## 프로젝트 구조

- `src/`: React 앱 진입점(`main.tsx`), 루트 화면(`App.tsx`), 스타일(`App.css`)
- `src-tauri/`: Rust 진입점(`src/main.rs`), `tauri.conf.json`, `Cargo.toml`
- `vite.config.js`: Vite 빌드 설정

## 버전 기준

- 현재 기준은 Tauri 2.x, React 19, TypeScript로 맞춰 유지
- `tauri`/`@tauri-apps/*` 및 Rust 설정은 `package.json`과 `src-tauri/Cargo.toml`에서 함께 확인

## 개발 규칙

- `pnpm` 사용
- 주석 및 설명은 기본적으로 한국어를 사용하며, 코드 작성 후에는 간략하게 주석을 달 것
- 한글이 포함된 파일은 PowerShell의 `Get-Content`, `Set-Content`, `Out-File` 등으로 내용 전체를 읽고 다시 쓰지 않는다
- 한글이 포함된 파일 수정은 기본적으로 `apply_patch`로만 진행하고, ASCII 식별자만 최소 범위로 변경한다
- 파일명 변경이나 import 경로 변경처럼 셸 작업이 필요해도, 한글 본문이 있는 파일 내용 치환은 셸 문자열 치환으로 처리하지 않는다
- 인코딩 이슈가 의심되면 먼저 이전 커밋과 diff로 확인하고, 한글 문자열이 깨진 상태에서 추가 수정하지 않는다
- ts내에서 import 시, ./까지 쓰고 그 이상은 @를 통해 절대경로로 사용할 것

### 프론트엔드

- type 및 함수 정의 시 export 없이 사용하고, 외부에서 사용할 여지가 있을 경우에만 export를 붙입니다.

## 보안

- 비밀키와 토큰은 절대 커밋 금지
