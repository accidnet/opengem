# src-tauri

Tauri 2.x 기반 데스크톱 백엔드 및 앱 패키징 디렉터리입니다.  
Rust 엔트리포인트, Tauri 설정, SQL 마이그레이션, 명령 처리 코드, 아이콘 리소스를 포함합니다.

## 프로젝트 구조

```text
src-tauri/
├─ build.rs
├─ Cargo.toml
├─ Cargo.lock
├─ tauri.conf.json
├─ src/
│  ├─ main.rs
│  ├─ app_state.rs
│  └─ commands/
│     ├─ mod.rs
│     ├─ operation_mode.rs
│     ├─ session.rs
│     ├─ settings.rs
│     └─ workspace.rs
├─ sql/
│  ├─ migrations/
│  │  ├─ 001_init.sql
│  │  ├─ 002_llm_settings.sql
│  │  ├─ 003_operation_mode_default.sql
│  │  ├─ 004_chat_session.sql
│  │  ├─ 005_operation_mode_agents.sql
│  │  ├─ 006_seed_default_mode_agents.sql
│  │  ├─ 007_chat_sessions_mode_name.sql
│  │  ├─ 008_agent_role.sql
│  │  ├─ 009_app_window_state.sql
│  │  ├─ 010_operation_mode_project_paths.sql
│  │  └─ 011_chat_session_project_paths.sql
│  └─ queries/
│     └─ operation_mode/
│        ├─ delete_all.sql
│        ├─ delete_by_name.sql
│        ├─ insert.sql
│        ├─ select_all.sql
│        ├─ select_first.sql
│        └─ update_selected.sql
├─ gen/
│  └─ schemas/
│     ├─ acl-manifests.json
│     ├─ capabilities.json
│     ├─ desktop-schema.json
│     ├─ linux-schema.json
│     └─ windows-schema.json
├─ icons/
│  ├─ icon.png
│  ├─ icon.ico
│  ├─ icon.icns
│  ├─ 32x32.png
│  ├─ 64x64.png
│  ├─ 128x128.png
│  ├─ 128x128@2x.png
│  ├─ Square*.png
│  ├─ StoreLogo.png
│  ├─ android/
│  └─ ios/
└─ target/
   └─ ...
```

## 디렉터리 설명

- `build.rs`: Tauri/Rust 빌드 시 실행되는 빌드 스크립트
- `Cargo.toml`: Rust 크레이트 의존성 및 패키지 설정
- `tauri.conf.json`: Tauri 앱 번들링 및 런타임 설정
- `src/`: Rust 백엔드 엔트리포인트와 Tauri 커맨드 구현
- `sql/`: DB 마이그레이션 및 쿼리 파일
- `gen/`: Tauri가 생성한 스키마 산출물
- `icons/`: 데스크톱/모바일 패키징용 아이콘 리소스
- `target/`: Rust 빌드 결과물 디렉터리

## 참고

- `target/`은 빌드 시 자동 생성되는 산출물 폴더이므로, 구조 파악 시에는 주로 `src/`, `sql/`, `icons/`, `tauri.conf.json`, `Cargo.toml`을 우선 보면 됩니다.
