#!/usr/bin/env bash
# 本机打包部署产物（项目方案第 11 节：服务器上不构建、不装依赖）。在 presign/ 下运行：bash deploy/pack.sh
# 产物：deploy/build/presign.tar.gz，里面是 web/（Next standalone）和 mcp/（单文件服务 + 法规库 + 向量模型）。
set -euo pipefail
cd "$(dirname "$0")/.."

OUT=deploy/build
rm -rf "$OUT"
mkdir -p "$OUT/web" "$OUT/mcp"

# 网站：standalone 不会自带 .next/static 和 public，要自己拷（Next 文档的要求）
npm run build
cp -r .next/standalone/. "$OUT/web/"
mkdir -p "$OUT/web/.next"
cp -r .next/static "$OUT/web/.next/static"
cp -r public "$OUT/web/public"

# MCP 服务：esbuild 打成单文件。onnxruntime-web 不打进去（它按自己的路径找 wasm），只带 Node 下要用的 4 个文件
npx -y --cache "${NPM_CACHE:-D:/npm-cache}" esbuild@0.25.11 deploy/mcp-entry.ts \
  --bundle --platform=node --format=esm --target=node24 \
  --external:onnxruntime-web \
  --banner:js="import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);" \
  --outfile="$OUT/mcp/server.mjs"
ORT="$OUT/mcp/node_modules/onnxruntime-web"
mkdir -p "$ORT/dist"
cp node_modules/onnxruntime-web/package.json "$ORT/"
for f in ort.node.min.mjs ort-wasm-simd-threaded.mjs ort-wasm-simd-threaded.wasm; do
  cp "node_modules/onnxruntime-web/dist/$f" "$ORT/dist/"
done
# ort.node.min.mjs 还要 import onnxruntime-common（10-31 第一次部署时缺了它，服务起不来）
COMMON="$OUT/mcp/node_modules/onnxruntime-common"
mkdir -p "$COMMON/dist"
cp node_modules/onnxruntime-common/package.json "$COMMON/"
cp -r node_modules/onnxruntime-common/dist/esm "$COMMON/dist/esm"
mkdir -p "$OUT/mcp/data/build" "$OUT/mcp/data/clean/wage"
cp data/build/law.db "$OUT/mcp/data/build/"
cp data/clean/wage/min_wage.json "$OUT/mcp/data/clean/wage/"
cp -r models "$OUT/mcp/models"

tar -czf "$OUT/presign.tar.gz" -C "$OUT" web mcp
du -sh "$OUT/presign.tar.gz"
