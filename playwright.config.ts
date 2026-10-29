import { defineConfig } from "@playwright/test";

// 端到端测试用本机已装的 Edge（channel: msedge），不再下载一套浏览器，省 C 盘空间。
// 模型响应用录好的文件回放（T10），所以每次结果一样，也不消耗额度。
export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: [["list"]],
  use: {
    channel: "msedge",
    baseURL: "http://localhost:3000",
    viewport: { width: 1440, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: "npm run start",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
