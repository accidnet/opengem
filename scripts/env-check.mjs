#!/usr/bin/env node
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import process from "node:process";

function checkCommand(name) {
  try {
    const version = execSync(`${name} --version`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return { ok: true, version };
  } catch {
    return { ok: false, version: null };
  }
}

function checkPnpmCommand(command) {
  try {
    const version = execSync(`pnpm ${command}`, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return { ok: true, version };
  } catch {
    return { ok: false, version: null };
  }
}

const results = {
  nodeModules: existsSync("node_modules"),
  node: checkCommand("node"),
  pnpm: checkCommand("pnpm"),
  rustc: checkCommand("rustc"),
  cargo: checkCommand("cargo"),
  tauriCli: checkPnpmCommand("tauri --version"),
};

console.log("== env-check ==");
console.log(`node_modules: ${results.nodeModules ? "OK" : "MISSING"}`);
console.log(`node: ${results.node.ok ? `OK (${results.node.version})` : "NOT FOUND"}`);
console.log(`pnpm: ${results.pnpm.ok ? `OK (${results.pnpm.version})` : "NOT FOUND"}`);
console.log(`rustc: ${results.rustc.ok ? `OK (${results.rustc.version})` : "NOT FOUND"}`);
console.log(`cargo: ${results.cargo.ok ? `OK (${results.cargo.version})` : "NOT FOUND"}`);
console.log(`tauri-cli: ${results.tauriCli.ok ? `OK (${results.tauriCli.version})` : "NOT FOUND"}`);

if (!results.nodeModules) {
  console.log("Action: run `pnpm install`");
}

if (!results.rustc.ok || !results.cargo.ok) {
  console.log("Action: install Rust toolchain via https://rustup.rs");
}

if (!results.tauriCli.ok) {
  console.log("Action: pnpm install (@tauri-apps/cli is in devDependencies)");
}

const ok =
  results.node.ok &&
  results.pnpm.ok &&
  results.nodeModules &&
  results.rustc.ok &&
  results.cargo.ok &&
  results.tauriCli.ok;
if (!ok) {
  process.exitCode = 1;
}
