import process from "node:process";
import { defineConfig } from "@playwright/test";

// 독립 포트와 소프트웨어 WebGL로 실제 오피스 입력을 재현합니다.
export default defineConfig({
  testDir: "./tests/office",
  timeout: 30_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:4175",
    viewport: { width: 1280, height: 1000 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    launchOptions: { args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"] },
  },
  webServer: {
    command:
      '"' +
      process.execPath +
      '" node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4175 --strictPort',
    url: "http://127.0.0.1:4175/tests/office/index.html",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
