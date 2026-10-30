import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // 格式交给 Prettier，关掉和它冲突的 ESLint 规则
  prettier,
  // deploy/build 是 deploy/pack.sh 打出来的产物（压缩过的 Next 构建和单文件 MCP 服务），不是源码
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "data/build/**",
    "deploy/build/**",
    "public/vendor/**",
  ]),
]);

export default eslintConfig;
