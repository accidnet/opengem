import { readFileSync } from "node:fs";

const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
const tauriVersion = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8")).version;
const cargoToml = readFileSync("src-tauri/Cargo.toml", "utf8");
const cargoVersion = cargoToml.match(/\[package\][\s\S]*?\nversion\s*=\s*"([^"]+)"/)?.[1];
// 버튼 실행의 ref는 main이므로 준비 단계에서 만든 태그를 우선 사용합니다.
const tag = process.env.RELEASE_TAG || process.env.GITHUB_REF_NAME;

// 태그와 설치 파일의 버전이 다르면 업데이트 매니페스트도 잘못 생성된다.
if (
  !packageVersion ||
  !cargoVersion ||
  packageVersion !== tauriVersion ||
  packageVersion !== cargoVersion ||
  tag !== `v${packageVersion}`
) {
  console.error(
    `배포 버전 불일치: tag=${tag}, package=${packageVersion}, tauri=${tauriVersion}, cargo=${cargoVersion}`
  );
  process.exit(1);
}

if (!process.env.TAURI_SIGNING_PRIVATE_KEY) {
  console.error("업데이트 서명키 TAURI_SIGNING_PRIVATE_KEY가 설정되지 않았습니다.");
  process.exit(1);
}
