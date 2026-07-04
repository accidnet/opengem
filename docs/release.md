# 릴리즈 가이드

`opengem`은 GitHub Releases와 Tauri updater를 사용해 Windows 설치 파일과 앱 업데이트를 배포합니다.

## 릴리즈 흐름

```text
v* 태그 push
→ GitHub Actions release workflow 실행
→ Windows runner에서 Tauri 앱 빌드
→ NSIS 설치 파일 생성
→ updater 서명 파일 생성
→ GitHub Release에 설치 파일과 updater metadata 업로드
→ 설치된 앱이 latest.json을 보고 업데이트 확인
```

릴리즈 자동화는 다음 workflow에서 관리합니다.

- `.github/workflows/release.yml`

태그 트리거는 다음과 같습니다.

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

## GitHub Release 생성

릴리즈는 스크립트로 생성합니다. 스크립트는 버전 동기화, 검증, 커밋, `main` push, 태그 push를 순서대로 처리합니다.

실행 전 조건:

- `main` 브랜치여야 합니다.
- 작업트리가 깨끗해야 합니다.
- 같은 버전 태그가 이미 있으면 안 됩니다.

예를 들어 `0.1.1`을 릴리즈하려면 다음 명령을 실행합니다.

```powershell
pnpm run release -- 0.1.1
```

Actions 실행 상태 확인:

```powershell
gh run list --repo accidnet/opengem --workflow release --limit 5
```

릴리즈 페이지:

- https://github.com/accidnet/opengem/releases

## 설치 및 업데이트

최초 설치는 GitHub Release에 올라간 NSIS 설치 파일을 실행합니다.

설치 후에는 앱 왼쪽 패널의 `App Update` 영역에서 업데이트를 확인할 수 있습니다.

업데이트 확인 흐름:

```text
앱에서 latest.json 조회
→ 현재 버전보다 높은 버전인지 확인
→ 설치 파일 다운로드
→ public key로 서명 검증
→ 검증 성공 시 설치
→ 앱 재시작
```
