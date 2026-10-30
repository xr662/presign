// 把浏览器端识别要用的文件从 node_modules 拷到 public/vendor/（生成物，不进仓库）。
// dev、build 之前自动运行。浏览器只在用户上传照片或 PDF 时才下载这些文件。
//   ocr/  Tesseract.js 的 worker、WebAssembly 内核（只拷 LSTM 版，浏览器按支持的指令集选一个）、中文模型
//   pdf/  pdf.js 的 worker
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const files = [
  ["tesseract.js/dist/worker.min.js", "ocr/worker.min.js"],
  ["tesseract.js-core/tesseract-core-lstm.wasm.js", "ocr/core/tesseract-core-lstm.wasm.js"],
  [
    "tesseract.js-core/tesseract-core-simd-lstm.wasm.js",
    "ocr/core/tesseract-core-simd-lstm.wasm.js",
  ],
  [
    "tesseract.js-core/tesseract-core-relaxedsimd-lstm.wasm.js",
    "ocr/core/tesseract-core-relaxedsimd-lstm.wasm.js",
  ],
  // best_int 版 1.7MB；同包里的 4.0.0 目录是 20MB 的浮点版，用不上
  [
    "@tesseract.js-data/chi_sim/4.0.0_best_int/chi_sim.traineddata.gz",
    "ocr/lang/chi_sim.traineddata.gz",
  ],
  ["pdfjs-dist/build/pdf.worker.min.mjs", "pdf/pdf.worker.min.mjs"],
];

let missing = 0;
for (const [from, to] of files) {
  const src = `node_modules/${from}`;
  const dest = `public/vendor/${to}`;
  if (!existsSync(src)) {
    console.log(`缺少 ${src}，先 npm install`);
    missing++;
    continue;
  }
  mkdirSync(dirname(dest), { recursive: true });
  copyFileSync(src, dest);
}
if (missing) process.exit(1);
console.log(`public/vendor：${files.length} 个文件已就绪`);
