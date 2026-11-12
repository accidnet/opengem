import { execFileSync } from "node:child_process";
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const versionFiles = [
  "package.json",
  "src-tauri/tauri.conf.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
];
const stableVersion = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const cargoVersion = /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/;
const lockVersion = /(\[\[package\]\]\r?\nname = "opengem"\r?\nversion = ")([^"]+)(")/;

function gitRaw(...args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const hint =
      args[0] === "push" ? " contents: write 권한과 브랜치·태그 보호 규칙을 확인하세요." : "";
    throw new Error(`git ${args[0]} 실행에 실패했습니다 (종료 코드 ${error.status}).${hint}`);
  }
}

function git(...args) {
  return gitRaw(...args).trim();
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function normalize(text) {
  return text.replace(/\r\n/g, "\n");
}

function readVersions(read) {
  const contents = Object.fromEntries(versionFiles.map((path) => [path, read(path)]));
  const versions = [
    JSON.parse(contents[versionFiles[0]]).version,
    JSON.parse(contents[versionFiles[1]]).version,
    contents[versionFiles[2]].match(cargoVersion)?.[2],
    contents[versionFiles[3]].match(lockVersion)?.[2],
  ];
  const version = versions[0];
  requireCondition(
    typeof version === "string" &&
      stableVersion.test(version) &&
      versions.every((value) => value === version),
    "package.json, Tauri, Cargo.toml, Cargo.lock의 정식 버전이 모두 일치해야 합니다."
  );
  return { version, contents };
}

function bumpedVersion(version, bump) {
  const parts = version.split(".").map(Number);
  const index = { major: 0, minor: 1, patch: 2 }[bump];
  parts[index] += 1;
  for (let i = index + 1; i < parts.length; i += 1) parts[i] = 0;
  requireCondition(parts.every(Number.isSafeInteger), "버전 숫자가 지원 범위를 초과했습니다.");
  return parts.join(".");
}

function updatedContents(contents, version) {
  return Object.fromEntries(
    versionFiles.map((path, index) => {
      const source = contents[path];
      if (index < 2) {
        const data = JSON.parse(source);
        data.version = version;
        const eol = source.includes("\r\n") ? "\r\n" : "\n";
        return [path, `${JSON.stringify(data, null, 2)}\n`.replace(/\n/g, eol)];
      }
      const pattern = index === 2 ? cargoVersion : lockVersion;
      return [
        path,
        source.replace(pattern, (_, prefix, _previous, suffix) => `${prefix}${version}${suffix}`),
      ];
    })
  );
}

function assertContents(expected, read) {
  for (const path of versionFiles) {
    requireCondition(
      normalize(read(path)) === normalize(expected[path]),
      `${path}에 버전 변경 외의 수정이 있습니다.`
    );
  }
}

function requireClean() {
  requireCondition(!git("status", "--porcelain"), "작업트리가 깨끗하지 않습니다.");
}

function remoteMain() {
  return git("ls-remote", "origin", "refs/heads/main").split(/\s+/)[0];
}

function verifyReleaseCommit(tag, sourceSha, runId, expected) {
  const commit = git("rev-parse", `${tag}^{commit}`);
  const parents = git("rev-list", "--parents", "-n", "1", commit).split(" ");
  requireCondition(
    parents.length === 2 && parents[1] === sourceSha,
    `${tag}의 원본 커밋이 이번 실행과 다릅니다.`
  );
  const message = git("show", "-s", "--format=%B", commit);
  requireCondition(
    message.split(/\r?\n/).includes(`OpenGem-Release-Run: ${runId}`),
    `${tag}는 다른 실행에서 생성한 태그입니다.`
  );
  const changed = git("diff", "--name-only", "-z", sourceSha, commit).split("\0").filter(Boolean);
  requireCondition(
    changed.length === versionFiles.length && changed.every((path) => versionFiles.includes(path)),
    `${tag}에 릴리스 버전 외의 변경이 있습니다.`
  );
  assertContents(expected, (path) => gitRaw("show", `${commit}:${path}`));
  return commit;
}

function writeState(state) {
  writeFileSync(
    git("rev-parse", "--git-path", "opengem-release.json"),
    JSON.stringify(state),
    "utf8"
  );
}

function output(state) {
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `tag=${state.tag}\nreused=${state.reused}\n`, "utf8");
  }
  console.log(
    `${state.tag}: ${state.reused ? "기존 릴리스 커밋 재사용" : "릴리스 버전 준비 완료"}`
  );
}

async function github(context, method, path, body) {
  const base = new URL(process.env.GITHUB_API_URL || "https://api.github.com");
  requireCondition(
    base.protocol === "https:" ||
      (base.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(base.hostname)),
    "GitHub API 주소는 HTTPS여야 합니다."
  );
  let response;
  try {
    response = await fetch(`${base.href.replace(/\/$/, "")}/repos/${context.repository}${path}`, {
      method,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${process.env.GITHUB_TOKEN}`,
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
  } catch {
    throw new Error(
      "GitHub API 연결에 실패했습니다. 네트워크를 확인하고 같은 실행을 재시도하세요."
    );
  }
  if (!response.ok) {
    const hint =
      method === "POST"
        ? "Actions의 PR 생성 허용 설정과 pull-requests: write 권한을 확인하세요."
        : method === "PUT"
          ? "PR 병합 권한, main 보호 규칙과 필수 검사를 확인한 뒤 같은 실행을 재시도하세요."
          : "GITHUB_TOKEN의 저장소 읽기 권한을 확인하세요.";
    throw new Error(`GitHub API ${method} 요청 실패 (HTTP ${response.status}). ${hint}`);
  }
  return response.json();
}

async function findPullRequest(context) {
  const query = new URLSearchParams({
    state: "all",
    head: `${context.repository.split("/")[0]}:${context.branch}`,
    base: "main",
    per_page: "100",
  });
  const pulls = await github(context, "GET", `/pulls?${query}`);
  requireCondition(
    Array.isArray(pulls) && pulls.length <= 1,
    "이번 실행의 릴리스 PR을 하나로 확인할 수 없습니다."
  );
  const pull = pulls[0];
  if (pull) {
    requireCondition(
      pull.head?.ref === context.branch &&
        pull.base?.ref === "main" &&
        (!pull.head.repo || pull.head.repo.full_name === context.repository),
      "릴리스 PR의 원본 브랜치나 저장소가 다릅니다."
    );
    requireCondition(
      pull.state === "open" || pull.merged_at,
      "릴리스 PR이 병합되지 않고 닫혔습니다. 최신 main에서 새 배포를 실행하세요."
    );
  }
  return pull;
}

async function waitForMergeable(pull, context, headSha) {
  // GitHub가 새 PR의 병합 가능 여부를 계산하는 동안만 짧게 기다립니다.
  for (const delay of [0, 1000, 2000, 4000]) {
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    pull = await github(context, "GET", `/pulls/${pull.number}`);
    requireCondition(
      pull.head?.sha === headSha && pull.head?.ref === context.branch && pull.base?.ref === "main",
      "병합 대기 중 릴리스 PR의 커밋이나 브랜치가 변경되었습니다."
    );
    if (pull.merged_at) return pull;
    requireCondition(pull.state === "open", "릴리스 PR이 병합되지 않고 닫혔습니다.");
    if (pull.mergeable === true) return pull;
    requireCondition(
      pull.mergeable === null,
      "릴리스 PR에 충돌이 있어 병합할 수 없습니다. 최신 main에서 새 배포를 실행하세요."
    );
  }
  throw new Error(
    "GitHub의 PR 병합 가능 여부 계산이 완료되지 않았습니다. 같은 실행을 재시도하세요."
  );
}

function mergedCommit(pull, context, expected) {
  const sha = pull.merge_commit_sha;
  requireCondition(
    pull.merged_at && /^[a-f0-9]{40}$/.test(sha ?? ""),
    "병합된 릴리스 PR 커밋을 확인할 수 없습니다."
  );
  git("fetch", "origin", sha);
  try {
    return verifyReleaseCommit(sha, context.sourceSha, context.runId, expected);
  } catch (error) {
    throw new Error(
      `${error.message} PR 병합 중 main이 변경되었을 수 있습니다. 태그를 만들지 않았으니 최신 main에서 새 배포를 실행하세요.`
    );
  }
}

function publishTag(state) {
  const remoteTag = git("ls-remote", "origin", `refs/tags/${state.tag}`).split(/\s+/)[0];
  requireCondition(
    !remoteTag || remoteTag === state.releaseSha,
    "원격 릴리스 태그가 다른 커밋을 가리킵니다."
  );
  if (!remoteTag) {
    if (git("tag", "--list", state.tag)) {
      requireCondition(
        git("rev-parse", state.tag) === state.releaseSha,
        "로컬 릴리스 태그가 다른 커밋을 가리킵니다."
      );
    } else {
      git("tag", state.tag, state.releaseSha);
    }
    git("push", "origin", `refs/tags/${state.tag}`);
  }
  writeState({ ...state, reused: true, tagPublished: true });
  console.log(`릴리스 PR과 태그를 게시했습니다: ${state.tag}`);
}

async function prepare(context) {
  requireClean();
  requireCondition(
    git("rev-parse", "HEAD") === context.sourceSha,
    "체크아웃한 커밋이 이번 실행의 원본 커밋과 다릅니다."
  );
  const source = readVersions((path) => readFileSync(path, "utf8"));
  const version = bumpedVersion(source.version, context.bump);
  const tag = `v${version}`;
  const expected = updatedContents(source.contents, version);
  git("fetch", "origin", "--tags");
  const exists = git("tag", "--list", tag);
  const state = {
    ...context,
    tag,
    version,
    reused: Boolean(exists),
    tagPublished: Boolean(exists),
  };
  if (exists) {
    // 같은 Actions 실행을 재시도할 때 이미 올린 버전을 다시 증가시키지 않습니다.
    state.releaseSha = verifyReleaseCommit(tag, context.sourceSha, context.runId, expected);
    const remoteTag = git("ls-remote", "origin", `refs/tags/${tag}`).split(/\s+/)[0];
    requireCondition(
      remoteTag === state.releaseSha,
      `${tag}가 원격의 동일한 릴리스 태그가 아닙니다.`
    );
    git("checkout", "--detach", tag);
  } else {
    const pull = await findPullRequest(context);
    if (pull?.merged_at) {
      // PR 병합 뒤 태그 업로드가 실패한 경우에도 동일 버전을 이어서 배포합니다.
      state.releaseSha = mergedCommit(pull, context, expected);
      state.reused = true;
      git("checkout", "--detach", state.releaseSha);
    } else {
      requireCondition(
        remoteMain() === context.sourceSha,
        "main이 변경되었습니다. 최신 main에서 새 배포를 실행하세요."
      );
      const branch = `origin/${context.branch}`;
      if (git("branch", "--remotes", "--list", branch)) {
        state.branchSha = verifyReleaseCommit(branch, context.sourceSha, context.runId, expected);
        git("checkout", "--detach", state.branchSha);
      } else {
        for (const path of versionFiles) writeFileSync(path, expected[path], "utf8");
      }
    }
  }
  writeState(state);
  output(state);
}

async function publish(context) {
  const state = JSON.parse(
    readFileSync(git("rev-parse", "--git-path", "opengem-release.json"), "utf8")
  );
  requireCondition(
    ["sourceSha", "runId", "bump", "repository", "branch"].every(
      (key) => state[key] === context[key]
    ),
    "준비한 릴리스와 현재 실행 정보가 다릅니다."
  );
  const source = readVersions((path) => gitRaw("show", `${context.sourceSha}:${path}`));
  const version = bumpedVersion(source.version, context.bump);
  requireCondition(
    state.version === version && state.tag === `v${version}`,
    "준비한 릴리스 버전 정보가 올바르지 않습니다."
  );
  const expected = updatedContents(source.contents, version);
  assertContents(expected, (path) => readFileSync(path, "utf8"));
  if (state.releaseSha) {
    requireClean();
    requireCondition(
      git("rev-parse", "HEAD") === state.releaseSha,
      "재사용할 릴리스 커밋이 변경되었습니다."
    );
    verifyReleaseCommit(state.releaseSha, context.sourceSha, context.runId, expected);
    publishTag(state);
    return;
  }
  requireCondition(
    git("rev-parse", "HEAD") === (state.branchSha || context.sourceSha),
    "검증 중 원본 커밋이 변경되었습니다."
  );
  const changed = [
    ...git("diff", "--name-only", "-z", "HEAD").split("\0"),
    ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0"),
  ].filter(Boolean);
  requireCondition(
    changed.every((path) => versionFiles.includes(path)),
    "버전 파일 외의 변경이 있어 배포를 중단합니다."
  );
  requireCondition(
    remoteMain() === context.sourceSha,
    "검증 중 main이 변경되었습니다. 최신 main에서 새 배포를 실행하세요."
  );
  if (state.branchSha) {
    requireClean();
    verifyReleaseCommit(state.branchSha, context.sourceSha, context.runId, expected);
  } else {
    git("add", "--", ...versionFiles);
    git(
      "-c",
      "user.name=github-actions[bot]",
      "-c",
      "user.email=41898282+github-actions[bot]@users.noreply.github.com",
      "commit",
      "-m",
      `Release ${state.tag}`,
      "-m",
      `OpenGem-Release-Run: ${context.runId}`
    );
    state.branchSha = git("rev-parse", "HEAD");
    writeState(state);
  }
  // main 보호 규칙을 유지하고 같은 실행의 전용 PR로 버전 변경을 병합합니다.
  git("push", "origin", `HEAD:refs/heads/${context.branch}`);
  let pull = await findPullRequest(context);
  if (!pull) {
    pull = await github(context, "POST", "/pulls", {
      head: context.branch,
      base: "main",
      title: `Release ${state.tag}`,
      body: `배포 버튼으로 준비한 ${state.tag} 버전 변경입니다.\n\nActions 실행: ${context.runId}\n원본 커밋: ${context.sourceSha}`,
    });
  }
  requireCondition(
    pull.head?.sha === state.branchSha,
    "릴리스 PR의 커밋이 검증한 버전 변경과 다릅니다."
  );
  if (!pull.merged_at) pull = await waitForMergeable(pull, context, state.branchSha);
  if (!pull.merged_at) {
    requireCondition(
      remoteMain() === context.sourceSha,
      "PR 병합 전 main이 변경되었습니다. 최신 main에서 새 배포를 실행하세요."
    );
    const merged = await github(context, "PUT", `/pulls/${pull.number}/merge`, {
      sha: state.branchSha,
      merge_method: "squash",
      commit_title: `Release ${state.tag}`,
      commit_message: `OpenGem-Release-Run: ${context.runId}`,
    });
    requireCondition(
      merged.merged,
      "릴리스 PR을 병합하지 못했습니다. main 보호 규칙과 필수 검사를 확인하고 같은 실행을 재시도하세요."
    );
    pull = { ...pull, merged_at: true, merge_commit_sha: merged.sha };
  }
  state.releaseSha = mergedCommit(pull, context, expected);
  state.reused = true;
  git("checkout", "--detach", state.releaseSha);
  writeState(state);
  publishTag(state);
}

try {
  const mode = process.argv[2];
  requireCondition(
    mode === "prepare" || mode === "publish",
    "사용법: node scripts/prepare-release.mjs prepare|publish"
  );
  requireCondition(
    process.env.GITHUB_EVENT_NAME === "workflow_dispatch" &&
      process.env.GITHUB_REF === "refs/heads/main",
    "배포 버튼은 main 브랜치에서만 실행할 수 있습니다."
  );
  const context = {
    bump: process.env.RELEASE_BUMP,
    sourceSha: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID,
    repository: process.env.GITHUB_REPOSITORY,
  };
  requireCondition(
    ["patch", "minor", "major"].includes(context.bump),
    "버전 증가 종류는 patch, minor, major 중 하나여야 합니다."
  );
  requireCondition(
    /^[a-f0-9]{40}$/.test(context.sourceSha ?? "") && /^\d+$/.test(context.runId ?? ""),
    "GitHub Actions 실행 정보가 올바르지 않습니다."
  );
  requireCondition(
    /^[\w.-]+\/[\w.-]+$/.test(context.repository ?? "") && process.env.GITHUB_TOKEN,
    "GITHUB_REPOSITORY와 GITHUB_TOKEN을 설정하세요."
  );
  context.branch = `codex/release-${context.runId}`;
  if (mode === "prepare") await prepare(context);
  else await publish(context);
} catch (error) {
  console.error(`release: ${error.message}`);
  process.exitCode = 1;
}
