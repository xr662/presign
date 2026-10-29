// 下载 data/sources.json 里列的官方页面，原样存到 data/raw/（不进仓库，是缓存）。
// 已经下载过的跳过，加 --refresh 重新下载。主地址失败时按 fallbackUrls 依次再试。
// 用法：node scripts/corpus/fetch.ts [--refresh]
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

type Entry = { id: string; url: string; fallbackUrls?: string[] };

const RAW = "data/raw";
const refresh = process.argv.includes("--refresh");
const cfg = JSON.parse(readFileSync("data/sources.json", "utf8")) as {
  sources: Entry[];
  cases: Entry[];
};
mkdirSync(RAW, { recursive: true });

// 有的政府网站会拒绝没有浏览器标识的请求
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36",
  "Accept-Language": "zh-CN,zh;q=0.9",
};

let failed = 0;
for (const e of [...cfg.sources, ...cfg.cases]) {
  const file = `${RAW}/${e.id}.html`;
  if (existsSync(file) && !refresh) {
    console.log(`跳过 ${e.id}（已缓存）`);
    continue;
  }
  let ok = false;
  for (const url of [e.url, ...(e.fallbackUrls ?? [])]) {
    try {
      const res = await fetch(url, {
        headers: HEADERS,
        redirect: "follow",
        signal: AbortSignal.timeout(40_000),
      });
      const buf = new Uint8Array(await res.arrayBuffer());
      if (!res.ok || buf.length < 2000) {
        console.log(`  ${e.id} ${url} → ${res.status}，${buf.length} 字节，换下一个地址`);
        continue;
      }
      writeFileSync(file, buf);
      writeFileSync(
        `${RAW}/${e.id}.meta.json`,
        JSON.stringify(
          { url, status: res.status, bytes: buf.length, fetchedAt: new Date().toISOString() },
          null,
          2,
        ),
      );
      console.log(`下载 ${e.id}：${buf.length} 字节`);
      ok = true;
      break;
    } catch (err) {
      console.log(`  ${e.id} ${url} → ${(err as Error).message}`);
    }
  }
  if (!ok) failed++;
}
if (failed) {
  console.log(`\n${failed} 个来源下载失败`);
  process.exit(1);
}
