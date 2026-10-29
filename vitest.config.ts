import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    // 规则引擎和服务端逻辑都是纯函数，用 node 环境跑；组件测试以后需要时再单独配 jsdom
    environment: "node",
    include: ["src/**/*.test.ts", "mcp/**/*.test.ts", "scripts/**/*.test.ts"],
    // 地基阶段还没有测试文件，先允许空跑；T07 规则用例写进来后去掉这一行
    passWithNoTests: true,
  },
});
