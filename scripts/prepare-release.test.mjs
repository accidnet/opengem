import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const script = fileURLToPath(new URL("./prepare-release.mjs", import.meta.url));
const files = [
  "package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
];

function git(cwd, ...args) {
  return execFileSync("git", args, {
    cwd,
    env: { ...process.env, OPENGEM_TEST_ALLOW_MAIN: "1" },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function configureGit(cwd) {
  git(cwd, "config", "user.name", "Release Test");
  git(cwd, "config", "user.email", "release-test@example.com");
  git(cwd, "config", "commit.gpgsign", "false");
  git(cwd, "config", "tag.gpgsign", "false");
}

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), "opengem-tag-release-test-"));
  // 테스트가 만든 임시 디렉터리만 정리합니다.
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("opengem-tag-release-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const remote = join(directory, "remote.git");
  const cwd = join(directory, "work");
  mkdirSync(cwd);
  git(directory, "init", "--bare", "--initial-branch=main", remote);
  git(cwd, "init", "--initial-branch=main");
  configureGit(cwd);
  git(cwd, "config", "core.autocrlf", "false");
  mkdirSync(join(cwd, "src-tauri"));
  writeFileSync(
    join(cwd, files[0]),
    JSON.stringify({ name: "opengem", version: "0.1.2" }, null, 2) + "\n",
    "utf8"
  );
  writeFileSync(
    join(cwd, files[1]),
    JSON.stringify({ productName: "opengem", version: "0.1.2" }, null, 2) + "\n",
    "utf8"
  );
  writeFileSync(
    join(cwd, files[2]),
    '[package]\nname = "opengem"\nversion = "0.1.2"\n\n[dependencies]\nserde = "1"\n',
    "utf8"
  );
  writeFileSync(
    join(cwd, files[3]),
    'version = 4\n\n[[package]]\nname = "opengem"\nversion = "0.1.2"\n\n[[package]]\nname = "serde"\nversion = "1.0.0"\n',
    "utf8"
  );
  writeFileSync(join(cwd, "README.md"), "처음 선택한 코드\n", "utf8");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "Initial source");
  git(cwd, "remote", "add", "origin", remote);
  git(cwd, "push", "origin", "main");
  // 배포 CLI가 main을 건드리면 서버에서도 실패하도록 보호합니다.
  writeFileSync(
    join(remote, "hooks", "update"),
    '#!/bin/sh\nif [ "$1" = refs/heads/main ] && [ "$OPENGEM_TEST_ALLOW_MAIN" != 1 ]; then exit 1; fi\n',
    { encoding: "utf8", mode: 0o755 }
  );
  const sourceSha = git(cwd, "rev-parse", "HEAD");
  const env = {
    ...process.env,
    OPENGEM_TEST_ALLOW_MAIN: "0",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_REF_NAME: "main",
    GITHUB_SHA: sourceSha,
    GITHUB_OUTPUT: join(directory, "output.txt"),
    // 태그 배포는 PR API나 토큰 없이 로컬 Git remote만으로 검증합니다.
    GITHUB_TOKEN: "",
    GITHUB_API_URL: "http://127.0.0.1:1",
    RELEASE_VERSION: "0.1.3",
    RELEASE_COMMIT: "",
    RELEASE_SOURCE_SHA: sourceSha,
  };
  return { directory, remote, cwd, sourceSha, env };
}

function run(repository, mode, overrides = {}) {
  return spawnSync(process.execPath, [script, mode], {
    cwd: repository.cwd,
    env: { ...repository.env, ...overrides },
    encoding: "utf8",
    timeout: 20000,
  });
}

function succeeds(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function fails(result) {
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
}

function output(repository) {
  return Object.fromEntries(
    readFileSync(repository.env.GITHUB_OUTPUT, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => line.split("="))
  );
}

function remoteRef(repository, ref) {
  return git(repository.cwd, "ls-remote", "origin", ref).split(/\s+/)[0];
}

function commitChange(repository, message = "Advance main") {
  writeFileSync(join(repository.cwd, "README.md"), `${message}\n`, "utf8");
  git(repository.cwd, "add", "README.md");
  git(repository.cwd, "commit", "-m", message);
  git(repository.cwd, "push", "origin", "main");
  return git(repository.cwd, "rev-parse", "HEAD");
}

function checkoutSource(repository, name, crlf = false) {
  const cwd = join(repository.directory, name);
  git(repository.directory, "clone", "--config", `core.autocrlf=${crlf}`, repository.remote, cwd);
  git(cwd, "checkout", "--detach", repository.sourceSha);
  return { ...repository, cwd };
}

function assertBuildVersion(repository, expected = "0.1.3") {
  assert.equal(JSON.parse(readFileSync(join(repository.cwd, files[0]), "utf8")).version, expected);
  assert.equal(JSON.parse(readFileSync(join(repository.cwd, files[1]), "utf8")).version, expected);
  assert.match(
    readFileSync(join(repository.cwd, files[2]), "utf8"),
    new RegExp(`version = "${expected.replaceAll(".", "\\.")}"`)
  );
  assert.match(
    readFileSync(join(repository.cwd, files[3]), "utf8"),
    new RegExp(`name = "opengem"\\r?\\nversion = "${expected.replaceAll(".", "\\.")}"`)
  );
  assert.match(
    readFileSync(join(repository.cwd, files[3]), "utf8"),
    /name = "serde"\r?\nversion = "1\.0\.0"/
  );
}

test("기본 대상은 실행 시점의 main SHA이며 이후 main 변경을 따라가지 않는다", (t) => {
  const repository = fixture(t);
  const advancedSha = commitChange(repository);
  git(repository.cwd, "checkout", "--detach", repository.sourceSha);
  succeeds(run(repository, "resolve"));
  assert.deepEqual(output(repository), {
    sha: repository.sourceSha,
    version: "0.1.3",
    tag: "v0.1.3",
  });
  assert.equal(remoteRef(repository, "refs/heads/main"), advancedSha);
  assert.equal(git(repository.cwd, "status", "--porcelain"), "");
});

test("과거 커밋을 외부 도구로 빌드하며 main과 원본 코드 대신 태그만 게시한다", (t) => {
  const repository = fixture(t);
  const advancedSha = commitChange(repository);
  succeeds(
    run(repository, "resolve", {
      GITHUB_SHA: advancedSha,
      RELEASE_COMMIT: repository.sourceSha,
    })
  );
  const app = checkoutSource(repository, "app");
  assert.equal(existsSync(join(app.cwd, "scripts/prepare-release.mjs")), false);
  succeeds(run(app, "prepare"));
  assertBuildVersion(app);
  succeeds(run(app, "publish"));
  assert.equal(git(app.cwd, "rev-parse", "HEAD"), repository.sourceSha);
  assert.equal(remoteRef(app, "refs/tags/v0.1.3"), repository.sourceSha);
  assert.equal(remoteRef(app, "refs/heads/main"), advancedSha);
  assert.equal(git(app.cwd, "show", "v0.1.3:README.md"), "처음 선택한 코드");
  assert.equal(JSON.parse(git(app.cwd, "show", "v0.1.3:package.json")).version, "0.1.2");
  assert.equal(
    git(repository.remote, "for-each-ref", "--format=%(refname)", "refs/heads"),
    "refs/heads/main"
  );
});

test("동일 버전과 커밋의 재시도는 기존 태그를 재사용한다", (t) => {
  const repository = fixture(t);
  succeeds(run(repository, "prepare"));
  succeeds(run(repository, "publish"));
  const retry = checkoutSource(repository, "retry");
  succeeds(run(retry, "resolve"));
  succeeds(run(retry, "prepare"));
  succeeds(run(retry, "publish"));
  assert.equal(remoteRef(repository, "refs/tags/v0.1.3"), repository.sourceSha);
  assert.equal(remoteRef(repository, "refs/heads/main"), repository.sourceSha);
  assert.equal(git(repository.remote, "tag", "--list"), "v0.1.3");
});

test("태그 push는 annotated tag의 버전과 peeled commit을 사용한다", (t) => {
  const repository = fixture(t);
  git(repository.cwd, "tag", "-a", "v0.2.0", "-m", "Release 0.2.0");
  git(repository.cwd, "push", "origin", "refs/tags/v0.2.0");
  const tagObject = remoteRef(repository, "refs/tags/v0.2.0");
  succeeds(
    run(repository, "resolve", {
      GITHUB_EVENT_NAME: "push",
      GITHUB_REF: "refs/tags/v0.2.0",
      GITHUB_REF_NAME: "v0.2.0",
      RELEASE_VERSION: "",
    })
  );
  assert.equal(output(repository).version, "0.2.0");
  assert.equal(output(repository).sha, repository.sourceSha);
  succeeds(run(repository, "prepare", { RELEASE_VERSION: "0.2.0" }));
  succeeds(run(repository, "publish", { RELEASE_VERSION: "0.2.0" }));
  assertBuildVersion(repository, "0.2.0");
  assert.equal(remoteRef(repository, "refs/tags/v0.2.0"), tagObject);
  assert.equal(remoteRef(repository, "refs/tags/v0.2.0^{}"), repository.sourceSha);
});

test("이미 다른 커밋에 붙은 태그는 resolve와 publish에서 덮어쓰지 않는다", (t) => {
  const repository = fixture(t);
  const advancedSha = commitChange(repository);
  const app = checkoutSource(repository, "app");
  succeeds(run(app, "prepare"));
  // 준비 후 다른 작업이 같은 이름의 태그를 만든 경합도 재확인합니다.
  git(repository.cwd, "tag", "v0.1.3", advancedSha);
  git(repository.cwd, "push", "origin", "refs/tags/v0.1.3");
  fails(run(app, "publish"));
  git(repository.cwd, "checkout", "--detach", repository.sourceSha);
  fails(run(repository, "resolve"));
  assert.equal(remoteRef(app, "refs/tags/v0.1.3"), advancedSha);
  assert.equal(remoteRef(app, "refs/heads/main"), advancedSha);
});

test("정식 버전·40자리 SHA·main 실행 조건을 만족하지 않으면 대상 변경을 거부한다", (t) => {
  const repository = fixture(t);
  for (const overrides of [
    { RELEASE_VERSION: "" },
    { RELEASE_VERSION: "v0.1.3" },
    { RELEASE_VERSION: "0.1.3-beta.1" },
    { RELEASE_VERSION: "01.1.3" },
    { RELEASE_COMMIT: "main" },
    { RELEASE_COMMIT: "a".repeat(40) },
    { GITHUB_SHA: "bad-sha" },
    { GITHUB_REF: "refs/heads/feature" },
  ])
    fails(run(repository, "resolve", overrides));
  assert.equal(git(repository.cwd, "status", "--porcelain"), "");
  assert.equal(git(repository.remote, "tag", "--list"), "");
});

test("실행 시점 main 이력에 없는 브랜치 커밋은 선택할 수 없다", (t) => {
  const repository = fixture(t);
  git(repository.cwd, "switch", "-c", "feature");
  writeFileSync(join(repository.cwd, "README.md"), "아직 main에 없는 코드\n", "utf8");
  git(repository.cwd, "add", "README.md");
  git(repository.cwd, "commit", "-m", "Unmerged feature");
  const featureSha = git(repository.cwd, "rev-parse", "HEAD");
  git(repository.cwd, "push", "origin", "feature");
  git(repository.cwd, "switch", "main");
  fails(run(repository, "resolve", { RELEASE_COMMIT: featureSha }));
  assert.equal(remoteRef(repository, "refs/heads/main"), repository.sourceSha);
});

test("prepare는 dirty checkout·잘못된 HEAD·원본 버전 불일치를 거부한다", (t) => {
  const repository = fixture(t);
  writeFileSync(join(repository.cwd, "unexpected.txt"), "미커밋 파일\n", "utf8");
  fails(run(repository, "prepare"));
  rmSync(join(repository.cwd, "unexpected.txt"));
  fails(run(repository, "prepare", { RELEASE_SOURCE_SHA: "a".repeat(40) }));
  writeFileSync(join(repository.cwd, files[1]), '{"version":"9.0.0"}\n', "utf8");
  git(repository.cwd, "add", files[1]);
  git(repository.cwd, "commit", "-m", "Mismatched version");
  fails(
    run(repository, "prepare", { RELEASE_SOURCE_SHA: git(repository.cwd, "rev-parse", "HEAD") })
  );
  assert.equal(git(repository.remote, "tag", "--list"), "");
});

test("검사 중 코드나 버전 이외 설정이 바뀌면 publish를 거부한다", (t) => {
  const repository = fixture(t);
  succeeds(run(repository, "prepare"));
  writeFileSync(join(repository.cwd, "README.md"), "검사하지 않은 수정\n", "utf8");
  fails(run(repository, "publish"));
  git(repository.cwd, "restore", "README.md");
  const packageJson = JSON.parse(readFileSync(join(repository.cwd, files[0]), "utf8"));
  packageJson.name = "unexpected";
  writeFileSync(
    join(repository.cwd, files[0]),
    JSON.stringify(packageJson, null, 2) + "\n",
    "utf8"
  );
  fails(run(repository, "publish"));
  assert.equal(remoteRef(repository, "refs/heads/main"), repository.sourceSha);
  assert.equal(git(repository.remote, "tag", "--list"), "");
});

test("detached CRLF 체크아웃에서 원본의 빈 줄을 보존한다", (t) => {
  const repository = fixture(t);
  for (const path of files.slice(2)) {
    writeFileSync(
      join(repository.cwd, path),
      readFileSync(join(repository.cwd, path), "utf8") + "\n\n",
      "utf8"
    );
  }
  git(repository.cwd, "add", ".");
  git(repository.cwd, "commit", "-m", "Keep trailing lines");
  git(repository.cwd, "push", "origin", "main");
  repository.sourceSha = git(repository.cwd, "rev-parse", "HEAD");
  repository.env.GITHUB_SHA = repository.sourceSha;
  repository.env.RELEASE_SOURCE_SHA = repository.sourceSha;
  const app = checkoutSource(repository, "app", true);
  succeeds(run(app, "prepare"));
  succeeds(run(app, "publish"));
  assertBuildVersion(app);
  for (const path of files.slice(2)) {
    assert.ok(readFileSync(join(app.cwd, path), "utf8").endsWith("\r\n\r\n\r\n"));
  }
  assert.equal(git(app.cwd, "rev-parse", "HEAD"), repository.sourceSha);
  assert.equal(remoteRef(app, "refs/tags/v0.1.3"), repository.sourceSha);
});
