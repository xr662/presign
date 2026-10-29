// 下载向量模型 bge-small-zh-v1.5（BAAI 发布，MIT 许可；用 Xenova 转好的 ONNX 量化版，约 24MB）。
// 模型文件不进仓库，放 models/。第一次下载后把 SHA-256 写进 data/model-lock.json（进仓库），
// 之后在任何机器上下载都按这份哈希校验，文件被换掉就报错。
// 用法：node scripts/corpus/fetch-model.ts
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const REPO = "Xenova/bge-small-zh-v1.5";
const FILES = [
  "onnx/model_quantized.onnx",
  "tokenizer.json",
  "tokenizer_config.json",
  "config.json",
];
// 国内服务器上 huggingface.co 可能连不上，换镜像站
const HOSTS = ["https://huggingface.co", "https://hf-mirror.com"];
const DIR = "models/bge-small-zh-v1.5";
const LOCK = "data/model-lock.json";

type Lock = { repo: string; files: Record<string, { sha256: string; bytes: number }> };
const lock: Lock = existsSync(LOCK)
  ? (JSON.parse(readFileSync(LOCK, "utf8")) as Lock)
  : { repo: REPO, files: {} };

const sha256 = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");

for (const f of FILES) {
  const dest = `${DIR}/${f}`;
  mkdirSync(dirname(dest), { recursive: true });
  let buf: Uint8Array | null = existsSync(dest) ? new Uint8Array(readFileSync(dest)) : null;
  if (!buf) {
    for (const host of HOSTS) {
      try {
        const res = await fetch(`${host}/${REPO}/resolve/main/${f}`, {
          signal: AbortSignal.timeout(300_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        buf = new Uint8Array(await res.arrayBuffer());
        console.log(`下载 ${f}：${(buf.length / 1024 / 1024).toFixed(1)} MB（${host}）`);
        break;
      } catch (e) {
        console.log(`  ${f} ${host} 失败：${(e as Error).message}`);
      }
    }
  }
  if (!buf) {
    console.log(`× ${f} 下载失败`);
    process.exit(1);
  }
  const hash = sha256(buf);
  const want = lock.files[f]?.sha256;
  if (want && want !== hash) {
    console.log(`× ${f} 哈希不符：应为 ${want}，实际 ${hash}`);
    process.exit(1);
  }
  lock.files[f] = { sha256: hash, bytes: buf.length };
  writeFileSync(dest, buf);
}
writeFileSync(LOCK, JSON.stringify(lock, null, 2) + "\n");
console.log("模型文件就绪，哈希已校验");
