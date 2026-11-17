// 构建后检查：/api/ 下的接口都不能被预渲染成静态文件。
// 开了 cacheComponents，GET 接口如果没调用 connection() 这类动态 API，构建时会被执行一次、结果存成 .body 文件，
// 之后每次请求都返回这份固定内容。11-17 /api/session 因此永远返回"没登录"（见 src/app/api/session/route.ts）。
import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const dir = ".next/server/app/api";
if (!existsSync(dir)) {
  console.error("没有找到构建产物，先运行 npm run build");
  process.exit(1);
}
const frozen = readdirSync(dir).filter((f) => f.endsWith(".body"));
if (frozen.length) {
  console.error(`这些接口被预渲染成了静态文件，请在 GET 里先 await connection()：`);
  for (const f of frozen) console.error(`  /api/${f.replace(/\.body$/, "")}（${join(dir, f)}）`);
  process.exit(1);
}
console.log("接口检查通过：/api/ 下没有预渲染的接口。");
