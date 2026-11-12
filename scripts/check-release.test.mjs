import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const script = fileURLToPath(new URL("./check-release.mjs", import.meta.url));

function checkRelease(t, environment, tauriVersion = "0.1.3") {
  const directory = mkdtempSync(join(tmpdir(), "opengem-check-release-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  mkdirSync(join(directory, "src-tauri"));
  writeFileSync(join(directory, "package.json"), JSON.stringify({ version: "0.1.3" }), "utf8");
  writeFileSync(
    join(directory, "src-tauri/tauri.conf.json"),
    JSON.stringify({ version: tauriVersion }),
    "utf8"
  );
  writeFileSync(join(directory, "src-tauri/Cargo.toml"), '[package]\nversion = "0.1.3"\n', "utf8");
  return spawnSync(process.execPath, [script], {
    cwd: directory,
    encoding: "utf8",
    // 실제 서명키 대신 존재 여부 확인에만 쓰는 테스트 값을 전달합니다.
    env: {
      ...process.env,
      RELEASE_TAG: "",
      GITHUB_REF_NAME: "v0.1.3",
      TAURI_SIGNING_PRIVATE_KEY: "test-key",
      ...environment,
    },
  });
}

test("태그 push의 ref로 배포 버전을 검사한다", (t) => {
  assert.equal(checkRelease(t, {}).status, 0);
});

test("버튼 실행에서는 main 대신 준비한 태그를 검사한다", (t) => {
  assert.equal(checkRelease(t, { GITHUB_REF_NAME: "main", RELEASE_TAG: "v0.1.3" }).status, 0);
});

test("태그나 앱 버전이 다르면 배포를 막는다", (t) => {
  assert.notEqual(checkRelease(t, { RELEASE_TAG: "v0.1.4" }).status, 0);
  assert.notEqual(checkRelease(t, {}, "0.1.2").status, 0);
});

test("서명키가 없으면 배포를 막는다", (t) => {
  const result = checkRelease(t, { TAURI_SIGNING_PRIVATE_KEY: "" });
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /TAURI_SIGNING_PRIVATE_KEY/);
});
