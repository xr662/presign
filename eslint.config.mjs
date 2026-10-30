import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier/flat";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // 格式交给 Prettier，关掉和它冲突的 ESLint 规则
  prettier,
  globalIgnores([".next/**", "out/**", "build/**", "next-env.d.ts", "data/build/**", "public/vendor/**"]),
]);

export default eslintConfig;
