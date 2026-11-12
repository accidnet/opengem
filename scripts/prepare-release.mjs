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
const commitSha = /^[a-f0-9]{40}$/;
const cargoVersion = /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/;
const lockVersion = /(\[\[package\]\]\r?\nname = "opengem"\r?\nversion = ")([^"]+)(")/;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function gitRaw(...args) {
  try {
    return execFileSync("git", args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (error) {
    const hint = args[0] === "push" ? " contents: write 권한과 태그 보호 규칙을 확인하세요." : "";
    throw new Error(`git ${args[0]} 실행에 실패했습니다 (종료 코드 ${error.status}).${hint}`);
  }
}

function git(...args) {
  return gitRaw(...args).trim();
}

function requireVersion(version) {
  requireCondition(
    stableVersion.test(version ?? "") &&
      version.split(".").every((part) => Number.isSafeInteger(Number(part))),
    "릴리스 버전은 0.1.3처럼 정식 x.y.z 형식이어야 합니다."
  );
  return version;
}

function requireCommit(sha) {
  requireCondition(commitSha.test(sha ?? ""), "배포 대상은 40자리 커밋 SHA여야 합니다.");
  requireCondition(git("cat-file", "-t", sha) === "commit", "배포 대상 SHA가 커밋이 아닙니다.");
  return sha;
}

function requireClean() {
  requireCondition(!git("status", "--porcelain"), "작업트리가 깨끗하지 않습니다.");
}

function remoteTagCommit(tag) {
  const reference = `refs/tags/${tag}`;
  const refs = new Map(
    git("ls-remote", "--tags", "origin", reference, `${reference}^{}`)
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [sha, name] = line.split(/\s+/);
        return [name, sha];
      })
  );
  // 주석 태그와 경량 태그 모두 최종 커밋으로 비교합니다.
  return refs.get(`${reference}^{}`) || refs.get(reference);
}

function checkTag(tag, sha) {
  if (git("tag", "--list", tag)) {
    requireCondition(
      git("rev-parse", `refs/tags/${tag}^{commit}`) === sha,
      `${tag} 태그가 다른 커밋을 가리킵니다.`
    );
  }
  const remote = remoteTagCommit(tag);
  requireCondition(!remote || remote === sha, `${tag} 원격 태그가 다른 커밋을 가리킵니다.`);
  return remote;
}

function resolveTarget() {
  const event = process.env.GITHUB_EVENT_NAME;
  const workflowSha = process.env.GITHUB_SHA?.trim().toLowerCase();
  requireCondition(
    commitSha.test(workflowSha ?? ""),
    "GitHub Actions 커밋 정보가 올바르지 않습니다."
  );
  let sha;
  let version;
  if (event === "workflow_dispatch") {
    requireCondition(
      process.env.GITHUB_REF === "refs/heads/main",
      "배포 버튼은 main의 workflow에서 실행하세요."
    );
    requireCondition(
      git("rev-parse", "HEAD") === workflowSha,
      "workflow 체크아웃이 실행 시점 커밋과 다릅니다."
    );
    version = requireVersion(process.env.RELEASE_VERSION?.trim());
    sha = (process.env.RELEASE_COMMIT?.trim() || workflowSha).toLowerCase();
    requireCondition(commitSha.test(sha), "배포 대상은 40자리 커밋 SHA여야 합니다.");
    git("fetch", "origin", "--tags");
    requireCommit(sha);
    requireCondition(
      git("merge-base", sha, workflowSha) === sha,
      "배포 대상 커밋은 실행 시점 main의 이력에 있어야 합니다."
    );
  } else {
    requireCondition(
      event === "push" && process.env.GITHUB_REF === `refs/tags/${process.env.GITHUB_REF_NAME}`,
      "배포 버튼 또는 v* 태그 push에서만 실행할 수 있습니다."
    );
    const tag = process.env.GITHUB_REF_NAME;
    requireCondition(tag?.startsWith("v"), "릴리스 태그는 v로 시작해야 합니다.");
    version = requireVersion(tag.slice(1));
    git("fetch", "origin", "--tags");
    sha = requireCommit(git("rev-parse", `${workflowSha}^{commit}`));
    requireCondition(
      remoteTagCommit(tag) === sha,
      "push한 태그의 원격 커밋이 실행 시점과 다릅니다."
    );
  }
  const tag = `v${version}`;
  checkTag(tag, sha);
  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(
      process.env.GITHUB_OUTPUT,
      `sha=${sha}\nversion=${version}\ntag=${tag}\n`,
      "utf8"
    );
  }
  console.log(`배포 대상 확정: ${tag} → ${sha}`);
}

function readVersions(read) {
  const contents = Object.fromEntries(versionFiles.map((path) => [path, read(path)]));
  const versions = [
    JSON.parse(contents[versionFiles[0]]).version,
    JSON.parse(contents[versionFiles[1]]).version,
    contents[versionFiles[2]].match(cargoVersion)?.[2],
    contents[versionFiles[3]].match(lockVersion)?.[2],
  ];
  requireCondition(
    typeof versions[0] === "string" &&
      stableVersion.test(versions[0]) &&
      versions.every((version) => version === versions[0]),
    "원본 package.json, Tauri, Cargo.toml, Cargo.lock의 정식 버전이 모두 일치해야 합니다."
  );
  return contents;
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

function releaseContext() {
  const version = requireVersion(process.env.RELEASE_VERSION?.trim());
  const sha = requireCommit(process.env.RELEASE_SOURCE_SHA?.trim().toLowerCase());
  requireCondition(
    git("rev-parse", "HEAD") === sha,
    "체크아웃한 커밋이 확정한 배포 대상과 다릅니다."
  );
  return { sha, version, tag: `v${version}` };
}

function prepare() {
  const context = releaseContext();
  requireClean();
  checkTag(context.tag, context.sha);
  const expected = updatedContents(
    readVersions((path) => readFileSync(path, "utf8")),
    context.version
  );
  // 태그는 원본 커밋에 붙이고 버전 메타데이터만 빌드 작업트리에 주입합니다.
  for (const path of versionFiles) writeFileSync(path, expected[path], "utf8");
  writeFileSync(
    git("rev-parse", "--git-path", "opengem-release.json"),
    JSON.stringify(context),
    "utf8"
  );
  console.log(`빌드 버전 준비: ${context.tag} (${context.sha})`);
}

function publish() {
  const context = releaseContext();
  const state = JSON.parse(
    readFileSync(git("rev-parse", "--git-path", "opengem-release.json"), "utf8")
  );
  requireCondition(
    ["sha", "version", "tag"].every((key) => state[key] === context[key]),
    "준비한 빌드와 현재 배포 대상 정보가 다릅니다."
  );
  const expected = updatedContents(
    readVersions((path) => gitRaw("show", `${context.sha}:${path}`)),
    context.version
  );
  for (const path of versionFiles) {
    requireCondition(
      readFileSync(path, "utf8").replace(/\r\n/g, "\n") === expected[path].replace(/\r\n/g, "\n"),
      `${path}에 빌드 버전 주입 외의 변경이 있습니다.`
    );
  }
  const changed = [
    ...git("diff", "--name-only", "-z", "HEAD").split("\0"),
    ...git("ls-files", "--others", "--exclude-standard", "-z").split("\0"),
  ].filter(Boolean);
  requireCondition(
    changed.every((path) => versionFiles.includes(path)),
    "버전 파일 외의 변경이 있어 배포를 중단합니다."
  );
  if (!checkTag(context.tag, context.sha)) {
    if (!git("tag", "--list", context.tag)) git("tag", context.tag, context.sha);
    git("push", "origin", `refs/tags/${context.tag}`);
  }
  requireCondition(
    remoteTagCommit(context.tag) === context.sha,
    "원격 릴리스 태그의 커밋을 확인할 수 없습니다."
  );
  console.log(`릴리스 태그 확정: ${context.tag} → ${context.sha}`);
}

try {
  const mode = process.argv[2];
  if (mode === "resolve") resolveTarget();
  else if (mode === "prepare") prepare();
  else if (mode === "publish") publish();
  else throw new Error("사용법: node scripts/prepare-release.mjs resolve|prepare|publish");
} catch (error) {
  console.error(`release: ${error.message}`);
  process.exitCode = 1;
}
