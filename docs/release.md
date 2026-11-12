# 릴리즈 가이드

`opengem`은 GitHub Releases와 Tauri updater를 사용해 Windows 설치 파일과 앱 업데이트를 배포합니다.

## 릴리즈 흐름

```text
GitHub Actions → release → Run workflow (배포 버전, 대상 커밋 SHA)
→ 배포할 커밋 확정 및 정확한 SHA checkout
→ 빌드 작업트리에 배포 버전 주입 및 프런트엔드·Rust 검사
→ 선택한 원본 커밋에 v* 태그 push
→ Windows runner에서 Tauri 앱 빌드
→ NSIS 설치 파일 생성
→ updater 서명 파일 생성
→ GitHub Release 초안에 설치 파일과 updater metadata 업로드
→ 필요한 파일이 모두 올라오면 정식 공개
→ 설치된 앱이 latest.json을 보고 업데이트 확인
```

릴리즈 자동화는 다음 workflow에서 관리합니다.

- `.github/workflows/release.yml`
- `scripts/prepare-release.mjs`: 커밋·버전 확정, 빌드용 버전 주입, 태그 게시 및 재시도를 처리합니다.
- 빌드 전에 태그와 `package.json`, Tauri, Cargo 버전의 일치 여부와 서명키 설정을 확인합니다.

이 workflow를 포함한 커밋에 `v*` 태그를 직접 push해도 같은 검사·빌드·공개 절차를 사용합니다. 과거 커밋의 workflow는 다를 수 있으므로 과거 코드를 배포할 때는 main의 배포 버튼을 사용합니다.

```yaml
on:
  push:
    tags:
      - "v*"
```

## 주요 설정

Tauri 번들 및 updater 설정은 다음 파일에서 관리합니다.

- `src-tauri/tauri.conf.json`

중요 설정:

- `bundle.active: true`
  - 배포용 설치 패키지를 생성합니다.
- `bundle.targets: ["nsis"]`
  - Windows NSIS 설치 파일을 생성합니다.
- `bundle.createUpdaterArtifacts: true`
  - updater 서명 파일과 metadata 생성을 활성화합니다.
- `plugins.updater.endpoints`
  - 설치된 앱이 새 버전을 확인할 `latest.json` 주소입니다.
- `plugins.updater.pubkey`
  - updater 서명을 검증하는 공개키입니다. 공개되어도 됩니다.

## 서명 키 관리

Tauri updater는 설치 파일이 신뢰 가능한지 확인하기 위해 서명을 사용합니다.

```text
private key: 설치 파일을 서명할 때 사용
password: private key를 열 때 사용
public key: 앱에 포함되어 서명을 검증할 때 사용
```

키 파일은 repository 밖의 안전한 위치에 보관합니다.

주의:

- `opengem.key`와 `opengem.key.password`는 절대 커밋하지 않습니다.
- 키를 잃어버리면 기존 설치 앱의 자동 업데이트가 끊길 수 있습니다.
- 키가 유출되면 가짜 업데이트 서명이 가능해질 수 있으므로 즉시 교체해야 합니다.
- private key와 password는 GitHub Secrets와 안전한 개인 백업에만 둡니다.

GitHub Actions에서 사용하는 Secrets:

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

Secrets 등록 명령 예시:

```powershell
$privateKeyPath = "<private-key-path>"
$privateKeyPasswordPath = "<private-key-password-path>"

gh secret set TAURI_SIGNING_PRIVATE_KEY --repo accidnet/opengem --body (Get-Content $privateKeyPath -Raw -Encoding UTF8)
gh secret set TAURI_SIGNING_PRIVATE_KEY_PASSWORD --repo accidnet/opengem --body (Get-Content $privateKeyPasswordPath -Raw -Encoding UTF8).Trim()
```

Secrets 등록 확인:

```powershell
gh secret list --repo accidnet/opengem
```

## 로컬 배포 빌드

로컬에서 설치 파일을 만들 때는 signing key 환경변수를 넣고 빌드합니다.

```powershell
$privateKeyPath = "<private-key-path>"
$privateKeyPasswordPath = "<private-key-password-path>"

$env:TAURI_SIGNING_PRIVATE_KEY=(Get-Content $privateKeyPath -Raw -Encoding UTF8)
$env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD=(Get-Content $privateKeyPasswordPath -Raw -Encoding UTF8).Trim()
pnpm run tauri:build
```

빌드 결과 예시:

```text
src-tauri\target\release\bundle\nsis\opengem_0.1.0_x64-setup.exe
src-tauri\target\release\bundle\nsis\opengem_0.1.0_x64-setup.exe.sig
```

## GitHub에서 배포 버튼 사용

1. 배포할 코드를 검증하고 `main` 이력에서 대상 커밋을 정합니다.
2. 저장소의 **Actions → release → Run workflow**를 엽니다.
3. **Use workflow from: main**을 선택합니다. 이는 배포 자동화를 실행할 브랜치입니다.
4. **배포 버전**에 `0.1.3`처럼 `v`를 제외한 정식 버전을 입력합니다.
5. **대상 커밋의 전체 SHA**에 배포할 커밋의 40자리 SHA를 입력합니다. 비워두면 버튼 실행 시점의 main 커밋으로 확정됩니다. GitHub의 커밋 상세 화면에서 전체 SHA를 복사할 수 있습니다.
6. **Run workflow**를 누릅니다. 성공하면 실행 요약에 릴리스 링크가 표시됩니다.

배포 대상은 실행 시점 main 이력에 포함된 커밋이어야 합니다. 예를 들어 main 이력이 `A → B → C → D`일 때 `B`와 `0.1.3`을 입력하면 `v0.1.3` 태그는 정확히 `B`를 가리킵니다. 이후 main에 `E`가 들어와도 배포 대상은 바뀌지 않습니다. main 변경만으로 배포가 시작되지는 않습니다.

배포 자동화와 앱 소스는 별도로 checkout합니다. 선택한 과거 커밋에 새 배포 스크립트가 없어도 버튼을 실행한 시점의 자동화가 그 커밋을 빌드합니다. 타입 검사, 린트, 포맷 검사, Node 테스트, 프런트엔드 빌드 및 Rust 포맷·테스트를 통과한 뒤 태그를 게시합니다. 3D 오피스 브라우저 검증은 PR Quality에서 실행하므로 배포 전 개발 PR 검사도 통과시킵니다.

### 배포 버전과 소스 버전

배포 버전의 기준은 `v0.1.3` 같은 태그입니다. 빌드 과정에서만 `package.json`, `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `src-tauri/Cargo.lock`의 앱 버전을 `0.1.3`으로 맞춥니다. 이 변경은 커밋하거나 main에 push하지 않으며 버전 PR도 만들지 않습니다. 설치 파일, 앱 버전 표시와 updater metadata에는 주입한 배포 버전이 들어갑니다.

따라서 태그의 GitHub **Source code** ZIP에는 원본 커밋의 개발 버전이 남습니다. 같은 버전으로 재현 빌드하려면 해당 커밋을 checkout한 뒤 이 workflow의 동일한 버전 주입·빌드 절차를 사용합니다. 버튼에서 동일한 커밋과 버전을 입력하면 기존 태그를 재사용할 수 있습니다.

### 필요한 권한

기존 서명 Secrets와 기본 `GITHUB_TOKEN`의 `contents: write`만 사용합니다. 조직·저장소의 **Allow GitHub Actions to create and approve pull requests** 설정은 필요하지 않습니다. main 보호 규칙에도 변경이 없으며, 태그 보호 규칙이 있는 경우 배포 태그 생성을 허용해야 합니다.

`GITHUB_TOKEN`으로 만든 태그는 새 workflow를 실행하지 않으므로 현재 실행에서 바로 빌드와 공개를 이어갑니다. [GitHub 이벤트 동작](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/trigger-a-workflow)

### 실패 후 다시 실행

- 일시적인 빌드·업로드 오류는 해당 실행의 **Re-run failed jobs**로 재시도합니다. **Re-run all jobs**도 원래 입력과 커밋을 그대로 사용합니다.
- 태그 push 전에 실패했다면 원격 저장소에 변경이 없습니다. 태그 push 후 실패하면 같은 커밋·버전으로 재시도해 이어서 빌드합니다. 새 버튼 실행으로 재시도할 때는 원래 대상 SHA를 명시합니다.
- 업로드 중 실패한 릴리스는 초안으로 남아 기존 앱에 노출되지 않습니다. 설치 파일, 서명, `latest.json`을 확인한 뒤 공개합니다.
- 이미 공개한 릴리스는 재실행해도 설치 파일을 덮어쓰지 않습니다.
- 동일한 버전 태그가 다른 커밋을 가리키면 중단합니다. 태그를 이동하거나 덮어쓰지 않습니다. 새 코드에는 새 버전을 사용합니다.
- 실행 중 main이 진행해도 이미 선택한 커밋으로 계속 배포합니다. 배포는 동시에 진행하지 않으며, 버튼을 연속으로 누르지 않습니다.

## 로컬 명령으로 GitHub Release 생성

기존 로컬 스크립트도 사용할 수 있습니다. 스크립트는 버전 동기화, 검증, 커밋, `main` push, 태그 push를 순서대로 처리합니다.

실행 전 조건:

- `main` 브랜치여야 합니다.
- 작업트리가 깨끗해야 합니다.
- 같은 버전 태그가 이미 있으면 안 됩니다.

예를 들어 `0.1.1`을 릴리즈하려면 다음 명령을 실행합니다.

```powershell
pnpm run release 0.1.1
```

Actions 실행 상태 확인:

```powershell
gh run list --repo accidnet/opengem --workflow release --limit 5
```

릴리즈 페이지:

- https://github.com/accidnet/opengem/releases

## 설치 및 업데이트

최초 설치는 GitHub Release에 올라간 NSIS 설치 파일을 실행합니다.

설치 후에는 앱 상단 또는 프로필 메뉴에서 현재 버전을 확인할 수 있습니다. 앱 시작 시 자동으로 업데이트를 확인하며 왼쪽 작업 공간 패널 하단의 `앱 업데이트` 영역에서 `확인` 버튼으로 다시 확인할 수 있습니다. 새 버전이 있으면 `설치`를 누릅니다. 대화 작업 중에는 설치가 비활성화됩니다.

업데이트 확인 흐름:

```text
앱에서 latest.json 조회
→ 현재 버전보다 높은 버전인지 확인
→ 설치 파일 다운로드
→ public key로 서명 검증
→ 검증 성공 시 설치
→ 앱 재시작
```
