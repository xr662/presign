import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 接真实接口的测试，只在手动执行 npm run test:live 时跑。
// 单独写一份，不和 vitest.config.ts 合并：合并会把两边的 include / exclude 数组拼在一起
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.live.test.ts"],
    testTimeout: 60_000,
  },
});
