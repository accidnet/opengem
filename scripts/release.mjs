#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import process from "node:process";

const version = process.argv[2];
const versionPattern = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

function run(command, args, options = {}) {
  return execFileSync(command, args, {
    encoding: "utf-8",
    stdio: options.capture ? ["ignore", "pipe", "pipe"] : "inherit",
    ...options,
  });
}

function fail(message) {
  console.error(`release: ${message}`);
  process.exit(1);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf-8"));
}

function writeJson(path, value) {
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf-8");
}

function updatePackageJson(nextVersion) {
  const packageJson = readJson("package.json");
  packageJson.version = nextVersion;
  writeJson("package.json", packageJson);
}

function updateTauriConfig(nextVersion) {
  const tauriConfig = readJson("src-tauri/tauri.conf.json");
  tauriConfig.version = nextVersion;
  writeJson("src-tauri/tauri.conf.json", tauriConfig);
}

function updateCargoToml(nextVersion) {
  const path = "src-tauri/Cargo.toml";
  const cargoToml = readFileSync(path, "utf-8");
  const nextCargoToml = cargoToml.replace(
    /(\[package\][\s\S]*?\nversion\s*=\s*")([^"]+)(")/,
    `$1${nextVersion}$3`
  );

  if (nextCargoToml === cargoToml) {
    fail("src-tauri/Cargo.toml의 package version을 찾지 못했습니다.");
  }

  writeFileSync(path, nextCargoToml, "utf-8");
}

if (!version || !versionPattern.test(version)) {
  fail("사용법: pnpm run release -- 0.1.1");
}

const tagName = `v${version}`;
const branch = run("git", ["branch", "--show-current"], { capture: true }).trim();
if (branch !== "main") {
  fail(`main 브랜치에서만 릴리즈할 수 있습니다. 현재 브랜치: ${branch || "(detached)"}`);
}

const status = run("git", ["status", "--porcelain"], { capture: true }).trim();
if (status) {
  fail("작업트리가 깨끗하지 않습니다. 변경사항을 먼저 커밋하거나 정리하세요.");
}

run("git", ["fetch", "origin", "--tags"]);

const localTag = run("git", ["tag", "--list", tagName], { capture: true }).trim();
if (localTag) {
  fail(`이미 로컬 태그가 있습니다: ${tagName}`);
}

try {
  run("git", ["ls-remote", "--exit-code", "--tags", "origin", tagName], { capture: true });
  fail(`이미 원격 태그가 있습니다: ${tagName}`);
} catch (error) {
  if (error.status !== 2) {
    throw error;
  }
}

console.log(`== release ${tagName} ==`);
updatePackageJson(version);
updateCargoToml(version);
updateTauriConfig(version);

run("cargo", ["check"], { cwd: "src-tauri" });
run("pnpm", ["run", "build"]);

run("git", [
  "add",
  "package.json",
  "src-tauri/Cargo.toml",
  "src-tauri/Cargo.lock",
  "src-tauri/tauri.conf.json",
]);
run("git", ["commit", "-m", `Release ${tagName}`]);
run("git", ["push", "origin", "main"]);
run("git", ["tag", tagName]);
run("git", ["push", "origin", tagName]);

console.log(`Release tag pushed: ${tagName}`);
