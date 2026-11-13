import { mergeConfig } from "vite";
import baseConfig from "./vite.config.js";

// 테스트 브라우저가 실행 중인 개발 앱의 HMR 서버에 연결되지 않게 격리합니다.
export default mergeConfig(baseConfig, {
  server: {
    hmr: false,
    watch: {
      usePolling: false,
      ignored: ["**/src-tauri/**", "**/test-results/**"],
    },
  },
});
