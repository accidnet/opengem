import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
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

async function fixture(t, version = "0.1.2") {
  const directory = mkdtempSync(join(tmpdir(), "opengem-release-test-"));
  // 테스트가 만든 임시 디렉터리만 제거합니다.
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith("opengem-release-test-"));
  const remote = join(directory, "remote.git");
  const cwd = join(directory, "work");
  mkdirSync(cwd);
  git(directory, "init", "--bare", "--initial-branch=main", remote);
  git(cwd, "init", "--initial-branch=main");
  git(cwd, "config", "user.name", "Release Test");
  git(cwd, "config", "user.email", "release-test@example.com");
  git(cwd, "config", "commit.gpgsign", "false");
  git(cwd, "config", "core.autocrlf", "false");
  mkdirSync(join(cwd, "src-tauri"));
  writeFileSync(
    join(cwd, files[0]),
    JSON.stringify({ name: "opengem", version }, null, 2) + "\n",
    "utf8"
  );
  writeFileSync(
    join(cwd, files[1]),
    JSON.stringify({ productName: "opengem", version }, null, 2) + "\n",
    "utf8"
  );
  writeFileSync(
    join(cwd, files[2]),
    `[package]\nname = "opengem"\nversion = "${version}"\n\n[dependencies]\nserde = "1"\n`,
    "utf8"
  );
  writeFileSync(
    join(cwd, files[3]),
    `version = 4\n\n[[package]]\nname = "opengem"\nversion = "${version}"\n\n[[package]]\nname = "serde"\nversion = "1.0.0"\n`,
    "utf8"
  );
  writeFileSync(join(cwd, "README.md"), "테스트 저장소\n", "utf8");
  git(cwd, "add", ".");
  git(cwd, "commit", "-m", "Initial version");
  git(cwd, "remote", "add", "origin", remote);
  git(cwd, "push", "origin", "main");
  // 테스트의 GitHub 병합만 main 갱신을 허용하고 CLI의 직접 push는 거부합니다.
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
    GITHUB_SHA: sourceSha,
    GITHUB_RUN_ID: "12345",
    GITHUB_OUTPUT: join(directory, "output.txt"),
    GITHUB_TOKEN: "test-token",
    GITHUB_REPOSITORY: "test/opengem",
    RELEASE_BUMP: "patch",
  };
  const repository = { directory, remote, cwd, sourceSha, env };
  const api = {
    pulls: [],
    calls: [],
    errors: [],
    denyCreate: false,
    raceBeforeMerge: false,
    initialMergeabilityPending: false,
    mergeabilityReads: 0,
    mergeCount: 0,
  };
  const server = createServer(async (request, response) => {
    function send(status, value) {
      response.writeHead(status, { "content-type": "application/json" });
      response.end(JSON.stringify(value));
    }
    try {
      assert.equal(request.headers.authorization, "Bearer test-token");
      const url = new URL(request.url, "http://localhost");
      let text = "";
      for await (const chunk of request) text += chunk;
      const body = text ? JSON.parse(text) : null;
      api.calls.push({ method: request.method, path: url.pathname, body });
      const pullsPath = "/repos/test/opengem/pulls";
      if (request.method === "GET" && url.pathname === pullsPath) {
        const head = url.searchParams.get("head");
        send(
          200,
          api.pulls.filter((pull) => !head || head === `test:${pull.head.ref}`)
        );
        return;
      }
      if (request.method === "POST" && url.pathname === pullsPath) {
        if (api.denyCreate) {
          send(403, { message: "GitHub Actions is not permitted to create pull requests." });
          return;
        }
        assert.equal(body.base, "main");
        assert.match(body.head, /^codex\/release-\d+$/);
        const pull = {
          number: api.pulls.length + 1,
          state: "open",
          merged: false,
          mergeable: api.initialMergeabilityPending ? null : true,
          merged_at: null,
          merge_commit_sha: null,
          html_url: `http://localhost/pull/${api.pulls.length + 1}`,
          head: { sha: remoteRef(repository, `refs/heads/${body.head}`), ref: body.head },
          base: { ref: "main" },
        };
        assert.match(pull.head.sha, /^[a-f0-9]{40}$/);
        api.pulls.push(pull);
        send(201, pull);
        return;
      }
      const matched = url.pathname.match(/^\/repos\/test\/opengem\/pulls\/(\d+)(\/merge)?$/);
      if (matched) {
        const pull = api.pulls.find((value) => value.number === Number(matched[1]));
        assert.ok(pull);
        if (request.method === "GET" && !matched[2]) {
          api.mergeabilityReads += 1;
          pull.mergeable =
            api.initialMergeabilityPending && api.mergeabilityReads === 1 ? null : true;
          send(200, pull);
          return;
        }
        if (request.method === "PUT" && matched[2]) {
          assert.equal(body.sha, pull.head.sha);
          assert.equal(body.merge_method, "squash");
          assert.equal(pull.merged, false);
          if (api.raceBeforeMerge) advanceMain(repository);
          const mergeWorktree = join(directory, `merge-${pull.number}`);
          git(directory, "clone", remote, mergeWorktree);
          git(mergeWorktree, "config", "user.name", "GitHub Merge Test");
          git(mergeWorktree, "config", "user.email", "merge-test@example.com");
          git(mergeWorktree, "config", "commit.gpgsign", "false");
          git(mergeWorktree, "merge", "--squash", `origin/${pull.head.ref}`);
          git(mergeWorktree, "commit", "-m", body.commit_title, "-m", body.commit_message);
          git(mergeWorktree, "push", "origin", "main");
          pull.merge_commit_sha = git(mergeWorktree, "rev-parse", "HEAD");
          pull.state = "closed";
          pull.merged = true;
          pull.merged_at = "2026-11-12T00:00:00Z";
          api.mergeCount += 1;
          send(200, { merged: true, sha: pull.merge_commit_sha });
          return;
        }
      }
      send(404, { message: "Unexpected mock API request" });
    } catch (error) {
      api.errors.push(error.message);
      send(500, { message: error.message });
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  env.GITHUB_API_URL = `http://127.0.0.1:${server.address().port}`;
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    rmSync(directory, { recursive: true, force: true });
    assert.deepEqual(api.errors, []);
  });
  return { ...repository, api };
}

function run(repository, mode, overrides = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, mode], {
      cwd: repository.cwd,
      env: { ...repository.env, ...overrides },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60000,
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

function succeeds(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function fails(result, message) {
  assert.equal(result.status, 1, `${result.stdout}\n${result.stderr}`);
  assert.match(result.stderr, message);
}

function remoteRef(repository, ref) {
  return git(repository.cwd, "ls-remote", "origin", ref).split(/\s+/)[0];
}

function advanceMain(repository) {
  const other = join(repository.directory, "other");
  git(repository.directory, "clone", repository.remote, other);
  git(other, "config", "user.name", "Other Developer");
  git(other, "config", "user.email", "other@example.com");
  git(other, "config", "commit.gpgsign", "false");
  writeFileSync(join(other, "README.md"), "새로운 main 변경\n", "utf8");
  git(other, "add", "README.md");
  git(other, "commit", "-m", "Advance main");
  git(other, "push", "origin", "main");
  return git(other, "rev-parse", "HEAD");
}

for (const [bump, expected] of [
  ["patch", "0.1.3"],
  ["minor", "0.2.0"],
  ["major", "1.0.0"],
]) {
  test(`${bump} 배포는 버전 PR을 병합한 후 해당 커밋에 태그를 만든다`, async (t) => {
    const repository = await fixture(t);
    repository.env.RELEASE_BUMP = bump;
    repository.api.initialMergeabilityPending = bump === "patch";
    succeeds(await run(repository, "prepare"));
    assert.equal(
      JSON.parse(readFileSync(join(repository.cwd, files[0]), "utf8")).version,
      expected
    );
    assert.equal(
      JSON.parse(readFileSync(join(repository.cwd, files[1]), "utf8")).version,
      expected
    );
    assert.match(
      readFileSync(join(repository.cwd, files[2]), "utf8"),
      new RegExp(`version = "${expected.replaceAll(".", "\\.")}"`)
    );
    assert.match(
      readFileSync(join(repository.cwd, files[3]), "utf8"),
      new RegExp(`name = "opengem"\nversion = "${expected.replaceAll(".", "\\.")}"`)
    );
    assert.match(
      readFileSync(join(repository.cwd, files[3]), "utf8"),
      /name = "serde"\nversion = "1\.0\.0"/
    );
    assert.equal(remoteRef(repository, "refs/heads/main"), repository.sourceSha);
    succeeds(await run(repository, "publish"));
    const releaseSha = git(repository.cwd, "rev-parse", "HEAD");
    assert.equal(remoteRef(repository, "refs/heads/main"), releaseSha);
    assert.equal(remoteRef(repository, `refs/tags/v${expected}`), releaseSha);
    assert.equal(git(repository.cwd, "rev-parse", "HEAD^"), repository.sourceSha);
    assert.equal(git(repository.cwd, "status", "--porcelain"), "");
    assert.equal(repository.api.pulls.length, 1);
    assert.equal(repository.api.mergeCount, 1);
    if (bump === "patch") assert.ok(repository.api.mergeabilityReads >= 2);
    assert.equal(repository.api.pulls[0].merge_commit_sha, releaseSha);
    const commitMessage = git(repository.cwd, "show", "-s", "--format=%B", releaseSha);
    assert.match(commitMessage, /OpenGem-Release-Run: 12345/);
    assert.match(
      readFileSync(repository.env.GITHUB_OUTPUT, "utf8"),
      new RegExp(`tag=v${expected.replaceAll(".", "\\.")}\nreused=false`)
    );
  });
}

test("잘못된 입력이나 main 이외 실행은 파일을 바꾸지 않는다", async (t) => {
  const repository = await fixture(t);
  for (const [overrides, message] of [
    [{ RELEASE_BUMP: "patch && echo invalid" }, /버전 증가 종류/],
    [{ GITHUB_REF: "refs/heads/feature" }, /main 브랜치/],
    [{ GITHUB_EVENT_NAME: "push" }, /main 브랜치/],
    [{ GITHUB_SHA: "invalid" }, /실행 정보/],
    [{ GITHUB_SHA: "a".repeat(40) }, /원본 커밋/],
  ]) {
    fails(await run(repository, "prepare", overrides), message);
    assert.equal(git(repository.cwd, "status", "--porcelain"), "");
  }
});

test("작업트리 변경과 버전 불일치를 거부한다", async (t) => {
  const repository = await fixture(t);
  writeFileSync(join(repository.cwd, "README.md"), "미커밋 변경\n", "utf8");
  fails(await run(repository, "prepare"), /작업트리가 깨끗하지/);
  git(repository.cwd, "restore", "README.md");
  writeFileSync(join(repository.cwd, files[1]), '{"version":"9.0.0"}\n', "utf8");
  git(repository.cwd, "add", files[1]);
  git(repository.cwd, "commit", "-m", "Mismatched version");
  git(repository.cwd, "push", "origin", "main");
  repository.env.GITHUB_SHA = git(repository.cwd, "rev-parse", "HEAD");
  fails(await run(repository, "prepare"), /정식 버전이 모두 일치/);
});

test("다른 배포가 만든 기존 태그를 덮어쓰지 않는다", async (t) => {
  const repository = await fixture(t);
  git(repository.cwd, "tag", "v0.1.3");
  git(repository.cwd, "push", "origin", "v0.1.3");
  fails(await run(repository, "prepare"), /원본 커밋이 이번 실행과 다릅니다/);
  assert.equal(remoteRef(repository, "refs/tags/v0.1.3"), repository.sourceSha);
  assert.equal(git(repository.cwd, "status", "--porcelain"), "");
});

test("배포 준비 전이나 검증 중 main 변경을 감지하면 태그를 올리지 않는다", async (t) => {
  const repository = await fixture(t);
  succeeds(await run(repository, "prepare"));
  const nextSha = advanceMain(repository);
  fails(await run(repository, "publish"), /검증 중 main이 변경/);
  assert.equal(remoteRef(repository, "refs/heads/main"), nextSha);
  assert.equal(remoteRef(repository, "refs/tags/v0.1.3"), "");
  git(repository.cwd, "restore", ".");
  fails(await run(repository, "prepare"), /main이 변경/);
  assert.equal(git(repository.cwd, "status", "--porcelain"), "");
});

test("검증 과정에서 버전 외 파일이나 설정이 바뀌면 게시하지 않는다", async (t) => {
  const repository = await fixture(t);
  succeeds(await run(repository, "prepare"));
  writeFileSync(join(repository.cwd, "unexpected.txt"), "추가 파일\n", "utf8");
  fails(await run(repository, "publish"), /버전 파일 외의 변경/);
  rmSync(join(repository.cwd, "unexpected.txt"));
  const packageJson = JSON.parse(readFileSync(join(repository.cwd, files[0]), "utf8"));
  packageJson.name = "unexpected";
  writeFileSync(
    join(repository.cwd, files[0]),
    JSON.stringify(packageJson, null, 2) + "\n",
    "utf8"
  );
  fails(await run(repository, "publish"), /버전 변경 외의 수정/);
  assert.equal(remoteRef(repository, "refs/heads/main"), repository.sourceSha);
  assert.equal(remoteRef(repository, "refs/tags/v0.1.3"), "");
});

test("PR 생성 권한이 없으면 main과 태그를 바꾸지 않고 같은 실행에서 복구한다", async (t) => {
  const repository = await fixture(t);
  repository.api.denyCreate = true;
  succeeds(await run(repository, "prepare"));
  fails(await run(repository, "publish"), /403|권한|pull request|PR/);
  assert.equal(remoteRef(repository, "refs/heads/main"), repository.sourceSha);
  assert.equal(remoteRef(repository, "refs/tags/v0.1.3"), "");
  const releaseBranchSha = remoteRef(repository, "refs/heads/codex/release-12345");
  assert.match(releaseBranchSha, /^[a-f0-9]{40}$/);
  assert.equal(repository.api.pulls.length, 0);
  const retry = join(repository.directory, "retry");
  git(repository.directory, "clone", repository.remote, retry);
  git(retry, "checkout", "--detach", repository.sourceSha);
  const rerun = { ...repository, cwd: retry };
  repository.api.denyCreate = false;
  succeeds(await run(rerun, "prepare"));
  succeeds(await run(rerun, "publish"));
  assert.equal(remoteRef(repository, "refs/heads/codex/release-12345"), releaseBranchSha);
  assert.equal(repository.api.pulls.length, 1);
  assert.equal(repository.api.mergeCount, 1);
  assert.equal(remoteRef(repository, "refs/tags/v0.1.3"), repository.api.pulls[0].merge_commit_sha);
});

test("PR 병합 뒤 태그 push 실패는 같은 실행 재시도로 중복 PR·병합 없이 복구한다", async (t) => {
  const repository = await fixture(t);
  succeeds(await run(repository, "prepare"));
  // Git for Windows에도 포함된 sh를 사용해 태그만 거부하는 서버 규칙을 흉내 냅니다.
  writeFileSync(
    join(repository.remote, "hooks", "update"),
    '#!/bin/sh\ncase "$1" in refs/tags/*) exit 1;; esac\nexit 0\n',
    { encoding: "utf8", mode: 0o755 }
  );
  fails(await run(repository, "publish"), /git push|태그/);
  const mergedSha = repository.api.pulls[0].merge_commit_sha;
  assert.notEqual(mergedSha, repository.sourceSha);
  assert.equal(remoteRef(repository, "refs/heads/main"), mergedSha);
  assert.equal(remoteRef(repository, "refs/tags/v0.1.3"), "");
  rmSync(join(repository.remote, "hooks", "update"));
  const retry = join(repository.directory, "retry");
  git(repository.directory, "clone", repository.remote, retry);
  git(retry, "checkout", "--detach", repository.sourceSha);
  const rerun = { ...repository, cwd: retry };
  succeeds(await run(rerun, "prepare"));
  assert.equal(git(retry, "rev-parse", "HEAD"), mergedSha);
  succeeds(await run(rerun, "publish"));
  assert.equal(remoteRef(repository, "refs/tags/v0.1.3"), mergedSha);
  assert.equal(remoteRef(repository, "refs/tags/v0.1.4"), "");
  assert.equal(repository.api.pulls.length, 1);
  assert.equal(repository.api.mergeCount, 1);
});

test("PR 병합 직전 main이 바뀌면 병합 결과에 릴리스 태그를 만들지 않는다", async (t) => {
  const repository = await fixture(t);
  repository.api.raceBeforeMerge = true;
  succeeds(await run(repository, "prepare"));
  fails(await run(repository, "publish"), /원본 커밋|main|경합/);
  assert.equal(repository.api.mergeCount, 1);
  const mergedSha = repository.api.pulls[0].merge_commit_sha;
  assert.equal(remoteRef(repository, "refs/heads/main"), mergedSha);
  assert.notEqual(git(repository.remote, "rev-parse", `${mergedSha}^`), repository.sourceSha);
  assert.equal(remoteRef(repository, "refs/tags/v0.1.3"), "");
  const retry = join(repository.directory, "retry");
  git(repository.directory, "clone", repository.remote, retry);
  git(retry, "checkout", "--detach", repository.sourceSha);
  fails(await run({ ...repository, cwd: retry }, "prepare"), /원본 커밋|main|경합/);
  assert.equal(remoteRef(repository, "refs/tags/v0.1.3"), "");
});

test("detached SHA·CRLF 체크아웃에서 빈 줄을 보존하고 같은 실행 재시도 시 태그를 재사용한다", async (t) => {
  const repository = await fixture(t);
  for (const path of files.slice(2)) {
    const content = readFileSync(join(repository.cwd, path), "utf8");
    writeFileSync(join(repository.cwd, path), `${content}\n\n`, "utf8");
  }
  git(repository.cwd, "add", ".");
  git(repository.cwd, "commit", "-m", "Keep trailing blank lines");
  git(repository.cwd, "push", "origin", "main");
  repository.sourceSha = git(repository.cwd, "rev-parse", "HEAD");
  repository.env.GITHUB_SHA = repository.sourceSha;
  const detached = join(repository.directory, "detached");
  git(repository.directory, "clone", "--config", "core.autocrlf=true", repository.remote, detached);
  git(detached, "checkout", "--detach", repository.sourceSha);
  repository.cwd = detached;
  for (const path of files) assert.match(readFileSync(join(detached, path), "utf8"), /\r\n/);
  succeeds(await run(repository, "prepare"));
  succeeds(await run(repository, "publish"));
  for (const path of files.slice(2)) {
    assert.ok(readFileSync(join(detached, path), "utf8").endsWith("\r\n\r\n\r\n"));
  }
  const releaseSha = git(repository.cwd, "rev-parse", "HEAD");
  const advancedSha = advanceMain(repository);
  const retry = join(repository.directory, "retry");
  git(repository.directory, "clone", "--config", "core.autocrlf=true", repository.remote, retry);
  git(retry, "checkout", "--detach", repository.sourceSha);
  const rerun = { ...repository, cwd: retry };
  succeeds(await run(rerun, "prepare"));
  assert.equal(git(retry, "rev-parse", "HEAD"), releaseSha);
  assert.match(readFileSync(repository.env.GITHUB_OUTPUT, "utf8"), /reused=true/);
  succeeds(await run(rerun, "publish"));
  assert.equal(remoteRef(repository, "refs/heads/main"), advancedSha);
  assert.equal(remoteRef(repository, "refs/tags/v0.1.3"), releaseSha);
  assert.equal(remoteRef(repository, "refs/tags/v0.1.4"), "");
  git(retry, "checkout", "--detach", repository.sourceSha);
  fails(await run(rerun, "prepare", { GITHUB_RUN_ID: "98765" }), /다른 실행에서 생성/);
});

test("시험판 버전은 정식 버전 증가 버튼에서 거부한다", async (t) => {
  const repository = await fixture(t, "1.0.0-beta.1");
  fails(await run(repository, "prepare"), /정식 버전이 모두 일치/);
  assert.equal(git(repository.cwd, "status", "--porcelain"), "");
});
