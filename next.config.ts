import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 部署目标是 2 核 2G 的服务器，服务器上不构建、不装依赖：
  // standalone 只打包运行时真正用到的文件，整个目录拷过去就能 node server.js 启动。
  output: "standalone",

  // 不走 Next 的图片优化，否则运行时要用到 sharp 这个原生模块，
  // Windows 上构建出的产物到 Linux 就跑不起来。页面里的图片在构建前压好。
  images: { unoptimized: true },

  // 静态外壳先出、动态部分流式补上；检查页的 SSE 本来就是动态路由，不受影响。
  // 两个开关 Next 16 要求同时显式写出。
  cacheComponents: true,
  partialPrefetching: true,

  // 响应头里不暴露框架名
  poweredByHeader: false,

  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
